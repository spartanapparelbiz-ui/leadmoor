import type { SubScore } from '@/lib/leads';

/**
 * The score, decomposed.
 *
 * A single number hides how it was reached, so each dimension is shown with the evidence behind
 * it. A dimension the search never asked about renders as "not applicable" rather than zero —
 * those are different facts and conflating them would misrepresent the lead.
 */
export function ScoreBreakdown({ subScores, compact }: { subScores: SubScore[]; compact?: boolean }) {
  return (
    <div className="col g-8">
      {subScores.map((s) => (
        <div key={s.key} className="subscore" title={s.help}>
          <span className="subscore__name">{s.label}</span>
          <div className="bar" aria-hidden="true">
            {s.value === null ? null : (
              <div
                className={`bar__fill ${s.key === 'evidence' && s.value < 75 ? 'bar__fill--warn' : ''}`}
                style={{ width: `${Math.max(2, s.value)}%` }}
              />
            )}
          </div>
          <span className="subscore__value mono">{s.value === null ? '—' : s.value}</span>
          {!compact ? <span className="subscore__detail">{s.detail}</span> : null}
        </div>
      ))}
    </div>
  );
}

/** The headline number, with its coverage caveat attached rather than hidden. */
export function ScoreBadge({
  score,
  band,
  coverage,
  status,
  size = 'md',
}: {
  score: number;
  band: string;
  coverage: number;
  status: string;
  size?: 'md' | 'lg' | 'xl';
}) {
  const held = status === 'held_insufficient_evidence';
  const partial = !held && coverage < 0.75;
  const cls = held
    ? 'score--none'
    : partial
      ? 'score--partial'
      : band === 'A'
        ? 'score--a'
        : band === 'B'
          ? 'score--b'
          : band === 'C'
            ? 'score--c'
            : 'score--none';

  return (
    <div className="col g-2">
      <span
        className={`score score--${size} ${cls}`}
        title={
          held
            ? 'Not scored: too little of the rubric could be evaluated.'
            : partial
              ? `Scored from ${Math.round(coverage * 100)}% of the rubric — the rest could not be established.`
              : 'Scored from the full rubric.'
        }
      >
        {held ? '—' : Math.round(score)}
      </span>
      <span className={`score__unit ${partial ? 'score__unit--partial' : ''}`}>
        {Math.round(coverage * 100)}% evidence
      </span>
    </div>
  );
}
