import { describe, expect, it } from 'vitest';
import { parseLeadSpec, totalScoringWeight, validateLeadSpecSemantics } from '@leadmoor/core';
import { HeuristicSpecCompiler, buildLeadSpec, type SpecDraft } from '@leadmoor/llm';
import { testSpec } from '../helpers/harness.js';

describe('LeadSpec parsing and validation', () => {
  it('accepts a well-formed spec', () => {
    const result = parseLeadSpec(testSpec());
    expect(result.ok).toBe(true);
  });

  it('rejects a spec with no rubric criteria', () => {
    const result = parseLeadSpec(testSpec({ rubric: { criteria: [], passThreshold: 50 } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(' ')).toMatch(/criteria/i);
  });

  it('rejects duplicate criterion ids', () => {
    const spec = testSpec() as ReturnType<typeof testSpec>;
    const first = spec.rubric.criteria[0]!;
    const problems = validateLeadSpecSemantics({
      ...spec,
      rubric: { ...spec.rubric, criteria: [first, { ...first }] },
    } as never);
    expect(problems.join(' ')).toMatch(/duplicate criterion id/);
  });

  it('rejects an inverted employee range', () => {
    const result = parseLeadSpec(
      testSpec({ company: { descriptors: [], employeeRange: { min: 500, max: 50 }, industries: [], excludeDomains: [] } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(' ')).toMatch(/exceeds/);
  });

  it('rejects a numeric_range criterion with neither bound', () => {
    const spec = testSpec() as ReturnType<typeof testSpec>;
    const broken = {
      ...spec,
      rubric: {
        ...spec.rubric,
        criteria: [
          {
            ...spec.rubric.criteria[0]!,
            evaluator: { type: 'numeric_range' as const, field: 'company.employeeCount' },
          },
        ],
      },
    };
    const result = parseLeadSpec(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join(' ')).toMatch(/at least one of min\/max/);
  });

  it('rejects a disqualifier that requires fewer sources than the policy demands', () => {
    const spec = testSpec() as ReturnType<typeof testSpec>;
    const problems = validateLeadSpecSemantics({
      ...spec,
      rubric: {
        ...spec.rubric,
        criteria: [
          ...spec.rubric.criteria,
          {
            id: 'bad_disqualifier',
            name: 'Bad',
            description: '',
            kind: 'disqualifier' as const,
            weight: 10,
            evaluator: { type: 'structured_predicate' as const, field: 'company.location', op: 'exists' as const },
            evidenceRequirement: { minSources: 1 },
          },
        ],
      },
    } as never);
    expect(problems.join(' ')).toMatch(/at least 2 independent sources/);
  });

  it('rejects garbage input rather than coercing it', () => {
    for (const input of [null, undefined, 42, 'a string', [], { version: 99 }]) {
      expect(parseLeadSpec(input).ok).toBe(false);
    }
  });

  it('computes total scoring weight from weighted and bonus criteria only', () => {
    const parsed = parseLeadSpec(testSpec());
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(totalScoringWeight(parsed.spec)).toBe(50);
  });
});

describe('deterministic rubric construction', () => {
  const draft: SpecDraft = {
    name: 'Security-forward SaaS',
    countries: ['US'],
    companyDescriptors: ['B2B SaaS'],
    industries: [],
    employeeMin: 50,
    employeeMax: 500,
    signals: [
      { id: 'Security Hiring!', label: 'Security hiring', terms: ['security engineer'], weight: 22, required: false },
    ],
    personaTitles: ['CTO'],
    leadCount: 20,
    excludeDomains: [],
    searchQueries: ['b2b saas security'],
  };

  it('builds an executable spec from an intent draft', () => {
    const result = buildLeadSpec(draft, 'find me security-forward saas');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.spec.rubric.criteria.map((c) => c.id)).toContain('security_hiring');
    expect(result.spec.rubric.criteria.map((c) => c.id)).toContain('employee_count');
    expect(result.spec.rubric.criteria.map((c) => c.id)).toContain('decision_maker_identified');
  });

  it('is reproducible — the same draft yields an identical rubric', () => {
    const a = buildLeadSpec(draft, 'req');
    const b = buildLeadSpec(draft, 'req');
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(JSON.stringify(a.spec.rubric)).toBe(JSON.stringify(b.spec.rubric));
  });

  it('marks a required signal as a hard filter', () => {
    const result = buildLeadSpec(
      { ...draft, signals: [{ ...draft.signals[0]!, required: true }] },
      'req',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.spec.rubric.criteria.find((c) => c.id === 'security_hiring')?.kind).toBe('hard_filter');
    }
  });
});

describe('heuristic compiler', () => {
  const compiler = new HeuristicSpecCompiler();

  it('extracts size band, geography, titles, and signals from a real request', () => {
    const result = compiler.compile(
      'Find 20 US-based B2B SaaS companies with 50-500 employees that are hiring security engineers and identify the CTO or VP Engineering.',
    );
    expect(result.ok).toBe(true);
    if (!result.ok || !result.spec) return;

    expect(result.spec.geography.countries).toContain('US');
    expect(result.spec.company.employeeRange).toEqual({ min: 50, max: 500 });
    expect(result.spec.personas.titles).toEqual(expect.arrayContaining(['CTO']));
    expect(result.spec.rubric.criteria.map((c) => c.id)).toContain('security_hiring');
  });

  it('labels its output so a keyword draft is never mistaken for a considered one', () => {
    const result = compiler.compile('Find SaaS companies');
    expect(result.origin).toBe('heuristic');
    expect(result.notice).toMatch(/without a language model/i);
  });

  it('does not invent a size band the user never stated', () => {
    const result = compiler.compile('Find US SaaS companies hiring security engineers');
    expect(result.ok).toBe(true);
    if (result.ok && result.spec) expect(result.spec.company.employeeRange).toBeUndefined();
  });

  it('parses "under N employees" and "over N employees"', () => {
    const under = compiler.compile('SaaS companies under 200 employees');
    const over = compiler.compile('SaaS companies over 1,000 employees');
    if (under.ok && under.spec) expect(under.spec.company.employeeRange).toEqual({ min: undefined, max: 200 });
    if (over.ok && over.spec) expect(over.spec.company.employeeRange).toEqual({ min: 1000, max: undefined });
  });
});
