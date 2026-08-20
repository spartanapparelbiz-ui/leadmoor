import { describe, expect, it } from 'vitest';
import type { Claim, Criterion, EvidenceRecord, FieldView, LeadSpec } from '@leadmoor/core';
import { parseLeadSpec } from '@leadmoor/core';
import {
  aggregate,
  evaluateEvidenceKeyword,
  evaluateNumericRange,
  evaluateStructuredPredicate,
  explainScore,
  scoreSubject,
  type EvaluationContext,
} from '@leadmoor/scoring';
import { testSpec } from '../helpers/harness.js';

function spec(overrides: Record<string, unknown> = {}): LeadSpec {
  const parsed = parseLeadSpec(testSpec(overrides));
  if (!parsed.ok) throw new Error(parsed.problems.join('; '));
  return parsed.spec;
}

function view(field: string, value: unknown, opts: Partial<FieldView> = {}): FieldView {
  const claim: Claim = {
    id: 'claim-1',
    runId: 'r',
    subjectType: 'company',
    subjectId: 'c',
    field,
    fieldClass: 'company_firmographic',
    value,
    spans: [{ evidenceId: 'e1', start: 0, end: 3, quote: '142' }],
    sourceId: 'company_web',
    extractor: 'pattern_match',
    confidence: 0.8,
    status: 'supported',
    observedAt: new Date(),
    createdAt: new Date(),
    note: null,
  };
  return {
    field,
    value,
    winningClaimId: 'claim-1',
    conflicting: false,
    candidates: [claim],
    supportingSourceCount: 1,
    confidence: 0.8,
    ...opts,
  };
}

function evidence(text: string, id = 'e1', role: EvidenceRecord['documentRole'] = 'company_careers'): EvidenceRecord {
  return {
    id,
    runId: 'r',
    sourceId: 'company_web',
    url: `https://acme.example/${id}`,
    title: null,
    documentRole: role,
    httpStatus: 200,
    contentHash: 'h',
    contentType: 'text/html',
    normalizedText: text,
    byteLength: text.length,
    fetchedAt: new Date(),
    robotsDecision: 'allowed',
    metadata: {},
  };
}

function ctx(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return { spec: spec(), views: new Map(), claims: [], evidence: [], ...overrides };
}

const criterion = (over: Partial<Criterion> = {}): Criterion => ({
  id: 'c1',
  name: 'Test criterion',
  description: '',
  kind: 'weighted',
  weight: 10,
  evaluator: { type: 'numeric_range', field: 'company.employeeCount', min: 50, max: 500 },
  evidenceRequirement: { minSources: 1 },
  ...over,
});

describe('numeric range evaluator', () => {
  it('passes inside the range and cites the claim evidence', () => {
    const result = evaluateNumericRange(criterion(), ctx({ views: new Map([['company.employeeCount', view('company.employeeCount', 142)]]) }));
    expect(result.verdict).toBe('pass');
    expect(result.spans).toHaveLength(1);
  });

  it('fails outside the range', () => {
    const result = evaluateNumericRange(criterion(), ctx({ views: new Map([['company.employeeCount', view('company.employeeCount', 4000)]]) }));
    expect(result.verdict).toBe('fail');
  });

  it('returns unknown — not fail — when nothing is known', () => {
    const result = evaluateNumericRange(criterion(), ctx());
    expect(result.verdict).toBe('unknown');
    expect(result.status).toBe('insufficient_evidence');
  });

  it('reads a published band as its midpoint', () => {
    const result = evaluateNumericRange(criterion(), ctx({ views: new Map([['company.employeeCount', view('company.employeeCount', '51-200')]]) }));
    expect(result.verdict).toBe('pass');
  });

  it('reports a conflict in its reasoning rather than hiding it', () => {
    const result = evaluateNumericRange(
      criterion(),
      ctx({ views: new Map([['company.employeeCount', view('company.employeeCount', 142, { conflicting: true })]]) }),
    );
    expect(result.reasoning).toMatch(/sources disagree/);
  });
});

describe('evidence keyword evaluator', () => {
  const kw = criterion({
    evaluator: {
      type: 'evidence_keyword',
      anyOf: ['security engineer', 'SOC 2'],
      allOf: [],
      fieldClass: 'company_signal',
      minMatches: 1,
      documentRoles: [],
    },
  });

  it('passes with a real span quoting the matched sentence', () => {
    const doc = evidence('We are hiring a Security Engineer for our platform team.');
    const result = evaluateEvidenceKeyword(kw, ctx({ evidence: [doc] }));
    expect(result.verdict).toBe('pass');
    expect(result.spans[0]!.quote.toLowerCase()).toContain('security engineer');
    expect(doc.normalizedText.slice(result.spans[0]!.start, result.spans[0]!.end)).toBe(result.spans[0]!.quote);
  });

  it('treats absence as unknown, never as false', () => {
    const result = evaluateEvidenceKeyword(kw, ctx({ evidence: [evidence('We sell widgets.')] }));
    expect(result.verdict).toBe('unknown');
    expect(result.reasoning).toMatch(/absence of evidence, not evidence of absence/);
  });

  it('is unknown when no documents were retrieved at all', () => {
    const result = evaluateEvidenceKeyword(kw, ctx({ evidence: [] }));
    expect(result.verdict).toBe('unknown');
    expect(result.reasoning).toMatch(/no documents were retrieved/);
  });

  it('raises confidence when more sources corroborate', () => {
    const one = evaluateEvidenceKeyword(kw, ctx({ evidence: [evidence('Security Engineer wanted', 'e1')] }));
    const two = evaluateEvidenceKeyword(
      kw,
      ctx({
        evidence: [
          evidence('Security Engineer wanted', 'e1'),
          { ...evidence('We hold SOC 2 certification', 'e2'), sourceId: 'github_public' },
        ],
      }),
    );
    expect(two.confidence).toBeGreaterThan(one.confidence);
  });

  it('respects a document-role restriction', () => {
    const restricted = criterion({
      evaluator: {
        type: 'evidence_keyword',
        anyOf: ['security engineer'],
        allOf: [],
        fieldClass: 'company_signal',
        minMatches: 1,
        documentRoles: ['company_careers'],
      },
    });
    const wrongRole = evaluateEvidenceKeyword(
      restricted,
      ctx({ evidence: [evidence('Security Engineer', 'e1', 'company_pricing')] }),
    );
    expect(wrongRole.verdict).toBe('unknown');
  });
});

describe('structured predicate evaluator', () => {
  it('handles exists when the field is absent', () => {
    const c = criterion({ evaluator: { type: 'structured_predicate', field: 'person.role', op: 'exists' } });
    expect(evaluateStructuredPredicate(c, ctx()).verdict).toBe('fail');
  });

  it('handles includes against an array of accepted values', () => {
    const c = criterion({
      evaluator: { type: 'structured_predicate', field: 'company.location', op: 'includes', value: ['United States', 'USA'] },
    });
    const result = evaluateStructuredPredicate(c, ctx({ views: new Map([['company.location', view('company.location', 'San Francisco, United States')]]) }));
    expect(result.verdict).toBe('pass');
  });
});

describe('aggregation', () => {
  const base = spec();

  it('normalizes against evaluable weight, not total weight', () => {
    const result = aggregate(base, [
      { criterionId: 'a', criterionName: 'A', kind: 'weighted', verdict: 'pass', status: 'evaluated', confidence: 0.8, pointsAwarded: 20, weight: 20, spans: [], sourceIds: ['s1'], reasoning: '' },
      { criterionId: 'b', criterionName: 'B', kind: 'weighted', verdict: 'unknown', status: 'insufficient_evidence', confidence: 0, pointsAwarded: 0, weight: 30, spans: [], sourceIds: [], reasoning: '' },
    ]);
    // 20/20 evaluable = 100, not 20/50 = 40. The unknown lowers coverage instead.
    expect(result.score).toBe(100);
    expect(result.coverage).toBeCloseTo(0.4, 5);
  });

  it('holds a lead whose coverage is below the spec minimum instead of scoring it low', () => {
    const result = aggregate(base, [
      { criterionId: 'a', criterionName: 'A', kind: 'weighted', verdict: 'pass', status: 'evaluated', confidence: 0.8, pointsAwarded: 5, weight: 5, spans: [], sourceIds: ['s1'], reasoning: '' },
      { criterionId: 'b', criterionName: 'B', kind: 'weighted', verdict: 'unknown', status: 'insufficient_evidence', confidence: 0, pointsAwarded: 0, weight: 95, spans: [], sourceIds: [], reasoning: '' },
    ]);
    expect(result.heldReason).toMatch(/could be evaluated/);
    expect(result.qualified).toBe(false);
  });

  it('zeroes a disqualified lead and names the disqualifier', () => {
    const result = aggregate(base, [
      { criterionId: 'a', criterionName: 'A', kind: 'weighted', verdict: 'pass', status: 'evaluated', confidence: 0.9, pointsAwarded: 50, weight: 50, spans: [], sourceIds: ['s1'], reasoning: '' },
      { criterionId: 'd', criterionName: 'Competitor', kind: 'disqualifier', verdict: 'pass', status: 'evaluated', confidence: 0.9, pointsAwarded: 0, weight: 0, spans: [], sourceIds: ['s1', 's2'], reasoning: '' },
    ]);
    expect(result.score).toBe(0);
    expect(result.disqualified).toBe(true);
    expect(explainScore(result)).toMatch(/Disqualified by Competitor/);
  });

  it('records a failed hard filter without letting it contribute points', () => {
    const result = aggregate(base, [
      { criterionId: 'h', criterionName: 'Must be US', kind: 'hard_filter', verdict: 'fail', status: 'evaluated', confidence: 0.9, pointsAwarded: 0, weight: 0, spans: [], sourceIds: ['s1'], reasoning: '' },
      { criterionId: 'a', criterionName: 'A', kind: 'weighted', verdict: 'pass', status: 'evaluated', confidence: 0.9, pointsAwarded: 50, weight: 50, spans: [], sourceIds: ['s1'], reasoning: '' },
    ]);
    expect(result.failedHardFilters).toEqual(['Must be US']);
    expect(result.qualified).toBe(false);
  });
});

describe('two-source rule for disqualifiers', () => {
  const withDisqualifier = spec({
    rubric: {
      criteria: [
        ...testSpec().rubric.criteria,
        {
          id: 'is_competitor',
          name: 'Is a competitor',
          description: '',
          kind: 'disqualifier' as const,
          weight: 0,
          evaluator: {
            type: 'evidence_keyword' as const,
            anyOf: ['competitor product'],
            allOf: [],
            fieldClass: 'company_signal' as const,
            minMatches: 1,
            documentRoles: [],
          },
          evidenceRequirement: { minSources: 2 },
        },
      ],
      passThreshold: 40,
    },
  });

  it('will not disqualify on a single source', async () => {
    const result = await scoreSubject({
      spec: withDisqualifier,
      ctx: ctx({ spec: withDisqualifier, evidence: [evidence('our competitor product is better', 'e1')] }),
    });
    const verdict = result.verdicts.find((v) => v.criterionId === 'is_competitor');
    expect(verdict?.verdict).toBe('unknown');
    expect(verdict?.reasoning).toMatch(/1 independent source\(s\), 2 required/);
    expect(result.disqualified).toBe(false);
  });

  it('disqualifies once two independent sources agree', async () => {
    const result = await scoreSubject({
      spec: withDisqualifier,
      ctx: ctx({
        spec: withDisqualifier,
        evidence: [
          evidence('our competitor product is better', 'e1'),
          { ...evidence('competitor product listed here', 'e2'), sourceId: 'github_public' },
        ],
      }),
    });
    expect(result.disqualified).toBe(true);
    expect(result.disqualifiedBy).toEqual(['Is a competitor']);
  });
});

describe('llm_judge without a configured model', () => {
  const judged = spec({
    rubric: {
      criteria: [
        {
          id: 'fuzzy',
          name: 'Sells into regulated industries',
          description: '',
          kind: 'weighted' as const,
          weight: 20,
          evaluator: { type: 'llm_judge' as const, question: 'Does this company sell into regulated industries?', fieldClass: 'company_signal' as const },
          evidenceRequirement: { minSources: 1 },
        },
      ],
      passThreshold: 40,
    },
  });

  it('reports not_configured rather than failing the criterion', async () => {
    const result = await scoreSubject({ spec: judged, ctx: ctx({ spec: judged }) });
    const verdict = result.verdicts[0]!;
    expect(verdict.status).toBe('not_configured');
    expect(verdict.verdict).toBe('unknown');
    expect(verdict.pointsAwarded).toBe(0);
    expect(result.heldReason).toMatch(/could be evaluated/);
  });
});

describe('reproducibility', () => {
  it('produces an identical score for identical inputs', async () => {
    const s = spec();
    const context = () => ctx({ spec: s, views: new Map([['company.employeeCount', view('company.employeeCount', 142)]]), evidence: [evidence('hiring a security engineer')] });
    const a = await scoreSubject({ spec: s, ctx: context() });
    const b = await scoreSubject({ spec: s, ctx: context() });
    expect(a.score).toBe(b.score);
    expect(JSON.stringify(a.verdicts)).toBe(JSON.stringify(b.verdicts));
  });
});
