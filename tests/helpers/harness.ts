import { MemoryBlobStore } from '@leadmoor/evidence';
import { Services } from '@leadmoor/runtime';
import type { Logger } from '@leadmoor/core';

/**
 * Test harness.
 *
 * Fixtures live at exactly one seam: the HTTP transport. Everything above it — policy gates, the
 * fetcher, the evidence store, the validator, the claim engine, resolution, scoring, the job queue —
 * is the same code the product runs in production. The pipeline never returns fixture data; it
 * fetches, through the real fetcher, from a stubbed network.
 */

export interface StubRoute {
  status?: number;
  body: string;
  contentType?: string;
  headers?: Record<string, string>;
}

export interface StubTransport {
  fetch: typeof globalThis.fetch;
  calls: Array<{ url: string; method: string }>;
  /** Hosts the stub refuses to answer, simulating an egress block. */
  blockedHosts: Set<string>;
}

/** Builds a fetch stub from a URL→response map. Unmatched URLs 404, unknown hosts fail hard. */
export function stubTransport(routes: Record<string, StubRoute>): StubTransport {
  const calls: Array<{ url: string; method: string }> = [];
  const blockedHosts = new Set<string>();

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method });

    const host = new URL(url).hostname;
    if (blockedHosts.has(host)) {
      throw Object.assign(new TypeError(`fetch failed`), { cause: { code: 'ECONNREFUSED' } });
    }

    const route = routes[url] ?? routes[stripQuery(url)];
    if (!route) {
      return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    }
    return new Response(route.body, {
      status: route.status ?? 200,
      headers: { 'content-type': route.contentType ?? 'text/html', ...(route.headers ?? {}) },
    });
  }) as typeof globalThis.fetch;

  return { fetch: fetchImpl, calls, blockedHosts };
}

function stripQuery(url: string): string {
  const u = new URL(url);
  u.search = '';
  return u.toString();
}

export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return silentLogger;
  },
};

export interface HarnessOptions {
  routes?: Record<string, StubRoute>;
  /** robots.txt body per origin. Absent origins get an empty (permissive) robots.txt. */
  robots?: Record<string, string | null>;
  env?: NodeJS.ProcessEnv;
}

export interface Harness {
  services: Services;
  transport: StubTransport;
  close(): Promise<void>;
}

/** Each harness gets its own in-memory Postgres, so tests never share state. */
export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  const transport = stubTransport(options.routes ?? {});

  const services = new Services({
    databaseUrl: 'pglite://memory',
    env: { ...(options.env ?? {}) } as NodeJS.ProcessEnv,
    logger: silentLogger,
    transport: transport.fetch,
    blobStore: new MemoryBlobStore(),
    robotsFetcher: async (origin) => {
      if (options.robots && origin in options.robots) return options.robots[origin] ?? null;
      return '';
    },
  });

  await services.migrate();
  return {
    services,
    transport,
    async close() {
      await services.close();
    },
  };
}

/** A minimal, valid LeadSpec used across tests. */
export function testSpec(overrides: Record<string, unknown> = {}) {
  return {
    version: 1 as const,
    name: 'Test search',
    sourceRequest: 'Find US SaaS companies hiring security engineers',
    geography: { countries: ['US'], regions: [] },
    company: { descriptors: ['B2B SaaS'], employeeRange: { min: 50, max: 500 }, industries: [], excludeDomains: [] },
    signals: ['Security hiring'],
    personas: { titles: ['CTO', 'VP Engineering'], seniority: [], functions: [], maxPerCompany: 3 },
    discovery: { queries: ['b2b saas security'], sources: ['company_web'], maxCompanies: 10 },
    rubric: {
      criteria: [
        {
          id: 'employee_count',
          name: 'Company size',
          description: '',
          kind: 'weighted' as const,
          weight: 20,
          evaluator: { type: 'numeric_range' as const, field: 'company.employeeCount', min: 50, max: 500 },
          evidenceRequirement: { minSources: 1 },
        },
        {
          id: 'security_hiring',
          name: 'Hiring for security',
          description: '',
          kind: 'weighted' as const,
          weight: 30,
          evaluator: {
            type: 'evidence_keyword' as const,
            anyOf: ['security engineer'],
            allOf: [],
            fieldClass: 'company_signal' as const,
            minMatches: 1,
            documentRoles: [],
          },
          evidenceRequirement: { minSources: 1 },
        },
      ],
      passThreshold: 40,
    },
    evidencePolicy: { minSourcesPerCriterion: 1, disqualifierMinSources: 2, maxEvidenceAgeDays: 540, minCoverage: 0.5 },
    budget: {
      maxCompanies: 10,
      maxDocuments: 60,
      maxPeoplePerCompany: 3,
      maxModelCalls: 10,
      maxRuntimeMs: 60_000,
      maxSearchDepth: 2,
      maxFetchesPerCompany: 6,
    },
    ...overrides,
  };
}
