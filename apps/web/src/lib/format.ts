/**
 * Presentation helpers.
 *
 * State is expressed with a small, fixed vocabulary of pills so the same fact always looks the
 * same everywhere. Nothing here upgrades a state: an unverified email renders as unverified, and
 * "unknown" is its own colour rather than being folded into failure.
 */

export interface Pill {
  className: string;
  label: string;
  title?: string;
}

/** Score band. `partial` is separate because a high score from thin coverage is not a high score. */
export function bandClass(band: string, coverage?: number): string {
  if (coverage !== undefined && coverage < 0.75) return 'score--partial';
  if (band === 'A') return 'score--a';
  if (band === 'B') return 'score--b';
  if (band === 'C') return 'score--c';
  return 'score--none';
}

export function statusPill(status: string): Pill {
  switch (status) {
    case 'qualified':
      return { className: 'pill pill--ok', label: 'Qualified', title: 'Met the rubric threshold on cited evidence.' };
    case 'held_insufficient_evidence':
      return {
        className: 'pill pill--unknown',
        label: 'Insufficient evidence',
        title: 'Too little of the rubric could be evaluated from evidence we could actually retrieve.',
      };
    case 'disqualified':
      return { className: 'pill pill--crit', label: 'Disqualified', title: 'A disqualifying criterion was proven by two independent sources.' };
    case 'suppressed':
      return { className: 'pill pill--warn', label: 'Suppressed', title: 'On this workspace’s do-not-contact list.' };
    default:
      return { className: 'pill pill--plain', label: 'Below threshold' };
  }
}

/**
 * Email state.
 *
 * These three are the only states that exist. LeadMoor never guesses an address from a pattern,
 * so "no email" means no evidence contained one — not that one could be inferred.
 */
export function emailPill(status: string): Pill {
  switch (status) {
    case 'verified':
      return { className: 'pill pill--ok', label: 'Verified', title: 'The address appears verbatim in a stored document we cite.' };
    case 'unverified':
      return {
        className: 'pill pill--warn',
        label: 'Unverified',
        title: 'Found in evidence, but not confirmed against a second source. Never a guessed pattern.',
      };
    default:
      return { className: 'pill pill--plain', label: 'None found', title: 'No permitted source contained an address for this person.' };
  }
}

export function verdictPill(verdict: string, status: string): Pill {
  if (status === 'not_configured') {
    return { className: 'pill pill--unknown', label: 'Not configured', title: 'This criterion needs a provider that is not set up.' };
  }
  if (status === 'rejected') {
    return { className: 'pill pill--crit', label: 'Rejected', title: 'The model’s answer failed provenance validation and was discarded.' };
  }
  if (verdict === 'pass') return { className: 'pill pill--ok', label: 'Pass' };
  if (verdict === 'fail') return { className: 'pill pill--crit', label: 'Fail' };
  return { className: 'pill pill--unknown', label: 'Unknown', title: 'We could not establish this either way. Unknown is not a failure.' };
}

export function runStatusPill(status: string): Pill {
  switch (status) {
    case 'completed':
      return { className: 'pill pill--ok', label: 'Completed' };
    case 'running':
      return { className: 'pill pill--warn', label: 'Running' };
    case 'queued':
      return { className: 'pill pill--plain', label: 'Queued' };
    case 'partial':
      return { className: 'pill pill--warn', label: 'Partial', title: 'Some stages failed; what completed is shown.' };
    case 'failed':
      return { className: 'pill pill--crit', label: 'Failed' };
    case 'budget_exhausted':
      return { className: 'pill pill--warn', label: 'Budget reached', title: 'The run stopped cleanly at its configured limit.' };
    case 'cancelled':
      return { className: 'pill pill--plain', label: 'Cancelled' };
    default:
      return { className: 'pill pill--plain', label: status };
  }
}

export function relativeTime(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const value = typeof date === 'string' ? new Date(date) : date;
  const seconds = Math.round((Date.now() - value.getTime()) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  if (seconds < 30 * 86400) return `${Math.round(seconds / 86400)}d ago`;
  return value.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function absoluteTime(date: Date | string | null | undefined): string {
  if (!date) return '—';
  const value = typeof date === 'string' ? new Date(date) : date;
  return value.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function durationOf(from: Date | null | undefined, to: Date | null | undefined): string {
  if (!from) return '—';
  const end = to ?? new Date();
  const ms = end.getTime() - from.getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  return `${minutes}m ${Math.round((ms % 60_000) / 1000)}s`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Splits document text around a quote so the match can be wrapped without rendering markup. */
export function highlight(text: string, quote: string): { before: string; match: string; after: string } {
  const at = text.indexOf(quote);
  if (at < 0) return { before: '', match: text, after: '' };
  return { before: text.slice(0, at), match: quote, after: text.slice(at + quote.length) };
}

/**
 * Turns `people_discovery` or `employeeCount` into readable words.
 *
 * Claim fields are camelCase and stage names are snake_case; both end up in the same labels, so
 * both are handled here rather than at each call site.
 */
export function humanize(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[._]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
