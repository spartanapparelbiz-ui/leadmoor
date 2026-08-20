'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { checkRateLimit } from '@leadmoor/core';
import { AuthError, passwordProblems } from '@leadmoor/auth';
import { audit, ready } from '../services';
import { authService, clearSessionCookie, currentSession, setSessionCookie } from '../session';

/**
 * Sign-up, sign-in, sign-out.
 *
 * Errors are returned as messages the user can act on, never as internal detail. Credential
 * attempts are rate limited per email so a single account cannot be brute-forced from one client.
 */

export interface FormResult {
  ok: boolean;
  error?: string;
  fieldErrors?: Record<string, string>;
}

const signupSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.').max(200),
  password: z.string().min(1, 'Choose a password.').max(400),
  name: z.string().trim().max(120).optional(),
  workspaceName: z.string().trim().max(120).optional(),
});

export async function signUp(_prev: FormResult | null, formData: FormData): Promise<FormResult> {
  const parsed = signupSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
    name: formData.get('name') ?? undefined,
    workspaceName: formData.get('workspaceName') ?? undefined,
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? 'Check the form and try again.' };
  }

  const weak = passwordProblems(parsed.data.password);
  if (weak.length > 0) return { ok: false, fieldErrors: { password: weak.join(' ') } };

  const limit = checkRateLimit(`signup:${parsed.data.email.toLowerCase()}`, 5, 60 * 60_000);
  if (!limit.allowed) return { ok: false, error: 'Too many sign-up attempts. Try again later.' };

  await ready();
  const auth = await authService();

  try {
    const { userId, workspaceId } = await auth.register(parsed.data);
    const session = await auth.login(parsed.data.email, parsed.data.password);
    await setSessionCookie(session.token, session.expiresAt);
    await audit().forWorkspace(workspaceId).record('auth.registered', { subject: userId });
    await audit().forWorkspace(workspaceId).record('workspace.created', { subject: workspaceId });
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: 'Could not create the account. Please try again.' };
  }

  redirect('/');
}

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email.').max(200),
  password: z.string().min(1, 'Enter your password.').max(400),
});

export async function signIn(_prev: FormResult | null, formData: FormData): Promise<FormResult> {
  const parsed = loginSchema.safeParse({ email: formData.get('email'), password: formData.get('password') });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Enter your email and password.' };
  }

  // Keyed by email so one account under attack cannot lock out every other user of the instance.
  const limit = checkRateLimit(`login:${parsed.data.email.toLowerCase()}`, 10, 15 * 60_000);
  if (!limit.allowed) {
    return { ok: false, error: 'Too many attempts for this account. Try again in a few minutes.' };
  }

  await ready();
  const auth = await authService();

  try {
    const session = await auth.login(parsed.data.email, parsed.data.password);
    await setSessionCookie(session.token, session.expiresAt);

    const resolved = await auth.resolve(session.token);
    if (resolved) {
      await audit().forWorkspace(resolved.workspaceId).record('auth.signed_in', { subject: resolved.userId });
    }
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: 'Could not sign in. Please try again.' };
  }

  redirect('/');
}

export async function signOut(): Promise<void> {
  const session = await currentSession();
  const token = await clearSessionCookie();

  if (token) {
    const auth = await authService();
    await auth.logout(token);
    if (session) {
      await audit()
        .forWorkspace(session.ctx.workspaceId)
        .record('auth.signed_out', { subject: session.ctx.userId });
    }
  }

  redirect('/login');
}
