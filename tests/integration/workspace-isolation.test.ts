import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newId, suppressionKey } from '@leadmoor/core';
import {
  AuditLog,
  WorkspaceScope,
  company as companyTable,
  evidence as evidenceTable,
  lead as leadTable,
  person as personTable,
  savedSearch,
} from '@leadmoor/db';
import {
  AuthService,
  ForbiddenError,
  hasRole,
  hashPassword,
  passwordProblems,
  verifyPassword,
} from '@leadmoor/auth';
import { PolicyEngine, SourceRegistry, createRunHostAllowlist } from '@leadmoor/policy';
import { DeletionService, ExportService, SuppressionService } from '@leadmoor/export';
import { openTestDb, seedRun, type TestDb } from '../helpers/db.js';

/**
 * Workspace isolation.
 *
 * These tests are adversarial on purpose: they hold a real id from workspace B and try to read,
 * export, suppress, and delete it while scoped to workspace A. Every one of those attempts must
 * fail in the data layer, not by the UI declining to render a link.
 */

const policy = new PolicyEngine(new SourceRegistry().asMap(), {
  userAgent: 'test',
  runHosts: createRunHostAllowlist(),
});

describe('workspace isolation', () => {
  let tdb: TestDb;
  let alpha: { workspaceId: string; runId: string; companyId: string; personId: string; leadId: string; evidenceId: string };
  let beta: { workspaceId: string; runId: string; companyId: string; personId: string; leadId: string; evidenceId: string };

  beforeAll(async () => {
    tdb = await openTestDb();
  });
  afterAll(async () => {
    await tdb.close();
  });

  /** Builds a workspace with one run holding a company, a person, a lead, and a document. */
  async function seedTenant(name: string) {
    const seeded = await seedRun(tdb.db);
    const companyId = newId();
    const personId = newId();
    const leadId = newId();
    const evidenceId = newId();

    await tdb.db.insert(companyTable).values({
      id: companyId,
      runId: seeded.runId,
      workspaceId: seeded.workspaceId,
      canonicalName: `${name} Industries`,
      normalizedName: `${name.toLowerCase()} industries`,
      primaryDomain: `${name.toLowerCase()}.example`,
    });
    await tdb.db.insert(personTable).values({
      id: personId,
      runId: seeded.runId,
      workspaceId: seeded.workspaceId,
      companyId,
      fullName: `${name} Contact`,
      normalizedName: `${name.toLowerCase()} contact`,
    });
    await tdb.db.insert(evidenceTable).values({
      id: evidenceId,
      runId: seeded.runId,
      workspaceId: seeded.workspaceId,
      sourceId: 'company_web',
      url: `https://${name.toLowerCase()}.example/about`,
      documentRole: 'company_about',
      contentHash: 'a'.repeat(64),
      normalizedText: `${name} Industries has 120 employees.`,
      byteLength: 40,
      robotsDecision: 'allowed',
    });
    await tdb.db.insert(leadTable).values({
      id: leadId,
      runId: seeded.runId,
      workspaceId: seeded.workspaceId,
      companyId,
      personId,
      score: 90,
      band: 'A',
      coverage: 1,
      status: 'qualified',
      emailStatus: 'unverified',
      email: `contact@${name.toLowerCase()}.example`,
      rationale: 'seeded',
    });

    return { workspaceId: seeded.workspaceId, runId: seeded.runId, companyId, personId, leadId, evidenceId };
  }

  beforeEach(async () => {
    await tdb.truncate();
    alpha = await seedTenant('Alpha');
    beta = await seedTenant('Beta');
  });

  describe('reads', () => {
    it('sees only its own runs, leads, companies, and people', async () => {
      const scope = new WorkspaceScope(tdb.db, alpha.workspaceId);

      expect((await scope.listRuns()).map((r) => r.id)).toEqual([alpha.runId]);
      expect((await scope.listLeads()).map((l) => l.id)).toEqual([alpha.leadId]);
      expect((await scope.listCompanies()).map((c) => c.id)).toEqual([alpha.companyId]);
      expect((await scope.listPeople()).map((p) => p.id)).toEqual([alpha.personId]);
    });

    it('refuses a direct fetch of another workspace record by id', async () => {
      const scope = new WorkspaceScope(tdb.db, alpha.workspaceId);

      expect(await scope.getRun(beta.runId)).toBeNull();
      expect(await scope.getLead(beta.leadId)).toBeNull();
      expect(await scope.getCompany(beta.companyId)).toBeNull();
      expect(await scope.getPerson(beta.personId)).toBeNull();
      expect(await scope.getEvidence(beta.evidenceId)).toBeNull();
    });

    it('refuses another workspace evidence even when asked for by id in bulk', async () => {
      const scope = new WorkspaceScope(tdb.db, alpha.workspaceId);
      const docs = await scope.evidenceByIds([alpha.evidenceId, beta.evidenceId]);
      expect(docs.map((d) => d.id)).toEqual([alpha.evidenceId]);
    });

    it('refuses another workspace run when listing its leads', async () => {
      const scope = new WorkspaceScope(tdb.db, alpha.workspaceId);
      expect(await scope.listLeads({ runId: beta.runId })).toHaveLength(0);
      expect(await scope.listEvidence(beta.runId)).toHaveLength(0);
      expect(await scope.listAudit({ runId: beta.runId })).toHaveLength(0);
    });

    it('counts only its own records', async () => {
      const counts = await new WorkspaceScope(tdb.db, alpha.workspaceId).counts();
      expect(counts.runs).toBe(1);
      expect(counts.leads).toBe(1);
      expect(counts.companies).toBe(1);
      expect(counts.people).toBe(1);
    });

    it('refuses a workspace id that is not a plain identifier', async () => {
      const injected = new WorkspaceScope(tdb.db, "' OR '1'='1");
      await expect(injected.counts()).rejects.toThrow(/invalid workspace id/);
    });
  });

  describe('export', () => {
    it('exports only its own leads', async () => {
      const audit = new AuditLog(tdb.db);
      const result = await new ExportService(tdb.db, policy, audit, alpha.workspaceId).exportRun(alpha.runId);
      expect(result.rows.map((r) => r.company)).toEqual(['Alpha Industries']);
    });

    it('returns nothing when handed another workspace run id', async () => {
      const audit = new AuditLog(tdb.db);
      const result = await new ExportService(tdb.db, policy, audit, alpha.workspaceId).exportRun(beta.runId);
      expect(result.rows).toHaveLength(0);
    });
  });

  describe('suppression', () => {
    it('refuses to suppress a lead belonging to another workspace', async () => {
      const service = new SuppressionService(tdb.db, new AuditLog(tdb.db), alpha.workspaceId);
      await expect(service.suppressLead(beta.leadId)).rejects.toThrow(/not found/);

      const stillActive = await new WorkspaceScope(tdb.db, beta.workspaceId).getLead(beta.leadId);
      expect(stillActive?.status).toBe('qualified');
    });

    it('keeps suppression lists separate between workspaces', async () => {
      const alphaService = new SuppressionService(tdb.db, new AuditLog(tdb.db), alpha.workspaceId);
      const betaService = new SuppressionService(tdb.db, new AuditLog(tdb.db), beta.workspaceId);

      await alphaService.suppressLead(alpha.leadId);

      expect(await alphaService.isSuppressed('domain', 'alpha.example')).toBe(true);
      // Beta must not inherit Alpha's do-not-contact list.
      expect(await betaService.isSuppressed('domain', 'alpha.example')).toBe(false);
      expect(await betaService.list()).toHaveLength(0);
    });

    it('does not let one workspace suppression filter another workspace export', async () => {
      const alphaService = new SuppressionService(tdb.db, new AuditLog(tdb.db), alpha.workspaceId);
      // Suppress the same domain string Beta happens to use.
      await tdb.db.execute(
        `INSERT INTO suppression (id, workspace_id, key, kind, reason) VALUES ('${newId()}', '${alpha.workspaceId}', '${suppressionKey('domain', 'beta.example')}', 'domain', 'test')`,
      );
      expect(await alphaService.isSuppressed('domain', 'beta.example')).toBe(true);

      const audit = new AuditLog(tdb.db);
      const betaExport = await new ExportService(tdb.db, policy, audit, beta.workspaceId).exportRun(beta.runId);
      expect(betaExport.rows.map((r) => r.company)).toEqual(['Beta Industries']);
    });
  });

  describe('deletion', () => {
    it('refuses to delete a person in another workspace', async () => {
      const suppression = new SuppressionService(tdb.db, new AuditLog(tdb.db), alpha.workspaceId);
      const deletion = new DeletionService(tdb.db, new AuditLog(tdb.db), suppression, alpha.workspaceId);

      await expect(deletion.deletePerson(beta.personId)).rejects.toThrow(/not found/);
      expect(await new WorkspaceScope(tdb.db, beta.workspaceId).getPerson(beta.personId)).not.toBeNull();
    });

    it('refuses to delete a company in another workspace', async () => {
      const suppression = new SuppressionService(tdb.db, new AuditLog(tdb.db), alpha.workspaceId);
      const deletion = new DeletionService(tdb.db, new AuditLog(tdb.db), suppression, alpha.workspaceId);

      await expect(deletion.deleteCompany(beta.companyId)).rejects.toThrow(/not found/);
      expect(await new WorkspaceScope(tdb.db, beta.workspaceId).getCompany(beta.companyId)).not.toBeNull();
    });

    it('deletes within its own workspace', async () => {
      const suppression = new SuppressionService(tdb.db, new AuditLog(tdb.db), alpha.workspaceId);
      const deletion = new DeletionService(tdb.db, new AuditLog(tdb.db), suppression, alpha.workspaceId);

      await deletion.deletePerson(alpha.personId);
      expect(await new WorkspaceScope(tdb.db, alpha.workspaceId).getPerson(alpha.personId)).toBeNull();
    });
  });

  describe('saved searches', () => {
    it('are visible only inside their workspace', async () => {
      await tdb.db.insert(savedSearch).values({
        id: newId(),
        workspaceId: beta.workspaceId,
        name: 'Beta private list',
        spec: {} as never,
      });

      expect(await new WorkspaceScope(tdb.db, alpha.workspaceId).listSavedSearches()).toHaveLength(0);
      expect(await new WorkspaceScope(tdb.db, beta.workspaceId).listSavedSearches()).toHaveLength(1);
    });
  });
});

describe('authentication', () => {
  let tdb: TestDb;
  let auth: AuthService;

  beforeAll(async () => {
    tdb = await openTestDb();
  });
  afterAll(async () => {
    await tdb.close();
  });
  beforeEach(async () => {
    await tdb.truncate();
    auth = new AuthService(tdb.db);
  });

  it('hashes passwords and never stores the plaintext', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toContain('correct horse');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('wrong password entirely', hash)).toBe(false);
  });

  it('rejects a malformed stored hash rather than throwing', async () => {
    expect(await verifyPassword('x', 'garbage')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$only-two')).toBe(false);
  });

  it('states password requirements explicitly', () => {
    expect(passwordProblems('short')).not.toHaveLength(0);
    expect(passwordProblems('alllettersnodigits')).toContain('Include at least one number or symbol.');
    expect(passwordProblems('a-good-password-1')).toHaveLength(0);
  });

  it('registers a user with an owner workspace', async () => {
    const { userId, workspaceId } = await auth.register({
      email: 'Ada@Example.test',
      password: 'a-good-password-1',
      name: 'Ada Lovelace',
    });

    const workspaces = await auth.workspacesFor(userId);
    expect(workspaces).toHaveLength(1);
    expect(workspaces[0]!.id).toBe(workspaceId);
    expect(workspaces[0]!.role).toBe('owner');
    expect(workspaces[0]!.name).toBe("Ada's workspace");
  });

  it('treats email as case-insensitive and refuses a duplicate', async () => {
    await auth.register({ email: 'ada@example.test', password: 'a-good-password-1' });
    await expect(auth.register({ email: 'ADA@example.test', password: 'another-password-2' })).rejects.toThrow(
      /already exists/,
    );
  });

  it('issues a session that resolves to the right workspace', async () => {
    const { workspaceId } = await auth.register({ email: 'ada@example.test', password: 'a-good-password-1' });
    const session = await auth.login('ADA@example.test', 'a-good-password-1');

    const ctx = await auth.resolve(session.token);
    expect(ctx?.workspaceId).toBe(workspaceId);
    expect(ctx?.role).toBe('owner');
  });

  it('rejects a wrong password and an unknown account identically', async () => {
    await auth.register({ email: 'ada@example.test', password: 'a-good-password-1' });
    await expect(auth.login('ada@example.test', 'wrong-password-9')).rejects.toThrow(/incorrect/);
    await expect(auth.login('nobody@example.test', 'a-good-password-1')).rejects.toThrow(/incorrect/);
  });

  it('resolves nothing for an unknown or expired token', async () => {
    expect(await auth.resolve(undefined)).toBeNull();
    expect(await auth.resolve('not-a-real-token')).toBeNull();
  });

  it('drops the session on logout', async () => {
    await auth.register({ email: 'ada@example.test', password: 'a-good-password-1' });
    const session = await auth.login('ada@example.test', 'a-good-password-1');
    await auth.logout(session.token);
    expect(await auth.resolve(session.token)).toBeNull();
  });

  it('refuses to switch into a workspace the user does not belong to', async () => {
    const ada = await auth.register({ email: 'ada@example.test', password: 'a-good-password-1' });
    const grace = await auth.register({ email: 'grace@example.test', password: 'a-good-password-2' });

    const session = await auth.login('ada@example.test', 'a-good-password-1');
    const ctx = await auth.resolve(session.token);

    await expect(auth.switchWorkspace(ctx!.sessionId, ada.userId, grace.workspaceId)).rejects.toThrow(ForbiddenError);
    expect((await auth.resolve(session.token))?.workspaceId).toBe(ada.workspaceId);
  });

  it('requires membership before any workspace-scoped action', async () => {
    const ada = await auth.register({ email: 'ada@example.test', password: 'a-good-password-1' });
    const grace = await auth.register({ email: 'grace@example.test', password: 'a-good-password-2' });

    await expect(auth.requireMembership(ada.userId, grace.workspaceId)).rejects.toThrow(ForbiddenError);
    await expect(auth.requireMembership(ada.userId, ada.workspaceId)).resolves.toBe('owner');
  });

  it('enforces the minimum role for privileged actions', async () => {
    const owner = await auth.register({ email: 'owner@example.test', password: 'a-good-password-1' });
    await auth.register({ email: 'member@example.test', password: 'a-good-password-2' });
    await auth.addMember(owner.workspaceId, 'member@example.test', 'member');

    const members = await auth.membersOf(owner.workspaceId);
    const member = members.find((m) => m.email === 'member@example.test');
    expect(member?.role).toBe('member');

    await expect(auth.requireMembership(member!.userId, owner.workspaceId, 'member')).resolves.toBe('member');
    await expect(auth.requireMembership(member!.userId, owner.workspaceId, 'admin')).rejects.toThrow(ForbiddenError);
  });

  it('revokes access the moment a membership is removed', async () => {
    const owner = await auth.register({ email: 'owner@example.test', password: 'a-good-password-1' });
    const guest = await auth.register({ email: 'guest@example.test', password: 'a-good-password-2' });
    await auth.addMember(owner.workspaceId, 'guest@example.test', 'member');

    await expect(auth.requireMembership(guest.userId, owner.workspaceId)).resolves.toBe('member');
    await auth.removeMember(owner.workspaceId, guest.userId);
    await expect(auth.requireMembership(guest.userId, owner.workspaceId)).rejects.toThrow(ForbiddenError);
  });

  it('will not remove the last owner', async () => {
    const owner = await auth.register({ email: 'owner@example.test', password: 'a-good-password-1' });
    await expect(auth.removeMember(owner.workspaceId, owner.userId)).rejects.toThrow(/at least one owner/);
  });

  it('refuses to add an account that does not exist', async () => {
    const owner = await auth.register({ email: 'owner@example.test', password: 'a-good-password-1' });
    await expect(auth.addMember(owner.workspaceId, 'ghost@example.test', 'member')).rejects.toThrow(/No account/);
  });

  it('ranks roles so a check can ask for admin-or-better', () => {
    expect(hasRole('owner', 'admin')).toBe(true);
    expect(hasRole('admin', 'admin')).toBe(true);
    expect(hasRole('member', 'admin')).toBe(false);
  });

  it('gives each workspace a distinct slug', async () => {
    const a = await auth.register({ email: 'a@example.test', password: 'a-good-password-1', workspaceName: 'Acme' });
    const b = await auth.register({ email: 'b@example.test', password: 'a-good-password-2', workspaceName: 'Acme' });

    const slugs = [
      (await auth.workspacesFor(a.userId))[0]!.slug,
      (await auth.workspacesFor(b.userId))[0]!.slug,
    ];
    expect(new Set(slugs).size).toBe(2);
  });
});
