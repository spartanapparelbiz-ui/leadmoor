'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { checkRateLimit, newId, parseLeadSpec, type LeadSpec } from '@leadmoor/core';
import { leadRequest, leadSpec as leadSpecTable, savedSearch } from '@leadmoor/db';
import { compileRequest } from '@leadmoor/llm';
import { audit, engine, ready, services } from '../services';
import { requireSession } from '../session';

/**
 * One action, one job: turn a sentence into a running search.
 *
 * There is no approval step. The user said what they want; making them read and sign off on a
 * generated specification before anything happens is the kind of ceremony that makes a tool feel
 * like software. The criteria are still shown — on the results page, while the search runs, where
 * they can be changed by typing.
 */

export interface Result {
  ok: boolean;
  error?: string;
  notice?: string;
}

const askSchema = z.object({
  ask: z
    .string()
    .trim()
    .min(8, 'Describe who you are looking for — a sentence is enough.')
    .max(2000, 'That is too long. Try summarising it.'),
});

/** Compiles the request, starts the run, and sends the user straight to the results. */
export async function findLeads(_prev: Result | null, formData: FormData): Promise<Result> {
  const { ctx } = await requireSession();

  const parsed = askSchema.safeParse({ ask: formData.get('ask') });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid request.' };

  const limit = checkRateLimit(`find:${ctx.workspaceId}`, 20, 60_000);
  if (!limit.allowed) {
    return { ok: false, error: `Too many searches. Try again in ${Math.ceil(limit.retryAfterMs / 1000)}s.` };
  }

  const svc = await ready();
  let runId: string;

  try {
    const compiled = await compileRequest(parsed.data.ask, svc.llm);
    if (!compiled.ok || !compiled.spec) {
      return { ok: false, error: `Could not build a search from that: ${compiled.problems.join('; ')}` };
    }

    runId = await launch(ctx.workspaceId, ctx.userId, parsed.data.ask, compiled.spec, compiled.origin);
  } catch (error) {
    svc.logger.error('findLeads failed', { error: (error as Error).message });
    return { ok: false, error: 'Something went wrong starting the search. Please try again.' };
  }

  redirect(`/s/${runId}`);
}

/**
 * Refines a finished search by describing the change in words.
 *
 * The refinement is compiled together with the original request, so "only founders" narrows the
 * personas without discarding the geography and size the user asked for the first time. It starts
 * a new run rather than mutating the old one: the previous results stay reproducible, and the
 * evidence behind them keeps pointing at the documents that were actually read.
 */
export async function refineSearch(_prev: Result | null, formData: FormData): Promise<Result> {
  const { ctx, scope } = await requireSession();

  const runId = z.string().uuid().safeParse(formData.get('runId'));
  const refinement = z.string().trim().min(2).max(600).safeParse(formData.get('refine'));
  if (!runId.success) return { ok: false, error: 'Invalid search.' };
  if (!refinement.success) return { ok: false, error: 'Say how you want the results changed.' };

  const limit = checkRateLimit(`find:${ctx.workspaceId}`, 20, 60_000);
  if (!limit.allowed) return { ok: false, error: 'Too many searches. Try again shortly.' };

  const run = await scope.getRun(runId.data);
  if (!run) return { ok: false, error: 'That search no longer exists.' };

  const previous = await scope.getSpec(run.specId);
  const parsedPrevious = previous ? parseLeadSpec(previous.spec) : null;
  const original = parsedPrevious?.ok ? parsedPrevious.spec.sourceRequest : '';

  const combined = `${original}\n\nRefinement: ${refinement.data}`;
  const svc = await ready();
  let next: string;

  try {
    const compiled = await compileRequest(combined, svc.llm);
    if (!compiled.ok || !compiled.spec) {
      return { ok: false, error: `Could not apply that: ${compiled.problems.join('; ')}` };
    }
    next = await launch(ctx.workspaceId, ctx.userId, combined, compiled.spec, compiled.origin);
  } catch (error) {
    svc.logger.error('refineSearch failed', { error: (error as Error).message });
    return { ok: false, error: 'Could not apply that refinement.' };
  }

  redirect(`/s/${next}`);
}

/**
 * "Find more like this" — the shortest path from one good lead to twenty.
 *
 * The new request is written from what is actually known about the lead: its industry, its size
 * band, where it is, and the role that was found. Nothing is inferred; a company whose size was
 * never established simply does not contribute a size clause.
 */
export async function findMoreLikeThis(_prev: Result | null, formData: FormData): Promise<Result> {
  const { ctx, scope } = await requireSession();

  const leadId = z.string().uuid().safeParse(formData.get('leadId'));
  if (!leadId.success) return { ok: false, error: 'Invalid lead.' };

  const limit = checkRateLimit(`find:${ctx.workspaceId}`, 20, 60_000);
  if (!limit.allowed) return { ok: false, error: 'Too many searches. Try again shortly.' };

  const lead = await scope.getLead(leadId.data);
  if (!lead) return { ok: false, error: 'That lead no longer exists.' };

  const company = await scope.getCompany(lead.companyId);
  if (!company) return { ok: false, error: 'That lead no longer exists.' };

  const run = await scope.getRun(lead.runId);
  const previous = run ? await scope.getSpec(run.specId) : null;
  const parsedPrevious = previous ? parseLeadSpec(previous.spec) : null;
  const spec = parsedPrevious?.ok ? parsedPrevious.spec : null;

  const claims = await scope.claimsFor('company', company.id);
  const value = (field: string): string | null => {
    const hit = claims.find((c) => c.field === field && c.status === 'supported');
    return hit && hit.value !== null && hit.value !== undefined ? String(hit.value) : null;
  };

  const person = lead.personId ? await scope.getPerson(lead.personId) : null;
  const role = person
    ? ((await scope.claimsFor('person', person.id)).find((c) => c.field === 'person.role')?.value as
        | string
        | undefined)
    : undefined;

  const ask = describeLike({
    name: company.canonicalName,
    industry: value('company.industry') ?? spec?.company.industries[0] ?? null,
    employees: Number(value('company.employeeCount')) || null,
    location: value('company.location') ?? value('company.country') ?? company.country,
    role: role ?? spec?.personas.titles[0] ?? null,
    signals: spec?.signals ?? [],
    countries: spec?.geography.countries ?? ['US'],
  });

  const svc = await ready();
  let next: string;

  try {
    const compiled = await compileRequest(ask, svc.llm);
    if (!compiled.ok || !compiled.spec) {
      return { ok: false, error: 'Could not build a similar search from this lead.' };
    }
    // Never hand back the company we started from.
    const widened: LeadSpec = {
      ...compiled.spec,
      company: {
        ...compiled.spec.company,
        excludeDomains: [
          ...new Set([
            ...compiled.spec.company.excludeDomains,
            ...(company.primaryDomain ? [company.primaryDomain] : []),
          ]),
        ],
      },
    };
    next = await launch(ctx.workspaceId, ctx.userId, ask, widened, compiled.origin);
  } catch (error) {
    svc.logger.error('findMoreLikeThis failed', { error: (error as Error).message });
    return { ok: false, error: 'Could not start that search.' };
  }

  redirect(`/s/${next}`);
}

/** Writes the request phrase for "more like this" from established facts only. */
function describeLike(l: {
  name: string;
  industry: string | null;
  employees: number | null;
  location: string | null;
  role: string | null;
  signals: string[];
  countries: string[];
}): string {
  const parts: string[] = ['Find companies similar to'];
  parts.push(l.name);

  if (l.industry) parts.push(`— ${l.industry} companies`);
  else parts.push('— companies in the same line of business');

  if (l.location) parts.push(`in ${l.location}`);
  else parts.push(`in ${l.countries.join(', ')}`);

  if (l.employees) {
    const low = Math.max(1, Math.round(l.employees * 0.4));
    const high = Math.round(l.employees * 2.5);
    parts.push(`with ${low}–${high} employees`);
  }

  if (l.signals.length > 0) parts.push(`showing ${l.signals.slice(0, 2).join(' or ')}`);
  if (l.role) parts.push(`, and identify the ${l.role}`);

  return `${parts.join(' ').replace(' ,', ',')}.`;
}

/** Creates the request, the spec, and the run, and enqueues the first stage. */
async function launch(
  workspaceId: string,
  userId: string,
  ask: string,
  spec: LeadSpec,
  origin: string,
): Promise<string> {
  const db = services().db;
  const requestId = newId();
  const specId = newId();

  await db.insert(leadRequest).values({ id: requestId, workspaceId, rawText: ask, createdBy: userId });
  await db.insert(leadSpecTable).values({
    id: specId,
    requestId,
    workspaceId,
    version: 1,
    spec: spec as never,
    origin: origin === 'model' ? 'compiled' : 'heuristic',
    // Approval is implicit: asking for leads is the approval.
    approvedAt: new Date(),
  });

  const log = audit().forWorkspace(workspaceId);
  await log.record('request.created', { subject: requestId, detail: { chars: ask.length } });
  await log.record('spec.compiled', { subject: specId, detail: { origin } });
  await log.record('spec.approved', { subject: specId });

  return engine().start(specId);
}

/* ── saved searches ───────────────────────────────────────────────────── */

export async function saveSearch(_prev: Result | null, formData: FormData): Promise<Result> {
  const { ctx, scope } = await requireSession();

  const runId = z.string().uuid().safeParse(formData.get('runId'));
  const name = z.string().trim().min(1).max(140).safeParse(formData.get('name'));
  if (!runId.success) return { ok: false, error: 'Invalid search.' };
  if (!name.success) return { ok: false, error: 'Give the search a name.' };

  const run = await scope.getRun(runId.data);
  if (!run) return { ok: false, error: 'That search no longer exists.' };

  const spec = await scope.getSpec(run.specId);
  if (!spec) return { ok: false, error: 'That search no longer exists.' };

  const request = spec.requestId ? await scope.getRequest(spec.requestId) : null;
  const id = newId();

  await services().db.insert(savedSearch).values({
    id,
    workspaceId: ctx.workspaceId,
    name: name.data,
    spec: spec.spec as never,
    sourceRequest: request?.rawText ?? '',
    createdBy: ctx.userId,
    lastRunId: runId.data,
    lastRunAt: new Date(),
  });

  await audit().forWorkspace(ctx.workspaceId).record('saved_search.created', { subject: id });
  revalidatePath('/searches');
  return { ok: true, notice: 'Saved. Run it again any time from Searches.' };
}

export async function runSavedSearch(_prev: Result | null, formData: FormData): Promise<Result> {
  const { ctx, scope } = await requireSession();

  const id = z.string().uuid().safeParse(formData.get('savedId'));
  if (!id.success) return { ok: false, error: 'Invalid search.' };

  const saved = await scope.getSavedSearch(id.data);
  if (!saved) return { ok: false, error: 'That search no longer exists.' };

  const validated = parseLeadSpec(saved.spec);
  if (!validated.ok) return { ok: false, error: 'That saved definition is no longer valid.' };

  await ready();
  const runId = await launch(
    ctx.workspaceId,
    ctx.userId,
    saved.sourceRequest || saved.name,
    validated.spec,
    'saved',
  );

  await services()
    .db.update(savedSearch)
    .set({ lastRunId: runId, lastRunAt: new Date() })
    .where(and(eq(savedSearch.id, id.data), eq(savedSearch.workspaceId, ctx.workspaceId)));

  redirect(`/s/${runId}`);
}

export async function deleteSavedSearch(_prev: Result | null, formData: FormData): Promise<Result> {
  const { ctx, scope } = await requireSession();

  const id = z.string().uuid().safeParse(formData.get('savedId'));
  if (!id.success) return { ok: false, error: 'Invalid search.' };
  if (!(await scope.getSavedSearch(id.data))) return { ok: false, error: 'That search no longer exists.' };

  await services()
    .db.delete(savedSearch)
    .where(and(eq(savedSearch.id, id.data), eq(savedSearch.workspaceId, ctx.workspaceId)));

  await audit().forWorkspace(ctx.workspaceId).record('saved_search.deleted', { subject: id.data });
  revalidatePath('/searches');
  return { ok: true, notice: 'Deleted.' };
}

export async function cancelRun(_prev: Result | null, formData: FormData): Promise<Result> {
  const { scope } = await requireSession();
  const runId = z.string().uuid().safeParse(formData.get('runId'));
  if (!runId.success) return { ok: false, error: 'Invalid search.' };
  if (!(await scope.getRun(runId.data))) return { ok: false, error: 'That search does not exist.' };

  await engine().cancel(runId.data);
  revalidatePath(`/s/${runId.data}`);
  return { ok: true, notice: 'Stopped. Everything found so far is kept.' };
}
