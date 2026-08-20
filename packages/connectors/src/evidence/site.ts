import type { DocumentRole, EvidenceRecord } from '@leadmoor/core';
import type { EvidenceStore } from '@leadmoor/evidence';
import type { ConnectorAvailability, EvidenceConnector, Fetcher, FetchOutcome } from '../types.js';

/**
 * Company website evidence collector — Tier C, logged-out first-party fetch.
 *
 * Retrieves a company's own pages: home, about, team, careers, security/trust. Every request goes
 * through the policy gate, which enforces robots.txt, rate limits, and the run-scoped host
 * allowlist — so this can only ever fetch the site of a company the run legitimately discovered.
 *
 * Paths are discovered from the homepage's own links first, with a small conventional fallback.
 * Nothing here bypasses anything: a 403, a robots denial, or a login wall is recorded and skipped.
 */

interface PathCandidate {
  path: string;
  role: DocumentRole;
}

/** Conventional paths, used only when the homepage does not link to an equivalent page. */
const FALLBACK_PATHS: PathCandidate[] = [
  { path: '/about', role: 'company_about' },
  { path: '/about-us', role: 'company_about' },
  { path: '/company', role: 'company_about' },
  { path: '/team', role: 'company_team' },
  { path: '/leadership', role: 'company_team' },
  { path: '/careers', role: 'company_careers' },
  { path: '/jobs', role: 'company_careers' },
  { path: '/security', role: 'company_security' },
  { path: '/trust', role: 'company_security' },
  { path: '/compliance', role: 'company_security' },
];

/** Link text / href patterns that identify a page's role. Ordered — first match wins. */
const ROLE_PATTERNS: Array<{ role: DocumentRole; re: RegExp }> = [
  { role: 'company_team', re: /\b(team|leadership|our-people|people|founders|management|executives)\b/i },
  { role: 'company_careers', re: /\b(careers?|jobs|join-us|join|hiring|open-roles|work-with-us)\b/i },
  { role: 'company_security', re: /\b(security|trust|compliance|soc-?2|privacy-and-security)\b/i },
  { role: 'company_about', re: /\b(about|about-us|company|who-we-are|story)\b/i },
  { role: 'company_pricing', re: /\b(pricing|plans)\b/i },
];

export class CompanySiteEvidence implements EvidenceConnector {
  readonly id = 'company_site_evidence';
  readonly sourceId = 'company_web';

  constructor(
    private readonly fetcher: Fetcher,
    private readonly evidenceStore: EvidenceStore,
  ) {}

  async availability(): Promise<ConnectorAvailability> {
    return { available: true };
  }

  async collect(args: {
    runId: string;
    companyId: string;
    domain: string | null;
    companyName: string;
    maxDocuments: number;
  }): Promise<{ evidence: EvidenceRecord[]; failures: FetchOutcome[] }> {
    const evidence: EvidenceRecord[] = [];
    const failures: FetchOutcome[] = [];
    if (!args.domain) return { evidence, failures };

    const origin = `https://${args.domain}`;
    const budget = Math.max(1, args.maxDocuments);

    const home = await this.fetcher.fetch({
      sourceId: this.sourceId,
      url: `${origin}/`,
      documentRole: 'company_home',
      runId: args.runId,
    });

    if (home.status !== 'ok' || !home.evidence) {
      failures.push(home);
      return { evidence, failures };
    }
    evidence.push(home.evidence);

    // Links are only in the original bytes, which the content-addressed store still holds.
    const raw = (await this.evidenceStore.rawBody(home.evidence.id)) ?? '';
    const targets = this.planTargets(origin, raw, budget - 1);

    for (const target of targets) {
      if (evidence.length >= budget) break;
      const outcome = await this.fetcher.fetch({
        sourceId: this.sourceId,
        url: target.url,
        documentRole: target.role,
        runId: args.runId,
      });
      if (outcome.status === 'ok' && outcome.evidence) evidence.push(outcome.evidence);
      else failures.push(outcome);
    }

    return { evidence, failures };
  }

  /**
   * Build the fetch plan: links the homepage actually publishes, then conventional paths for
   * roles the homepage did not link to. Deduplicated, same-origin only.
   */
  planTargets(origin: string, homepageHtml: string, limit: number): Array<{ url: string; role: DocumentRole }> {
    const found = new Map<string, DocumentRole>();

    for (const href of extractHrefs(homepageHtml)) {
      let abs: URL;
      try {
        abs = new URL(href, origin);
      } catch {
        continue;
      }
      if (abs.origin !== origin) continue;
      if (abs.pathname === '/' || abs.pathname.length > 80) continue;

      const probe = `${abs.pathname} ${href}`;
      const match = ROLE_PATTERNS.find((p) => p.re.test(probe));
      if (!match) continue;

      abs.hash = '';
      abs.search = '';
      const key = abs.toString();
      if (!found.has(key)) found.set(key, match.role);
    }

    const covered = new Set(found.values());
    for (const fallback of FALLBACK_PATHS) {
      if (covered.has(fallback.role)) continue;
      const url = `${origin}${fallback.path}`;
      if (!found.has(url)) {
        found.set(url, fallback.role);
        covered.add(fallback.role);
      }
    }

    // Prefer team and security pages — they carry the evidence the rubric usually needs.
    const priority: Record<string, number> = {
      company_team: 0,
      company_security: 1,
      company_careers: 2,
      company_about: 3,
      company_pricing: 5,
    };
    return [...found.entries()]
      .map(([url, role]) => ({ url, role }))
      .sort((a, b) => (priority[a.role] ?? 4) - (priority[b.role] ?? 4))
      .slice(0, Math.max(0, limit));
  }
}

export function extractHrefs(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>/gi)) {
    const href = m[1];
    if (href && !href.startsWith('mailto:') && !href.startsWith('tel:') && !href.startsWith('javascript:')) {
      out.push(href);
    }
  }
  return out;
}
