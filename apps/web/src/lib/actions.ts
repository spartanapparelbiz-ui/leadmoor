'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { checkRateLimit, newId, parseLeadSpec } from '@leadmoor/core';
import { leadRequest, leadSpec as leadSpecTable, run as runTable } from '@leadmoor/db';
import { compileRequest } from '@leadmoor/llm';
import {
  audit,
  deletionService,
  engine,
  exportService,
  pumpEmbeddedWorker,
  ready,
  suppressionService,
} from './services';

/**
 * Server actions.
 *
 * Every input is validated with Zod before it reaches a service, every expensive action is rate
 * limited, and errors are returned as safe messages — an internal failure never leaks a stack
 * trace, a query, or a credential to the browser.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
  notice?: string;
}

const requestSchema = z.object({
  request: z.string().trim().min(12, 'Describe who you are looking for in a sentence or two.').max(4000),
});

/** Compiles a natural-language request into a LeadSpec and sends the user to review it. */
export async function createSearch(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = requestSchema.safeParse({ request: formData.get('request') });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request.' };
  }

  const limit = checkRateLimit('compile', 10, 60_000);
  if (!limit.allowed) {
    return { ok: false, error: `Too many searches. Try again in ${Math.ceil(limit.retryAfterMs / 1000)}s.` };
  }

  const svc = await ready();
  let specId: string;

  try {
    const result = await compileRequest(parsed.data.request, svc.llm);
    if (!result.ok || !result.spec) {
      return {
        ok: false,
        error: `Could not build a search from that request: ${result.problems.join('; ')}`,
      };
    }

    const requestId = newId();
    specId = newId();

    await svc.db.insert(leadRequest).values({ id: requestId, rawText: parsed.data.request });
    await svc.db.insert(leadSpecTable).values({
      id: specId,
      requestId,
      version: 1,
      spec: result.spec as never,
      origin: result.origin === 'model' ? 'compiled' : 'heuristic',
    });

    await audit().record('request.created', { subject: requestId, detail: { chars: parsed.data.request.length } });
    await audit().record('spec.compiled', { subject: specId, detail: { origin: result.origin } });
  } catch (error) {
    svc.logger.error('createSearch failed', { error: (error as Error).message });
    return { ok: false, error: 'Something went wrong building the search. Please try again.' };
  }

  redirect(`/searches/${specId}`);
}

const specEditSchema = z.object({
  specId: z.string().uuid(),
  spec: z.string().min(2).max(200_000),
});

/** Saves a user-edited LeadSpec as a new version. The stored document is always validated. */
export async function updateSpec(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const parsed = specEditSchema.safeParse({ specId: formData.get('specId'), spec: formData.get('spec') });
  if (!parsed.success) return { ok: false, error: 'Invalid edit.' };

  const svc = await ready();

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

  const existing = (
    await svc.db.select().from(leadSpecTable).where(eq(leadSpecTable.id, parsed.data.specId)).limit(1)
  )[0];
  if (!existing) return { ok: false, error: 'That search no longer exists.' };
  if (existing.approvedAt) return { ok: false, error: 'This search has already been approved and cannot be edited.' };

  await svc.db
    .update(leadSpecTable)
    .set({ spec: validated.spec as never, origin: 'edited', version: existing.version + 1 })
    .where(eq(leadSpecTable.id, parsed.data.specId));

  await audit().record('spec.edited', { subject: parsed.data.specId, detail: { version: existing.version + 1 } });
  revalidatePath(`/searches/${parsed.data.specId}`);
  return { ok: true, notice: 'Search updated.' };
}

/** Approves a spec and starts a durable run. Nothing expensive happens before this point. */
export async function approveAndRun(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const specId = z.string().uuid().safeParse(formData.get('specId'));
  if (!specId.success) return { ok: false, error: 'Invalid search.' };

  const limit = checkRateLimit('run', 5, 60_000);
  if (!limit.allowed) {
    return { ok: false, error: `Too many runs started. Try again in ${Math.ceil(limit.retryAfterMs / 1000)}s.` };
  }

  const svc = await ready();
  let runId: string;

  try {
    await svc.db
      .update(leadSpecTable)
      .set({ approvedAt: new Date() })
      .where(eq(leadSpecTable.id, specId.data));
    await audit().record('spec.approved', { subject: specId.data });

    runId = await engine().start(specId.data);
  } catch (error) {
    svc.logger.error('approveAndRun failed', { error: (error as Error).message });
    return { ok: false, error: 'Could not start the search. Please try again.' };
  }

  redirect(`/runs/${runId}`);
}

export async function cancelRun(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const runId = z.string().uuid().safeParse(formData.get('runId'));
  if (!runId.success) return { ok: false, error: 'Invalid run.' };

  await ready();
  await engine().cancel(runId.data);
  revalidatePath(`/runs/${runId.data}`);
  return { ok: true, notice: 'Run cancelled.' };
}

export async function suppressLead(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const leadId = z.string().uuid().safeParse(formData.get('leadId'));
  if (!leadId.success) return { ok: false, error: 'Invalid lead.' };

  await ready();
  try {
    await suppressionService().suppressLead(leadId.data);
  } catch {
    return { ok: false, error: 'Could not suppress that lead.' };
  }

  revalidatePath('/runs', 'layout');
  revalidatePath(`/leads/${leadId.data}`);
  return { ok: true, notice: 'Suppressed. It will not appear in results or exports, here or in future runs.' };
}

export async function deletePersonAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const personId = z.string().uuid().safeParse(formData.get('personId'));
  const leadId = z.string().uuid().safeParse(formData.get('leadId'));
  if (!personId.success) return { ok: false, error: 'Invalid person.' };

  await ready();
  try {
    const result = await deletionService().deletePerson(personId.data);
    revalidatePath('/runs', 'layout');
    if (leadId.success) revalidatePath(`/leads/${leadId.data}`);
    return {
      ok: true,
      notice: `Deleted. ${result.claimsDeleted} claim(s) and ${result.identifiersDeleted} identifier(s) removed; the lead keeps its company and score.`,
    };
  } catch {
    return { ok: false, error: 'Could not delete that person.' };
  }
}

export async function deleteCompanyAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const companyId = z.string().uuid().safeParse(formData.get('companyId'));
  if (!companyId.success) return { ok: false, error: 'Invalid company.' };

  await ready();
  try {
    const result = await deletionService().deleteCompany(companyId.data);
    revalidatePath('/runs', 'layout');
    return { ok: true, notice: `Deleted the company and ${result.peopleDeleted} associated person record(s).` };
  } catch {
    return { ok: false, error: 'Could not delete that company.' };
  }
}

/** Returns CSV text for the client to save. Suppression and the export gate are applied first. */
export async function exportRunCsv(runId: string): Promise<{ ok: boolean; csv?: string; error?: string; meta?: string }> {
  const parsed = z.string().uuid().safeParse(runId);
  if (!parsed.success) return { ok: false, error: 'Invalid run.' };

  const limit = checkRateLimit('export', 20, 60_000);
  if (!limit.allowed) return { ok: false, error: 'Too many exports. Try again shortly.' };

  await ready();
  try {
    const result = await exportService().exportRun(parsed.data);
    const withheld = result.withheldFields.length > 0 ? ` ${result.withheldFields.length} field(s) withheld by source terms.` : '';
    return {
      ok: true,
      csv: result.csv,
      meta: `${result.rows.length} lead(s) exported. ${result.suppressedCount} suppressed and excluded.${withheld}`,
    };
  } catch {
    return { ok: false, error: 'Export failed.' };
  }
}

/** Advances the durable queue when the embedded worker mode is enabled. */
export async function pumpWorker(): Promise<{ processed: number }> {
  await ready();
  return { processed: await pumpEmbeddedWorker(6) };
}

export async function runSummary(runId: string): Promise<{ status: string; pending: number } | null> {
  const parsed = z.string().uuid().safeParse(runId);
  if (!parsed.success) return null;

  const svc = await ready();
  const row = (await svc.db.select().from(runTable).where(eq(runTable.id, parsed.data)).limit(1))[0];
  if (!row) return null;

  const pending = await engine().jobs.pendingForRun(parsed.data);
  return { status: row.status, pending };
}
