import { z } from 'zod';
import type { LeadSpec } from '@leadmoor/core';
import { spanFor } from '@leadmoor/evidence';
import type {
  CandidateCompany,
  ConnectorAvailability,
  DiscoveryConnector,
  DiscoveryReport,
  Fetcher,
  FetchOutcome,
} from '../types.js';

/**
 * SEC EDGAR discovery — Tier B.
 *
 * Full-text search finds filings matching the spec's queries; the submissions API then supplies
 * official identity for each filer (legal name, CIK, SIC, state). Form D is included on purpose:
 * it is filed by *private* companies raising capital, which is where US companies in the 50-500
 * employee band actually appear. Public-company forms (10-K, S-1) are searched too.
 *
 * Requires no credential. SEC asks for a descriptive User-Agent, which HttpFetcher sends.
 */

const ftsSchema = z.object({
  hits: z
    .object({
      hits: z
        .array(
          z.object({
            _source: z.object({
              display_names: z.array(z.string()).default([]),
              ciks: z.array(z.string()).default([]),
              file_type: z.string().optional(),
              file_date: z.string().optional(),
            }),
          }),
        )
        .default([]),
    })
    .default({ hits: [] }),
});

const submissionsSchema = z.object({
  cik: z.union([z.string(), z.number()]).optional(),
  name: z.string().optional(),
  sic: z.string().optional(),
  sicDescription: z.string().optional(),
  stateOfIncorporation: z.string().optional(),
  website: z.string().optional(),
  addresses: z
    .object({ business: z.object({ stateOrCountry: z.string().optional() }).optional() })
    .optional(),
});

/** Form types worth searching for a B2B company hunt, private filers first. */
const FORM_TYPES = ['D', 'S-1', '10-K', '1-A'];

export class SecEdgarDiscovery implements DiscoveryConnector {
  readonly id = 'sec_edgar_discovery';
  readonly sourceId = 'sec_edgar';

  constructor(private readonly fetcher: Fetcher) {}

  async availability(): Promise<ConnectorAvailability> {
    // No credential needed. Reachability is proven by the first real request, not guessed here.
    return { available: true };
  }

  async discover(args: {
    spec: LeadSpec;
    runId: string;
    limit: number;
    onCandidate: (c: CandidateCompany) => Promise<void>;
  }): Promise<DiscoveryReport> {
    const failures: DiscoveryReport['failures'] = [];
    const seenCik = new Set<string>();
    let attempted = 0;
    let found = 0;

    for (const query of args.spec.discovery.queries) {
      if (found >= args.limit) break;

      const url = new URL('https://efts.sec.gov/LATEST/search-index');
      url.searchParams.set('q', `"${query.replace(/"/g, '')}"`);
      url.searchParams.set('forms', FORM_TYPES.join(','));

      attempted += 1;
      const outcome = await this.fetcher.fetch({
        sourceId: this.sourceId,
        url: url.toString(),
        documentRole: 'search_result',
        runId: args.runId,
        headers: { Accept: 'application/json' },
      });

      if (outcome.status !== 'ok' || !outcome.evidence) {
        failures.push({ url: outcome.url, status: outcome.status, reason: outcome.reason });
        continue;
      }

      const parsed = safeJson(outcome.evidence.normalizedText, ftsSchema);
      if (!parsed) {
        failures.push({ url: outcome.url, status: 'http_error', reason: 'unparseable EDGAR full-text response' });
        continue;
      }

      for (const hit of parsed.hits.hits) {
        if (found >= args.limit) break;
        const cik = hit._source.ciks[0];
        const displayName = hit._source.display_names[0];
        if (!cik || !displayName || seenCik.has(cik)) continue;
        seenCik.add(cik);

        const candidate = await this.enrichFromSubmissions(cik, displayName, query, args.runId, failures);
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
        status === 'failed'
          ? `SEC EDGAR returned no usable results (${failures[0]?.reason ?? 'unknown error'})`
          : null,
      failures,
    };
  }

  /** Pull official identity for a CIK. Every field becomes a claim with a span into this document. */
  private async enrichFromSubmissions(
    cik: string,
    displayName: string,
    query: string,
    runId: string,
    failures: DiscoveryReport['failures'],
  ): Promise<CandidateCompany | null> {
    const padded = cik.padStart(10, '0');
    const outcome: FetchOutcome = await this.fetcher.fetch({
      sourceId: this.sourceId,
      url: `https://data.sec.gov/submissions/CIK${padded}.json`,
      documentRole: 'registry_record',
      runId,
      headers: { Accept: 'application/json' },
    });

    if (outcome.status !== 'ok' || !outcome.evidence) {
      failures.push({ url: outcome.url, status: outcome.status, reason: outcome.reason });
      return null;
    }

    const doc = safeJson(outcome.evidence.normalizedText, submissionsSchema);
    if (!doc) return null;

    const evidenceId = outcome.evidence.id;
    const text = outcome.evidence.normalizedText;
    const legalName = doc.name ?? cleanEdgarName(displayName);

    const claims: CandidateCompany['claims'] = [];

    const nameSpan = spanFor(evidenceId, text, legalName);
    if (nameSpan) {
      claims.push({
        subjectType: 'company',
        field: 'company.legalName',
        fieldClass: 'company_identity',
        value: legalName,
        spans: [nameSpan],
        sourceId: this.sourceId,
        extractor: 'registry_field',
        confidence: 0.98,
      });
    }

    if (doc.sicDescription) {
      const span = spanFor(evidenceId, text, doc.sicDescription);
      if (span) {
        claims.push({
          subjectType: 'company',
          field: 'company.industry',
          fieldClass: 'company_firmographic',
          value: doc.sicDescription,
          spans: [span],
          sourceId: this.sourceId,
          extractor: 'registry_field',
          confidence: 0.9,
        });
      }
    }

    const state = doc.addresses?.business?.stateOrCountry ?? doc.stateOfIncorporation;
    if (state) {
      const span = spanFor(evidenceId, text, state);
      if (span) {
        claims.push({
          subjectType: 'company',
          field: 'company.stateOrCountry',
          fieldClass: 'company_firmographic',
          value: state,
          spans: [span],
          sourceId: this.sourceId,
          extractor: 'registry_field',
          confidence: 0.9,
        });
      }
    }

    return {
      name: legalName,
      domain: doc.website ? hostOf(doc.website) : null,
      country: 'US',
      sourceId: this.sourceId,
      identifiers: [{ kind: 'cik', value: padded, strength: 'strong' }],
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

/** EDGAR display names look like "Acme Inc (0001234567) (CIK 0001234567)". */
function cleanEdgarName(display: string): string {
  return display.replace(/\s*\(.*$/, '').trim();
}

function hostOf(url: string): string | null {
  try {
    return new URL(url.startsWith('http') ? url : `https://${url}`).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}
