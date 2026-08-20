'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq, ilike, or } from 'drizzle-orm';
import { z } from 'zod';
import { checkRateLimit, newId, parseLeadSpec } from '@leadmoor/core';
import {
  company as companyTable,
  lead as leadTable,
  leadRequest,
  leadSpec as leadSpecTable,
  person as personTable,
  savedSearch,
} from '@leadmoor/db';
import { compileRequest } from '@leadmoor/llm';
import { audit, engine, ready, services } from '../services';
import { requireSession } from '../session';

/**
 * Search lifecycle: compile a request, edit the spec, approve it, run it, save it.
 *
 * Every action resolves the session first and writes the caller's workspace onto whatever it
 * creates, so a row can never be created outside the tenant that made it.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
  notice?: string;
}

const requestSchema = z.object({
  request: z
    .string()
    .trim()
    .min(12, 'Describe who you are looking for in a sentence or two.')
    .max(4000, 'That request is too long — try summarising it.'),
});

/** Compiles a natural-language request into a LeadSpec, then sends the user to review it. */
export async function createSearch(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { ctx } = await requireSession();

  const parsed = requestSchema.safeParse({ request: formData.get('request') });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request.' };

  const limit = checkRateLimit(`compile:${ctx.workspaceId}`, 20, 60_000);
  if (!limit.allowed) {
    return { ok: false, error: `Too many searches. Try again in ${Math.ceil(limit.retryAfterMs / 1000)}s.` };
  }

  const svc = await ready();
  let specId: string;

  try {
    const result = await compileRequest(parsed.data.request, svc.llm);
    if (!result.ok || !result.spec) {
      return { ok: false, error: `Could not build a search from that request: ${result.problems.join('; ')}` };
    }

    const requestId = newId();
    specId = newId();

    await svc.db.insert(leadRequest).values({
      id: requestId,
      workspaceId: ctx.workspaceId,
      rawText: parsed.data.request,
      createdBy: ctx.userId,
    });
    await svc.db.insert(leadSpecTable).values({
      id: specId,
      requestId,
      workspaceId: ctx.workspaceId,
      version: 1,
      spec: result.spec as never,
      origin: result.origin === 'model' ? 'compiled' : 'heuristic',
    });

    const log = audit().forWorkspace(ctx.workspaceId);
    await log.record('request.created', { subject: requestId, detail: { chars: parsed.data.request.length } });
    await log.record('spec.compiled', { subject: specId, detail: { origin: result.origin } });
  } catch (error) {
    svc.logger.error('createSearch failed', { error: (error as Error).message });
    return { ok: false, error: 'Something went wrong building the search. Please try again.' };
  }

  redirect(`/searches/${specId}`);
}

const specEditSchema = z.object({ specId: z.string().uuid(), spec: z.string().min(2).max(400_000) });

/** Saves an edited LeadSpec as a new version. The stored document is always re-validated. */
export async function updateSpec(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { ctx, scope } = await requireSession();

  const parsed = specEditSchema.safeParse({ specId: formData.get('specId'), spec: formData.get('spec') });
  if (!parsed.success) return { ok: false, error: 'Invalid edit.' };

  let candidate: unknown;
  try {
    candidate = JSON.parse(parsed.data.spec);
  } catch {
    return { ok: false, error: 'That is not valid JSON. Check for a missing comma or bracket.' };
  }

  const validated = parseLeadSpec(candidate);
  if (!validated.ok) {
    return { ok: false, error: `The search is not valid: ${validated.problems.slice(0, 4).join('; ')}` };
  }

  const existing = await scope.getSpec(parsed.data.specId);
  if (!existing) return { ok: false, error: 'That search no longer exists.' };
  if (existing.approvedAt) return { ok: false, error: 'This search has already been approved and cannot be edited.' };

  await services()
    .db.update(leadSpecTable)
    .set({ spec: validated.spec as never, origin: 'edited', version: existing.version + 1 })
    .where(and(eq(leadSpecTable.id, parsed.data.specId), eq(leadSpecTable.workspaceId, ctx.workspaceId)));

  await audit()
    .forWorkspace(ctx.workspaceId)
    .record('spec.edited', { subject: parsed.data.specId, detail: { version: existing.version + 1 } });

  revalidatePath(`/searches/${parsed.data.specId}`);
  return { ok: true, notice: 'Search updated.' };
}

/** Approves a spec and starts a durable run. Nothing expensive happens before this point. */
export async function approveAndRun(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { ctx, scope } = await requireSession();

  const specId = z.string().uuid().safeParse(formData.get('specId'));
  if (!specId.success) return { ok: false, error: 'Invalid search.' };

  const limit = checkRateLimit(`run:${ctx.workspaceId}`, 10, 60_000);
  if (!limit.allowed) {
    return { ok: false, error: `Too many runs started. Try again in ${Math.ceil(limit.retryAfterMs / 1000)}s.` };
  }

  const existing = await scope.getSpec(specId.data);
  if (!existing) return { ok: false, error: 'That search no longer exists.' };

  const svc = await ready();
  let runId: string;

  try {
    await svc.db
      .update(leadSpecTable)
      .set({ approvedAt: new Date() })
      .where(and(eq(leadSpecTable.id, specId.data), eq(leadSpecTable.workspaceId, ctx.workspaceId)));

    await audit().forWorkspace(ctx.workspaceId).record('spec.approved', { subject: specId.data });
    runId = await engine().start(specId.data);
  } catch (error) {
    svc.logger.error('approveAndRun failed', { error: (error as Error).message });
    return { ok: false, error: 'Could not start the search. Please try again.' };
  }

  redirect(`/runs/${runId}`);
}

export async function cancelRun(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { ctx, scope } = await requireSession();
  const runId = z.string().uuid().safeParse(formData.get('runId'));
  if (!runId.success) return { ok: false, error: 'Invalid run.' };

  // Verifying ownership before cancelling is the whole point: an id alone is not authorization.
  if (!(await scope.getRun(runId.data))) return { ok: false, error: 'That run does not exist.' };

  await engine().cancel(runId.data);
  revalidatePath(`/runs/${runId.data}`);
  void ctx;
  return { ok: true, notice: 'Run cancelled.' };
}

/* ── saved searches ───────────────────────────────────────────────────── */

const saveSchema = z.object({ specId: z.string().uuid(), name: z.string().trim().min(1).max(140) });

export async function saveSearch(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { ctx, scope } = await requireSession();

  const parsed = saveSchema.safeParse({ specId: formData.get('specId'), name: formData.get('name') });
  if (!parsed.success) return { ok: false, error: 'Give the list a name.' };

  const spec = await scope.getSpec(parsed.data.specId);
  if (!spec) return { ok: false, error: 'That search no longer exists.' };

  const request = spec.requestId ? await scope.getRequest(spec.requestId) : null;
  const id = newId();

  await services().db.insert(savedSearch).values({
    id,
    workspaceId: ctx.workspaceId,
    name: parsed.data.name,
    spec: spec.spec as never,
    sourceRequest: request?.rawText ?? '',
    createdBy: ctx.userId,
  });

  await audit().forWorkspace(ctx.workspaceId).record('saved_search.created', { subject: id });
  revalidatePath('/lists');
  return { ok: true, notice: 'Saved. You can re-run it any time from Saved lists.' };
}

export async function deleteSavedSearch(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { ctx, scope } = await requireSession();
  const id = z.string().uuid().safeParse(formData.get('savedId'));
  if (!id.success) return { ok: false, error: 'Invalid list.' };
  if (!(await scope.getSavedSearch(id.data))) return { ok: false, error: 'That list no longer exists.' };

  await services()
    .db.delete(savedSearch)
    .where(and(eq(savedSearch.id, id.data), eq(savedSearch.workspaceId, ctx.workspaceId)));

  await audit().forWorkspace(ctx.workspaceId).record('saved_search.deleted', { subject: id.data });
  revalidatePath('/lists');
  return { ok: true, notice: 'List deleted.' };
}

/** Re-runs a saved list by creating a fresh spec from its stored definition. */
export async function runSavedSearch(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { ctx, scope } = await requireSession();

  const id = z.string().uuid().safeParse(formData.get('savedId'));
  if (!id.success) return { ok: false, error: 'Invalid list.' };

  const saved = await scope.getSavedSearch(id.data);
  if (!saved) return { ok: false, error: 'That list no longer exists.' };

  const validated = parseLeadSpec(saved.spec);
  if (!validated.ok) return { ok: false, error: 'The saved definition is no longer valid. Edit and re-save it.' };

  const requestId = newId();
  const specId = newId();
  const db = services().db;

  await db.insert(leadRequest).values({
    id: requestId,
    workspaceId: ctx.workspaceId,
    rawText: saved.sourceRequest || saved.name,
    createdBy: ctx.userId,
  });
  await db.insert(leadSpecTable).values({
    id: specId,
    requestId,
    workspaceId: ctx.workspaceId,
    version: 1,
    spec: validated.spec as never,
    origin: 'edited',
    approvedAt: new Date(),
  });

  const runId = await engine().start(specId);
  await db.update(savedSearch).set({ lastRunId: runId, lastRunAt: new Date() }).where(eq(savedSearch.id, id.data));

  redirect(`/runs/${runId}`);
}

/* ── quick search for the command menu ────────────────────────────────── */

export interface QuickResult {
  kind: 'lead' | 'company' | 'person';
  id: string;
  label: string;
  hint: string;
  href: string;
}

export async function searchEverything(term: string): Promise<QuickResult[]> {
  const { ctx } = await requireSession();
  const trimmed = term.trim();
  if (trimmed.length < 2) return [];

  const like = `%${trimmed.replace(/[%_]/g, (m) => `\\${m}`)}%`;
  const db = services().db;

  const companies = await db
    .select()
    .from(companyTable)
    .where(
      and(
        eq(companyTable.workspaceId, ctx.workspaceId),
        or(ilike(companyTable.canonicalName, like), ilike(companyTable.primaryDomain, like)),
      ),
    )
    .limit(6);

  const people = await db
    .select()
    .from(personTable)
    .where(and(eq(personTable.workspaceId, ctx.workspaceId), ilike(personTable.fullName, like)))
    .limit(6);

  const results: QuickResult[] = [];

  for (const c of companies) {
    // Prefer the lead route when one exists, since that is where the evidence lives.
    const leads = await db
      .select()
      .from(leadTable)
      .where(and(eq(leadTable.companyId, c.id), eq(leadTable.workspaceId, ctx.workspaceId)))
      .limit(1);

    results.push({
      kind: 'company',
      id: c.id,
      label: c.canonicalName,
      hint: c.primaryDomain ?? 'company',
      href: leads[0] ? `/leads?lead=${leads[0].id}` : `/companies/${c.id}`,
    });
  }

  for (const p of people) {
    const leads = await db
      .select()
      .from(leadTable)
      .where(and(eq(leadTable.personId, p.id), eq(leadTable.workspaceId, ctx.workspaceId)))
      .limit(1);

    results.push({
      kind: 'person',
      id: p.id,
      label: p.fullName,
      hint: 'person',
      href: leads[0] ? `/leads?lead=${leads[0].id}` : `/people`,
    });
  }

  return results.slice(0, 10);
}
