'use server';

import { z } from 'zod';
import { checkRateLimit, newId, suppressionKey } from '@leadmoor/core';
import { exportRecord } from '@leadmoor/db';
import { audit, exportPolicy, ready, services } from '../services';
import { loadLeads, sourceName } from '../leads';
import { requireSession } from '../session';

/**
 * CSV export.
 *
 * Built on the server so two things happen before anything reaches the browser: suppressed records
 * are dropped, and every field is checked against the redistribution terms of the source that
 * produced it. A field a source forbids redistributing is left out of every row and named in the
 * result, rather than being quietly blanked as though it were simply missing.
 */

export interface ExportResult {
  ok: boolean;
  csv?: string;
  filename?: string;
  meta?: string;
  error?: string;
}

const COLUMNS = [
  'Company',
  'Website',
  'Person',
  'Role',
  'Email',
  'Email Status',
  'Score',
  'Why Fit',
  'Source',
] as const;

export async function exportCsv(runId: string): Promise<ExportResult> {
  const { ctx, scope } = await requireSession();

  const parsed = z.string().uuid().safeParse(runId);
  if (!parsed.success) return { ok: false, error: 'Invalid search.' };

  const limit = checkRateLimit(`export:${ctx.workspaceId}`, 30, 60_000);
  if (!limit.allowed) return { ok: false, error: 'Too many exports. Try again shortly.' };

  await ready();
  const run = await scope.getRun(parsed.data);
  if (!run) return { ok: false, error: 'That search does not exist.' };

  const leads = await loadLeads(scope, { runId: parsed.data, limit: 1000 });
  const suppressed = await scope.suppressionKeys();
  const policy = exportPolicy();

  const withheld = new Set<string>();
  const rows: string[][] = [];
  let excluded = 0;

  for (const lead of leads) {
    // Suppression is hash-keyed, so a suppressed domain or address is excluded without us having
    // to keep the raw identifier anywhere.
    const domainKey = suppressionKey('domain', lead.website ?? lead.company);
    if (suppressed.has(domainKey) || (lead.email && suppressed.has(suppressionKey('email', lead.email)))) {
      excluded += 1;
      continue;
    }
    if (lead.status === 'suppressed') {
      excluded += 1;
      continue;
    }

    // Gate three: may this field leave the system, given the source that produced it?
    const emailSource = await emailSourceOf(scope, lead.id);
    const emailOk = !lead.email || !emailSource || policy.checkExport(emailSource, 'person_work_email').allowed;
    if (!emailOk) withheld.add('Email');

    rows.push([
      lead.company,
      lead.website ?? '',
      lead.person ?? '',
      lead.role ?? '',
      emailOk ? (lead.email ?? '') : '',
      lead.emailStatus,
      lead.scoreShown ? String(lead.score) : '',
      lead.reasons.filter((r) => r.met).map((r) => r.text).join('; '),
      lead.sources.map(sourceName).join('; '),
    ]);
  }

  if (rows.length === 0) {
    return { ok: false, error: 'Nothing to export — every lead was suppressed or filtered out.' };
  }

  const csv = [COLUMNS.join(','), ...rows.map((r) => r.map(cell).join(','))].join('\r\n');
  const withheldNote = withheld.size > 0 ? ` ${[...withheld].join(', ')} withheld by source terms.` : '';

  const record = newId();
  await services()
    .db.insert(exportRecord)
    .values({
      id: record,
      workspaceId: ctx.workspaceId,
      runId: parsed.data,
      format: 'csv',
      rowCount: rows.length,
      suppressedCount: excluded,
      withheldFields: [...withheld] as never,
    });
  await audit()
    .forWorkspace(ctx.workspaceId)
    .record('lead.exported', { runId: parsed.data, subject: record, detail: { rows: rows.length } });

  return {
    ok: true,
    csv,
    filename: `leadmoor-${parsed.data.slice(0, 8)}.csv`,
    meta: `${rows.length} exported${excluded > 0 ? `, ${excluded} suppressed` : ''}.${withheldNote}`,
  };
}

/** The source that supplied a lead's address, if it has one. */
async function emailSourceOf(
  scope: Awaited<ReturnType<typeof requireSession>>['scope'],
  leadId: string,
): Promise<string | null> {
  const lead = await scope.getLead(leadId);
  return lead?.emailSourceId ?? null;
}

/**
 * Writes one CSV cell.
 *
 * The leading-character guard stops a value beginning `=`, `+`, `-`, or `@` from being executed as
 * a formula when the file is opened in a spreadsheet.
 */
function cell(value: string): string {
  const v = value ?? '';
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}
