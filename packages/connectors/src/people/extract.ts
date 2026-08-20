import type { EvidenceRecord, Persona } from '@leadmoor/core';
import type { PersonObservation } from '../types.js';

/**
 * Deterministic person extraction from stored evidence.
 *
 * No model is involved: a person is only produced when a real document contains a capitalized
 * personal name adjacent to a role title from the spec's persona. Both halves get their own
 * quoted span, so "who is this and why do we think they hold that role" is answerable from the
 * dossier. When nothing matches confidently we return nothing — a lead with no person is a valid
 * outcome, an invented person is not.
 */

/** Role vocabulary. Extended at call time with the persona's own titles. */
const BASE_TITLES = [
  'Chief Technology Officer', 'Chief Information Security Officer', 'Chief Security Officer',
  'Chief Information Officer', 'Chief Executive Officer', 'Chief Product Officer',
  'VP of Engineering', 'VP Engineering', 'VP of Security', 'VP Security', 'VP of Platform',
  'Vice President of Engineering', 'Vice President, Engineering', 'Vice President of Security',
  'Head of Engineering', 'Head of Security', 'Head of Platform', 'Head of Infrastructure',
  'Head of Product Security', 'Director of Engineering', 'Director of Security',
  'Engineering Manager', 'Platform Engineering Lead', 'Security Engineering Lead',
  'DevSecOps Lead', 'Principal Engineer', 'Staff Engineer',
  'Co-Founder', 'Cofounder', 'Founder', 'CTO', 'CISO', 'CSO', 'CIO', 'CEO', 'CPO',
];

/** Words that look like names but are not people. Prevents "Our Team" becoming a person. */
const NAME_STOPWORDS = new Set([
  'our', 'the', 'we', 'us', 'team', 'about', 'company', 'careers', 'contact', 'privacy', 'terms',
  'security', 'engineering', 'platform', 'product', 'sales', 'marketing', 'support', 'leadership',
  'board', 'advisors', 'investors', 'press', 'blog', 'home', 'read', 'more', 'learn', 'view',
  'join', 'open', 'all', 'rights', 'reserved', 'inc', 'llc', 'ltd', 'corp', 'copyright', 'cookie',
  'new', 'york', 'san', 'francisco', 'united', 'states', 'get', 'started', 'sign', 'log',
]);

const NAME_RE = /\b([A-Z][a-z'’-]{1,20}(?:\s+[A-Z][a-z'’-]{1,20}){1,2})\b/g;

export interface ExtractOptions {
  persona: Persona;
  maxPeople: number;
  sourceId: string;
}

export function extractPeople(evidence: EvidenceRecord[], options: ExtractOptions): PersonObservation[] {
  const titles = dedupe([...options.persona.titles, ...BASE_TITLES]).sort((a, b) => b.length - a.length);
  const byName = new Map<string, PersonObservation>();

  for (const doc of evidence) {
    // Team and about pages are where people legitimately appear; a pricing page is not.
    if (doc.documentRole !== 'company_team' && doc.documentRole !== 'company_about' && doc.documentRole !== 'company_home') {
      continue;
    }
    const text = doc.normalizedText;

    for (const title of titles) {
      const titleRe = new RegExp(`\\b${escapeRe(title)}\\b`, 'gi');
      for (const match of text.matchAll(titleRe)) {
        const at = match.index;
        if (at === undefined) continue;

        const found = findNameNear(text, at, match[0].length);
        if (!found) continue;

        const key = found.name.toLowerCase();
        const existing = byName.get(key);
        // Keep the most specific title we saw for a person (longest match wins).
        if (existing && (existing.role?.length ?? 0) >= title.length) continue;

        byName.set(key, {
          fullName: found.name,
          role: normalizeTitle(match[0]),
          profileUrl: null,
          githubLogin: null,
          nameEvidence: { evidenceId: doc.id, quote: found.quote },
          roleEvidence: { evidenceId: doc.id, quote: contextQuote(text, at, match[0].length) },
          sourceId: options.sourceId,
          confidence: found.distance <= 40 ? 0.8 : 0.6,
        });
      }
    }
  }

  return [...byName.values()]
    .sort((a, b) => rankTitle(a.role, options.persona) - rankTitle(b.role, options.persona) || b.confidence - a.confidence)
    .slice(0, options.maxPeople);
}

/**
 * Look for a personal name immediately before or after a title occurrence. The window is small on
 * purpose — a name three paragraphs away is not evidence that this person holds this title.
 */
function findNameNear(
  text: string,
  titleAt: number,
  titleLen: number,
): { name: string; quote: string; distance: number } | null {
  const WINDOW = 90;
  const beforeStart = Math.max(0, titleAt - WINDOW);
  const before = text.slice(beforeStart, titleAt);
  const after = text.slice(titleAt + titleLen, Math.min(text.length, titleAt + titleLen + WINDOW));

  const beforeMatches = [...before.matchAll(NAME_RE)];
  const last = beforeMatches[beforeMatches.length - 1];
  if (last?.[1] && isPlausibleName(last[1])) {
    const idx = last.index ?? 0;
    return { name: last[1], quote: last[1], distance: before.length - (idx + last[1].length) };
  }

  const first = [...after.matchAll(NAME_RE)][0];
  if (first?.[1] && isPlausibleName(first[1])) {
    return { name: first[1], quote: first[1], distance: first.index ?? 0 };
  }
  return null;
}

function isPlausibleName(candidate: string): boolean {
  const parts = candidate.split(/\s+/);
  if (parts.length < 2 || parts.length > 3) return false;
  for (const part of parts) {
    if (NAME_STOPWORDS.has(part.toLowerCase())) return false;
    if (part.length < 2) return false;
  }
  // Reject strings that are entirely role vocabulary, e.g. "Head Of".
  return !BASE_TITLES.some((t) => t.toLowerCase() === candidate.toLowerCase());
}

function contextQuote(text: string, at: number, len: number): string {
  const start = Math.max(0, at - 70);
  const end = Math.min(text.length, at + len + 70);
  return text.slice(start, end).trim();
}

/** Persona titles rank ahead of the generic vocabulary, in the order the user listed them. */
function rankTitle(role: string | null, persona: Persona): number {
  if (!role) return 999;
  const lower = role.toLowerCase();
  const idx = persona.titles.findIndex((t) => lower.includes(t.toLowerCase()) || t.toLowerCase().includes(lower));
  return idx >= 0 ? idx : 100 + BASE_TITLES.findIndex((t) => t.toLowerCase() === lower);
}

function normalizeTitle(raw: string): string {
  const trimmed = raw.trim();
  const canonical = BASE_TITLES.find((t) => t.toLowerCase() === trimmed.toLowerCase());
  return canonical ?? trimmed;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dedupe(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const k = item.toLowerCase();
    if (!seen.has(k)) {
      seen.add(k);
      out.push(item);
    }
  }
  return out;
}
