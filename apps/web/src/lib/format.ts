/** Presentation helpers shared across server components. */

export function bandClass(band: string): string {
  if (band === 'A') return 'score--a';
  if (band === 'B') return 'score--b';
  if (band === 'C') return 'score--c';
  return 'score--none';
}

export function statusChip(status: string): { className: string; label: string } {
  switch (status) {
    case 'qualified':
      return { className: 'chip chip--pass', label: 'Qualified' };
    case 'held_insufficient_evidence':
      return { className: 'chip chip--unknown', label: 'Insufficient evidence' };
    case 'disqualified':
      return { className: 'chip chip--fail', label: 'Disqualified' };
    case 'suppressed':
      return { className: 'chip chip--warn', label: 'Suppressed' };
    default:
      return { className: 'chip chip--neutral', label: 'Not qualified' };
  }
}

export function emailChip(status: string): { className: string; label: string } {
  switch (status) {
    case 'verified':
      return { className: 'chip chip--pass', label: 'Email verified' };
    case 'unverified':
      return { className: 'chip chip--warn', label: 'Email unverified' };
    default:
      return { className: 'chip chip--neutral', label: 'No email' };
  }
}

export function verdictChip(verdict: string, status: string): { className: string; label: string } {
  if (status === 'not_configured') return { className: 'chip chip--unknown', label: 'Not configured' };
  if (status === 'rejected') return { className: 'chip chip--fail', label: 'Rejected' };
  if (verdict === 'pass') return { className: 'chip chip--pass', label: 'Pass' };
  if (verdict === 'fail') return { className: 'chip chip--fail', label: 'Fail' };
  return { className: 'chip chip--unknown', label: 'Unknown' };
}

export function runStatusChip(status: string): { className: string; label: string } {
  switch (status) {
    case 'completed':
      return { className: 'chip chip--pass', label: 'Completed' };
    case 'running':
      return { className: 'chip chip--warn', label: 'Running' };
    case 'queued':
      return { className: 'chip chip--neutral', label: 'Queued' };
    case 'partial':
      return { className: 'chip chip--warn', label: 'Partial' };
    case 'failed':
      return { className: 'chip chip--fail', label: 'Failed' };
    case 'budget_exhausted':
      return { className: 'chip chip--warn', label: 'Budget reached' };
    case 'cancelled':
      return { className: 'chip chip--neutral', label: 'Cancelled' };
    default:
      return { className: 'chip chip--neutral', label: status };
  }
}

export function relativeTime(date: Date | null | undefined): string {
  if (!date) return '—';
  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Wraps the matched span in <mark> without letting document text become markup. */
export function highlight(text: string, quote: string): { before: string; match: string; after: string } {
  const at = text.indexOf(quote);
  if (at < 0) return { before: '', match: text, after: '' };
  return { before: text.slice(0, at), match: quote, after: text.slice(at + quote.length) };
}
