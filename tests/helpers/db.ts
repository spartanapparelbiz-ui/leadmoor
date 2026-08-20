import { newId } from '@leadmoor/core';
import { leadRequest, leadSpec, openDb, run, type Db, type DbHandle } from '@leadmoor/db';
import { testSpec } from './harness.js';

/**
 * Shared test database helpers.
 *
 * PGlite boot is the slow part, so tests open one database per file and truncate between cases
 * rather than migrating repeatedly.
 */

export interface TestDb {
  handle: DbHandle;
  db: Db;
  close(): Promise<void>;
  truncate(): Promise<void>;
}

const TABLES = [
  'audit_log', 'export', 'deletion_request', 'suppression', 'lead', 'criterion_verdict',
  'conflict', 'claim', 'entity_link', 'person_identifier', 'person', 'company_alias',
  'company_identifier', 'company', 'evidence', 'fetch_log', 'source', 'job', 'run_stage',
  'run', 'lead_spec', 'lead_request',
];

export async function openTestDb(): Promise<TestDb> {
  const handle = openDb('pglite://memory');
  await handle.migrate();
  return {
    handle,
    db: handle.db,
    async close() {
      await handle.close();
    },
    async truncate() {
      await handle.db.execute(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);
    },
  };
}

/** Creates request → spec → run so foreign keys are satisfied, and returns the ids. */
export async function seedRun(
  db: Db,
  specOverrides: Record<string, unknown> = {},
): Promise<{ requestId: string; specId: string; runId: string; spec: ReturnType<typeof testSpec> }> {
  const requestId = newId();
  const specId = newId();
  const runId = newId();
  const spec = testSpec(specOverrides);

  await db.insert(leadRequest).values({ id: requestId, rawText: spec.sourceRequest });
  await db.insert(leadSpec).values({ id: specId, requestId, version: 1, spec: spec as never, origin: 'compiled' });
  await db.insert(run).values({ id: runId, specId, status: 'queued' });

  return { requestId, specId, runId, spec };
}
