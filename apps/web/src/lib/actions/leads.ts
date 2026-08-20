'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { STAGE_LABELS, checkRateLimit, type RunStage } from '@leadmoor/core';
import { EXPORT_COLUMNS, toCsvColumns } from '@leadmoor/export';
import { deletionService, exportService, pumpEmbeddedWorker, ready, suppressionService } from '../services';
import { humanize } from '../format';
import { requireSession } from '../session';

/**
 * Lead-level actions: suppress, delete, export.
 *
 * Each one resolves the session, then checks that the id it was handed actually belongs to the
 * caller's workspace *before* doing anything. An id is not authorization — a lead id copied from
 * another tenant resolves to "not found" here, not to a suppression on their data.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
  notice?: string;
}

export async function suppressLead(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { ctx, scope } = await requireSession();

  const leadId = z.string().uuid().safeParse(formData.get('leadId'));
  if (!leadId.success) return { ok: false, error: 'Invalid lead.' };

  await ready();
  if (!(await scope.getLead(leadId.data))) return { ok: false, error: 'That lead no longer exists.' };

  try {
    await suppressionService(ctx.workspaceId).suppressLead(leadId.data);
  } catch {
    return { ok: false, error: 'Could not suppress that lead.' };
  }

  revalidatePath('/leads');
  revalidatePath('/runs', 'layout');
  return { ok: true, notice: 'Suppressed. It will not appear in results or exports, here or in future runs.' };
}

export async function suppressCompanyAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const { ctx, scope } = await requireSession();

  const companyId = z.string().uuid().safeParse(formData.get('companyId'));
  if (!companyId.success) return { ok: false, error: 'Invalid company.' };

  await ready();
  if (!(await scope.getCompany(companyId.data))) return { ok: false, error: 'That company no longer exists.' };

  try {
    await suppressionService(ctx.workspaceId).suppressCompany(companyId.data);
  } catch {
    return { ok: false, error: 'Could not suppress that company.' };
  }

  revalidatePath('/leads');
  revalidatePath('/companies');
  return { ok: true, notice: 'Company suppressed across this workspace, including future runs.' };
}

export async function deletePersonAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { ctx, scope } = await requireSession();

  const personId = z.string().uuid().safeParse(formData.get('personId'));
  if (!personId.success) return { ok: false, error: 'Invalid person.' };

  await ready();
  if (!(await scope.getPerson(personId.data))) return { ok: false, error: 'That person no longer exists.' };

  try {
    const result = await deletionService(ctx.workspaceId).deletePerson(personId.data);
    revalidatePath('/leads');
    revalidatePath('/people');
    revalidatePath('/runs', 'layout');
    return {
      ok: true,
      notice: `Deleted. ${result.claimsDeleted} claim(s) and ${result.identifiersDeleted} identifier(s) removed; the lead keeps its company and score.`,
    };
  } catch {
    return { ok: false, error: 'Could not delete that person.' };
  }
}

export async function deleteCompanyAction(_prev: ActionResult | null, formData: FormData): Promise<ActionResult> {
  const { ctx, scope } = await requireSession();

  const companyId = z.string().uuid().safeParse(formData.get('companyId'));
  if (!companyId.success) return { ok: false, error: 'Invalid company.' };

  await ready();
  if (!(await scope.getCompany(companyId.data))) return { ok: false, error: 'That company no longer exists.' };

  try {
    const result = await deletionService(ctx.workspaceId).deleteCompany(companyId.data);
    revalidatePath('/leads');
    revalidatePath('/companies');
    revalidatePath('/runs', 'layout');
    return { ok: true, notice: `Deleted the company and ${result.peopleDeleted} associated person record(s).` };
  } catch {
    return { ok: false, error: 'Could not delete that company.' };
  }
}

/* ── export ───────────────────────────────────────────────────────────── */

export interface ExportOutcome {
  ok: boolean;
  csv?: string;
  filename?: string;
  error?: string;
  meta?: string;
  rowCount?: number;
  suppressedCount?: number;
  withheldFields?: string[];
}

const exportSchema = z.object({
  runId: z.string().uuid(),
  columns: z.array(z.string()).min(1).max(EXPORT_COLUMNS.length),
  includeUnqualified: z.boolean(),
});

/**
 * Builds CSV text for the browser to save.
 *
 * Suppression and the export gate run inside `ExportService`; this only chooses which of the
 * already-permitted columns to write. A column the source forbids redistributing is reported in
 * `withheldFields` and left out of every row — it is never quietly blanked.
 */
export async function exportRunCsv(input: {
  runId: string;
  columns?: string[];
  includeUnqualified?: boolean;
}): Promise<ExportOutcome> {
  const { ctx, scope } = await requireSession();

  const parsed = exportSchema.safeParse({
    runId: input.runId,
    columns: input.columns?.length ? input.columns : [...EXPORT_COLUMNS],
    includeUnqualified: input.includeUnqualified ?? false,
  });
  if (!parsed.success) return { ok: false, error: 'Invalid export request.' };

  const limit = checkRateLimit(`export:${ctx.workspaceId}`, 20, 60_000);
  if (!limit.allowed) return { ok: false, error: 'Too many exports. Try again shortly.' };

  await ready();
  const run = await scope.getRun(parsed.data.runId);
  if (!run) return { ok: false, error: 'That run does not exist.' };

  // Unknown column names are dropped rather than trusted — the caller does not get to name fields.
  const chosen = EXPORT_COLUMNS.filter((c) => parsed.data.columns.includes(c));
  if (chosen.length === 0) return { ok: false, error: 'Choose at least one column.' };

  try {
    const result = await exportService(ctx.workspaceId).exportRun(parsed.data.runId, {
      includeUnqualified: parsed.data.includeUnqualified,
    });

    const csv = toCsvColumns(result.rows, chosen);
    const withheld =
      result.withheldFields.length > 0
        ? ` ${result.withheldFields.length} field(s) withheld by source terms: ${result.withheldFields.join(', ')}.`
        : '';

    return {
      ok: true,
      csv,
      filename: `leadmoor-${parsed.data.runId.slice(0, 8)}.csv`,
      rowCount: result.rows.length,
      suppressedCount: result.suppressedCount,
      withheldFields: result.withheldFields,
      meta: `${result.rows.length} lead(s) exported. ${result.suppressedCount} suppressed and excluded.${withheld}`,
    };
  } catch {
    return { ok: false, error: 'Export failed.' };
  }
}

/* ── run progress ─────────────────────────────────────────────────────── */

/** Advances the durable queue when the embedded worker mode is enabled. */
export async function pumpWorker(): Promise<{ processed: number }> {
  await requireSession();
  await ready();
  return { processed: await pumpEmbeddedWorker(6) };
}

export interface RunProgress {
  status: string;
  pending: number;
  stages: Array<{
    stage: string;
    label: string;
    status: string;
    startedAt: string | null;
    finishedAt: string | null;
    attempts: number;
    error: string | null;
    detail: Record<string, unknown>;
  }>;
  counters: { companies: number; people: number; leads: number; documents: number; modelCalls: number };
  activity: Array<{ at: string; action: string; detail: string }>;
}

/** Polled by the live run screen. Scoped, so a run id from another workspace returns null. */
export async function runProgress(runId: string): Promise<RunProgress | null> {
  const { scope } = await requireSession();

  const parsed = z.string().uuid().safeParse(runId);
  if (!parsed.success) return null;

  await ready();
  const run = await scope.getRun(parsed.data);
  if (!run) return null;

  const { engine } = await import('../services');
  const pending = await engine().jobs.pendingForRun(parsed.data);

  const stages = (await scope.stagesFor(parsed.data)).map((s) => ({
    stage: s.stage,
    label: STAGE_LABELS[s.stage as RunStage] ?? humanize(s.stage),
    status: s.status,
    startedAt: s.startedAt ? s.startedAt.toISOString() : null,
    finishedAt: s.finishedAt ? s.finishedAt.toISOString() : null,
    attempts: s.attempts,
    error: s.error,
    detail: (s.detail ?? {}) as Record<string, unknown>,
  }));

  const counters = await scope.runCounters(parsed.data);
  const activity = (await scope.listAudit({ runId: parsed.data, limit: 60 })).map((a) => ({
    at: a.createdAt.toISOString(),
    action: a.action,
    detail: summarize(a.detail),
  }));

  return { status: run.status, pending, stages, counters, activity };
}

/** Renders an audit detail blob as one short human line. Long values are trimmed, not dumped. */
function summarize(detail: unknown): string {
  if (!detail || typeof detail !== 'object') return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(detail as Record<string, unknown>)) {
    if (value === null || value === undefined || value === '') continue;
    const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
    parts.push(`${key}: ${text.length > 80 ? `${text.slice(0, 80)}…` : text}`);
    if (parts.length === 4) break;
  }
  return parts.join(' · ');
}
