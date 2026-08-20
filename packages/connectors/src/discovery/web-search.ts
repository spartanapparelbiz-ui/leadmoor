import { ProviderNotConfiguredError, ProviderUnreachableError, type LeadSpec } from '@leadmoor/core';
import { spanFor } from '@leadmoor/evidence';
import type {
  CandidateCompany,
  ConnectorAvailability,
  DiscoveryConnector,
  DiscoveryReport,
} from '../types.js';
import type { SearchProviderRegistry } from '../search/index.js';

/**
 * Search-driven discovery — Tier C.
 *
 * Turns spec queries into search results and treats each distinct registrable domain as a company
 * candidate. The search index is deliberately weak evidence: it establishes only that a domain
 * exists and matched a query. Everything substantive comes from fetching the company's own site
 * in the evidence stage.
 */
export class WebSearchDiscovery implements DiscoveryConnector {
  readonly id = 'web_search_discovery';
  readonly sourceId = 'brave_search';

  constructor(private readonly registry: SearchProviderRegistry) {}

  async availability(): Promise<ConnectorAvailability> {
    const chosen = await this.registry.firstAvailable();
    if ('provider' in chosen) return { available: true };
    const first = chosen.unavailable[0];
    return (
      first ?? {
        available: false,
        reason: 'not_configured',
        envVar: 'BRAVE_SEARCH_API_KEY',
        message: 'No web search provider is configured.',
      }
    );
  }

  async discover(args: {
    spec: LeadSpec;
    runId: string;
    limit: number;
    onCandidate: (c: CandidateCompany) => Promise<void>;
  }): Promise<DiscoveryReport> {
    const chosen = await this.registry.firstAvailable();
    if (!('provider' in chosen)) {
      const messages = chosen.unavailable
        .map((u) => (u.available ? '' : u.message))
        .filter(Boolean)
        .join(' ');
      return {
        connectorId: this.id,
        attempted: 0,
        found: 0,
        status: 'not_configured',
        message: messages || 'No web search provider is configured.',
        failures: [],
      };
    }

    const provider = chosen.provider;
    const failures: DiscoveryReport['failures'] = [];
    const seenDomains = new Set<string>();
    let attempted = 0;
    let found = 0;

    for (const query of args.spec.discovery.queries) {
      if (found >= args.limit) break;
      attempted += 1;

      let results;
      try {
        results = await provider.search(query, { limit: 20, runId: args.runId });
      } catch (error) {
        if (error instanceof ProviderNotConfiguredError) {
          return {
            connectorId: this.id,
            attempted,
            found,
            status: 'not_configured',
            message: error.message,
            failures,
          };
        }
        if (error instanceof ProviderUnreachableError) {
          failures.push({ url: error.host, status: 'network_blocked', reason: error.message });
          continue;
        }
        throw error;
      }

      for (const result of results) {
        if (found >= args.limit) break;
        const domain = hostOf(result.url);
        if (!domain || seenDomains.has(domain) || isAggregator(domain)) continue;
        seenDomains.add(domain);

        found += 1;
        await args.onCandidate({
          name: cleanTitle(result.title) || domain,
          domain,
          country: null,
          sourceId: provider.sourceId,
          identifiers: [{ kind: 'domain', value: domain, strength: 'medium' }],
          evidenceIds: [],
          claims: [],
          discoveryQuery: query,
        });
      }
    }

    const status: DiscoveryReport['status'] =
      failures.length > 0 && found === 0 ? 'failed' : failures.length > 0 ? 'partial' : 'completed';

    return {
      connectorId: this.id,
      attempted,
      found,
      status,
      message: status === 'failed' ? (failures[0]?.reason ?? 'search provider failed') : null,
      failures,
    };
  }
}

/** Domains that host many companies rather than being one. Never treated as a candidate. */
const AGGREGATORS = new Set([
  'linkedin.com', 'crunchbase.com', 'glassdoor.com', 'indeed.com', 'wikipedia.org', 'youtube.com',
  'twitter.com', 'x.com', 'facebook.com', 'medium.com', 'reddit.com', 'github.com', 'g2.com',
  'capterra.com', 'producthunt.com', 'bloomberg.com', 'forbes.com', 'techcrunch.com', 'ycombinator.com',
  'apple.com', 'play.google.com', 'stackoverflow.com', 'quora.com', 'pitchbook.com', 'owler.com',
  'zoominfo.com', 'apollo.io', 'builtin.com', 'trustradius.com', 'gartner.com', 'clutch.co',
]);

function isAggregator(domain: string): boolean {
  if (AGGREGATORS.has(domain)) return true;
  for (const a of AGGREGATORS) if (domain.endsWith(`.${a}`)) return true;
  return false;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

/** Search titles are usually "Company — tagline"; keep the leading name. */
function cleanTitle(title: string): string {
  return title.split(/\s+[|·—–-]\s+/)[0]?.trim().slice(0, 120) ?? '';
}
