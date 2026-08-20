import type { ConnectorAvailability } from '../types.js';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  rank: number;
}

/**
 * SearchProvider port — ARCHITECTURE.md §10.
 *
 * Discovery is written against this interface, never against a specific vendor, so providers are
 * swappable without touching the pipeline. A provider that lacks credentials says so; it never
 * returns an empty result set that would read as "nothing found".
 */
export interface SearchProvider {
  readonly id: string;
  readonly sourceId: string;
  availability(): Promise<ConnectorAvailability>;
  search(query: string, opts: { limit: number; runId: string | null }): Promise<SearchResult[]>;
}
