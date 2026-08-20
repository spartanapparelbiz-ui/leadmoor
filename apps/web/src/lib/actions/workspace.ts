'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { checkRateLimit } from '@leadmoor/core';
import { AuthError, ForbiddenError, ROLES, type Role } from '@leadmoor/auth';
import { audit } from '../services';
import { authService, requireRole, requireSession } from '../session';

/**
 * Workspace membership and switching.
 *
 * Authorization is decided here, on the server, by re-reading the caller's membership row. The
 * sidebar only decides what to *offer*; it never decides what is permitted. Passing another
 * workspace's id to any of these actions fails with the same message as a workspace that does not
 * exist, so an id cannot be used to probe for tenants.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
  notice?: string;
}

/**
 * Points the current session at a different workspace.
 *
 * Called from the switcher. Membership is re-verified inside `switchWorkspace`, so a crafted call
 * with an id the user cannot see is rejected before the session row changes.
 */
export async function switchWorkspaceAction(workspaceId: string): Promise<ActionResult> {
  const { ctx } = await requireSession();

  const parsed = z.string().uuid().safeParse(workspaceId);
  if (!parsed.success) return { ok: false, error: 'Unknown workspace.' };
  if (parsed.data === ctx.workspaceId) return { ok: true };

  try {
    const auth = await authService();
    await auth.switchWorkspace(ctx.sessionId, ctx.userId, parsed.data);
    await audit().forWorkspace(parsed.data).record('workspace.switched', { subject: ctx.userId });
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, error: 'Unknown workspace.' };
    return { ok: false, error: 'Could not switch workspace.' };
  }

  // Every page is workspace-scoped, so the whole tree is stale after a switch.
  revalidatePath('/', 'layout');
  redirect('/');
}

const createSchema = z.object({
  name: z.string().trim().min(2, 'Give the workspace a name.').max(120, 'That name is too long.'),
});

export async function createWorkspaceAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx } = await requireSession();

  const parsed = createSchema.safeParse({ name: formData.get('name') });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid name.' };

  const limit = checkRateLimit(`workspace:${ctx.userId}`, 10, 60 * 60_000);
  if (!limit.allowed) return { ok: false, error: 'Too many workspaces created. Try again later.' };

  let workspaceId: string;
  try {
    const auth = await authService();
    workspaceId = await auth.createWorkspace({ name: parsed.data.name, userId: ctx.userId });
    await auth.switchWorkspace(ctx.sessionId, ctx.userId, workspaceId);
    await audit().forWorkspace(workspaceId).record('workspace.created', { subject: workspaceId });
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: 'Could not create the workspace.' };
  }

  revalidatePath('/', 'layout');
  redirect('/settings/workspace');
}

const memberSchema = z.object({
  email: z.string().trim().email('Enter the teammate’s email address.').max(200),
  role: z.enum(ROLES),
});

/** Adds an existing account to this workspace. Requires admin. */
export async function addMemberAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { ctx } = await requireRole('admin');

  const parsed = memberSchema.safeParse({ email: formData.get('email'), role: formData.get('role') });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' };

  // Only an owner may mint another owner; an admin promoting themselves sideways is not a thing.
  if (parsed.data.role === 'owner' && ctx.role !== 'owner') {
    return { ok: false, error: 'Only an owner can add another owner.' };
  }

  try {
    const auth = await authService();
    await auth.addMember(ctx.workspaceId, parsed.data.email, parsed.data.role as Role);
    await audit()
      .forWorkspace(ctx.workspaceId)
      .record('workspace.member_added', { subject: ctx.workspaceId, detail: { role: parsed.data.role } });
  } catch (error) {
    if (error instanceof AuthError) return { ok: false, error: error.message };
    return { ok: false, error: 'Could not add that member.' };
  }

  revalidatePath('/settings/workspace');
  return { ok: true, notice: `${parsed.data.email} now has access to this workspace.` };
}

export async function removeMemberAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { ctx } = await requireRole('admin');

  const userId = z.string().uuid().safeParse(formData.get('userId'));
  if (!userId.success) return { ok: false, error: 'Invalid member.' };

  try {
    const auth = await authService();

    // Removing an owner requires owner rank; the service separately refuses to remove the last one.
    const members = await auth.membersOf(ctx.workspaceId);
    const target = members.find((m) => m.userId === userId.data);
    if (!target) return { ok: false, error: 'That person is not a member of this workspace.' };
    if (target.role === 'owner' && ctx.role !== 'owner') {
      return { ok: false, error: 'Only an owner can remove another owner.' };
    }

    await auth.removeMember(ctx.workspaceId, userId.data);
    await audit().forWorkspace(ctx.workspaceId).record('workspace.member_removed', { subject: userId.data });
  } catch (error) {
    // "A workspace must keep at least one owner" is worth showing; it tells the user what to do.
    if (error instanceof ForbiddenError || error instanceof AuthError) {
      return { ok: false, error: error.message };
    }
    return { ok: false, error: 'Could not remove that member.' };
  }

  revalidatePath('/settings/workspace');
  return { ok: true, notice: 'Member removed. Their sessions for this workspace no longer resolve.' };
}
