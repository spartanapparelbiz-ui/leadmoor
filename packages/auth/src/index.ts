import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { and, eq, gt } from 'drizzle-orm';
import { newId, LeadMoorError } from '@leadmoor/core';
import {
  appUser,
  userSession,
  workspace as workspaceTable,
  workspaceMember,
  type Db,
} from '@leadmoor/db';

/**
 * Identity, sessions, and workspace authorization.
 *
 * Authorization is a server-side check that returns a scope, not a UI concern. Every workspace-owned
 * query takes its `workspaceId` from `requireWorkspace`, which verifies membership first — so a
 * caller cannot reach another workspace's data by editing a URL, and hiding a nav item is never
 * what keeps data separated.
 */

const scrypt = promisify(scryptCb);

const SCRYPT_KEYLEN = 64;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_COOKIE = 'leadmoor_session';

export const ROLES = ['owner', 'admin', 'member'] as const;
export type Role = (typeof ROLES)[number];

/** Ranked so a check can ask for "admin or better" without enumerating roles. */
const ROLE_RANK: Record<Role, number> = { owner: 3, admin: 2, member: 1 };

export class AuthError extends LeadMoorError {
  constructor(message: string, code = 'unauthenticated') {
    super(message, code);
  }
}

export class ForbiddenError extends LeadMoorError {
  constructor(message = 'You do not have access to this workspace.') {
    super(message, 'forbidden');
  }
}

/* ── passwords ────────────────────────────────────────────────────────── */

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const derived = (await scrypt(plain, salt, SCRYPT_KEYLEN)) as Buffer;
  return `scrypt$${salt}$${derived.toString('hex')}`;
}

/** Constant-time comparison. Returns false rather than throwing on a malformed stored hash. */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) return false;

  const expected = Buffer.from(expectedHex, 'hex');
  const derived = (await scrypt(plain, salt, expected.length)) as Buffer;
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}

export function passwordProblems(password: string): string[] {
  const problems: string[] = [];
  if (password.length < 10) problems.push('Use at least 10 characters.');
  if (!/[a-zA-Z]/.test(password)) problems.push('Include at least one letter.');
  if (!/[0-9\W]/.test(password)) problems.push('Include at least one number or symbol.');
  return problems;
}

/* ── sessions ─────────────────────────────────────────────────────────── */

export interface SessionToken {
  /** Sent to the browser in an httpOnly cookie. Never stored. */
  token: string;
  expiresAt: Date;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface AuthenticatedContext {
  userId: string;
  email: string;
  name: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  role: Role;
  sessionId: string;
}

export class AuthService {
  constructor(private readonly db: Db) {}

  /** Creates a user, their first workspace, and an owner membership in one step. */
  async register(args: {
    email: string;
    password: string;
    name?: string;
    workspaceName?: string;
  }): Promise<{ userId: string; workspaceId: string }> {
    const emailLower = args.email.trim().toLowerCase();

    const existing = await this.db.select().from(appUser).where(eq(appUser.emailLower, emailLower)).limit(1);
    if (existing.length > 0) throw new AuthError('An account with that email already exists.', 'email_taken');

    const userId = newId();
    await this.db.insert(appUser).values({
      id: userId,
      email: args.email.trim(),
      emailLower,
      name: args.name?.trim() ?? '',
      passwordHash: await hashPassword(args.password),
    });

    const workspaceName = args.workspaceName?.trim() || defaultWorkspaceName(args.name, args.email);
    const workspaceId = await this.createWorkspace({ name: workspaceName, userId });

    return { userId, workspaceId };
  }

  async createWorkspace(args: { name: string; userId: string }): Promise<string> {
    const workspaceId = newId();
    await this.db.insert(workspaceTable).values({
      id: workspaceId,
      name: args.name,
      slug: await this.uniqueSlug(args.name),
      createdBy: args.userId,
    });
    await this.db.insert(workspaceMember).values({
      id: newId(),
      workspaceId,
      userId: args.userId,
      role: 'owner',
    });
    return workspaceId;
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'workspace';

    for (let attempt = 0; attempt < 40; attempt++) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const clash = await this.db.select().from(workspaceTable).where(eq(workspaceTable.slug, candidate)).limit(1);
      if (clash.length === 0) return candidate;
    }
    return `${base}-${newId().slice(0, 8)}`;
  }

  /** Verifies credentials and issues a session bound to the user's first workspace. */
  async login(email: string, password: string): Promise<SessionToken> {
    const emailLower = email.trim().toLowerCase();
    const rows = await this.db.select().from(appUser).where(eq(appUser.emailLower, emailLower)).limit(1);
    const user = rows[0];

    // Run the hash comparison even when the user is absent, so a missing account and a wrong
    // password take the same time and cannot be told apart.
    const stored = user?.passwordHash ?? 'scrypt$0000$0000';
    const valid = await verifyPassword(password, stored);
    if (!user || !valid) throw new AuthError('Email or password is incorrect.', 'invalid_credentials');

    const memberships = await this.db
      .select()
      .from(workspaceMember)
      .where(eq(workspaceMember.userId, user.id));

    return this.issueSession(user.id, memberships[0]?.workspaceId ?? null);
  }

  async issueSession(userId: string, workspaceId: string | null): Promise<SessionToken> {
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.db.insert(userSession).values({
      id: newId(),
      tokenHash: hashToken(token),
      userId,
      workspaceId,
      expiresAt,
    });

    return { token, expiresAt };
  }

  async logout(token: string): Promise<void> {
    await this.db.delete(userSession).where(eq(userSession.tokenHash, hashToken(token)));
  }

  /**
   * Resolves a cookie into a verified context.
   *
   * Returns null for a missing, unknown, or expired token — and re-checks workspace membership on
   * every request, so revoking someone's membership takes effect immediately rather than at their
   * next login.
   */
  async resolve(token: string | undefined): Promise<AuthenticatedContext | null> {
    if (!token) return null;

    const rows = await this.db
      .select()
      .from(userSession)
      .where(and(eq(userSession.tokenHash, hashToken(token)), gt(userSession.expiresAt, new Date())))
      .limit(1);
    const session = rows[0];
    if (!session) return null;

    const users = await this.db.select().from(appUser).where(eq(appUser.id, session.userId)).limit(1);
    const user = users[0];
    if (!user) return null;

    const memberships = await this.db
      .select()
      .from(workspaceMember)
      .where(eq(workspaceMember.userId, user.id));
    if (memberships.length === 0) return null;

    const active =
      memberships.find((m) => m.workspaceId === session.workspaceId) ?? (memberships[0] as (typeof memberships)[number]);

    const workspaces = await this.db
      .select()
      .from(workspaceTable)
      .where(eq(workspaceTable.id, active.workspaceId))
      .limit(1);
    const ws = workspaces[0];
    if (!ws) return null;

    return {
      userId: user.id,
      email: user.email,
      name: user.name,
      workspaceId: ws.id,
      workspaceName: ws.name,
      workspaceSlug: ws.slug,
      role: active.role as Role,
      sessionId: session.id,
    };
  }

  /** Switches the active workspace on a session, after verifying membership. */
  async switchWorkspace(sessionId: string, userId: string, workspaceId: string): Promise<void> {
    const membership = await this.db
      .select()
      .from(workspaceMember)
      .where(and(eq(workspaceMember.userId, userId), eq(workspaceMember.workspaceId, workspaceId)))
      .limit(1);
    if (membership.length === 0) throw new ForbiddenError('You are not a member of that workspace.');

    await this.db.update(userSession).set({ workspaceId }).where(eq(userSession.id, sessionId));
  }

  async workspacesFor(userId: string): Promise<Array<{ id: string; name: string; slug: string; role: Role }>> {
    const memberships = await this.db.select().from(workspaceMember).where(eq(workspaceMember.userId, userId));
    const out: Array<{ id: string; name: string; slug: string; role: Role }> = [];

    for (const m of memberships) {
      const rows = await this.db.select().from(workspaceTable).where(eq(workspaceTable.id, m.workspaceId)).limit(1);
      const ws = rows[0];
      if (ws) out.push({ id: ws.id, name: ws.name, slug: ws.slug, role: m.role as Role });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  async membersOf(workspaceId: string) {
    const members = await this.db
      .select()
      .from(workspaceMember)
      .where(eq(workspaceMember.workspaceId, workspaceId));

    const out: Array<{ userId: string; email: string; name: string; role: Role; joinedAt: Date }> = [];
    for (const m of members) {
      const rows = await this.db.select().from(appUser).where(eq(appUser.id, m.userId)).limit(1);
      const user = rows[0];
      if (user) out.push({ userId: user.id, email: user.email, name: user.name, role: m.role as Role, joinedAt: m.createdAt });
    }
    return out;
  }

  /** Adds an existing account to a workspace. Membership is idempotent. */
  async addMember(workspaceId: string, email: string, role: Role): Promise<void> {
    const rows = await this.db
      .select()
      .from(appUser)
      .where(eq(appUser.emailLower, email.trim().toLowerCase()))
      .limit(1);
    const user = rows[0];
    if (!user) throw new AuthError('No account with that email exists yet. Ask them to sign up first.', 'no_such_user');

    await this.db
      .insert(workspaceMember)
      .values({ id: newId(), workspaceId, userId: user.id, role })
      .onConflictDoUpdate({ target: [workspaceMember.workspaceId, workspaceMember.userId], set: { role } });
  }

  /** Removes a member. The last owner cannot be removed, or a workspace becomes unadministrable. */
  async removeMember(workspaceId: string, userId: string): Promise<void> {
    const members = await this.db
      .select()
      .from(workspaceMember)
      .where(eq(workspaceMember.workspaceId, workspaceId));

    const target = members.find((m) => m.userId === userId);
    if (!target) return;
    if (target.role === 'owner' && members.filter((m) => m.role === 'owner').length === 1) {
      throw new ForbiddenError('A workspace must keep at least one owner.');
    }

    await this.db
      .delete(workspaceMember)
      .where(and(eq(workspaceMember.workspaceId, workspaceId), eq(workspaceMember.userId, userId)));
  }

  /** Verifies membership and returns the caller's role. Throws rather than returning a default. */
  async requireMembership(userId: string, workspaceId: string, minimum: Role = 'member'): Promise<Role> {
    const rows = await this.db
      .select()
      .from(workspaceMember)
      .where(and(eq(workspaceMember.userId, userId), eq(workspaceMember.workspaceId, workspaceId)))
      .limit(1);

    const membership = rows[0];
    if (!membership) throw new ForbiddenError();

    const role = membership.role as Role;
    if (ROLE_RANK[role] < ROLE_RANK[minimum]) {
      throw new ForbiddenError(`This action requires the ${minimum} role.`);
    }
    return role;
  }

  /** Deletes expired sessions. Safe to call on boot or on a schedule. */
  async pruneSessions(now = new Date()): Promise<number> {
    const removed = await this.db
      .delete(userSession)
      .where(gt(new Date(now.getTime()) as never, userSession.expiresAt))
      .returning({ id: userSession.id });
    return removed.length;
  }
}

export function hasRole(role: Role, minimum: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

function defaultWorkspaceName(name: string | undefined, email: string): string {
  const trimmed = name?.trim();
  if (trimmed) return `${trimmed.split(/\s+/)[0]}'s workspace`;
  const local = email.split('@')[0] ?? 'My';
  return `${local}'s workspace`;
}
