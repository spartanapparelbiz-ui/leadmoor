import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BudgetExceededError } from '@leadmoor/core';
import { BudgetGovernor, JobQueue, backoffMs, STAGE_ORDER, nextStage } from '@leadmoor/runtime';
import { openTestDb, seedRun, type TestDb } from '../helpers/db.js';
import { testSpec } from '../helpers/harness.js';

const budgetOf = (over: Partial<ReturnType<typeof testSpec>['budget']> = {}) => ({
  ...testSpec().budget,
  ...over,
});

describe('BudgetGovernor', () => {
  it('consumes until the ceiling and then refuses', () => {
    const b = new BudgetGovernor(budgetOf({ maxCompanies: 3 }));
    expect(b.tryConsume('companies')).toBe(true);
    expect(b.tryConsume('companies')).toBe(true);
    expect(b.tryConsume('companies')).toBe(true);
    expect(b.tryConsume('companies')).toBe(false);
    expect(b.isExhausted()).toBe(true);
    expect(b.exhaustedLimit()).toBe('maxCompanies');
  });

  it('does not partially consume past a ceiling', () => {
    const b = new BudgetGovernor(budgetOf({ maxDocuments: 5 }));
    expect(b.tryConsume('documents', 4)).toBe(true);
    expect(b.tryConsume('documents', 4)).toBe(false);
    expect(b.usage().documents).toBe(4);
  });

  it('stops on elapsed runtime', () => {
    let now = 1_000_000;
    const b = new BudgetGovernor(budgetOf({ maxRuntimeMs: 5000 }), now, () => now);
    expect(b.tryConsume('companies')).toBe(true);
    now += 6000;
    expect(b.tryConsume('companies')).toBe(false);
    expect(b.exhaustedLimit()).toBe('maxRuntimeMs');
  });

  it('throws a typed error from the throwing variant', () => {
    const b = new BudgetGovernor(budgetOf({ maxModelCalls: 1 }));
    b.consumeOrThrow('modelCalls');
    expect(() => b.consumeOrThrow('modelCalls')).toThrow(BudgetExceededError);
  });

  it('restores counters so a resumed run does not get a fresh allowance', () => {
    const b = new BudgetGovernor(budgetOf({ maxCompanies: 10 }));
    b.restore({ companies: 9 });
    expect(b.tryConsume('companies')).toBe(true);
    expect(b.tryConsume('companies')).toBe(false);
  });

  it('reports remaining headroom for display', () => {
    const b = new BudgetGovernor(budgetOf({ maxCompanies: 10 }));
    b.tryConsume('companies', 4);
    expect(b.remaining().companies).toBe(6);
  });
});

describe('backoff', () => {
  it('grows exponentially and is capped', () => {
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(2)).toBe(2000);
    expect(backoffMs(3)).toBe(4000);
    expect(backoffMs(20)).toBe(60_000);
  });
});

describe('stage ordering', () => {
  it('walks every stage exactly once and terminates', () => {
    const seen: string[] = [];
    let stage: string | null = STAGE_ORDER[0]!;
    while (stage) {
      seen.push(stage);
      stage = nextStage(stage as never);
    }
    expect(seen).toEqual([...STAGE_ORDER]);
  });
});

describe('JobQueue', () => {
  let tdb: TestDb;
  let runId: string;

  beforeAll(async () => {
    tdb = await openTestDb();
  });
  afterAll(async () => {
    await tdb.close();
  });
  beforeEach(async () => {
    await tdb.truncate();
    runId = (await seedRun(tdb.db)).runId;
  });

  it('claims a queued job exactly once', async () => {
    const q = new JobQueue(tdb.db, 'w1');
    await q.enqueue({ runId, stage: 'discovery' });

    const first = await q.claim();
    const second = await q.claim();
    expect(first?.stage).toBe('discovery');
    expect(first?.attempts).toBe(1);
    expect(second).toBeNull();
  });

  it('retries with backoff while attempts remain, then fails', async () => {
    let now = new Date('2026-01-01T00:00:00Z');
    const q = new JobQueue(tdb.db, 'w1', () => now);
    await q.enqueue({ runId, stage: 'discovery', maxAttempts: 2 });

    const job = await q.claim();
    expect(job).not.toBeNull();

    const first = await q.fail(job!.id, 'transient network error');
    expect(first.willRetry).toBe(true);

    // Not yet due — backoff must actually delay the retry.
    expect(await q.claim()).toBeNull();

    now = new Date(now.getTime() + 5000);
    const retried = await q.claim();
    expect(retried?.attempts).toBe(2);

    const second = await q.fail(retried!.id, 'still failing');
    expect(second.willRetry).toBe(false);

    now = new Date(now.getTime() + 120_000);
    expect(await q.claim()).toBeNull();
  });

  it('reclaims a job whose worker died mid-stage', async () => {
    let now = new Date('2026-01-01T00:00:00Z');
    const dying = new JobQueue(tdb.db, 'worker-that-dies', () => now);
    await dying.enqueue({ runId, stage: 'discovery' });

    const claimed = await dying.claim();
    expect(claimed).not.toBeNull();

    // The worker never completes. Another worker picks it up after the lease expires.
    now = new Date(now.getTime() + 6 * 60 * 1000);
    const rescuer = new JobQueue(tdb.db, 'worker-that-lives', () => now);
    const rescued = await rescuer.claim();

    expect(rescued?.id).toBe(claimed!.id);
    expect(rescued?.attempts).toBe(2);
  });

  it('cancels every outstanding job for a run', async () => {
    const q = new JobQueue(tdb.db, 'w1');
    await q.enqueue({ runId, stage: 'discovery' });
    await q.enqueue({ runId, stage: 'scoring' });

    expect(await q.pendingForRun(runId)).toBe(2);
    expect(await q.cancelRun(runId)).toBe(2);
    expect(await q.pendingForRun(runId)).toBe(0);
    expect(await q.claim()).toBeNull();
  });

  it('honors a scheduled delay', async () => {
    let now = new Date('2026-01-01T00:00:00Z');
    const q = new JobQueue(tdb.db, 'w1', () => now);
    await q.enqueue({ runId, stage: 'discovery', delayMs: 30_000 });

    expect(await q.claim()).toBeNull();
    now = new Date(now.getTime() + 31_000);
    expect(await q.claim()).not.toBeNull();
  });

  it('reclaims expired leases in bulk on worker boot', async () => {
    let now = new Date('2026-01-01T00:00:00Z');
    const q = new JobQueue(tdb.db, 'w1', () => now);
    await q.enqueue({ runId, stage: 'discovery' });
    await q.claim();

    now = new Date(now.getTime() + 10 * 60 * 1000);
    const boot = new JobQueue(tdb.db, 'w2', () => now);
    expect(await boot.reclaimExpired()).toBe(1);
  });
});
