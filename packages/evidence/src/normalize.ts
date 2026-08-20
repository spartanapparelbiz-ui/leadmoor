/**
 * Deterministic text normalization.
 *
 * Every EvidenceSpan offset indexes into the output of `htmlToText` / `normalizeText`, so these
 * functions must be stable: the same input always produces byte-identical output. Changing them
 * invalidates historical spans, which is why they carry a version.
 */

export const NORMALIZER_VERSION = 1;

const BLOCK_TAGS =
  'address|article|aside|blockquote|br|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul';

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-',
  lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"', hellip: '...', middot: '.', bull: '.',
};

function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Collapse runs of whitespace, normalize newlines, trim. Idempotent. */
export function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Strip HTML to readable text. Deliberately simple and dependency-free: script/style/noscript
 * removed, block elements become newlines, entities decoded, whitespace collapsed.
 */
export function htmlToText(html: string): string {
  const withoutHidden = html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ');

  const withBreaks = withoutHidden
    .replace(new RegExp(`<\\s*(${BLOCK_TAGS})\\b[^>]*>`, 'gi'), '\n')
    .replace(new RegExp(`<\\s*/\\s*(${BLOCK_TAGS})\\s*>`, 'gi'), '\n');

  return normalizeText(decodeEntities(withBreaks.replace(/<[^>]*>/g, ' ')));
}

/** Extract a document title from HTML, when present. */
export function extractTitle(html: string): string | null {
  const og = /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i.exec(html);
  if (og?.[1]) return decodeEntities(og[1]).trim().slice(0, 300);
  const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (t?.[1]) return normalizeText(decodeEntities(t[1])).slice(0, 300);
  return null;
}

/** Aggressive fold used only for *fuzzy* citation matching, never for storage or offsets. */
export function foldForMatch(input: string): string {
  return input
    .toLowerCase()
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/[‐-―]/g, '-')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
