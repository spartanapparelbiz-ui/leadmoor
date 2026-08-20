import type { EvidenceSpan } from '@leadmoor/core';

/**
 * Span location and verification.
 *
 * A citation is only accepted if its quoted text is genuinely present in the stored document.
 * This module is the mechanism behind ARCHITECTURE.md §4: "A validator checks each ID exists in
 * this run and each span appears in that evidence's extracted text — exact match first,
 * normalized fuzzy match second."
 */

export type SpanVerification = 'exact' | 'repaired' | 'fuzzy' | 'absent';

/** Fold used for fuzzy matching, paired with an index back to original offsets. */
function foldWithIndex(text: string): { folded: string; map: number[] } {
  const out: string[] = [];
  const map: number[] = [];
  let lastWasSpace = true; // suppress a leading space
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    let f = ch.toLowerCase();
    if ('‘’‚‛'.includes(f)) f = "'";
    else if ('“”„‟'.includes(f)) f = '"';
    else if ('‐‑‒–—―'.includes(f)) f = '-';

    if (/[a-z0-9]/.test(f)) {
      out.push(f);
      map.push(i);
      lastWasSpace = false;
    } else if (!lastWasSpace) {
      out.push(' ');
      map.push(i);
      lastWasSpace = true;
    }
  }
  while (out.length > 0 && out[out.length - 1] === ' ') {
    out.pop();
    map.pop();
  }
  return { folded: out.join(''), map };
}

/**
 * Find `quote` inside `text`. Exact search first; if that fails, a whitespace/punctuation-folded
 * search whose result is mapped back to real offsets in `text`.
 * Returns null when the quote genuinely is not present — that is a rejected citation.
 */
export function locateQuote(
  text: string,
  quote: string,
): { start: number; end: number; quote: string; how: 'exact' | 'fuzzy' } | null {
  if (quote.length === 0) return null;

  const exact = text.indexOf(quote);
  if (exact >= 0) return { start: exact, end: exact + quote.length, quote, how: 'exact' };

  const hay = foldWithIndex(text);
  const needle = foldWithIndex(quote);
  if (needle.folded.length === 0) return null;

  const at = hay.folded.indexOf(needle.folded);
  if (at < 0) return null;

  const start = hay.map[at];
  const lastFoldedIdx = at + needle.folded.length - 1;
  const lastOriginal = hay.map[lastFoldedIdx];
  if (start === undefined || lastOriginal === undefined) return null;

  const end = lastOriginal + 1;
  return { start, end, quote: text.slice(start, end), how: 'fuzzy' };
}

/**
 * Verify a span against the document it claims to come from.
 *
 * - `exact`    — offsets and quote both correct
 * - `repaired` — quote is present but the offsets were wrong; caller should store the fixed span
 * - `fuzzy`    — quote present only after folding; accepted, with the real text substituted
 * - `absent`   — the quote is not in the document; the citation is fabricated
 */
export function verifySpan(
  text: string,
  span: EvidenceSpan,
): { verification: SpanVerification; corrected: EvidenceSpan | null } {
  if (span.start >= 0 && span.end <= text.length && span.start < span.end) {
    if (text.slice(span.start, span.end) === span.quote) {
      return { verification: 'exact', corrected: span };
    }
  }
  const found = locateQuote(text, span.quote);
  if (!found) return { verification: 'absent', corrected: null };

  return {
    verification: found.how === 'exact' ? 'repaired' : 'fuzzy',
    corrected: { evidenceId: span.evidenceId, start: found.start, end: found.end, quote: found.quote },
  };
}

/** Build a span for a quote known to exist in `text`, with a little surrounding context. */
export function spanFor(evidenceId: string, text: string, quote: string, contextChars = 0): EvidenceSpan | null {
  const found = locateQuote(text, quote);
  if (!found) return null;
  if (contextChars <= 0) {
    return { evidenceId, start: found.start, end: found.end, quote: found.quote };
  }
  const start = Math.max(0, found.start - contextChars);
  const end = Math.min(text.length, found.end + contextChars);
  return { evidenceId, start, end, quote: text.slice(start, end) };
}

/** All non-overlapping occurrences of `term`, case-insensitive, as spans with sentence context. */
export function findTermSpans(evidenceId: string, text: string, term: string, limit = 3): EvidenceSpan[] {
  const spans: EvidenceSpan[] = [];
  const hay = text.toLowerCase();
  const needle = term.toLowerCase();
  if (needle.length === 0) return spans;

  let from = 0;
  while (spans.length < limit) {
    const at = hay.indexOf(needle, from);
    if (at < 0) break;

    // Expand to sentence-ish boundaries so the quote is readable in a dossier.
    let start = at;
    while (start > 0 && !'\n.!?'.includes(text[start - 1] as string) && at - start < 220) start--;
    let end = at + needle.length;
    while (end < text.length && !'\n.!?'.includes(text[end] as string) && end - (at + needle.length) < 220) end++;
    if (end < text.length && '.!?'.includes(text[end] as string)) end++;

    const quote = text.slice(start, end).trim();
    if (quote.length > 0) {
      const trimStart = start + (text.slice(start, end).length - text.slice(start, end).trimStart().length);
      spans.push({ evidenceId, start: trimStart, end: trimStart + quote.length, quote });
    }
    from = at + needle.length;
  }
  return spans;
}
