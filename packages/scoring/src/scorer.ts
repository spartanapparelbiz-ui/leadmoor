import type {
  Criterion,
  CriterionVerdict,
  LeadScore,
  LeadSpec,
} from '@leadmoor/core';
import {
  evaluateEvidenceKeyword,
  evaluateNumericRange,
  evaluateStructuredPredicate,
  type EvaluationContext,
  type PartialVerdict,
} from './evaluators.js';

/**
 * Scorer — ARCHITECTURE.md section 5.
 *
 * Judgment and arithmetic are kept apart. Evaluators decide pass/fail/unknown against evidence;
 * this file does nothing but deterministic arithmetic over those verdicts. No model ever emits a
 * score, which is what makes the number tunable, auditable, and explainable.
 */

export interface JudgeFn {
  (criterion: Criterion, ctx: EvaluationContext): Promise<PartialVerdict>;
}

export interface ScoreOptions {
  spec: LeadSpec;
  ctx: EvaluationContext;
  /** Supplied when an LLM is configured. Absent means llm_judge criteria return not_configured. */
  judge?: JudgeFn;
}

export async function scoreSubject(options: ScoreOptions): Promise<LeadScore> {
  const { spec, ctx, judge } = options;
  const verdicts: CriterionVerdict[] = [];

  for (const criterion of spec.rubric.criteria) {
    const partial = await evaluateCriterion(criterion, ctx, judge);
    verdicts.push(applyWeighting(criterion, partial, spec));
  }

  return aggregate(spec, verdicts);
}

async function evaluateCriterion(
  criterion: Criterion,
  ctx: EvaluationContext,
  judge: JudgeFn | undefined,
): Promise<PartialVerdict> {
  switch (criterion.evaluator.type) {
    case 'numeric_range':
      return evaluateNumericRange(criterion, ctx);
    case 'structured_predicate':
      return evaluateStructuredPredicate(criterion, ctx);
    case 'evidence_keyword':
      return evaluateEvidenceKeyword(criterion, ctx);
    case 'llm_judge': {
      if (!judge) {
        // No model configured. This is reported as its own status so the UI can say
        // "provider not configured" rather than implying the criterion failed.
        return {
          criterionId: criterion.id,
          verdict: 'unknown',
          status: 'not_configured',
          confidence: 0,
          spans: [],
          sourceIds: [],
          reasoning: 'no language model is configured, so this criterion could not be judged',
        };
      }
      return judge(criterion, ctx);
    }
  }
}

/**
 * Turn a raw verdict into a weighted one, enforcing the evidence requirements.
 *
 * The two-source rule lives here: a disqualifier backed by fewer independent sources than the
 * spec requires is demoted to `unknown`, so one weak source can never silently eliminate a lead.
 */
function applyWeighting(criterion: Criterion, partial: PartialVerdict, spec: LeadSpec): CriterionVerdict {
  const required = Math.max(
    criterion.evidenceRequirement.minSources,
    criterion.kind === 'disqualifier' ? spec.evidencePolicy.disqualifierMinSources : 1,
    spec.evidencePolicy.minSourcesPerCriterion,
  );
  const distinctSources = new Set(partial.sourceIds).size;

  let verdict = partial.verdict;
  let status = partial.status;
  let reasoning = partial.reasoning;

  if (verdict !== 'unknown' && distinctSources < required) {
    reasoning =
      `${reasoning} — held: ${distinctSources} independent source(s), ` +
      `${required} required${criterion.kind === 'disqualifier' ? ' for a disqualifying criterion' : ''}`;
    verdict = 'unknown';
    status = 'insufficient_evidence';
  }

  const weight = criterion.kind === 'hard_filter' ? 0 : criterion.weight;
  const pointsAwarded = verdict === 'pass' && (criterion.kind === 'weighted' || criterion.kind === 'bonus')
    ? weight
    : 0;

  return {
    criterionId: criterion.id,
    criterionName: criterion.name,
    kind: criterion.kind,
    verdict,
    status,
    confidence: partial.confidence,
    pointsAwarded,
    weight,
    spans: partial.spans,
    sourceIds: [...new Set(partial.sourceIds)],
    reasoning,
  };
}

/**
 * Deterministic aggregation.
 *
 * Coverage is the fraction of scoring weight that was actually evaluable. The score is normalized
 * against *evaluable* weight, not total weight, so a lead is never penalised for what we did not
 * manage to look up — instead its coverage is reported and, below the spec's minimum, the lead is
 * held rather than scored.
 */
export function aggregate(spec: LeadSpec, verdicts: CriterionVerdict[]): LeadScore {
  const scoring = verdicts.filter((v) => v.kind === 'weighted' || v.kind === 'bonus');
  const totalWeight = scoring.reduce((sum, v) => sum + v.weight, 0);
  const evaluableWeight = scoring
    .filter((v) => v.verdict !== 'unknown')
    .reduce((sum, v) => sum + v.weight, 0);
  const earned = scoring.reduce((sum, v) => sum + v.pointsAwarded, 0);

  const coverage = totalWeight === 0 ? 0 : evaluableWeight / totalWeight;
  const score = evaluableWeight === 0 ? 0 : Math.round((earned / evaluableWeight) * 100);

  const failedHardFilters = verdicts
    .filter((v) => v.kind === 'hard_filter' && v.verdict === 'fail')
    .map((v) => v.criterionName);

  const disqualifiedBy = verdicts
    .filter((v) => v.kind === 'disqualifier' && v.verdict === 'pass')
    .map((v) => v.criterionName);

  const disqualified = disqualifiedBy.length > 0;
  const belowCoverage = coverage < spec.evidencePolicy.minCoverage;

  const heldReason = belowCoverage
    ? `only ${Math.round(coverage * 100)}% of rubric weight could be evaluated (minimum ${Math.round(
        spec.evidencePolicy.minCoverage * 100,
      )}%)`
    : null;

  const qualified =
    !disqualified && failedHardFilters.length === 0 && !belowCoverage && score >= spec.rubric.passThreshold;

  return {
    score: disqualified ? 0 : score,
    band: bandFor(disqualified ? 0 : score, qualified),
    coverage,
    qualified,
    disqualified,
    disqualifiedBy,
    failedHardFilters,
    verdicts,
    heldReason,
  };
}

function bandFor(score: number, qualified: boolean): LeadScore['band'] {
  if (!qualified) return 'unqualified';
  if (score >= 80) return 'A';
  if (score >= 60) return 'B';
  return 'C';
}

/**
 * Human-readable explanation built strictly from verdicts that carry evidence.
 * Nothing is asserted here that a citation does not already support.
 */
export function explainScore(result: LeadScore, limit = 4): string {
  const passing = result.verdicts
    .filter((v) => v.verdict === 'pass' && v.pointsAwarded > 0)
    .sort((a, b) => b.pointsAwarded - a.pointsAwarded)
    .slice(0, limit);

  if (result.disqualified) {
    return `Disqualified by ${result.disqualifiedBy.join(', ')}.`;
  }
  if (result.heldReason) {
    return `Held for review — ${result.heldReason}.`;
  }
  if (passing.length === 0) {
    return 'No criteria could be confirmed from retrieved evidence.';
  }
  const parts = passing.map((v) => `${v.criterionName} (+${v.pointsAwarded})`);
  const unknowns = result.verdicts.filter((v) => v.verdict === 'unknown').length;
  const tail = unknowns > 0 ? ` ${unknowns} criterion(s) unknown.` : '';
  return `${parts.join(', ')}.${tail}`;
}
