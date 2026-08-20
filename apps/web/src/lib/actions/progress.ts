'use server';

import { z } from 'zod';
import { STAGE_LABELS, type RunStage } from '@leadmoor/core';
import { pumpEmbeddedWorker, ready, engine } from '../services';
import { requireSession } from '../session';

/**
 * Live search progress.
 *
 * Every number here is read back from the database each tick. Nothing is interpolated and nothing
 * counts up on a timer: a stage that has not started reads as waiting, and a stage that failed
 * says so in its own words.
 */

export interface Progress {
  status: string;
  pending: number;
  done: boolean;
  steps: Array<{
    key: string;
    label: string;
    status: string;
    note: string;
    count: number | null;
    error: string | null;
  }>;
  counts: { companies: number; people: number; leads: number; documents: number };
}

/** Headline number for each stage — what the user is watching climb. */
const COUNT_KEYS: Record<string, string[]> = {
  discovery: ['inserted', 'companies'],
  company_resolution: ['companies'],
  company_enrichment: ['enriched'],
  hard_filter_gate: ['kept'],
  people_discovery: ['peopleFound'],
  people_resolution: ['resolved', 'peopleFound'],
  scoring: ['qualified', 'scored'],
  evidence_assembly: ['leads'],
};

export async function searchProgress(runId: string): Promise<Progress | null> {
  const { scope } = await requireSession();

  const parsed = z.string().uuid().safeParse(runId);
  if (!parsed.success) return null;

  await ready();
  const run = await scope.getRun(parsed.data);
  if (!run) return null;

  // Single-node installs drain the queue from the page that is watching it.
  await pumpEmbeddedWorker(6);

  const pending = await engine().jobs.pendingForRun(parsed.data);
  const stages = await scope.stagesFor(parsed.data);
  const counts = await scope.runCounters(parsed.data);

  const steps = stages.map((s) => {
    const detail = (s.detail ?? {}) as Record<string, unknown>;
    const key = COUNT_KEYS[s.stage]?.find((k) => typeof detail[k] === 'number');
    return {
      key: s.stage,
      label: STAGE_LABELS[s.stage as RunStage] ?? s.stage.replace(/_/g, ' '),
      status: s.status,
      note: noteOf(detail),
      count: key ? (detail[key] as number) : null,
      error: s.error,
    };
  });

  const terminal = ['completed', 'partial', 'failed', 'cancelled', 'budget_exhausted'].includes(run.status);

  return {
    status: run.status,
    pending,
    done: terminal && pending === 0,
    steps,
    counts: {
      companies: counts.companies,
      people: counts.people,
      leads: counts.leads,
      documents: counts.documents,
    },
  };
}

/** A stage's own reported detail, in words. Never invents progress the pipeline did not report. */
function noteOf(detail: Record<string, unknown>): string {
  const parts: string[] = [];
  const add = (key: string, label: string) => {
    if (typeof detail[key] === 'number') parts.push(`${detail[key]} ${label}`);
  };

  add('merged', 'merged');
  add('dropped', 'dropped');
  add('documents', 'documents read');
  add('companiesWithoutPeople', 'without a contact');
  add('unverified', 'unverified emails');
  add('unavailable', 'no email found');
  add('held', 'held for evidence');

  if (typeof detail.reason === 'string') parts.push(detail.reason);
  if (Array.isArray(detail.blocked) && detail.blocked.length > 0) {
    parts.push(String(detail.blocked[0]).slice(0, 130));
  }
  return parts.join(' · ');
}
