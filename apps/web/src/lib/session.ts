import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AuthService, SESSION_COOKIE, type AuthenticatedContext, type Role } from '@leadmoor/auth';
import { WorkspaceScope } from '@leadmoor/db';
import { ready, services } from './services';

/**
 * Server-side session and authorization.
 *
 * `requireSession` is the only way a route obtains a workspace id. It resolves the cookie, verifies
 * the membership behind it, and returns a scope already bound to that workspace — so a route
 * cannot accidentally query unscoped, and a URL carrying someone else's id resolves to nothing.
 */

export async function authService(): Promise<AuthService> {
  const svc = await ready();
  return new AuthService(svc.db);
}

export interface Session {
  ctx: AuthenticatedContext;
  scope: WorkspaceScope;
}

/** Resolves the session without redirecting. Used by pages that render for signed-out visitors. */
export async function currentSession(): Promise<Session | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const auth = await authService();
  const ctx = await auth.resolve(token);
  if (!ctx) return null;

  return { ctx, scope: new WorkspaceScope(services().db, ctx.workspaceId) };
}

/** Requires a signed-in session. Redirects to the sign-in page otherwise. */
export async function requireSession(): Promise<Session> {
  const session = await currentSession();
  if (!session) redirect('/login');
  return session;
}

/**
 * Requires a session whose role meets a minimum.
 *
 * Used by member management and workspace settings. Authorization is checked here, server-side —
 * not by omitting a button.
 */
export async function requireRole(minimum: Role): Promise<Session> {
  const session = await requireSession();
  const auth = await authService();
  await auth.requireMembership(session.ctx.userId, session.ctx.workspaceId, minimum);
  return session;
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<string | undefined> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  jar.delete(SESSION_COOKIE);
  return token;
}
