import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId } from '@leadmoor/core';
import {
  AuditLog,
  WorkspaceScope,
  company as companyTable,
  criterionVerdict,
  evidence as evidenceTable,
  lead as leadTable,
  person as personTable,
  runStage,
} from '@leadmoor/db';
import { AuthService, ForbiddenError } from '@leadmoor/auth';
import { openTestDb, seedRun, seedWorkspace, type TestDb } from '../helpers/db.js';

/**
 * Scope methods that reach through a parent row, and the membership rules behind them.
 *
 * `run_stage` and `criterion_verdict` carry no workspace column of their own — they hang off a run
 * that does. That indirection is exactly where a leak would hide, so it is tested directly rather
 * than assumed from the presence of a WHERE clause elsewhere.
 */

let t: TestDb;
beforeAll(async () => {
  t = await openTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.truncate();
});

async function twoWorkspaces() {
  const a = await seedRun(t.db, {});
  const b = await seedRun(t.db, {});
  return {
    a: { ...a, scope: new WorkspaceScope(t.db, a.workspaceId) },
    b: { ...b, scope: new WorkspaceScope(t.db, b.workspaceId) },
  };
}

describe('stages and verdicts are scoped through their run', () => {
  it('returns no stages for a run in another workspace', async () => {
    const { a, b } = await twoWorkspaces();
    await t.db.insert(runStage).values({ id: newId(), runId: b.runId, stage: 'discovery', ordinal: 1 });

    expect(await b.scope.stagesFor(b.runId)).toHaveLength(1);
    expect(await a.scope.stagesFor(b.runId)).toHaveLength(0);
  });

  it('returns no verdicts for a run in another workspace', async () => {
    const { a, b } = await twoWorkspaces();
    const companyId = newId();
    await t.db.insert(companyTable).values({
      id: companyId,
      runId: b.runId,
      workspaceId: b.workspaceId,
      canonicalName: 'Held Co',
      normalizedName: 'held co',
    });
    await t.db.insert(criterionVerdict).values({
      id: newId(),
      runId: b.runId,
      subjectType: 'company',
      subjectId: companyId,
      criterionId: 'size',
      verdict: 'pass',
      status: 'ok',
    });

    expect(await b.scope.verdictsFor(b.runId)).toHaveLength(1);
    expect(await a.scope.verdictsFor(b.runId)).toHaveLength(0);
    expect(await a.scope.verdictsFor(b.runId, companyId)).toHaveLength(0);
  });

  it('counts nothing for a run in another workspace', async () => {
    const { a, b } = await twoWorkspaces();
    await t.db.insert(companyTable).values({
      id: newId(),
      runId: b.runId,
      workspaceId: b.workspaceId,
      canonicalName: 'Counted Co',
      normalizedName: 'counted co',
    });
    await t.db.insert(evidenceTable).values({
      id: newId(),
      runId: b.runId,
      workspaceId: b.workspaceId,
      sourceId: 'company_web',
      url: 'https://counted.example/',
      contentHash: 'a'.repeat(64),
      normalizedText: 'text',
    });

    const mine = await b.scope.runCounters(b.runId);
    expect(mine.companies).toBe(1);
    expect(mine.documents).toBe(1);

    const theirs = await a.scope.runCounters(b.runId);
    expect(theirs).toEqual({ companies: 0, people: 0, leads: 0, documents: 0, modelCalls: 0 });
  });

  it('reads model-call usage from the run rather than recomputing it', async () => {
    const { a } = await twoWorkspaces();
    await t.db.execute(
      `UPDATE run SET usage = '{"modelCalls": 7}'::jsonb WHERE id = '${a.runId}'`,
    );
    expect((await a.scope.runCounters(a.runId)).modelCalls).toBe(7);
  });

  it('excludes suppressed leads from the live counter', async () => {
    const { a } = await twoWorkspaces();
    const companyId = newId();
    await t.db.insert(companyTable).values({
      id: companyId,
      runId: a.runId,
      workspaceId: a.workspaceId,
      canonicalName: 'Acme',
      normalizedName: 'acme',
    });
    await t.db.insert(leadTable).values({
      id: newId(),
      runId: a.runId,
      companyId,
      workspaceId: a.workspaceId,
      status: 'qualified',
    });
    await t.db.insert(leadTable).values({
      id: newId(),
      runId: a.runId,
      companyId,
      personId: null,
      workspaceId: a.workspaceId,
      status: 'suppressed',
      suppressedAt: new Date(),
    });

    // The unique index is (run, company, person), so the second row needs a distinct person.
    const counters = await a.scope.runCounters(a.runId);
    expect(counters.leads).toBe(1);
  });
});

describe('membership decides access, not the id in the URL', () => {
  it('refuses to switch a session into a workspace the user does not belong to', async () => {
    const auth = new AuthService(t.db);
    const mine = await seedWorkspace(t.db, { email: 'a@example.test' });
    const other = await seedWorkspace(t.db, { email: 'b@example.test' });

    // A session with no active workspace resolves to one the user actually belongs to, never to
    // nothing and never to someone else's.
    const session = await auth.issueSession(mine.userId, null);
    const resolved = await auth.resolve(session.token);
    expect(resolved?.workspaceId).toBe(mine.workspaceId);

    await expect(auth.switchWorkspace(resolved!.sessionId, mine.userId, other.workspaceId)).rejects.toThrow(
      ForbiddenError,
    );

    // The refused switch left the session where it was.
    expect((await auth.resolve(session.token))?.workspaceId).toBe(mine.workspaceId);
  });

  it('drops a live session out of a workspace the moment membership is removed', async () => {
    const auth = new AuthService(t.db);
    const owner = await seedWorkspace(t.db, { email: 'owner@example.test' });
    await auth.register({ email: 'member@example.test', password: 'member-password-1' });
    await auth.addMember(owner.workspaceId, 'member@example.test', 'member');

    const session = await auth.login('member@example.test', 'member-password-1');
    const before = await auth.resolve(session.token);
    await auth.switchWorkspace(before!.sessionId, before!.userId, owner.workspaceId);
    expect((await auth.resolve(session.token))?.workspaceId).toBe(owner.workspaceId);

    // Removal takes effect on the next request, without needing the session to be revoked: the
    // session row still points at the workspace, but resolve re-reads membership every time.
    await auth.removeMember(owner.workspaceId, before!.userId);
    const after = await auth.resolve(session.token);
    expect(after?.workspaceId).not.toBe(owner.workspaceId);
  });

  it('resolves to nothing once a user belongs to no workspace at all', async () => {
    const auth = new AuthService(t.db);
    const { userId, workspaceId } = await seedWorkspace(t.db, { email: 'last@example.test' });
    const session = await auth.issueSession(userId, workspaceId);
    expect(await auth.resolve(session.token)).not.toBeNull();

    await t.db.execute(`DELETE FROM workspace_member WHERE user_id = '${userId}'`);
    expect(await auth.resolve(session.token)).toBeNull();
  });

  it('keeps at least one owner in a workspace', async () => {
    const auth = new AuthService(t.db);
    const { userId, workspaceId } = await seedWorkspace(t.db, { email: 'solo@example.test' });
    await expect(auth.removeMember(workspaceId, userId)).rejects.toThrow(ForbiddenError);
  });

  it('requires the stated role, not merely membership', async () => {
    const auth = new AuthService(t.db);
    const owner = await seedWorkspace(t.db, { email: 'boss@example.test' });
    await auth.register({ email: 'plain@example.test', password: 'plain-password-1' });
    await auth.addMember(owner.workspaceId, 'plain@example.test', 'member');

    const session = await auth.login('plain@example.test', 'plain-password-1');
    const ctx = await auth.resolve(session.token);
    const plainId = ctx?.userId as string;

    await expect(auth.requireMembership(plainId, owner.workspaceId, 'member')).resolves.toBe('member');
    await expect(auth.requireMembership(plainId, owner.workspaceId, 'admin')).rejects.toThrow(ForbiddenError);
    await expect(auth.requireMembership(plainId, owner.workspaceId, 'owner')).rejects.toThrow(ForbiddenError);
  });

  it('lists a user only the workspaces they belong to', async () => {
    const auth = new AuthService(t.db);
    const mine = await seedWorkspace(t.db, { email: 'mine@example.test', name: 'Mine' });
    await seedWorkspace(t.db, { email: 'theirs@example.test', name: 'Theirs' });

    const listed = await auth.workspacesFor(mine.userId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(mine.workspaceId);
  });
});

describe('a run’s own lifecycle is visible to the workspace that owns it', () => {
  it('scopes run.created, run.started, and every stage event to the run’s workspace', async () => {
    const { a, b } = await twoWorkspaces();

    // Written the way the engine writes them: scoped to the run's owner. That the engine actually
    // does so is asserted against a real run in pipeline.test.ts.
    const scoped = new AuditLog(t.db).forWorkspace(a.workspaceId);
    await scoped.record('run.created', { runId: a.runId, detail: { specId: a.specId } });
    await scoped.record('run.started', { runId: a.runId });
    await scoped.record('run.stage_failed', { runId: a.runId, subject: 'discovery' });

    const mine = await a.scope.listAudit({ runId: a.runId });
    expect(mine.map((e) => e.action)).toEqual(
      expect.arrayContaining(['run.created', 'run.started', 'run.stage_failed']),
    );

    // And invisible to anyone else, even naming the run id directly.
    expect(await b.scope.listAudit({ runId: a.runId })).toHaveLength(0);
  });

  it('leaves an unowned event visible to nobody rather than to everybody', async () => {
    const { a, b } = await twoWorkspaces();
    await new AuditLog(t.db).record('run.created', { runId: a.runId });

    expect(await a.scope.listAudit({ runId: a.runId })).toHaveLength(0);
    expect(await b.scope.listAudit({ runId: a.runId })).toHaveLength(0);
  });
});

describe('people and titles stay inside the workspace', () => {
  it('does not surface another workspace’s person through a company filter', async () => {
    const { a, b } = await twoWorkspaces();
    const companyId = newId();
    await t.db.insert(companyTable).values({
      id: companyId,
      runId: b.runId,
      workspaceId: b.workspaceId,
      canonicalName: 'Their Co',
      normalizedName: 'their co',
    });
    await t.db.insert(personTable).values({
      id: newId(),
      runId: b.runId,
      companyId,
      workspaceId: b.workspaceId,
      fullName: 'Their Person',
      normalizedName: 'their person',
    });

    expect(await b.scope.listPeople({ companyId })).toHaveLength(1);
    expect(await a.scope.listPeople({ companyId })).toHaveLength(0);
  });
});
