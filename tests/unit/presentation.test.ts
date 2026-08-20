import { describe, expect, it } from 'vitest';
import { EXPORT_COLUMNS, toCsv, toCsvColumns, type ExportRow } from '@leadmoor/export';
import { computeSubScores, type LeadFacts, type SubScore } from '@leadmoor/scoring';
import { humanize, bandClass, emailPill, statusPill, verdictPill } from '../../apps/web/src/lib/format.js';

/**
 * Presentation rules.
 *
 * These are the guarantees that stop the interface from overstating what the pipeline established:
 * an unknown never renders as a failure, a dimension the search never asked about never renders as
 * zero, and a chosen column subset never smuggles a field past the export writer's guards.
 */

function row(overrides: Partial<ExportRow> = {}): ExportRow {
  return {
    company: 'Acme',
    domain: 'acme.example',
    person: 'Dana Ray',
    role: 'CTO',
    email: 'dana@acme.example',
    email_status: 'unverified',
    score: '72',
    coverage: '80%',
    status: 'qualified',
    why_fit: 'Hiring for security',
    evidence_count: '3',
    source_urls: 'https://acme.example/careers',
    ...overrides,
  };
}

describe('CSV column selection', () => {
  it('writes only the chosen columns, in the canonical order', () => {
    const csv = toCsvColumns([row()], ['email', 'company']);
    const [header, body] = csv.split('\n');
    expect(header).toBe('company,email');
    expect(body).toBe('Acme,dana@acme.example');
  });

  it('ignores names that are not real columns rather than inventing a field', () => {
    const csv = toCsvColumns([row()], ['company', 'salary' as never, 'phone' as never]);
    expect(csv.split('\n')[0]).toBe('company');
  });

  it('falls back to every column when the selection matches nothing', () => {
    const csv = toCsvColumns([row()], ['nonsense' as never]);
    expect(csv.split('\n')[0]).toBe(EXPORT_COLUMNS.join(','));
  });

  it('keeps the formula-injection guard on a narrowed export', () => {
    const csv = toCsvColumns([row({ company: '=cmd|calc' })], ['company']);
    expect(csv.split('\n')[1]).toBe("'=cmd|calc");
  });

  it('agrees with toCsv when every column is chosen', () => {
    expect(toCsvColumns([row()], [...EXPORT_COLUMNS])).toBe(toCsv([row()]));
  });

  it('quotes a value containing a comma so columns cannot shift', () => {
    const csv = toCsvColumns([row({ why_fit: 'Hiring, and compliant' })], ['why_fit']);
    expect(csv.split('\n')[1]).toBe('"Hiring, and compliant"');
  });
});

/* ── sub-scores ───────────────────────────────────────────────────────── */

const lead = (overrides: Partial<LeadFacts> = {}): LeadFacts => ({
  coverage: 0.8,
  emailStatus: 'unavailable',
  ...overrides,
});

const of = (scores: SubScore[], key: SubScore['key']): SubScore | undefined =>
  scores.find((s) => s.key === key);

const criterion = (id: string, type: string) =>
  ({
    id,
    name: id,
    description: '',
    kind: 'weighted' as const,
    weight: 10,
    evaluator: { type, field: 'company.employeeCount' } as never,
    evidenceRequirement: { minSources: 1 },
  }) as never;

const spec = (criteria: unknown[]) =>
  ({ rubric: { criteria, passThreshold: 50 } }) as never;

const verdict = (criterionId: string, over: Record<string, unknown> = {}) => ({
  subjectId: 'co-1',
  criterionId,
  verdict: 'pass',
  status: 'ok',
  pointsAwarded: 10,
  weight: 10,
  sourceIds: ['company_web'],
  ...over,
});

describe('score decomposition', () => {
  it('reports a dimension the search never asked about as not applicable, not zero', () => {
    const { subScores } = computeSubScores(lead(), null, spec([criterion('size', 'numeric_range')]), []);
    const intent = of(subScores, 'intent');
    expect(intent?.value).toBeNull();
    expect(intent?.detail).toMatch(/not part of this search/i);
  });

  it('excludes unknown verdicts from the denominator rather than counting them as failures', () => {
    const criteria = [criterion('size', 'numeric_range'), criterion('country', 'structured_predicate')];
    const verdicts = [verdict('size'), verdict('country', { verdict: 'unknown', pointsAwarded: 0 })];
    const { subScores } = computeSubScores(lead(), null, spec(criteria), verdicts);

    // One of two decided, and it passed: 100%, not the 50% that treating unknown as failure gives.
    expect(of(subScores, 'fit')?.value).toBe(100);
    expect(of(subScores, 'fit')?.detail).toMatch(/1 of 2/);
  });

  it('treats a rejected model answer as undecided, never as a pass', () => {
    const criteria = [criterion('judgement', 'llm_judge')];
    const verdicts = [verdict('judgement', { status: 'rejected', pointsAwarded: 10 })];
    const { subScores } = computeSubScores(lead(), null, spec(criteria), verdicts);
    expect(of(subScores, 'intent')?.value).toBeNull();
  });

  it('separates firmographic criteria from signal criteria', () => {
    const criteria = [criterion('size', 'numeric_range'), criterion('hiring', 'evidence_keyword')];
    const verdicts = [verdict('size'), verdict('hiring', { verdict: 'fail', pointsAwarded: 0 })];
    const { subScores } = computeSubScores(lead(), null, spec(criteria), verdicts);

    expect(of(subScores, 'fit')?.value).toBe(100);
    expect(of(subScores, 'intent')?.value).toBe(0);
  });

  it('scores contactability from the real email state, never from an inference', () => {
    const none = computeSubScores(lead(), null, null, []);
    expect(of(none.subScores, 'contactability')?.value).toBe(0);

    const person = { id: 'p1', fullName: 'Dana Ray', title: 'CTO' };
    const unverified = computeSubScores(lead({ emailStatus: 'unverified' }), person, null, []);
    const verified = computeSubScores(lead({ emailStatus: 'verified' }), person, null, []);
    const missing = computeSubScores(lead({ emailStatus: 'unavailable' }), person, null, []);

    expect(of(verified.subScores, 'contactability')?.value).toBe(100);
    expect(of(unverified.subScores, 'contactability')?.value).toBe(60);
    expect(of(missing.subScores, 'contactability')?.detail).toMatch(/no address/i);
  });

  it('reports evidence coverage as the stored coverage, not as a derived guess', () => {
    const { subScores, sourceCount } = computeSubScores(lead({ coverage: 0.55 }), null, null, [
      verdict('a', { sourceIds: ['company_web', 'github_public'] }),
    ]);
    expect(of(subScores, 'evidence')?.value).toBe(55);
    expect(sourceCount).toBe(2);
  });

  it('counts each source once across criteria', () => {
    const { sourceCount } = computeSubScores(lead(), null, null, [
      verdict('a', { sourceIds: ['company_web'] }),
      verdict('b', { sourceIds: ['company_web'] }),
    ]);
    expect(sourceCount).toBe(1);
  });
});

/* ── state vocabulary ─────────────────────────────────────────────────── */

describe('state is never overstated', () => {
  it('gives unknown its own colour rather than folding it into failure', () => {
    expect(verdictPill('unknown', 'ok').className).toContain('unknown');
    expect(verdictPill('fail', 'ok').className).toContain('crit');
    expect(verdictPill('unknown', 'ok').className).not.toBe(verdictPill('fail', 'ok').className);
  });

  it('shows an unconfigured provider as unconfigured, not as a failed check', () => {
    expect(verdictPill('unknown', 'not_configured').label).toMatch(/not configured/i);
  });

  it('never labels an unverified address as verified', () => {
    expect(emailPill('unverified').label).toBe('Unverified');
    expect(emailPill('unavailable').label).toMatch(/none found/i);
    expect(emailPill('verified').label).toBe('Verified');
  });

  it('distinguishes held-for-evidence from disqualified', () => {
    expect(statusPill('held_insufficient_evidence').label).toMatch(/insufficient evidence/i);
    expect(statusPill('disqualified').label).toBe('Disqualified');
  });

  it('flags a high score built on thin coverage', () => {
    expect(bandClass('A', 0.5)).toBe('score--partial');
    expect(bandClass('A', 1)).toBe('score--a');
  });

  it('reads camelCase and snake_case field names as words', () => {
    expect(humanize('employeeCount')).toBe('Employee count');
    expect(humanize('people_discovery')).toBe('People discovery');
    expect(humanize('company.techStack'.replace(/^company\./, ''))).toBe('Tech stack');
  });
});
