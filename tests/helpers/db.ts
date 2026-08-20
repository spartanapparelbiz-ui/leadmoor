import { newId } from '@leadmoor/core';
import {
  appUser,
  leadRequest,
  leadSpec,
  openDb,
  run,
  workspace,
  workspaceMember,
  type Db,
  type DbHandle,
} from '@leadmoor/db';
import { hashPassword } from '@leadmoor/auth';
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
  'user_session', 'workspace_member', 'saved_search', 'app_user', 'workspace',
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

/** Creates a user, a workspace, and an owner membership. Returns the ids. */
export async function seedWorkspace(
  db: Db,
  opts: { name?: string; email?: string } = {},
): Promise<{ userId: string; workspaceId: string }> {
  const userId = newId();
  const workspaceId = newId();
  const email = opts.email ?? `${userId.slice(0, 8)}@example.test`;

  await db.insert(appUser).values({
    id: userId,
    email,
    emailLower: email.toLowerCase(),
    name: 'Test User',
    passwordHash: await hashPassword('correct horse battery staple'),
  });
  await db.insert(workspace).values({
    id: workspaceId,
    name: opts.name ?? 'Test workspace',
    slug: `ws-${workspaceId.slice(0, 8)}`,
    createdBy: userId,
  });
  await db.insert(workspaceMember).values({ id: newId(), workspaceId, userId, role: 'owner' });

  return { userId, workspaceId };
}

/** Creates workspace → request → spec → run so foreign keys are satisfied, and returns the ids. */
export async function seedRun(
  db: Db,
  specOverrides: Record<string, unknown> = {},
  existingWorkspaceId?: string,
): Promise<{
  requestId: string;
  specId: string;
  runId: string;
  workspaceId: string;
  userId: string;
  spec: ReturnType<typeof testSpec>;
}> {
  const seeded = existingWorkspaceId
    ? { workspaceId: existingWorkspaceId, userId: '' }
    : await seedWorkspace(db);

  const requestId = newId();
  const specId = newId();
  const runId = newId();
  const spec = testSpec(specOverrides);

  await db
    .insert(leadRequest)
    .values({ id: requestId, workspaceId: seeded.workspaceId, rawText: spec.sourceRequest });
  await db.insert(leadSpec).values({
    id: specId,
    requestId,
    workspaceId: seeded.workspaceId,
    version: 1,
    spec: spec as never,
    origin: 'compiled',
  });
  await db
    .insert(run)
    .values({ id: runId, specId, workspaceId: seeded.workspaceId, status: 'queued' });

  return { requestId, specId, runId, workspaceId: seeded.workspaceId, userId: seeded.userId, spec };
}
