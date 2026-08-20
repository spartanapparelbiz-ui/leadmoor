import { z } from 'zod';
import { ProviderNotConfiguredError, ProviderUnreachableError } from '@leadmoor/core';
import type { Fetcher, ConnectorAvailability } from '../types.js';
import type { SearchProvider, SearchResult } from './types.js';

const responseSchema = z.object({
  results: z
    .array(z.object({ title: z.string().nullable().default(''), url: z.string(), text: z.string().nullable().default('') }))
    .default([]),
});

/** Exa Search API adapter. Real integration; reports honestly when EXA_API_KEY is absent. */
export class ExaSearchProvider implements SearchProvider {
  readonly id = 'exa_search';
  readonly sourceId = 'exa_search';

  constructor(
    private readonly fetcher: Fetcher,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  async availability(): Promise<ConnectorAvailability> {
    if (!this.env.EXA_API_KEY) {
      return {
        available: false,
        reason: 'not_configured',
        envVar: 'EXA_API_KEY',
        message: 'Exa is not configured. Set EXA_API_KEY to enable web discovery.',
      };
    }
    return { available: true };
  }

  async search(query: string, opts: { limit: number; runId: string | null }): Promise<SearchResult[]> {
    const key = this.env.EXA_API_KEY;
    if (!key) throw new ProviderNotConfiguredError('exa_search', 'EXA_API_KEY');

    const outcome = await this.fetcher.fetch({
      sourceId: this.sourceId,
      url: 'https://api.exa.ai/search',
      documentRole: 'search_result',
      runId: opts.runId,
      headers: { 'x-api-key': key, Accept: 'application/json' },
      json: { query, numResults: Math.min(25, opts.limit), type: 'auto', contents: { text: { maxCharacters: 1200 } } },
    });

    if (outcome.status !== 'ok' || !outcome.evidence) {
      throw new ProviderUnreachableError('exa_search', 'api.exa.ai', { status: outcome.status, reason: outcome.reason });
    }

    const parsed = responseSchema.safeParse(JSON.parse(outcome.evidence.normalizedText));
    if (!parsed.success) return [];
    return parsed.data.results.map((r, i) => ({
      title: r.title ?? '',
      url: r.url,
      snippet: (r.text ?? '').slice(0, 600),
      rank: i + 1,
    }));
  }
}
