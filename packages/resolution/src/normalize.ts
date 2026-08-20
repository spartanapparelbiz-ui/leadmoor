/** Company and person identity normalization — the input to blocking and matching. */

const LEGAL_SUFFIXES = [
  'incorporated', 'inc', 'corporation', 'corp', 'company', 'co', 'limited', 'ltd', 'llc', 'llp',
  'lp', 'plc', 'gmbh', 'ag', 'sa', 'nv', 'bv', 'ab', 'oy', 'as', 'pty', 'holdings', 'holding',
  'group', 'technologies', 'technology', 'labs', 'laboratories', 'software', 'systems', 'solutions',
];

/** Public suffixes we must not mistake for the registrable part of a domain. */
const MULTI_PART_TLDS = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'co.jp', 'co.nz', 'co.za', 'com.au', 'com.br', 'com.mx',
  'co.in', 'com.sg', 'co.kr', 'com.tr', 'co.il',
]);

export function normalizeCompanyName(name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  const tokens = base.split(' ').filter(Boolean);
  while (tokens.length > 1) {
    const last = tokens[tokens.length - 1];
    if (last && LEGAL_SUFFIXES.includes(last)) tokens.pop();
    else break;
  }
  return tokens.join(' ');
}

/** Tokens used for blocking. Short tokens are dropped — they generate noise, not candidates. */
export function nameTokens(name: string): string[] {
  return normalizeCompanyName(name)
    .split(' ')
    .filter((t) => t.length >= 3);
}

export function normalizeDomain(input: string | null): string | null {
  if (!input) return null;
  let host = input.trim().toLowerCase();
  try {
    if (host.includes('://')) host = new URL(host).hostname;
    else if (host.includes('/')) host = new URL(`https://${host}`).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^www\./, '').replace(/\.$/, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : null;
}

/** The registrable domain — "app.acme.co.uk" resolves to "acme.co.uk". */
export function registrableDomain(domain: string | null): string | null {
  const normalized = normalizeDomain(domain);
  if (!normalized) return null;
  const parts = normalized.split('.');
  if (parts.length <= 2) return normalized;

  const lastTwo = parts.slice(-2).join('.');
  if (MULTI_PART_TLDS.has(lastTwo) && parts.length >= 3) return parts.slice(-3).join('.');
  return lastTwo;
}

export function normalizePersonName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z\s'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
