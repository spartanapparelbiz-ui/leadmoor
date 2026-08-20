import { describe, expect, it } from 'vitest';
import { PolicyViolationError, assertNotTierD, assertPermittedAccessMode, TIER_D_PRACTICES, PERMITTED_TIERS } from '@leadmoor/core';
import {
  M0_SOURCES,
  PolicyEngine,
  SourceRegistry,
  createRunHostAllowlist,
  defineSource,
  isAllowedByRobots,
  parseRobots,
} from '@leadmoor/policy';

const registry = new SourceRegistry();

function engine(overrides: Partial<ConstructorParameters<typeof PolicyEngine>[1]> = {}) {
  return new PolicyEngine(registry.asMap(), {
    userAgent: 'LeadMoor/0.1 (test)',
    runHosts: createRunHostAllowlist(),
    robotsFetcher: async () => '',
    ...overrides,
  });
}

describe('Tier D is unreachable', () => {
  it('has no representable tier D value', () => {
    expect(PERMITTED_TIERS).toEqual(['A', 'B', 'C']);
    expect(PERMITTED_TIERS as readonly string[]).not.toContain('D');
  });

  it('refuses a tier D manifest at construction', () => {
    expect(() =>
      defineSource({
        id: 'shady_broker',
        name: 'Consumer data broker',
        tier: 'D',
        accessMode: 'official_api',
        legalBasis: 'none',
        jurisdiction: ['US'],
        hosts: ['broker.example'],
        permittedFieldClasses: ['person_identity'],
        robots: 'not_applicable',
        rateLimit: { requests: 1, perMs: 1000, minIntervalMs: 0 },
        retentionDays: 30,
        redistribution: { export: true, exportableFieldClasses: [], attribution: null },
        requiresCredential: null,
        trustTier: 1,
        documentation: null,
      }),
    ).toThrow(PolicyViolationError);
  });

  it('refuses a manifest describing a tier D practice as its access mode', () => {
    for (const practice of TIER_D_PRACTICES) {
      expect(() => assertPermittedAccessMode(practice, 'test')).toThrow(PolicyViolationError);
    }
  });

  it('refuses tier D coming from untyped data', () => {
    for (const value of ['D', 'd', 'E', '', null, undefined, 4]) {
      expect(() => assertNotTierD(value, 'test')).toThrow(PolicyViolationError);
    }
  });

  it('refuses registration of a tier D manifest even if one were constructed', () => {
    const smuggled = { ...M0_SOURCES[0]!, id: 'smuggled', tier: 'D' as unknown as 'A' };
    expect(() => new SourceRegistry([smuggled])).toThrow(PolicyViolationError);
  });

  it('ships no tier D source and permits no direct-contact field class', () => {
    for (const source of M0_SOURCES) {
      expect(['A', 'B', 'C']).toContain(source.tier);
      expect(source.permittedFieldClasses).not.toContain('personal_direct_contact');
    }
  });

  it('refuses a manifest that tries to permit direct personal contact data', () => {
    expect(() =>
      defineSource({
        ...M0_SOURCES.find((s) => s.id === 'github_public'),
        id: 'greedy',
        permittedFieldClasses: ['person_identity', 'personal_direct_contact'],
      }),
    ).toThrow(/prohibited product-wide/);
  });

  it('refuses an unknown source id at the fetch gate', async () => {
    const decision = await engine().checkFetch('nonexistent', 'https://example.com/');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('unknown_source');
  });
});

describe('gate 1 — pre-fetch', () => {
  it('permits a declared host for an API source', async () => {
    const decision = await engine().checkFetch('sec_edgar', 'https://data.sec.gov/submissions/CIK0000320193.json');
    expect(decision.allowed).toBe(true);
  });

  it('refuses a host the source never declared', async () => {
    const decision = await engine().checkFetch('sec_edgar', 'https://evil.example/data.json');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('host_not_permitted');
  });

  it('refuses plain http', async () => {
    const decision = await engine().checkFetch('sec_edgar', 'http://data.sec.gov/x.json');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('insecure_scheme');
  });

  it('refuses a URL carrying credentials, since authenticated retrieval is not permitted', async () => {
    const decision = await engine().checkFetch('sec_edgar', 'https://user:pass@data.sec.gov/x.json');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('credentials_in_url');
  });

  it('refuses a run-scoped fetch for a domain the run never discovered', async () => {
    const decision = await engine().checkFetch('company_web', 'https://never-discovered.example/team');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('host_not_permitted');
  });

  it('permits a run-scoped fetch once the domain has been discovered', async () => {
    const runHosts = createRunHostAllowlist();
    runHosts.permit('acme.example');
    const decision = await engine({ runHosts }).checkFetch('company_web', 'https://acme.example/team');
    expect(decision.allowed).toBe(true);
  });

  it('permits a subdomain of a discovered domain but not an unrelated lookalike', async () => {
    const runHosts = createRunHostAllowlist();
    runHosts.permit('acme.example');
    const e = engine({ runHosts });
    expect((await e.checkFetch('company_web', 'https://careers.acme.example/x')).allowed).toBe(true);
    expect((await e.checkFetch('company_web', 'https://acme.example.evil.com/x')).allowed).toBe(false);
  });

  it('honors robots.txt disallow', async () => {
    const runHosts = createRunHostAllowlist();
    runHosts.permit('acme.example');
    const e = engine({ runHosts, robotsFetcher: async () => 'User-agent: *\nDisallow: /private' });
    const denied = await e.checkFetch('company_web', 'https://acme.example/private/team');
    expect(denied.allowed).toBe(false);
    if (!denied.allowed) expect(denied.code).toBe('robots_denied');
  });

  it('fails closed when robots.txt cannot be read', async () => {
    const runHosts = createRunHostAllowlist();
    runHosts.permit('acme.example');
    const e = engine({ runHosts, robotsFetcher: async () => null });
    const decision = await e.checkFetch('company_web', 'https://acme.example/team');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('robots_unreadable');
  });

  it('exhausts the rate limit rather than letting a caller burst past it', async () => {
    const e = engine();
    const results: boolean[] = [];
    for (let i = 0; i < 40; i++) {
      results.push((await e.checkFetch('gleif', `https://api.gleif.org/api/v1/lei-records?n=${i}`)).allowed);
    }
    expect(results.filter(Boolean).length).toBeLessThanOrEqual(30);
    expect(results).toContain(false);
  });
});

describe('gate 2 — post-extract', () => {
  it('permits a field class the source declares', () => {
    expect(engine().checkExtract('sec_edgar', 'company_identity').allowed).toBe(true);
  });

  it('refuses a field class the source does not declare', () => {
    const decision = engine().checkExtract('gleif', 'person_work_email');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('field_class_not_permitted');
  });

  it('refuses direct personal contact data from every source, without exception', () => {
    for (const source of M0_SOURCES) {
      const decision = engine().checkExtract(source.id, 'personal_direct_contact');
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.code).toBe('field_class_globally_prohibited');
    }
  });
});

describe('gate 3 — export', () => {
  it('permits export from a source whose terms allow redistribution', () => {
    expect(engine().checkExport('sec_edgar', 'company_identity').allowed).toBe(true);
  });

  it('refuses export from a search provider whose terms forbid redistribution', () => {
    const decision = engine().checkExport('brave_search', 'company_identity');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('export_not_permitted');
  });
});

describe('robots.txt parsing', () => {
  it('applies the most specific user-agent group', () => {
    const body = 'User-agent: *\nDisallow: /\n\nUser-agent: LeadMoor\nDisallow: /admin';
    const rules = parseRobots(body, 'LeadMoor/0.1');
    expect(isAllowedByRobots(rules, '/team')).toBe(true);
    expect(isAllowedByRobots(rules, '/admin/users')).toBe(false);
  });

  it('lets a longer Allow override a shorter Disallow', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /docs\nAllow: /docs/public', 'x');
    expect(isAllowedByRobots(rules, '/docs/private')).toBe(false);
    expect(isAllowedByRobots(rules, '/docs/public/a')).toBe(true);
  });

  it('supports wildcards and end anchors', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /*.pdf$', 'x');
    expect(isAllowedByRobots(rules, '/files/report.pdf')).toBe(false);
    expect(isAllowedByRobots(rules, '/files/report.pdf.html')).toBe(true);
  });

  it('treats an empty robots.txt as fully permitted', () => {
    expect(isAllowedByRobots(parseRobots('', 'x'), '/anything')).toBe(true);
  });

  it('reads crawl-delay', () => {
    expect(parseRobots('User-agent: *\nCrawl-delay: 2.5', 'x').crawlDelayMs).toBe(2500);
  });
});

describe('source registry', () => {
  it('reports which credentials are missing without leaking their values', () => {
    const missing = registry.missingCredentials({} as NodeJS.ProcessEnv);
    expect(missing.map((m) => m.envVar)).toEqual(
      expect.arrayContaining(['BRAVE_SEARCH_API_KEY', 'EXA_API_KEY']),
    );
  });

  it('lists sources that work with no credentials at all', () => {
    const free = registry.credentialFree().map((s) => s.id);
    expect(free).toEqual(expect.arrayContaining(['sec_edgar', 'gleif', 'github_public', 'company_web']));
  });

  it('refuses duplicate source ids', () => {
    expect(() => new SourceRegistry([M0_SOURCES[0]!, M0_SOURCES[0]!])).toThrow(/duplicate source id/);
  });
});
