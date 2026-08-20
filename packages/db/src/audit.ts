import { desc, eq } from 'drizzle-orm';
import { newId, redact } from '@leadmoor/core';
import type { Db } from './client.js';
import { auditLog } from './schema.js';

/**
 * Append-only audit trail — ARCHITECTURE.md §8 ("demonstrable compliance").
 *
 * Records what the system did *and what it refused to do*: a policy denial is as important to
 * retain as a successful fetch. Details pass through the same redaction as the logger, so a
 * credential can never reach the audit table.
 */
export const AUDIT_ACTIONS = [
  'request.created',
  'spec.compiled',
  'spec.edited',
  'spec.approved',
  'run.created',
  'run.started',
  'run.stage_started',
  'run.stage_completed',
  'run.stage_failed',
  'run.completed',
  'run.failed',
  'run.budget_exhausted',
  'run.cancelled',
  'connector.used',
  'fetch.attempted',
  'fetch.denied',
  'fetch.failed',
  'document.retrieved',
  'claim.created',
  'claim.rejected',
  'claim.insufficient_evidence',
  'conflict.recorded',
  'person.discovered',
  'email.resolved',
  'email.unavailable',
  'score.generated',
  'lead.suppressed',
  'lead.unsuppressed',
  'lead.exported',
  'record.deleted',
  'provider.unavailable',
  'provider.not_configured',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export class AuditLog {
  constructor(
    private readonly db: Db,
    private readonly workspaceId: string | null = null,
  ) {}

  /** An audit log bound to a workspace. Entries it writes are visible only inside it. */
  forWorkspace(workspaceId: string): AuditLog {
    return new AuditLog(this.db, workspaceId);
  }

  async record(
    action: AuditAction,
    opts: { runId?: string | null; subject?: string | null; detail?: Record<string, unknown> } = {},
  ): Promise<void> {
    await this.db.insert(auditLog).values({
      id: newId(),
      workspaceId: this.workspaceId,
      runId: opts.runId ?? null,
      action,
      subject: opts.subject ?? null,
      detail: (redact(opts.detail ?? {}) as Record<string, unknown>) ?? {},
    });
  }

  async forRun(runId: string, limit = 500) {
    return this.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.runId, runId))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit);
  }
}
