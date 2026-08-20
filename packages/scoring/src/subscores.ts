import type { Criterion, LeadSpec } from '@leadmoor/core';

/**
 * Score decomposition.
 *
 * A single number hides how it was reached, so the score is broken into the dimensions a buyer
 * actually reasons about. Two rules make the decomposition honest:
 *
 *   - a dimension the search never asked about is `null` — "not applicable", not zero;
 *   - an undecided criterion leaves the denominator, so unknown never reads as failure.
 */

export interface SubScore {
  key: 'fit' | 'intent' | 'evidence' | 'contactability';
  label: string;
  /** null means "not applicable to this search", which is different from zero. */
  value: number | null;
  detail: string;
  help: string;
}

/** The parts of a lead the decomposition reads. */
export interface LeadFacts {
  coverage: number;
  emailStatus: string;
}

/** A stored criterion verdict, as the scorer wrote it. */
export interface Verdict {
  subjectId: string;
  criterionId: string;
  verdict: string;
  status: string;
  pointsAwarded: number;
  weight: number;
  sourceIds: unknown;
}

/**
 * Which dimension a criterion belongs to.
 *
 * Derived from how the criterion is *decided*, not from its wording: firmographic evaluators read
 * structured attributes (size, geography, registry facts), while the text evaluators look for a
 * signal in a document. That split is deterministic and inspectable, which matters more here than
 * a prettier taxonomy nobody could verify.
 */
function dimensionOf(criterion: Criterion): 'fit' | 'intent' {
  return criterion.evaluator.type === 'numeric_range' || criterion.evaluator.type === 'structured_predicate'
    ? 'fit'
    : 'intent';
}

export function computeSubScores(
  lead: LeadFacts,
  person: { fullName: string } | null,
  spec: LeadSpec | null,
  verdicts: Verdict[],
): { subScores: SubScore[]; sourceCount: number } {
  const sources = new Set<string>();
  for (const v of verdicts) {
    for (const id of Array.isArray(v.sourceIds) ? (v.sourceIds as string[]) : []) sources.add(id);
  }

  const byId = new Map(verdicts.map((v) => [v.criterionId, v]));
  const scored = (dimension: 'fit' | 'intent'): { value: number | null; detail: string } => {
    const criteria = (spec?.rubric.criteria ?? []).filter(
      (c) => c.kind !== 'disqualifier' && dimensionOf(c) === dimension,
    );
    if (criteria.length === 0) return { value: null, detail: 'Not part of this search' };

    let earned = 0;
    let evaluated = 0;
    let unknown = 0;

    for (const c of criteria) {
      const v = byId.get(c.id);
      // An unknown verdict is excluded from the denominator, never counted as a failure.
      if (!v || v.verdict === 'unknown' || v.status === 'not_configured' || v.status === 'rejected') {
        unknown += 1;
        continue;
      }
      earned += v.pointsAwarded;
      evaluated += v.weight;
    }

    if (evaluated === 0) {
      return { value: null, detail: `${criteria.length} criteria, none could be established` };
    }
    const pct = Math.round((earned / evaluated) * 100);
    const detail =
      unknown > 0
        ? `${criteria.length - unknown} of ${criteria.length} criteria decided`
        : `${criteria.length} criteria decided`;
    return { value: pct, detail };
  };

  const fit = scored('fit');
  const intent = scored('intent');

  const contactability = ((): { value: number | null; detail: string } => {
    if (!person) return { value: 0, detail: 'No decision maker found' };
    if (lead.emailStatus === 'verified') return { value: 100, detail: 'Named person, cited address' };
    if (lead.emailStatus === 'unverified') return { value: 60, detail: 'Named person, address from one source' };
    return { value: 30, detail: 'Named person, no address in evidence' };
  })();

  return {
    sourceCount: sources.size,
    subScores: [
      {
        key: 'fit',
        label: 'Fit',
        value: fit.value,
        detail: fit.detail,
        help: 'Share of firmographic criteria — size, geography, structured attributes — that this company met, counting only criteria we could actually decide.',
      },
      {
        key: 'intent',
        label: 'Intent',
        value: intent.value,
        detail: intent.detail,
        help: 'Share of signal criteria found in documents we retrieved and cited — hiring, adoption, published commitments.',
      },
      {
        key: 'evidence',
        label: 'Evidence',
        value: Math.round(lead.coverage * 100),
        detail:
          sources.size === 0
            ? 'No sources cited'
            : `${sources.size} independent ${sources.size === 1 ? 'source' : 'sources'}`,
        help: 'How much of the rubric’s weight could be evaluated from evidence we actually retrieved. A high score built on thin coverage is flagged, not hidden.',
      },
      {
        key: 'contactability',
        label: 'Contactability',
        value: contactability.value,
        detail: contactability.detail,
        help: 'Whether a named decision maker was found and whether an address appears verbatim in a cited document. LeadMoor never guesses an address from a pattern.',
      },
    ],
  };
}

