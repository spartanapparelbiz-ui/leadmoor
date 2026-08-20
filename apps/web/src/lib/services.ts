import 'server-only';
import { createLogger } from '@leadmoor/core';
import { AuditLog } from '@leadmoor/db';
import { PolicyEngine, SourceRegistry, createRunHostAllowlist } from '@leadmoor/policy';
import { DeletionService, ExportService, SuppressionService } from '@leadmoor/export';
import { RunEngine, Services } from '@leadmoor/runtime';

/**
 * Server-side service singleton.
 *
 * `server-only` makes this module a build error if it is ever imported from a client component,
 * which is what keeps provider credentials, the database URL, and retrieved page content out of
 * the browser bundle. Nothing here is exported to the client.
 */

declare global {
  // eslint-disable-next-line no-var
  var __leadmoorServices: Services | undefined;
  // eslint-disable-next-line no-var
  var __leadmoorReady: Promise<void> | undefined;
}

const logger = createLogger({ app: 'leadmoor-web' });

function build(): Services {
  return new Services({
    databaseUrl: process.env.DATABASE_URL,
    evidenceDir: process.env.EVIDENCE_DIR ?? '.leadmoor/evidence',
    logger,
  });
}

/** Reused across hot reloads in development so we do not leak connection pools. */
export function services(): Services {
  if (!globalThis.__leadmoorServices) globalThis.__leadmoorServices = build();
  return globalThis.__leadmoorServices;
}

/** Applies the schema once per process. Safe and idempotent. */
export async function ready(): Promise<Services> {
  const svc = services();
  if (!globalThis.__leadmoorReady) {
    globalThis.__leadmoorReady = svc.migrate().catch((error) => {
      globalThis.__leadmoorReady = undefined;
      throw error;
    });
  }
  await globalThis.__leadmoorReady;
  return svc;
}

export function engine(): RunEngine {
  return new RunEngine(services(), `web-${process.pid}`, logger);
}

export function audit(): AuditLog {
  return new AuditLog(services().db);
}

/** A policy engine for gate-3 export checks. No fetching happens through it. */
export function exportPolicy(): PolicyEngine {
  return new PolicyEngine(new SourceRegistry().asMap(), {
    userAgent: 'LeadMoor/0.1',
    runHosts: createRunHostAllowlist(),
  });
}

/*
 * The three data-handling services take a workspace id as a required argument rather than reading
 * one from ambient state. A caller that has not resolved a session cannot construct them at all,
 * which is why tenant isolation holds even if a route forgets to check something.
 */

export function exportService(workspaceId: string): ExportService {
  return new ExportService(services().db, exportPolicy(), audit().forWorkspace(workspaceId), workspaceId);
}

export function suppressionService(workspaceId: string): SuppressionService {
  return new SuppressionService(services().db, audit().forWorkspace(workspaceId), workspaceId);
}

export function deletionService(workspaceId: string): DeletionService {
  return new DeletionService(
    services().db,
    audit().forWorkspace(workspaceId),
    suppressionService(workspaceId),
    workspaceId,
  );
}

/**
 * Optional embedded worker.
 *
 * A dedicated worker process is the normal deployment. Small single-node installs can instead set
 * LEADMOOR_EMBEDDED_WORKER=1, which drains the same durable queue from the web process. It is the
 * identical RunEngine either way — this is a deployment topology, not a second code path.
 */
export function embeddedWorkerEnabled(): boolean {
  return process.env.LEADMOOR_EMBEDDED_WORKER === '1';
}

let embeddedRunning = false;

export async function pumpEmbeddedWorker(maxJobs = 4): Promise<number> {
  if (!embeddedWorkerEnabled() || embeddedRunning) return 0;
  embeddedRunning = true;
  try {
    return await engine().drain(maxJobs);
  } catch (error) {
    logger.error('embedded worker failed', { error: (error as Error).message });
    return 0;
  } finally {
    embeddedRunning = false;
  }
}

/** What the UI shows on the provider status strip. Never includes a credential value. */
export function providerStatus() {
  return services().providerStatus();
}
