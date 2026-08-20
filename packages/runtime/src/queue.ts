import { and, asc, eq, lte, or, sql } from 'drizzle-orm';
import { newId, type RunStage } from '@leadmoor/core';
import { job as jobTable, type Db } from '@leadmoor/db';

/**
 * Durable job queue — the RunEngine port's Postgres adapter.
 *
 * ARCHITECTURE.md section 11 calls a lead run "a long-lived saga with human-in-the-loop signals and
 * partial failure". This implements that without an external orchestrator: jobs are rows, workers
 * claim them with SELECT ... FOR UPDATE SKIP LOCKED under a lease, and a worker that dies simply
 * lets its lease expire so the job is retried instead of lost.
 *
 * The interface is deliberately narrow so an Inngest or Temporal adapter can replace it without
 * touching the pipeline.
 */

export type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'retrying' | 'cancelled';

export interface JobRecord {
  id: string;
  runId: string;
  stage: RunStage;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  payload: Record<string, unknown>;
  lastError: string | null;
}

export interface EnqueueArgs {
  runId: string;
  stage: RunStage;
  payload?: Record<string, unknown>;
  maxAttempts?: number;
  delayMs?: number;
}

const LEASE_MS = 5 * 60 * 1000;

/** Exponential backoff with a ceiling. Deterministic — no jitter, so tests can assert it. */
export function backoffMs(attempt: number): number {
  return Math.min(60_000, 2 ** Math.max(0, attempt - 1) * 1000);
}

export class JobQueue {
  constructor(
    private readonly db: Db,
    private readonly workerId: string = `worker-${process.pid}`,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async enqueue(args: EnqueueArgs): Promise<string> {
    const id = newId();
    await this.db.insert(jobTable).values({
      id,
      runId: args.runId,
      stage: args.stage,
      status: 'queued',
      maxAttempts: args.maxAttempts ?? 3,
      runAfter: new Date(this.now().getTime() + (args.delayMs ?? 0)),
      payload: (args.payload ?? {}) as never,
    });
    return id;
  }

  /**
   * Claim one runnable job.
   *
   * A job is runnable when it is queued/retrying and due, or when it is running but its lease has
   * expired — that second case is what makes a crashed worker recoverable rather than a stuck run.
   */
  async claim(): Promise<JobRecord | null> {
    const now = this.now();
    const leaseUntil = new Date(now.getTime() + LEASE_MS);

    const rows = await this.db.execute(sql`
      UPDATE job SET
        status = 'running',
        attempts = attempts + 1,
        leased_until = ${leaseUntil.toISOString()},
        leased_by = ${this.workerId},
        updated_at = ${now.toISOString()}
      WHERE id = (
        SELECT id FROM job
        WHERE (
          (status IN ('queued','retrying') AND run_after <= ${now.toISOString()})
          OR (status = 'running' AND leased_until IS NOT NULL AND leased_until < ${now.toISOString()})
        )
        ORDER BY run_after ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING id, run_id, stage, status, attempts, max_attempts, payload, last_error
    `);

    const record = firstRow(rows);
    if (!record) return null;

    return {
      id: String(record.id),
      runId: String(record.run_id),
      stage: String(record.stage) as RunStage,
      status: 'running',
      attempts: Number(record.attempts),
      maxAttempts: Number(record.max_attempts),
      payload: (record.payload ?? {}) as Record<string, unknown>,
      lastError: record.last_error === null ? null : String(record.last_error),
    };
  }

  async complete(jobId: string): Promise<void> {
    await this.db
      .update(jobTable)
      .set({ status: 'completed', leasedUntil: null, leasedBy: null, updatedAt: this.now() })
      .where(eq(jobTable.id, jobId));
  }

  /**
   * Record a failure. Retries with backoff while attempts remain, then marks the job failed.
   * Returns whether it will run again — the caller uses this to decide if the run is partial or done.
   */
  async fail(jobId: string, error: string): Promise<{ willRetry: boolean; attempts: number }> {
    const rows = await this.db.select().from(jobTable).where(eq(jobTable.id, jobId)).limit(1);
    const row = rows[0];
    if (!row) return { willRetry: false, attempts: 0 };

    const willRetry = row.attempts < row.maxAttempts;
    await this.db
      .update(jobTable)
      .set({
        status: willRetry ? 'retrying' : 'failed',
        lastError: error.slice(0, 2000),
        runAfter: new Date(this.now().getTime() + backoffMs(row.attempts)),
        leasedUntil: null,
        leasedBy: null,
        updatedAt: this.now(),
      })
      .where(eq(jobTable.id, jobId));

    return { willRetry, attempts: row.attempts };
  }

  async cancelRun(runId: string): Promise<number> {
    const result = await this.db
      .update(jobTable)
      .set({ status: 'cancelled', leasedUntil: null, leasedBy: null, updatedAt: this.now() })
      .where(
        and(
          eq(jobTable.runId, runId),
          or(eq(jobTable.status, 'queued'), eq(jobTable.status, 'retrying'), eq(jobTable.status, 'running')),
        ),
      )
      .returning({ id: jobTable.id });
    return result.length;
  }

  async pendingForRun(runId: string): Promise<number> {
    const rows = await this.db
      .select({ id: jobTable.id })
      .from(jobTable)
      .where(
        and(
          eq(jobTable.runId, runId),
          or(eq(jobTable.status, 'queued'), eq(jobTable.status, 'retrying'), eq(jobTable.status, 'running')),
        ),
      );
    return rows.length;
  }

  async listForRun(runId: string): Promise<JobRecord[]> {
    const rows = await this.db
      .select()
      .from(jobTable)
      .where(eq(jobTable.runId, runId))
      .orderBy(asc(jobTable.createdAt));

    return rows.map((row) => ({
      id: row.id,
      runId: row.runId,
      stage: row.stage as RunStage,
      status: row.status as JobStatus,
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      payload: (row.payload ?? {}) as Record<string, unknown>,
      lastError: row.lastError,
    }));
  }

  /** Frees leases held by workers that are gone. Safe to call on worker boot. */
  async reclaimExpired(): Promise<number> {
    const now = this.now();
    const result = await this.db
      .update(jobTable)
      .set({ status: 'retrying', leasedUntil: null, leasedBy: null, updatedAt: now })
      .where(and(eq(jobTable.status, 'running'), lte(jobTable.leasedUntil, now)))
      .returning({ id: jobTable.id });
    return result.length;
  }
}

/** Drizzle returns `{rows}` on node-postgres and an array on PGlite. */
function firstRow(result: unknown): Record<string, unknown> | null {
  if (Array.isArray(result)) return (result[0] as Record<string, unknown>) ?? null;
  const rows = (result as { rows?: unknown[] }).rows;
  return Array.isArray(rows) ? ((rows[0] as Record<string, unknown>) ?? null) : null;
}
