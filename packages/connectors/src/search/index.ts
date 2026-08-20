export * from './types.js';
export * from './brave.js';
export * from './exa.js';

import type { SearchProvider } from './types.js';
import type { ConnectorAvailability } from '../types.js';

/**
 * Chooses among configured search providers.
 *
 * When none is configured this reports every provider's missing credential rather than returning
 * zero results — "provider not configured" and "nothing found" are different outcomes and the
 * product must never conflate them.
 */
export class SearchProviderRegistry {
  constructor(private readonly providers: SearchProvider[]) {}

  all(): SearchProvider[] {
    return this.providers;
  }

  async firstAvailable(): Promise<{ provider: SearchProvider } | { unavailable: ConnectorAvailability[] }> {
    const unavailable: ConnectorAvailability[] = [];
    for (const provider of this.providers) {
      const status = await provider.availability();
      if (status.available) return { provider };
      unavailable.push(status);
    }
    return { unavailable };
  }
}
