import { createLogger } from '@leadmoor/core';
import { RunEngine, Services } from '@leadmoor/runtime';

/**
 * The LeadMoor worker.
 *
 * Claims durable jobs and executes one pipeline stage each. Multiple workers can run safely — jobs
 * are claimed with FOR UPDATE SKIP LOCKED under a lease, so two workers never run the same stage
 * and a worker that dies has its jobs picked up by another once the lease expires.
 */

const logger = createLogger({ app: 'leadmoor-worker' });
const POLL_IDLE_MS = Number(process.env.WORKER_POLL_MS ?? 1500);

async function main(): Promise<void> {
  const services = new Services({
    databaseUrl: process.env.DATABASE_URL,
    evidenceDir: process.env.EVIDENCE_DIR ?? '.leadmoor/evidence',
    logger,
  });
  await services.migrate();

  const workerId = `worker-${process.pid}`;
  const engine = new RunEngine(services, workerId, logger);

  const reclaimed = await engine.jobs.reclaimExpired();
  if (reclaimed > 0) logger.info('reclaimed jobs from expired leases', { reclaimed });

  const status = services.providerStatus();
  logger.info('worker ready', {
    workerId,
    llmConfigured: status.llm.configured,
    credentialFreeSources: status.credentialFreeSources,
    missingCredentials: status.missingCredentials.map((m) => m.source),
  });

  let stopping = false;
  const stop = (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info('shutting down', { signal });
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));

  while (!stopping) {
    let worked = false;
    try {
      worked = await engine.tick();
    } catch (error) {
      // tick() handles stage failures itself; reaching here means the loop itself broke.
      logger.error('worker tick failed', { error: (error as Error).message });
    }
    if (!worked) await sleep(POLL_IDLE_MS);
  }

  await services.close();
  logger.info('stopped');
  process.exit(0);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  logger.error('worker failed to start', { error: (error as Error).message });
  process.exit(1);
});
