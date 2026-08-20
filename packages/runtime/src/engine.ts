import { eq, isNotNull, and } from 'drizzle-orm';
import {
  BudgetExceededError,
  newId,
  parseLeadSpec,
  type LeadSpec,
  type Logger,
  type RunStatus,
} from '@leadmoor/core';
import { nullLogger } from '@leadmoor/core';
import {
  company as companyTable,
  leadSpec as leadSpecTable,
  run as runTable,
  runStage as runStageTable,
  type Db,
} from '@leadmoor/db';
import { createRunHostAllowlist, type RunHostAllowlist } from '@leadmoor/policy';
import { BudgetGovernor } from './budget.js';
import { JobQueue } from './queue.js';
import {
  STAGE_ORDER,
  initializeStages,
  markStage,
  nextStage,
  runStageHandler,
  updateRunUsage,
  type PipelineContext,
} from './pipeline.js';
import type { Services } from './services.js';

/**
 * RunEngine — drives a run through its stages, one durable job at a time.
 *
 * A worker claims a job, executes exactly one stage, then enqueues the next. If the process dies
 * mid-stage the lease expires and another worker picks the same stage up again, so progress is
 * never lost and no stage is silently skipped.
 */
export class RunEngine {
  private readonly queue: JobQueue;
  private readonly log: Logger;
  /** Host allowlists are per-run and rebuilt from the database when a run resumes. */
  private readonly hostCache = new Map<string, RunHostAllowlist>();

  constructor(
    private readonly services: Services,
    workerId?: string,
    logger?: Logger,
  ) {
    this.queue = new JobQueue(services.db, workerId);
    this.log = (logger ?? services.logger ?? nullLogger).child({ component: 'run-engine' });
  }

  get jobs(): JobQueue {
    return this.queue;
  }

  /** Creates a run for an approved spec and enqueues its first stage. */
  async start(specId: string): Promise<string> {
    const spec = await this.loadSpec(this.services.db, specId);
    const runId = newId();

    await this.services.db.insert(runTable).values({
      id: runId,
      specId,
      status: 'queued',
      usage: {} as never,
      stats: {} as never,
    });
    await initializeStages(this.services.db, runId);
    await this.queue.enqueue({ runId, stage: STAGE_ORDER[0] as (typeof STAGE_ORDER)[number] });
    await this.services.audit.record('run.created', { runId, detail: { specId, name: spec.name } });

    return runId;
  }

  /**
   * Claims and executes one job. Returns false when the queue is empty, so a worker loop can idle.
   * Every failure path is caught: a thrown stage marks the job for retry rather than killing the worker.
   */
  async tick(): Promise<boolean> {
    const job = await this.queue.claim();
    if (!job) return false;

    const stage = job.stage;
    const log = this.log.child({ runId: job.runId, stage, jobId: job.id, attempt: job.attempts });

    try {
      const runRows = await this.services.db.select().from(runTable).where(eq(runTable.id, job.runId)).limit(1);
      const runRow = runRows[0];
      if (!runRow) {
        await this.queue.complete(job.id);
        return true;
      }
      if (runRow.status === 'cancelled') {
        await this.queue.complete(job.id);
        return true;
      }

      const spec = await this.loadSpec(this.services.db, runRow.specId);
      const budget = new BudgetGovernor(spec.budget, Date.parse(runRow.startedAt?.toISOString() ?? '') || Date.now());
      budget.restore((runRow.usage ?? {}) as Record<string, number>);

      if (runRow.status === 'queued') {
        await this.services.db
          .update(runTable)
          .set({ status: 'running', startedAt: new Date() })
          .where(eq(runTable.id, job.runId));
        await this.services.audit.record('run.started', { runId: job.runId });
      }

      const runHosts = await this.hostsFor(job.runId);
      const runServices = this.services.forRun({ budget, runHosts });

      await markStage(this.services.db, job.runId, stage, 'running');
      await this.services.audit.record('run.stage_started', { runId: job.runId, subject: stage });

      const ctx: PipelineContext = {
        db: this.services.db,
        runId: job.runId,
        spec,
        claims: this.services.claims,
        evidence: this.services.evidence,
        audit: this.services.audit,
        budget,
        runHosts,
        discovery: runServices.discovery,
        siteEvidence: runServices.siteEvidence,
        email: runServices.email,
        judge: runServices.judge,
        logger: this.services.logger,
      };

      const result = await runStageHandler(ctx, stage);

      await markStage(this.services.db, job.runId, stage, result.status, result.detail, result.error);
      await updateRunUsage(this.services.db, job.runId, budget);
      await this.queue.complete(job.id);
      await this.services.audit.record('run.stage_completed', {
        runId: job.runId,
        subject: stage,
        detail: { status: result.status },
      });
      log.info('stage finished', { status: result.status });

      // A blocked stage ends the run with a real reason rather than continuing into empty stages.
      if (result.status === 'blocked') {
        await this.finish(job.runId, 'failed', result.error ?? 'stage blocked');
        return true;
      }

      if (budget.isExhausted()) {
        await this.finish(job.runId, 'budget_exhausted', `budget limit reached: ${budget.exhaustedLimit()}`);
        return true;
      }

      const following = nextStage(stage);
      if (following) {
        await this.queue.enqueue({ runId: job.runId, stage: following });
      } else {
        const stages = await this.services.db
          .select()
          .from(runStageTable)
          .where(eq(runStageTable.runId, job.runId));
        const anyPartial = stages.some((s) => s.status === 'partial' || s.status === 'failed');
        await this.finish(job.runId, anyPartial ? 'partial' : 'completed', null);
      }

      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('stage threw', { error: message });

      if (error instanceof BudgetExceededError) {
        await markStage(this.services.db, job.runId, stage, 'skipped', { limit: error.limit }, message);
        await this.queue.complete(job.id);
        await this.finish(job.runId, 'budget_exhausted', message);
        return true;
      }

      const { willRetry } = await this.queue.fail(job.id, message);
      await markStage(
        this.services.db,
        job.runId,
        stage,
        willRetry ? 'pending' : 'failed',
        { attempts: job.attempts },
        message,
      );
      await this.services.audit.record('run.stage_failed', {
        runId: job.runId,
        subject: stage,
        detail: { error: message, willRetry },
      });

      if (!willRetry) await this.finish(job.runId, 'failed', message);
      return true;
    }
  }

  /** Drains the queue. Used by the worker loop and by integration tests. */
  async drain(maxJobs = 100): Promise<number> {
    let processed = 0;
    while (processed < maxJobs) {
      const did = await this.tick();
      if (!did) break;
      processed += 1;
    }
    return processed;
  }

  async cancel(runId: string): Promise<void> {
    await this.queue.cancelRun(runId);
    await this.finish(runId, 'cancelled', 'cancelled by user');
    await this.services.audit.record('run.cancelled', { runId });
  }

  private async finish(runId: string, status: RunStatus, error: string | null): Promise<void> {
    await this.services.db
      .update(runTable)
      .set({ status, error, finishedAt: new Date() })
      .where(eq(runTable.id, runId));

    const action =
      status === 'completed' ? 'run.completed' : status === 'budget_exhausted' ? 'run.budget_exhausted' : 'run.failed';
    await this.services.audit.record(action, { runId, detail: { status, error } });
  }

  /**
   * Rebuilds the run-scoped host allowlist from companies already discovered, so a resumed run can
   * still fetch the sites it legitimately found without re-running discovery.
   */
  private async hostsFor(runId: string): Promise<RunHostAllowlist> {
    const cached = this.hostCache.get(runId);
    if (cached) return cached;

    const allowlist = createRunHostAllowlist();
    const rows = await this.services.db
      .select({ domain: companyTable.primaryDomain })
      .from(companyTable)
      .where(and(eq(companyTable.runId, runId), isNotNull(companyTable.primaryDomain)));
    for (const row of rows) {
      if (row.domain) allowlist.permit(row.domain);
    }

    this.hostCache.set(runId, allowlist);
    return allowlist;
  }

  private async loadSpec(db: Db, specId: string): Promise<LeadSpec> {
    const rows = await db.select().from(leadSpecTable).where(eq(leadSpecTable.id, specId)).limit(1);
    const row = rows[0];
    if (!row) throw new Error(`lead spec ${specId} not found`);

    const parsed = parseLeadSpec(row.spec);
    if (!parsed.ok) throw new Error(`stored lead spec is invalid: ${parsed.problems.join('; ')}`);
    return parsed.spec;
  }
}
