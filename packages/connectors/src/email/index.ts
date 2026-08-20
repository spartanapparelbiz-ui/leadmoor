import type { EvidenceRecord } from '@leadmoor/core';
import type { ConnectorAvailability, EmailEnrichmentProvider, EmailResolution } from '../types.js';

/**
 * Email enrichment — a swappable subsystem, kept deliberately separate from the rest of the
 * pipeline so a real verification provider can be added without touching discovery or scoring.
 *
 * Three states, and only three: verified, unverified, unavailable.
 *
 * There is no pattern inference anywhere in this file. `first.last@company.com` is never
 * constructed, never guessed, and never returned. An address is only ever reported when it was
 * literally published in a document we retrieved and stored, and even then it is `unverified` —
 * publication is not deliverability. Only a provider that actually verifies may return
 * `verified`, and no such provider ships in M0.
 */

const EMAIL_RE = /\b([A-Za-z0-9._%+-]+)@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g;

/** Addresses that belong to a company rather than a person. Never attached to an individual. */
const ROLE_LOCALPARTS = new Set([
  'info', 'hello', 'contact', 'support', 'sales', 'admin', 'help', 'team', 'press', 'media',
  'careers', 'jobs', 'legal', 'privacy', 'security', 'abuse', 'billing', 'noreply', 'no-reply',
  'marketing', 'partners', 'hi', 'ask', 'office', 'general', 'inquiries', 'webmaster', 'postmaster',
]);

/**
 * Finds an address for a specific person in already-retrieved evidence.
 *
 * The address must (a) appear literally in a stored document, (b) sit on the company's own domain,
 * and (c) be attributable to this person — either the local part matches their name, or the
 * address appears within a short window of their name. Anything else is `unavailable`.
 */
export class PublishedEmailProvider implements EmailEnrichmentProvider {
  readonly id = 'published_email';

  constructor(private readonly loadEvidence: (runId: string, companyId: string) => Promise<EvidenceRecord[]>) {}

  async availability(): Promise<ConnectorAvailability> {
    return { available: true };
  }

  async resolve(args: {
    runId: string;
    personId: string;
    fullName: string;
    companyDomain: string | null;
    companyId?: string;
  }): Promise<EmailResolution> {
    if (!args.companyDomain || !args.companyId) {
      return {
        status: 'unavailable',
        email: null,
        sourceId: null,
        evidenceId: null,
        quote: null,
        reason: 'no company domain available to attribute an address to',
      };
    }

    const documents = await this.loadEvidence(args.runId, args.companyId);
    const nameTokens = args.fullName
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length >= 2);

    for (const doc of documents) {
      const text = doc.normalizedText;
      for (const match of text.matchAll(EMAIL_RE)) {
        const address = match[0].toLowerCase();
        const local = (match[1] ?? '').toLowerCase();
        const domain = (match[2] ?? '').toLowerCase();
        const at = match.index;
        if (at === undefined) continue;

        if (!sameOrSubdomain(domain, args.companyDomain)) continue;
        if (ROLE_LOCALPARTS.has(local)) continue;

        const localMatchesName = nameTokens.some((t) => local.includes(t));
        const nearName = isAttributableByProximity(text, at, args.fullName);
        if (!localMatchesName && !nearName) continue;

        const start = Math.max(0, at - 60);
        const end = Math.min(text.length, at + address.length + 60);

        return {
          // Published on the company's own site, but nobody has verified deliverability.
          status: 'unverified',
          email: address,
          sourceId: doc.sourceId,
          evidenceId: doc.id,
          quote: text.slice(start, end).trim(),
          reason: localMatchesName
            ? 'address published on the company site and its local part matches the person name'
            : 'address published on the company site adjacent to the person name',
        };
      }
    }

    return {
      status: 'unavailable',
      email: null,
      sourceId: null,
      evidenceId: null,
      quote: null,
      reason: 'no published address attributable to this person was found in retrieved evidence',
    };
  }
}

/**
 * The provider used when no email source is configured at all. Always `unavailable` — never a
 * guess, never a pattern.
 */
export class UnavailableEmailProvider implements EmailEnrichmentProvider {
  readonly id = 'none';

  async availability(): Promise<ConnectorAvailability> {
    return {
      available: false,
      reason: 'not_configured',
      envVar: 'EMAIL_ENRICHMENT_PROVIDER',
      message:
        'No email enrichment provider is configured. Addresses will be reported as unavailable rather than guessed.',
    };
  }

  async resolve(): Promise<EmailResolution> {
    return {
      status: 'unavailable',
      email: null,
      sourceId: null,
      evidenceId: null,
      quote: null,
      reason: 'no email enrichment provider configured',
    };
  }
}

function sameOrSubdomain(candidate: string, companyDomain: string): boolean {
  const c = candidate.replace(/^www\./, '');
  const d = companyDomain.replace(/^www\./, '').toLowerCase();
  return c === d || c.endsWith(`.${d}`);
}

/**
 * Attribute an address by proximity only when it is genuinely unambiguous.
 *
 * The name must appear *before* the address, close to it, with no other personal name in between.
 * A symmetric window is not good enough: on a team page every address sits within a few lines of
 * the next person, and a looser rule silently gives one person another person's address.
 */
function isAttributableByProximity(text: string, at: number, fullName: string): boolean {
  const windowStart = Math.max(0, at - 120);
  const before = text.slice(windowStart, at);
  const nameAt = before.toLowerCase().lastIndexOf(fullName.toLowerCase());
  if (nameAt < 0) return false;

  const between = before.slice(nameAt + fullName.length);
  // Another capitalized two-word name between them means the address is not clearly this person's.
  const OTHER_NAME = /\b[A-Z][a-z'’-]{1,20}[ \u00a0]+[A-Z][a-z'’-]{1,20}\b/;
  return !OTHER_NAME.test(between);
}

/**
 * Guard used by the export layer and by tests: rejects anything that looks like an inferred
 * address rather than an observed one.
 */
export function isFabricatedEmailShape(email: string, fullName: string, domain: string | null): boolean {
  if (!domain) return false;
  const [local, host] = email.toLowerCase().split('@');
  if (!local || !host) return false;
  if (!sameOrSubdomain(host, domain)) return false;

  const parts = fullName.toLowerCase().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? '';
  const last = parts[parts.length - 1] ?? '';
  if (!first || !last || first === last) return false;

  // The classic guessed permutations. Presence of one of these is not proof of fabrication on its
  // own — it is only used where the caller already knows the address lacks evidence.
  const patterns = [
    `${first}.${last}`, `${first}${last}`, `${first[0]}${last}`, `${first}_${last}`,
    `${first}-${last}`, `${last}.${first}`, `${last}${first[0]}`, first, last,
  ];
  return patterns.includes(local);
}
