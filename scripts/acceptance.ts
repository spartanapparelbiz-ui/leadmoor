/**
 * Acceptance run against the real application stack.
 *
 * This is not a test double: it drives the same Services, RunEngine, connectors, and policy
 * gates the web app uses, against the real database, with the real network. Whatever the egress
 * environment permits is what it retrieves — a blocked host produces a recorded failure, never a
 * fabricated result.
 */
import { asc, desc, eq } from 'drizzle-orm';
import { newId } from '@leadmoor/core';
import {
  company as companyTable,
  evidence as evidenceTable,
  fetchLog,
  lead as leadTable,
  leadRequest,
  leadSpec as leadSpecTable,
  person as personTable,
  run as runTable,
  runStage as runStageTable,
} from '@leadmoor/db';
import { compileRequest } from '@leadmoor/llm';
import { RunEngine, Services } from '@leadmoor/runtime';

const REQUEST =
  'Find 20 US-based B2B SaaS companies with 50-500 employees that show strong security and compliance signals, and identify the most relevant technical decision maker.';

const services = new Services({
  databaseUrl: process.env.DATABASE_URL,
  evidenceDir: process.env.EVIDENCE_DIR ?? '.leadmoor/evidence',
});
await services.migrate();

console.log('=== PROVIDER STATUS ===');
const status = services.providerStatus();
console.log('  language model:', status.llm.configured ? 'configured' : `NOT CONFIGURED — ${status.llm.reason}`);
console.log('  credential-free sources:', status.credentialFreeSources.join(', '));
console.log('  missing credentials:', status.missingCredentials.map((m) => `${m.source} (${m.envVar})`).join(', ') || 'none');

console.log('\n=== 1. COMPILE REQUEST ===');
const compiled = await compileRequest(REQUEST, services.llm);
if (!compiled.ok || !compiled.spec) {
  console.error('  FAILED:', compiled.problems.join('; '));
  process.exit(1);
}
console.log('  origin:', compiled.origin);
console.log('  name:', compiled.spec.name);
console.log('  countries:', compiled.spec.geography.countries.join(','));
console.log('  employees:', JSON.stringify(compiled.spec.company.employeeRange ?? null));
console.log('  personas:', compiled.spec.personas.titles.join(', '));
console.log('  criteria:', compiled.spec.rubric.criteria.map((c) => `${c.id}(${c.kind},w${c.weight})`).join(' '));
console.log('  queries:', compiled.spec.discovery.queries.length);
if (compiled.notice) console.log('  notice:', compiled.notice);

const requestId = newId();
const specId = newId();
await services.db.insert(leadRequest).values({ id: requestId, rawText: REQUEST });
await services.db.insert(leadSpecTable).values({
  id: specId,
  requestId,
  version: 1,
  spec: compiled.spec as never,
  origin: compiled.origin === 'model' ? 'compiled' : 'heuristic',
});

console.log('\n=== 2. APPROVAL GATE ===');
const beforeApproval = (await services.db.select().from(leadSpecTable).where(eq(leadSpecTable.id, specId)).limit(1))[0];
console.log('  approvedAt before approval:', beforeApproval?.approvedAt ?? 'null (nothing has run)');
await services.db.update(leadSpecTable).set({ approvedAt: new Date() }).where(eq(leadSpecTable.id, specId));
console.log('  approved.');

console.log('\n=== 3. RUN ===');
const engine = new RunEngine(services, 'acceptance');
const runId = await engine.start(specId);
const processed = await engine.drain(60);
console.log('  runId:', runId);
console.log('  jobs processed:', processed);

const run = (await services.db.select().from(runTable).where(eq(runTable.id, runId)).limit(1))[0];
console.log('  status:', run?.status);
if (run?.error) console.log('  reason:', run.error);

console.log('\n=== 4. STAGES ===');
for (const s of await services.db.select().from(runStageTable).where(eq(runStageTable.runId, runId)).orderBy(asc(runStageTable.ordinal))) {
  const detail = JSON.stringify(s.detail);
  console.log(`  ${String(s.ordinal).padStart(2)} ${s.stage.padEnd(20)} ${s.status.padEnd(12)} ${detail.slice(0, 150)}`);
  if (s.error) console.log(`     error: ${s.error.slice(0, 220)}`);
}

console.log('\n=== 5. RETRIEVAL ===');
const fetches = await services.db.select().from(fetchLog).where(eq(fetchLog.runId, runId));
const byStatus = new Map<string, number>();
for (const f of fetches) byStatus.set(f.status, (byStatus.get(f.status) ?? 0) + 1);
console.log('  attempts:', fetches.length);
for (const [k, v] of byStatus) console.log(`    ${k}: ${v}`);
for (const f of fetches.filter((x) => x.status !== 'ok').slice(0, 6)) {
  console.log(`    ! ${f.status} ${f.url.slice(0, 88)} :: ${(f.denialReason ?? '').slice(0, 90)}`);
}

const docs = await services.db.select().from(evidenceTable).where(eq(evidenceTable.runId, runId));
console.log('  evidence stored:', docs.length);

console.log('\n=== 6. RESULTS ===');
const companies = await services.db.select().from(companyTable).where(eq(companyTable.runId, runId));
const people = await services.db.select().from(personTable).where(eq(personTable.runId, runId));
const leads = await services.db.select().from(leadTable).where(eq(leadTable.runId, runId)).orderBy(desc(leadTable.score));
console.log('  companies:', companies.length, '| people:', people.length, '| leads:', leads.length);
for (const lead of leads.slice(0, 10)) {
  const c = companies.find((x) => x.id === lead.companyId);
  const p = people.find((x) => x.id === lead.personId);
  console.log(
    `    ${String(Math.round(lead.score)).padStart(3)} ${lead.status.padEnd(28)} ${(c?.canonicalName ?? '?').slice(0, 30).padEnd(30)} ${(p?.fullName ?? 'no person').padEnd(20)} ${lead.emailStatus}`,
  );
}

console.log('\n=== VERDICT ===');
if (leads.length === 0) {
  console.log('  NO LEADS PRODUCED.');
  console.log('  This is the honest outcome for this environment, not a silent success.');
  console.log('  Reason recorded on the run:', run?.error ?? '(none)');
} else {
  console.log(`  ${leads.filter((l) => l.status === 'qualified').length} qualified of ${leads.length} scored.`);
}

await services.close();
