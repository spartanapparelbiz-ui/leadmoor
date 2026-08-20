import { z } from 'zod';
import { ProviderNotConfiguredError, ProviderUnreachableError } from '@leadmoor/core';
import type { Fetcher, ConnectorAvailability } from '../types.js';
import type { SearchProvider, SearchResult } from './types.js';

const responseSchema = z.object({
  web: z
    .object({
      results: z
        .array(z.object({ title: z.string().default(''), url: z.string(), description: z.string().default('') }))
        .default([]),
    })
    .optional(),
});

/** Brave Search API adapter. Real integration; reports honestly when BRAVE_SEARCH_API_KEY is absent. */
export class BraveSearchProvider implements SearchProvider {
  readonly id = 'brave_search';
  readonly sourceId = 'brave_search';

  constructor(
    private readonly fetcher: Fetcher,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async availability(): Promise<ConnectorAvailability> {
    if (!this.env.BRAVE_SEARCH_API_KEY) {
      return {
        available: false,
        reason: 'not_configured',
        envVar: 'BRAVE_SEARCH_API_KEY',
        message: 'Brave Search is not configured. Set BRAVE_SEARCH_API_KEY to enable web discovery.',
      };
    }
    return { available: true };
  }

  async search(query: string, opts: { limit: number; runId: string | null }): Promise<SearchResult[]> {
    const key = this.env.BRAVE_SEARCH_API_KEY;
    if (!key) throw new ProviderNotConfiguredError('brave_search', 'BRAVE_SEARCH_API_KEY');

    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', query);
    url.searchParams.set('count', String(Math.min(20, opts.limit)));
    url.searchParams.set('country', 'us');
    url.searchParams.set('result_filter', 'web');

    const outcome = await this.fetcher.fetch({
      sourceId: this.sourceId,
      url: url.toString(),
      documentRole: 'search_result',
      runId: opts.runId,
      headers: { 'X-Subscription-Token': key, Accept: 'application/json' },
    });

    if (outcome.status !== 'ok' || !outcome.evidence) {
      throw new ProviderUnreachableError('brave_search', 'api.search.brave.com', {
        status: outcome.status,
        reason: outcome.reason,
      });
    }

    const parsed = responseSchema.safeParse(JSON.parse(outcome.evidence.normalizedText));
    if (!parsed.success) return [];
    return (parsed.data.web?.results ?? []).map((r, i) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
      rank: i + 1,
    }));
  }
}
