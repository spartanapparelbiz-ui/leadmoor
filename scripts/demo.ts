/**
 * Demo mode — local development and evaluation only.
 *
 * This does NOT insert fabricated leads into the database. It runs the *real* pipeline — the same
 * Services, policy gates, fetcher, evidence store, provenance validator, resolver, and scorer the
 * product uses — against a fixture corpus supplied at the HTTP transport seam. Every claim it
 * produces is genuinely extracted from a stored document and genuinely validated.
 *
 * The corpus describes obviously fictional companies on `.example` domains, and the run is flagged
 * `is_demo` so the interface labels it everywhere. Production has no code path that reaches this
 * file: it is a script, not an application module, and nothing in apps/ imports it.
 *
 *   pnpm demo:seed
 */
import { eq } from 'drizzle-orm';
import { newId } from '@leadmoor/core';
import { AuthService } from '@leadmoor/auth';
import { leadRequest, leadSpec as leadSpecTable, run as runTable } from '@leadmoor/db';
import { MemoryBlobStore } from '@leadmoor/evidence';
import { HeuristicSpecCompiler } from '@leadmoor/llm';
import { RunEngine, Services } from '@leadmoor/runtime';

const REQUEST =
  'Find 20 US-based B2B SaaS companies with 50-500 employees that are hiring security engineers and show SOC 2 compliance signals, and identify the CTO or VP Engineering.';

/* ── fixture corpus: obviously fictional companies on .example domains ──── */

const page = (title: string, body: string) =>
  `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;

const nav = `<nav><a href="/about">About</a><a href="/team">Team</a><a href="/careers">Careers</a><a href="/security">Security</a></nav>`;

const CORPUS: Record<string, string> = {
  // Northwind Ledger — strong on every signal
  'https://northwind-ledger.example/': page(
    'Northwind Ledger',
    `${nav}<h1>Northwind Ledger</h1><p>Financial close automation for mid-market finance teams.</p>`,
  ),
  'https://northwind-ledger.example/about': page(
    'About Northwind Ledger',
    `<h1>About us</h1><p>Founded in 2018 and headquartered in Boston, United States. We are a team of 214 employees serving finance departments across North America.</p>`,
  ),
  'https://northwind-ledger.example/team': page(
    'Leadership',
    `<h1>Leadership</h1><ul>
     <li><strong>Priya Raghunathan</strong> &mdash; Chief Technology Officer. Reach her at priya.raghunathan@northwind-ledger.example.</li>
     <li><strong>Daniel Okonkwo</strong> &mdash; VP Engineering</li>
     <li><strong>Hannah Weiss</strong> &mdash; Head of Security</li></ul>`,
  ),
  'https://northwind-ledger.example/careers': page(
    'Careers',
    `<h1>Open roles</h1><p>We are hiring a Security Engineer to expand our detection and response practice.</p><p>We are also hiring a Platform Engineer with deep Kubernetes and Terraform experience.</p>`,
  ),
  'https://northwind-ledger.example/security': page(
    'Trust',
    `<h1>Trust and security</h1><p>Northwind Ledger maintains SOC 2 Type II certification, renewed annually, and completes an independent penetration test every six months.</p>`,
  ),

  // Cascade Signal — mid-strength, no compliance page
  'https://cascade-signal.example/': page(
    'Cascade Signal',
    `${nav}<h1>Cascade Signal</h1><p>Observability for distributed systems.</p>`,
  ),
  'https://cascade-signal.example/about': page(
    'About',
    `<h1>About Cascade Signal</h1><p>Based in Denver, United States. We are a team of 88 employees.</p>`,
  ),
  'https://cascade-signal.example/team': page(
    'Team',
    `<h1>Our team</h1><ul><li><strong>Marcus Bell</strong> &mdash; VP Engineering</li></ul>`,
  ),
  'https://cascade-signal.example/careers': page(
    'Careers',
    `<h1>Join us</h1><p>We are hiring a Security Engineer and a Backend Engineer.</p>`,
  ),

  // Tidewater Forms — too small, should not qualify
  'https://tidewater-forms.example/': page(
    'Tidewater Forms',
    `<nav><a href="/about">About</a></nav><h1>Tidewater Forms</h1><p>Simple form building.</p>`,
  ),
  'https://tidewater-forms.example/about': page(
    'About',
    `<h1>About</h1><p>We are a team of 7 employees in Austin, United States. Trusted by 40,000 customers.</p>`,
  ),

  // Granite Peak Health — has compliance but no discoverable person
  'https://granite-peak-health.example/': page(
    'Granite Peak Health',
    `<nav><a href="/security">Security</a><a href="/about">About</a></nav><h1>Granite Peak Health</h1><p>Care coordination software.</p>`,
  ),
  'https://granite-peak-health.example/about': page(
    'About',
    `<h1>About</h1><p>Located in Seattle, United States. We are a team of 160 employees.</p>`,
  ),
  'https://granite-peak-health.example/security': page(
    'Security',
    `<h1>Security</h1><p>Granite Peak Health is HIPAA compliant and holds SOC 2 Type II certification.</p>`,
  ),
};

const GITHUB_SEARCH = JSON.stringify({
  total_count: 4,
  items: [
    { full_name: 'northwind-ledger/platform', html_url: 'https://github.com/northwind-ledger/platform', description: 'close automation platform', owner: { login: 'northwind-ledger', type: 'Organization' } },
    { full_name: 'cascade-signal/agent', html_url: 'https://github.com/cascade-signal/agent', description: 'observability agent', owner: { login: 'cascade-signal', type: 'Organization' } },
    { full_name: 'tidewater-forms/web', html_url: 'https://github.com/tidewater-forms/web', description: 'form builder', owner: { login: 'tidewater-forms', type: 'Organization' } },
    { full_name: 'granite-peak-health/core', html_url: 'https://github.com/granite-peak-health/core', description: 'care coordination', owner: { login: 'granite-peak-health', type: 'Organization' } },
  ],
});

const ORGS: Record<string, { name: string; blog: string; location: string }> = {
  'northwind-ledger': { name: 'Northwind Ledger', blog: 'https://northwind-ledger.example', location: 'Boston, United States' },
  'cascade-signal': { name: 'Cascade Signal', blog: 'https://cascade-signal.example', location: 'Denver, United States' },
  'tidewater-forms': { name: 'Tidewater Forms', blog: 'https://tidewater-forms.example', location: 'Austin, United States' },
  'granite-peak-health': { name: 'Granite Peak Health', blog: 'https://granite-peak-health.example', location: 'Seattle, United States' },
};

/** The fixture transport. Anything not in the corpus 404s, exactly as a real miss would. */
const transport = (async (input: RequestInfo | URL): Promise<Response> => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input);
  const bare = url.split('?')[0] ?? url;

  if (bare === 'https://api.github.com/search/repositories') {
    return new Response(GITHUB_SEARCH, { status: 200, headers: { 'content-type': 'application/json' } });
  }
  const orgMatch = /^https:\/\/api\.github\.com\/orgs\/(.+)$/.exec(bare);
  if (orgMatch?.[1]) {
    const org = ORGS[orgMatch[1]];
    if (!org) return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } });
    return new Response(
      JSON.stringify({ login: orgMatch[1], ...org, description: '', public_repos: 12, type: 'Organization', html_url: `https://github.com/${orgMatch[1]}` }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  }

  const body = CORPUS[url] ?? CORPUS[bare];
  if (body) return new Response(body, { status: 200, headers: { 'content-type': 'text/html' } });
  return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
}) as typeof globalThis.fetch;

/* ── run the real pipeline over the corpus ─────────────────────────────── */

async function main(): Promise<void> {
  const services = new Services({
    databaseUrl: process.env.DATABASE_URL,
    env: { ...process.env, EMAIL_ENRICHMENT_PROVIDER: undefined } as NodeJS.ProcessEnv,
    transport,
    robotsFetcher: async () => '',
    blobStore: new MemoryBlobStore(),
  });
  await services.migrate();

  // A run must belong to a workspace — the engine refuses to execute one that does not. The demo
  // therefore signs up a real account rather than writing rows with a null tenant.
  const auth = new AuthService(services.db);
  const email = process.env.DEMO_EMAIL ?? 'demo@leadmoor.local';
  const password = process.env.DEMO_PASSWORD ?? 'demo-password-1';

  let workspaceId: string;
  try {
    ({ workspaceId } = await auth.register({
      email,
      password,
      name: 'Demo user',
      workspaceName: 'Demo workspace',
    }));
  } catch {
    // Already registered from a previous seed; reuse that account's first workspace.
    const session = await auth.login(email, password);
    const ctx = await auth.resolve(session.token);
    if (!ctx) throw new Error(`demo account ${email} exists but could not be resolved`);
    workspaceId = ctx.workspaceId;
  }

  const compiled = new HeuristicSpecCompiler().compile(REQUEST);
  if (!compiled.ok || !compiled.spec) {
    throw new Error(`demo spec failed to build: ${compiled.problems.join('; ')}`);
  }

  // Point discovery at the sources the corpus answers for.
  const spec = {
    ...compiled.spec,
    name: 'DEMO — US B2B SaaS with security and compliance signals',
    discovery: { ...compiled.spec.discovery, sources: ['github_public', 'company_web'], maxCompanies: 10 },
  };

  const requestId = newId();
  const specId = newId();
  await services.db
    .insert(leadRequest)
    .values({ id: requestId, workspaceId, rawText: REQUEST, createdBy: 'demo' });
  await services.db.insert(leadSpecTable).values({
    id: specId,
    requestId,
    workspaceId,
    version: 1,
    spec: spec as never,
    origin: 'heuristic',
    approvedAt: new Date(),
  });

  const engine = new RunEngine(services, 'demo-seeder');
  const runId = await engine.start(specId);
  await services.db.update(runTable).set({ isDemo: true }).where(eq(runTable.id, runId));

  const processed = await engine.drain(60);
  const run = (await services.db.select().from(runTable).where(eq(runTable.id, runId)).limit(1))[0];

  console.log(`demo run ${runId}`);
  console.log(`  jobs processed: ${processed}`);
  console.log(`  status: ${run?.status}`);
  console.log(`  open: /runs/${runId}`);
  console.log(`  sign in as: ${email} / ${password}`);
  console.log('  every record from this run is flagged is_demo and labelled in the interface.');

  await services.close();
}

main().catch((error) => {
  console.error('demo seed failed:', (error as Error).message);
  process.exit(1);
});
