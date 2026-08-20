import type {
  Claim,
  Criterion,
  CriterionVerdict,
  EvidenceRecord,
  EvidenceSpan,
  FieldView,
  LeadSpec,
} from '@leadmoor/core';
import { findTermSpans } from '@leadmoor/evidence';

/**
 * Criterion evaluators.
 *
 * Three of the four are fully deterministic and produce real citations without a model:
 * `numeric_range` and `structured_predicate` read the claim view (itself evidence-backed), and
 * `evidence_keyword` searches stored document text and returns the exact matched span.
 *
 * `llm_judge` is the only evaluator that needs a model, and it lives in judge.ts because its
 * output has to survive citation validation before it may influence a score.
 */

export interface EvaluationContext {
  spec: LeadSpec;
  /** Resolved field views for the subject, keyed by field path. */
  views: Map<string, FieldView>;
  /** Every claim on the subject, for source counting. */
  claims: Claim[];
  /** Documents retrieved for this subject, available to keyword evaluators. */
  evidence: EvidenceRecord[];
}

/** A verdict that has not yet been scored — points are assigned by the aggregator. */
export type PartialVerdict = Omit<CriterionVerdict, 'pointsAwarded' | 'weight' | 'kind' | 'criterionName'>;

export function evaluateNumericRange(criterion: Criterion, ctx: EvaluationContext): PartialVerdict {
  if (criterion.evaluator.type !== 'numeric_range') throw new Error('wrong evaluator');
  const { field, min, max } = criterion.evaluator;
  const view = ctx.views.get(field);

  if (!view || view.value === null) {
    return unknownVerdict(criterion.id, `no supported claim for ${field}`);
  }

  const numeric = toNumber(view.value);
  if (numeric === null) {
    return unknownVerdict(criterion.id, `value for ${field} is not numeric: ${String(view.value)}`);
  }

  const aboveMin = min === undefined || numeric >= min;
  const belowMax = max === undefined || numeric <= max;
  const pass = aboveMin && belowMax;
  const bounds = [min !== undefined ? `min ${min}` : null, max !== undefined ? `max ${max}` : null]
    .filter(Boolean)
    .join(', ');

  const winning = view.candidates.find((c) => c.id === view.winningClaimId);
  return {
    criterionId: criterion.id,
    verdict: pass ? 'pass' : 'fail',
    status: 'evaluated',
    confidence: view.confidence,
    spans: winning?.spans ?? [],
    sourceIds: winning ? [winning.sourceId] : [],
    reasoning: `${field} is ${numeric} (${bounds}) — ${pass ? 'within range' : 'outside range'}${
      view.conflicting ? '; sources disagree on this value' : ''
    }`,
  };
}

export function evaluateStructuredPredicate(criterion: Criterion, ctx: EvaluationContext): PartialVerdict {
  if (criterion.evaluator.type !== 'structured_predicate') throw new Error('wrong evaluator');
  const { field, op, value } = criterion.evaluator;
  const view = ctx.views.get(field);

  if (!view || view.value === null) {
    if (op === 'exists') {
      return {
        criterionId: criterion.id,
        verdict: 'fail',
        status: 'evaluated',
        confidence: 0.5,
        spans: [],
        sourceIds: [],
        reasoning: `no supported claim exists for ${field}`,
      };
    }
    return unknownVerdict(criterion.id, `no supported claim for ${field}`);
  }

  const actual = view.value;
  const winning = view.candidates.find((c) => c.id === view.winningClaimId);
  let pass = false;

  switch (op) {
    case 'exists':
      pass = true;
      break;
    case 'equals':
      pass = looseEquals(actual, value);
      break;
    case 'not_equals':
      pass = !looseEquals(actual, value);
      break;
    case 'includes':
      pass = includesValue(actual, value);
      break;
    case 'excludes':
      pass = !includesValue(actual, value);
      break;
  }

  return {
    criterionId: criterion.id,
    verdict: pass ? 'pass' : 'fail',
    status: 'evaluated',
    confidence: view.confidence,
    spans: winning?.spans ?? [],
    sourceIds: winning ? [winning.sourceId] : [],
    reasoning: `${field} ${op} ${JSON.stringify(value ?? null)} — actual ${JSON.stringify(actual)}`,
  };
}

/**
 * Searches stored evidence for the criterion's terms and cites the exact matched sentence.
 *
 * Absence is reported as `unknown`, never as `fail`: not finding "SOC 2" on the pages we happened
 * to retrieve is not evidence that a company lacks SOC 2.
 */
export function evaluateEvidenceKeyword(criterion: Criterion, ctx: EvaluationContext): PartialVerdict {
  if (criterion.evaluator.type !== 'evidence_keyword') throw new Error('wrong evaluator');
  const { anyOf, allOf, minMatches, documentRoles } = criterion.evaluator;

  const pool =
    documentRoles.length > 0
      ? ctx.evidence.filter((e) => documentRoles.includes(e.documentRole))
      : ctx.evidence;

  if (pool.length === 0) {
    return unknownVerdict(
      criterion.id,
      documentRoles.length > 0
        ? `no ${documentRoles.join('/')} documents were retrieved for this company`
        : 'no documents were retrieved for this company',
    );
  }

  const spans: EvidenceSpan[] = [];
  const sources = new Set<string>();
  const matchedTerms = new Set<string>();

  for (const doc of pool) {
    for (const term of anyOf) {
      const found = findTermSpans(doc.id, doc.normalizedText, term, 2);
      if (found.length > 0) {
        matchedTerms.add(term);
        sources.add(doc.sourceId);
        for (const s of found) if (spans.length < 6) spans.push(s);
      }
    }
  }

  const requiredPresent = allOf.every((term) =>
    pool.some((doc) => doc.normalizedText.toLowerCase().includes(term.toLowerCase())),
  );

  if (matchedTerms.size >= minMatches && requiredPresent) {
    return {
      criterionId: criterion.id,
      verdict: 'pass',
      status: 'evaluated',
      // Confidence tracks how many distinct terms and documents corroborate.
      confidence: Math.min(0.95, 0.55 + 0.12 * matchedTerms.size + 0.08 * (sources.size - 1)),
      spans,
      sourceIds: [...sources],
      reasoning: `found ${[...matchedTerms].map((t) => `"${t}"`).join(', ')} in ${sources.size} source(s)`,
    };
  }

  return unknownVerdict(
    criterion.id,
    `none of ${anyOf.map((t) => `"${t}"`).join(', ')} appeared in the ${pool.length} document(s) retrieved — absence of evidence, not evidence of absence`,
  );
}

function unknownVerdict(criterionId: string, reason: string): PartialVerdict {
  return {
    criterionId,
    verdict: 'unknown',
    status: 'insufficient_evidence',
    confidence: 0,
    spans: [],
    sourceIds: [],
    reasoning: reason,
  };
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const cleaned = value.replace(/[,\s]/g, '');
    const range = /^(\d+)[-–](\d+)$/.exec(cleaned);
    if (range?.[1] && range[2]) {
      // A published band like "51-200" is represented by its midpoint.
      return (Number(range[1]) + Number(range[2])) / 2;
    }
    const plus = /^(\d+)\+$/.exec(cleaned);
    if (plus?.[1]) return Number(plus[1]);
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function looseEquals(actual: unknown, expected: unknown): boolean {
  if (typeof actual === 'string' && typeof expected === 'string') {
    return actual.trim().toLowerCase() === expected.trim().toLowerCase();
  }
  return actual === expected;
}

function includesValue(actual: unknown, expected: unknown): boolean {
  const needles = Array.isArray(expected) ? expected : [expected];
  const haystack = Array.isArray(actual) ? actual.map(String) : [String(actual)];
  return needles.some((n) =>
    haystack.some((h) => h.toLowerCase().includes(String(n).toLowerCase())),
  );
}
