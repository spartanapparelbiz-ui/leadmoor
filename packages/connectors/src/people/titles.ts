/**
 * Canonical job titles.
 *
 * A user asking for a "CTO" must be matched with a page that says "Chief Technology Officer", and
 * ranked ahead of a VP Engineering. Persona matching therefore runs over canonical keys rather
 * than raw strings — otherwise the ranking silently depends on which spelling a company happens
 * to use on its team page.
 */

export const CANONICAL_TITLES = [
  'cto',
  'ciso',
  'cso',
  'cio',
  'ceo',
  'cpo',
  'vp_engineering',
  'vp_security',
  'vp_platform',
  'head_of_engineering',
  'head_of_security',
  'head_of_platform',
  'head_of_infrastructure',
  'director_engineering',
  'director_security',
  'devsecops',
  'engineering_manager',
  'principal_engineer',
  'founder',
] as const;
export type CanonicalTitle = (typeof CANONICAL_TITLES)[number];

/** Ordered: the first pattern that matches wins, so specific titles precede general ones. */
const TITLE_PATTERNS: Array<{ canonical: CanonicalTitle; re: RegExp }> = [
  { canonical: 'ciso', re: /^(ciso|chief information security officer)$/i },
  { canonical: 'cso', re: /^(cso|chief security officer)$/i },
  { canonical: 'cto', re: /^(cto|chief technology officer|chief technical officer)$/i },
  { canonical: 'cio', re: /^(cio|chief information officer)$/i },
  { canonical: 'cpo', re: /^(cpo|chief product officer)$/i },
  { canonical: 'ceo', re: /^(ceo|chief executive officer)$/i },
  { canonical: 'vp_security', re: /^(vp|vice president)([ ,]+of)?[ ,]+(security|information security)$/i },
  { canonical: 'vp_platform', re: /^(vp|vice president)([ ,]+of)?[ ,]+(platform|infrastructure)$/i },
  { canonical: 'vp_engineering', re: /^(vp|vice president)([ ,]+of)?[ ,]+(engineering|technology)$/i },
  { canonical: 'head_of_security', re: /^head of (security|product security|information security)$/i },
  { canonical: 'head_of_platform', re: /^head of platform( engineering)?$/i },
  { canonical: 'head_of_infrastructure', re: /^head of infrastructure$/i },
  { canonical: 'head_of_engineering', re: /^head of (engineering|technology)$/i },
  { canonical: 'director_security', re: /^director of security$/i },
  { canonical: 'director_engineering', re: /^director of engineering$/i },
  { canonical: 'devsecops', re: /^devsecops( lead| engineer)?$/i },
  { canonical: 'engineering_manager', re: /^engineering manager$/i },
  { canonical: 'principal_engineer', re: /^(principal|staff) engineer$/i },
  { canonical: 'founder', re: /^(co[- ]?founder|founder|technical founder)$/i },
];

/** Map a raw title to its canonical key, or null when it is not a recognised role. */
export function canonicalTitle(raw: string | null | undefined): CanonicalTitle | null {
  if (!raw) return null;
  const cleaned = raw
    .trim()
    .replace(/[.]+$/, '')
    .replace(/\s+/g, ' ');
  for (const { canonical, re } of TITLE_PATTERNS) {
    if (re.test(cleaned)) return canonical;
  }
  return null;
}

/**
 * Rank a role against the persona's preference order. Lower is better.
 *
 * An exact canonical match ranks by the persona's own ordering. An unrecognised but non-empty
 * role still ranks ahead of no role at all, so a real person with an unusual title is not
 * discarded in favour of nobody.
 */
export function rankAgainstPersona(role: string | null | undefined, personaTitles: readonly string[]): number {
  if (!role) return 1000;

  const roleKey = canonicalTitle(role);
  const wanted = personaTitles.map((t) => ({ raw: t.toLowerCase().trim(), key: canonicalTitle(t) }));

  for (const [index, want] of wanted.entries()) {
    if (roleKey && want.key && roleKey === want.key) return index;
  }
  for (const [index, want] of wanted.entries()) {
    const lower = role.toLowerCase();
    if (lower === want.raw) return index;
    if (lower.includes(want.raw) || want.raw.includes(lower)) return 100 + index;
  }
  return 500;
}
