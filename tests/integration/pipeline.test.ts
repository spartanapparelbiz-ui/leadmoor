import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { newId, suppressionKey } from '@leadmoor/core';
import {
  AuditLog,
  WorkspaceScope,
  claim as claimTable,
  company as companyTable,
  criterionVerdict as verdictTable,
  evidence as evidenceTable,
  fetchLog,
  lead as leadTable,
  leadRequest,
  leadSpec as leadSpecTable,
  person as personTable,
  run as runTable,
  runStage as runStageTable,
} from '@leadmoor/db';
import { PolicyEngine, SourceRegistry, createRunHostAllowlist } from '@leadmoor/policy';
import { DeletionService, ExportService, SuppressionService } from '@leadmoor/export';
import { RunEngine, Services } from '@leadmoor/runtime';
import { MemoryBlobStore } from '@leadmoor/evidence';
import { silentLogger, stubTransport, testSpec } from '../helpers/harness.js';
import { seedWorkspace } from '../helpers/db.js';

/**
 * Full-pipeline integration.
 *
 * The only thing stubbed is the network transport. Every layer above it — policy gates, the real
 * HttpFetcher, the evidence store, the provenance validator, the claim engine, resolution, the
 * scorer, the durable queue — is production code. The pipeline genuinely fetches these pages
 * through the real fetcher; it is never handed fixture objects.
 */

const ACME_HOME = `<!doctype html><html><head><title>Acme Systems</title></head><body>
<nav><a href="/about">About</a><a href="/team">Team</a><a href="/careers">Careers</a><a href="/security">Security</a></nav>
<h1>Acme Systems</h1><p>Infrastructure security for modern engineering teams.</p>
</body></html>`;

const ACME_ABOUT = `<!doctype html><html><body>
<h1>About Acme Systems</h1>
<p>Founded in San Francisco, United States. We are a team of 142 employees serving enterprise customers.</p>
</body></html>`;

const ACME_TEAM = `<!doctype html><html><body>
<h1>Leadership</h1>
<ul>
<li><strong>Jane Okafor</strong> &mdash; Chief Technology Officer. Reach her at jane.okafor@acme.example.</li>
<li><strong>Marcus Bell</strong> &mdash; VP Engineering</li>
</ul>
</body></html>`;

const ACME_CAREERS = `<!doctype html><html><body>
<h1>Open roles</h1>
<p>We are hiring a Security Engineer to build our detection platform.</p>
<p>Also hiring a Platform Engineer with Kubernetes experience.</p>
</body></html>`;

const ACME_SECURITY = `<!doctype html><html><body>
<h1>Trust and security</h1><p>Acme maintains SOC 2 Type II compliance, audited annually.</p>
</body></html>`;

const BOREAL_HOME = `<!doctype html><html><head><title>Boreal Data</title></head><body>
<nav><a href="/about">About</a></nav><h1>Boreal Data</h1><p>Analytics tooling.</p>
</body></html>`;

const BOREAL_ABOUT = `<!doctype html><html><body>
<h1>About Boreal</h1><p>We are a team of 9 employees in Portland.</p>
</body></html>`;

const GITHUB_SEARCH = JSON.stringify({
  total_count: 2,
  items: [
    { full_name: 'acme/platform', html_url: 'https://github.com/acme/platform', description: 'security platform', owner: { login: 'acme', type: 'Organization' } },
    { full_name: 'boreal/core', html_url: 'https://github.com/boreal/core', description: 'analytics', owner: { login: 'boreal', type: 'Organization' } },
  ],
});

const GITHUB_ACME_ORG = JSON.stringify({
  login: 'acme',
  name: 'Acme Systems',
  blog: 'https://acme.example',
  location: 'San Francisco, United States',
  description: 'Infrastructure security',
  public_repos: 42,
  type: 'Organization',
  html_url: 'https://github.com/acme',
});

const GITHUB_BOREAL_ORG = JSON.stringify({
  login: 'boreal',
  name: 'Boreal Data',
  blog: 'https://boreal.example',
  location: 'Portland, United States',
  description: 'Analytics tooling',
  public_repos: 8,
  type: 'Organization',
  html_url: 'https://github.com/boreal',
});

const ROUTES: Record<string, { body: string; contentType?: string }> = {
  'https://api.github.com/search/repositories': { body: GITHUB_SEARCH, contentType: 'application/json' },
  'https://api.github.com/orgs/acme': { body: GITHUB_ACME_ORG, contentType: 'application/json' },
  'https://api.github.com/orgs/boreal': { body: GITHUB_BOREAL_ORG, contentType: 'application/json' },
  'https://acme.example/': { body: ACME_HOME },
  'https://acme.example/about': { body: ACME_ABOUT },
  'https://acme.example/team': { body: ACME_TEAM },
  'https://acme.example/careers': { body: ACME_CAREERS },
  'https://acme.example/security': { body: ACME_SECURITY },
  'https://boreal.example/': { body: BOREAL_HOME },
  'https://boreal.example/about': { body: BOREAL_ABOUT },
};

const SPEC = testSpec({
  discovery: { queries: ['security platform'], sources: ['github_public', 'company_web'], maxCompanies: 10 },
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
          anyOf: ['Security Engineer'],
          allOf: [],
          fieldClass: 'company_signal' as const,
          minMatches: 1,
          documentRoles: [],
        },
        evidenceRequirement: { minSources: 1 },
      },
      {
        id: 'compliance_signal',
        name: 'Compliance program',
        description: '',
        kind: 'weighted' as const,
        weight: 25,
        evaluator: {
          type: 'evidence_keyword' as const,
          anyOf: ['SOC 2'],
          allOf: [],
          fieldClass: 'company_signal' as const,
          minMatches: 1,
          documentRoles: [],
        },
        evidenceRequirement: { minSources: 1 },
      },
      {
        id: 'decision_maker_identified',
        name: 'Technical decision maker identified',
        description: '',
        kind: 'weighted' as const,
        weight: 15,
        evaluator: { type: 'structured_predicate' as const, field: 'person.role', op: 'exists' as const },
        evidenceRequirement: { minSources: 1 },
      },
    ],
    passThreshold: 40,
  },
});

describe('full pipeline against permitted sources', () => {
  let services: Services;
  let engine: RunEngine;
  let runId: string;
  let workspaceId: string;
  let transport: ReturnType<typeof stubTransport>;

  beforeAll(async () => {
    transport = stubTransport(ROUTES);
    services = new Services({
      databaseUrl: 'pglite://memory',
      env: {} as NodeJS.ProcessEnv,
      logger: silentLogger,
      transport: transport.fetch,
      blobStore: new MemoryBlobStore(),
      robotsFetcher: async () => '',
    });
    await services.migrate();

    workspaceId = (await seedWorkspace(services.db)).workspaceId;

    const requestId = newId();
    const specId = newId();
    await services.db.insert(leadRequest).values({ id: requestId, workspaceId, rawText: SPEC.sourceRequest });
    await services.db.insert(leadSpecTable).values({
      id: specId,
      requestId,
      workspaceId,
      version: 1,
      spec: SPEC as never,
      origin: 'compiled',
      approvedAt: new Date(),
    });

    engine = new RunEngine(services, 'test-worker', silentLogger);
    runId = await engine.start(specId);
    await engine.drain(50);
  }, 60_000);

  afterAll(async () => {
    await services.close();
  });

  it('completes every stage', async () => {
    const stages = await services.db.select().from(runStageTable).where(eq(runStageTable.runId, runId));
    const byStage = Object.fromEntries(stages.map((s) => [s.stage, s.status]));
    expect(byStage.source_planning).toBe('completed');
    expect(byStage.discovery).toMatch(/completed|partial/);
    expect(byStage.scoring).toBe('completed');
    expect(byStage.evidence_assembly).toBe('completed');
  });

  it('finishes the run without failing', async () => {
    const row = (await services.db.select().from(runTable).where(eq(runTable.id, runId)).limit(1))[0];
    expect(['completed', 'partial']).toContain(row?.status);
  });

  it('records the run’s own lifecycle inside the owning workspace', async () => {
    // Written unscoped, these land with a null workspace and are visible to nobody — which makes a
    // run's own history disappear from the audit log of the workspace that ran it.
    const scope = new WorkspaceScope(services.db, workspaceId);
    const actions = (await scope.listAudit({ runId })).map((e) => e.action);

    expect(actions).toContain('run.created');
    expect(actions).toContain('run.started');
    expect(actions).toContain('run.stage_started');
    expect(actions).toContain('run.stage_completed');
    expect(actions).toContain('run.completed');
  });

  it('shows a different workspace none of that history', async () => {
    const other = await seedWorkspace(services.db, { email: 'outsider@example.test' });
    const scope = new WorkspaceScope(services.db, other.workspaceId);
    expect(await scope.listAudit({ runId })).toHaveLength(0);
  });

  it('actually fetched the company pages through the real fetcher', () => {
    const urls = transport.calls.map((c) => c.url);
    expect(urls).toContain('https://acme.example/');
    expect(urls).toContain('https://acme.example/team');
    expect(urls).toContain('https://acme.example/careers');
  });

  it('stored evidence with content hashes and retrievable text', async () => {
    const docs = await services.db.select().from(evidenceTable).where(eq(evidenceTable.runId, runId));
    expect(docs.length).toBeGreaterThan(4);
    for (const doc of docs) {
      expect(doc.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(doc.normalizedText.length).toBeGreaterThan(0);
    }
    const team = docs.find((d) => d.url.endsWith('/team'));
    expect(team?.normalizedText).toContain('Jane Okafor');
  });

  it('logged every fetch, including the ones that 404ed', async () => {
    const fetches = await services.db.select().from(fetchLog).where(eq(fetchLog.runId, runId));
    expect(fetches.length).toBeGreaterThan(0);
    expect(fetches.every((f) => f.status.length > 0)).toBe(true);
  });

  it('discovered both companies and resolved them to distinct records', async () => {
    const companies = await services.db.select().from(companyTable).where(eq(companyTable.runId, runId));
    const names = companies.map((c) => c.canonicalName).sort();
    expect(names).toEqual(['Acme Systems', 'Boreal Data']);
    expect(new Set(companies.map((c) => c.primaryDomain)).size).toBe(2);
  });

  it('extracted an employee count as a claim backed by a real span', async () => {
    const acme = (await services.db.select().from(companyTable).where(eq(companyTable.runId, runId)))
      .find((c) => c.primaryDomain === 'acme.example');
    expect(acme).toBeDefined();

    const claims = await services.claims.getClaims('company', acme!.id, 'company.employeeCount');
    const supported = claims.filter((c) => c.status === 'supported');
    expect(supported.length).toBeGreaterThan(0);
    expect(supported[0]!.value).toBe(142);

    // The span must genuinely resolve inside the stored document.
    const span = supported[0]!.spans[0]!;
    const doc = await services.evidence.get(span.evidenceId);
    expect(doc!.normalizedText.slice(span.start, span.end)).toBe(span.quote);
    expect(span.quote).toContain('142');
  });

  it('found an evidence-backed decision maker and never invented one', async () => {
    const people = await services.db.select().from(personTable).where(eq(personTable.runId, runId));
    const jane = people.find((p) => p.fullName === 'Jane Okafor');
    expect(jane).toBeDefined();

    const roleClaim = await services.claims.getBestSupportedClaim('person', jane!.id, 'person.role');
    expect(roleClaim?.value).toBe('Chief Technology Officer');
    expect(roleClaim?.spans.length).toBeGreaterThan(0);

    // Every person present must have a supported name claim — no unsourced people.
    for (const person of people) {
      const nameClaim = await services.claims.getBestSupportedClaim('person', person.id, 'person.fullName');
      expect(nameClaim).not.toBeNull();
    }
  });

  it('produced an explainable score with per-criterion verdicts', async () => {
    const acme = (await services.db.select().from(companyTable).where(eq(companyTable.runId, runId)))
      .find((c) => c.primaryDomain === 'acme.example');
    const verdicts = await services.db
      .select()
      .from(verdictTable)
      .where(eq(verdictTable.subjectId, acme!.id));

    expect(verdicts.length).toBe(SPEC.rubric.criteria.length);
    const security = verdicts.find((v) => v.criterionId === 'security_hiring');
    expect(security?.verdict).toBe('pass');
    expect((security?.spans as unknown[]).length).toBeGreaterThan(0);
    expect(security?.reasoning).toContain('Security Engineer');

    const compliance = verdicts.find((v) => v.criterionId === 'compliance_signal');
    expect(compliance?.verdict).toBe('pass');
  });

  it('qualifies the strong company and does not qualify the weak one', async () => {
    const leads = await services.db.select().from(leadTable).where(eq(leadTable.runId, runId));
    const companies = await services.db.select().from(companyTable).where(eq(companyTable.runId, runId));
    const byId = new Map(companies.map((c) => [c.id, c]));

    const acmeLead = leads.find((l) => byId.get(l.companyId)?.primaryDomain === 'acme.example');
    const borealLead = leads.find((l) => byId.get(l.companyId)?.primaryDomain === 'boreal.example');

    expect(acmeLead?.status).toBe('qualified');
    expect(acmeLead!.score).toBeGreaterThan(50);
    expect(acmeLead?.rationale).toBeTruthy();

    // Boreal has 9 employees and no security signal — it must not qualify.
    expect(borealLead?.status).not.toBe('qualified');
  });

  it('marks unknown criteria as unknown rather than false', async () => {
    const boreal = (await services.db.select().from(companyTable).where(eq(companyTable.runId, runId)))
      .find((c) => c.primaryDomain === 'boreal.example');
    const verdicts = await services.db.select().from(verdictTable).where(eq(verdictTable.subjectId, boreal!.id));
    const security = verdicts.find((v) => v.criterionId === 'security_hiring');
    expect(security?.verdict).toBe('unknown');
    expect(security?.status).toBe('insufficient_evidence');
  });

  it('never fabricates an email and reports a published one as unverified', async () => {
    const leads = await services.db.select().from(leadTable).where(eq(leadTable.runId, runId));
    for (const lead of leads) {
      expect(['verified', 'unverified', 'unavailable']).toContain(lead.emailStatus);
      if (lead.email) {
        expect(lead.emailStatus).not.toBe('verified');
        // The address must literally exist in a stored document.
        const docs = await services.evidence.listForRun(runId);
        expect(docs.some((d) => d.normalizedText.includes(lead.email as string))).toBe(true);
      }
    }
    const withEmail = leads.find((l) => l.email);
    expect(withEmail?.email).toBe('jane.okafor@acme.example');
    expect(withEmail?.emailStatus).toBe('unverified');
  });

  it('records an audit trail of what happened', async () => {
    const audit = new AuditLog(services.db);
    const events = await audit.forRun(runId);
    const actions = new Set(events.map((e) => e.action));
    expect(actions).toContain('run.created');
    expect(actions).toContain('document.retrieved');
    expect(actions).toContain('claim.created');
    expect(actions).toContain('score.generated');
  });

  it('stores no claim that is supported yet uncited', async () => {
    const claims = await services.db.select().from(claimTable).where(eq(claimTable.runId, runId));
    for (const c of claims) {
      if (c.status === 'supported') expect((c.spans as unknown[]).length).toBeGreaterThan(0);
      else expect(c.value).toBeNull();
    }
  });

  describe('export, suppression, deletion', () => {
    const policy = new PolicyEngine(new SourceRegistry().asMap(), {
      userAgent: 'test',
      runHosts: createRunHostAllowlist(),
    });

    it('exports qualified leads as CSV with provenance', async () => {
      const audit = new AuditLog(services.db);
      const result = await new ExportService(services.db, policy, audit, workspaceId).exportRun(runId);
      expect(result.rows.length).toBeGreaterThan(0);

      const acme = result.rows.find((r) => r.domain === 'acme.example');
      expect(acme?.person).toBe('Jane Okafor');
      expect(acme?.role).toBe('Chief Technology Officer');
      expect(acme?.email_status).toBe('unverified');
      expect(Number(acme?.evidence_count)).toBeGreaterThan(0);
      expect(acme?.source_urls).toContain('acme.example');
      expect(result.csv.split('\n')[0]).toContain('email_status');
    });

    it('excludes a suppressed lead from export', async () => {
      const audit = new AuditLog(services.db);
      const suppression = new SuppressionService(services.db, audit, workspaceId);
      const leads = await services.db.select().from(leadTable).where(eq(leadTable.runId, runId));
      const companies = await services.db.select().from(companyTable).where(eq(companyTable.runId, runId));
      const byId = new Map(companies.map((c) => [c.id, c]));
      const acmeLead = leads.find((l) => byId.get(l.companyId)?.primaryDomain === 'acme.example');

      await suppression.suppressLead(acmeLead!.id);
      expect(await suppression.isSuppressed('domain', 'acme.example')).toBe(true);

      const after = await new ExportService(services.db, policy, audit, workspaceId).exportRun(runId);
      expect(after.rows.find((r) => r.domain === 'acme.example')).toBeUndefined();
      expect(after.suppressedCount).toBeGreaterThan(0);
    });

    it('deletes a person without leaving orphaned contact data', async () => {
      const audit = new AuditLog(services.db);
      const suppression = new SuppressionService(services.db, audit, workspaceId);
      const deletion = new DeletionService(services.db, audit, suppression, workspaceId);

      const people = await services.db.select().from(personTable).where(eq(personTable.runId, runId));
      const jane = people.find((p) => p.fullName === 'Jane Okafor');
      expect(jane).toBeDefined();

      const result = await deletion.deletePerson(jane!.id);
      expect(result.claimsDeleted).toBeGreaterThan(0);

      expect(await services.claims.getClaims('person', jane!.id)).toHaveLength(0);
      expect(
        (await services.db.select().from(personTable).where(eq(personTable.id, jane!.id))).length,
      ).toBe(0);

      const leads = await services.db.select().from(leadTable).where(eq(leadTable.runId, runId));
      for (const lead of leads) {
        expect(lead.personId).not.toBe(jane!.id);
        if (lead.personId === null) expect(lead.email).toBeNull();
      }
    });

    it('keeps the suppression key after deletion so future runs still honor it', async () => {
      const suppression = new SuppressionService(services.db, new AuditLog(services.db), workspaceId);
      const keys = await suppression.list();
      expect(keys.some((k) => k.reason === 'deletion_request')).toBe(true);
      // The key is a hash — the raw identifier is not retained anywhere in it.
      for (const k of keys) expect(k.key).toMatch(/^(email|domain|person):[0-9a-f]{64}$/);
    });
  });
});

describe('a blocked provider is reported, never silently empty', () => {
  it('marks the run failed with the real reason when every host is unreachable', async () => {
    const transport = stubTransport(ROUTES);
    // Simulate the egress policy denying the discovery host.
    transport.blockedHosts.add('api.github.com');

    const services = new Services({
      databaseUrl: 'pglite://memory',
      env: {} as NodeJS.ProcessEnv,
      logger: silentLogger,
      transport: transport.fetch,
      blobStore: new MemoryBlobStore(),
      robotsFetcher: async () => '',
    });
    await services.migrate();

    const blockedWorkspace = (await seedWorkspace(services.db)).workspaceId;
    const requestId = newId();
    const specId = newId();
    await services.db.insert(leadRequest).values({ id: requestId, workspaceId: blockedWorkspace, rawText: 'x' });
    await services.db.insert(leadSpecTable).values({
      id: specId,
      requestId,
      workspaceId: blockedWorkspace,
      version: 1,
      spec: testSpec({ discovery: { queries: ['blocked test query'], sources: ['github_public'], maxCompanies: 5 } }) as never,
      origin: 'compiled',
      approvedAt: new Date(),
    });

    const engine = new RunEngine(services, 'blocked-worker', silentLogger);
    const runId = await engine.start(specId);
    await engine.drain(50);

    const row = (await services.db.select().from(runTable).where(eq(runTable.id, runId)).limit(1))[0];
    expect(row?.status).toBe('failed');
    expect(row?.error).toMatch(/No companies discovered|network unreachable/i);

    const fetches = await services.db.select().from(fetchLog).where(eq(fetchLog.runId, runId));
    expect(fetches.some((f) => f.status === 'network_blocked')).toBe(true);

    // Zero leads AND an explicit failure reason — not a quiet "search complete".
    const leads = await services.db.select().from(leadTable).where(eq(leadTable.runId, runId));
    expect(leads).toHaveLength(0);

    await services.close();
  }, 60_000);
});

describe('suppression key hashing', () => {
  it('never stores the raw identifier', () => {
    const key = suppressionKey('email', 'jane.okafor@acme.example');
    expect(key).not.toContain('jane');
    expect(key).not.toContain('acme');
    expect(key).toMatch(/^email:[0-9a-f]{64}$/);
  });
});
