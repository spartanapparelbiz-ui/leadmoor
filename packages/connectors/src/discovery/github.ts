import { z } from 'zod';
import type { LeadSpec } from '@leadmoor/core';
import { spanFor } from '@leadmoor/evidence';
import type {
  CandidateCompany,
  ConnectorAvailability,
  DiscoveryConnector,
  DiscoveryReport,
  Fetcher,
} from '../types.js';

/**
 * GitHub public API discovery — Tier C.
 *
 * Uses the official REST API logged-out (or with an ordinary token for higher rate limits), within
 * published limits. Organizations map to real companies and carry a website, location, and
 * description; their public repositories are genuine technographic evidence.
 *
 * GITHUB_TOKEN is optional — without it the API still works at the lower unauthenticated limit.
 */

const repoSearchSchema = z.object({
  total_count: z.number().default(0),
  items: z
    .array(
      z.object({
        full_name: z.string(),
        html_url: z.string(),
        description: z.string().nullable().default(null),
        owner: z.object({ login: z.string(), type: z.string() }),
      }),
    )
    .default([]),
});

const orgSchema = z.object({
  login: z.string(),
  name: z.string().nullable().default(null),
  blog: z.string().nullable().default(null),
  location: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  public_repos: z.number().default(0),
  type: z.string().default('Organization'),
  html_url: z.string(),
});

export class GitHubDiscovery implements DiscoveryConnector {
  readonly id = 'github_discovery';
  readonly sourceId = 'github_public';

  constructor(
    private readonly fetcher: Fetcher,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async availability(): Promise<ConnectorAvailability> {
    return { available: true };
  }

  /** Set once a supplied token is rejected, so the rest of the run stops sending it. */
  private tokenRejected = false;

  private headers(authenticated = true): Record<string, string> {
    const h: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (authenticated && !this.tokenRejected && this.env.GITHUB_TOKEN) {
      h.Authorization = `Bearer ${this.env.GITHUB_TOKEN}`;
    }
    return h;
  }

  /**
   * Fetch a GitHub endpoint, falling back to unauthenticated on a rejected token.
   *
   * The public API works logged out at a lower rate limit, so a stale or wrong GITHUB_TOKEN should
   * degrade to that rather than failing the whole connector. Once a token is rejected we stop
   * sending it for the remainder of the run instead of re-trying it on every call.
   */
  private async get(url: string, runId: string, role: 'search_result' | 'registry_record') {
    const first = await this.fetcher.fetch({
      sourceId: this.sourceId,
      url,
      documentRole: role,
      runId,
      headers: this.headers(),
    });

    const sentToken = Boolean(this.env.GITHUB_TOKEN) && !this.tokenRejected;
    if (first.httpStatus === 401 && sentToken) {
      this.tokenRejected = true;
      const retry = await this.fetcher.fetch({
        sourceId: this.sourceId,
        url,
        documentRole: role,
        runId,
        headers: this.headers(false),
      });
      if (retry.status === 'ok') return retry;
      return {
        ...retry,
        reason: `GITHUB_TOKEN was rejected (401) and the unauthenticated request also failed: ${retry.reason ?? retry.status}`,
      };
    }
    return first;
  }

  async discover(args: {
    spec: LeadSpec;
    runId: string;
    limit: number;
    onCandidate: (c: CandidateCompany) => Promise<void>;
  }): Promise<DiscoveryReport> {
    const failures: DiscoveryReport['failures'] = [];
    const seenOrgs = new Set<string>();
    let attempted = 0;
    let found = 0;

    for (const query of args.spec.discovery.queries) {
      if (found >= args.limit) break;

      const url = new URL('https://api.github.com/search/repositories');
      url.searchParams.set('q', `${query} in:readme,description`);
      url.searchParams.set('sort', 'updated');
      url.searchParams.set('per_page', '30');

      attempted += 1;
      const outcome = await this.get(url.toString(), args.runId, 'search_result');

      if (outcome.status !== 'ok' || !outcome.evidence) {
        failures.push({ url: outcome.url, status: outcome.status, reason: outcome.reason });
        continue;
      }

      const parsed = safeJson(outcome.evidence.normalizedText, repoSearchSchema);
      if (!parsed) {
        failures.push({ url: outcome.url, status: 'http_error', reason: 'unparseable GitHub search response' });
        continue;
      }

      for (const item of parsed.items) {
        if (found >= args.limit) break;
        if (item.owner.type !== 'Organization') continue;
        if (seenOrgs.has(item.owner.login)) continue;
        seenOrgs.add(item.owner.login);

        const candidate = await this.orgToCandidate(item.owner.login, query, args.runId, failures);
        if (candidate) {
          found += 1;
          await args.onCandidate(candidate);
        }
      }
    }

    const status: DiscoveryReport['status'] =
      failures.length > 0 && found === 0 ? 'failed' : failures.length > 0 ? 'partial' : 'completed';

    return {
      connectorId: this.id,
      attempted,
      found,
      status,
      message:
        status === 'failed' ? `GitHub returned no usable results (${failures[0]?.reason ?? 'unknown error'})` : null,
      failures,
    };
  }

  private async orgToCandidate(
    login: string,
    query: string,
    runId: string,
    failures: DiscoveryReport['failures'],
  ): Promise<CandidateCompany | null> {
    const outcome = await this.get(`https://api.github.com/orgs/${encodeURIComponent(login)}`, runId, 'registry_record');

    if (outcome.status !== 'ok' || !outcome.evidence) {
      failures.push({ url: outcome.url, status: outcome.status, reason: outcome.reason });
      return null;
    }

    const org = safeJson(outcome.evidence.normalizedText, orgSchema);
    if (!org) return null;

    const evidenceId = outcome.evidence.id;
    const text = outcome.evidence.normalizedText;
    const name = org.name ?? org.login;
    const domain = org.blog ? hostOf(org.blog) : null;

    const claims: CandidateCompany['claims'] = [];

    const nameSpan = spanFor(evidenceId, text, name);
    if (nameSpan) {
      claims.push({
        subjectType: 'company',
        field: 'company.name',
        fieldClass: 'company_identity',
        value: name,
        spans: [nameSpan],
        sourceId: this.sourceId,
        extractor: 'structured_api_field',
        confidence: 0.9,
      });
    }

    if (domain && org.blog) {
      const span = spanFor(evidenceId, text, org.blog);
      if (span) {
        claims.push({
          subjectType: 'company',
          field: 'company.website',
          fieldClass: 'company_identity',
          value: org.blog,
          spans: [span],
          sourceId: this.sourceId,
          extractor: 'structured_api_field',
          confidence: 0.9,
        });
      }
    }

    if (org.location) {
      const span = spanFor(evidenceId, text, org.location);
      if (span) {
        claims.push({
          subjectType: 'company',
          field: 'company.location',
          fieldClass: 'company_firmographic',
          value: org.location,
          spans: [span],
          sourceId: this.sourceId,
          extractor: 'structured_api_field',
          confidence: 0.75,
        });
      }
    }

    return {
      name,
      domain,
      country: null,
      sourceId: this.sourceId,
      identifiers: [
        { kind: 'github_org', value: org.login, strength: 'medium' },
        ...(domain ? [{ kind: 'domain', value: domain, strength: 'medium' as const }] : []),
      ],
      evidenceIds: [evidenceId],
      claims,
      discoveryQuery: query,
    };
  }
}

function safeJson<T extends z.ZodTypeAny>(text: string, schema: T): z.infer<T> | null {
  try {
    const parsed = schema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function hostOf(url: string): string | null {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
