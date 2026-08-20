import { and, eq, inArray } from 'drizzle-orm';
import {
  newId,
  type Claim,
  type ClaimInput,
  type EvidenceRecord,
  type EvidenceSpan,
  type FieldView,
  type SubjectType,
} from '@leadmoor/core';
import { AuditLog, claim as claimTable, conflict as conflictTable, type Db } from '@leadmoor/db';
import type { EvidenceStore, ProvenanceValidator } from '@leadmoor/evidence';
import type { SourceRegistry } from '@leadmoor/policy';

/**
 * ClaimEngine — the write path for every fact in the system.
 *
 * Nothing else may insert into `claim`. Every value arrives here, is validated against stored
 * evidence, and is persisted with its status: `supported`, `insufficient_evidence`, or `rejected`.
 * Rejections are kept rather than dropped — an audit needs to show what the system refused.
 */
export class ClaimEngine {
  constructor(
    private readonly db: Db,
    private readonly validator: ProvenanceValidator,
    private readonly evidence: EvidenceStore,
    private readonly sources: SourceRegistry,
    private readonly audit: AuditLog,
    /** Stamped on every claim so facts are workspace-scoped like the entities they describe. */
    private readonly workspaceId: string | null = null,
  ) {}

  forWorkspace(workspaceId: string): ClaimEngine {
    return new ClaimEngine(
      this.db,
      this.validator,
      this.evidence,
      this.sources,
      this.audit.forWorkspace(workspaceId),
      workspaceId,
    );
  }

  /** Validate and persist. Returns the stored claim, whatever its status. */
  async createClaim(input: ClaimInput): Promise<Claim> {
    const { claim } = await this.validator.toClaim(input);

    await this.db.insert(claimTable).values({
      id: claim.id,
      runId: claim.runId,
      workspaceId: this.workspaceId,
      subjectType: claim.subjectType,
      subjectId: claim.subjectId,
      field: claim.field,
      fieldClass: claim.fieldClass,
      value: claim.value === undefined ? null : (claim.value as never),
      spans: claim.spans as never,
      sourceId: claim.sourceId,
      extractor: claim.extractor,
      confidence: claim.confidence,
      status: claim.status,
      note: claim.note,
      observedAt: claim.observedAt,
    });

    if (claim.status === 'supported') {
      await this.audit.record('claim.created', {
        runId: claim.runId,
        subject: `${claim.subjectType}:${claim.subjectId}`,
        detail: { field: claim.field, sourceId: claim.sourceId, spans: claim.spans.length },
      });
    } else if (claim.status === 'rejected') {
      await this.audit.record('claim.rejected', {
        runId: claim.runId,
        subject: `${claim.subjectType}:${claim.subjectId}`,
        detail: { field: claim.field, sourceId: claim.sourceId, reason: claim.note },
      });
    } else {
      await this.audit.record('claim.insufficient_evidence', {
        runId: claim.runId,
        subject: `${claim.subjectType}:${claim.subjectId}`,
        detail: { field: claim.field, sourceId: claim.sourceId, reason: claim.note },
      });
    }

    return claim;
  }

  async createMany(inputs: ClaimInput[]): Promise<Claim[]> {
    const out: Claim[] = [];
    for (const input of inputs) out.push(await this.createClaim(input));
    return out;
  }

  async getClaims(subjectType: SubjectType, subjectId: string, field?: string): Promise<Claim[]> {
    const where = field
      ? and(
          eq(claimTable.subjectType, subjectType),
          eq(claimTable.subjectId, subjectId),
          eq(claimTable.field, field),
        )
      : and(eq(claimTable.subjectType, subjectType), eq(claimTable.subjectId, subjectId));

    const rows = await this.db.select().from(claimTable).where(where);
    return rows.map(rowToClaim);
  }

  async getEvidenceForClaim(claimId: string): Promise<EvidenceRecord[]> {
    const rows = await this.db.select().from(claimTable).where(eq(claimTable.id, claimId)).limit(1);
    const row = rows[0];
    if (!row) return [];
    const spans = (row.spans ?? []) as EvidenceSpan[];
    const map = await this.evidence.getMany(spans.map((s) => s.evidenceId));
    return [...map.values()];
  }

  /**
   * Survivorship — ARCHITECTURE.md section 4: "the current value of a field is a view ... not a
   * stored truth". Conflicting supported claims coexist; this ranks them without deleting any.
   */
  async getFieldView<T = unknown>(
    subjectType: SubjectType,
    subjectId: string,
    field: string,
  ): Promise<FieldView<T>> {
    const all = await this.getClaims(subjectType, subjectId, field);
    const supported = all.filter((c) => c.status === 'supported');

    if (supported.length === 0) {
      return {
        field,
        value: null,
        winningClaimId: null,
        conflicting: false,
        candidates: [],
        supportingSourceCount: 0,
        confidence: 0,
      };
    }

    const ranked = [...supported].sort((a, b) => this.survivorshipScore(b) - this.survivorshipScore(a));
    const winner = ranked[0] as Claim;

    const winningKey = valueKey(winner.value);
    const agreeing = supported.filter((c) => valueKey(c.value) === winningKey);
    const conflicting = supported.some((c) => valueKey(c.value) !== winningKey);
    const sources = new Set(agreeing.map((c) => c.sourceId));

    // Corroboration raises confidence, capped so agreement never manufactures certainty.
    const corroboration = Math.min(1.3, 1 + 0.15 * (sources.size - 1));
    const confidence = Math.min(0.99, winner.confidence * corroboration);

    return {
      field,
      value: winner.value as T,
      winningClaimId: winner.id,
      conflicting,
      candidates: ranked,
      supportingSourceCount: sources.size,
      confidence,
    };
  }

  /** Persist a conflict so the dossier can show it rather than hiding the disagreement. */
  async recordConflict(
    subjectType: SubjectType,
    subjectId: string,
    field: string,
    runId: string | null,
  ): Promise<boolean> {
    const view = await this.getFieldView(subjectType, subjectId, field);
    if (!view.conflicting) return false;

    await this.db.insert(conflictTable).values({
      id: newId(),
      runId,
      subjectType,
      subjectId,
      field,
      claimIds: view.candidates.map((c) => c.id) as never,
      winningClaimId: view.winningClaimId,
      rule: 'trust_tier x recency x confidence x corroboration',
    });
    await this.audit.record('conflict.recorded', {
      runId,
      subject: `${subjectType}:${subjectId}`,
      detail: { field, claims: view.candidates.length, winner: view.winningClaimId },
    });
    return true;
  }

  async listConflicts(runId: string) {
    return this.db.select().from(conflictTable).where(eq(conflictTable.runId, runId));
  }

  /** Best supported claim for a field, or null when nothing is supported. */
  async getBestSupportedClaim(subjectType: SubjectType, subjectId: string, field: string): Promise<Claim | null> {
    const view = await this.getFieldView(subjectType, subjectId, field);
    if (!view.winningClaimId) return null;
    return view.candidates.find((c) => c.id === view.winningClaimId) ?? null;
  }

  /** Load every claim for a set of subjects in one query. */
  async getClaimsForSubjects(subjectType: SubjectType, subjectIds: string[]): Promise<Map<string, Claim[]>> {
    const out = new Map<string, Claim[]>();
    if (subjectIds.length === 0) return out;

    const rows = await this.db
      .select()
      .from(claimTable)
      .where(and(eq(claimTable.subjectType, subjectType), inArray(claimTable.subjectId, subjectIds)));

    for (const row of rows) {
      const claim = rowToClaim(row);
      const list = out.get(claim.subjectId);
      if (list) list.push(claim);
      else out.set(claim.subjectId, [claim]);
    }
    return out;
  }

  /** trust tier x recency x confidence. Open registries beat scraped pages at equal recency. */
  private survivorshipScore(claim: Claim): number {
    const manifest = this.sources.get(claim.sourceId);
    const trust = (manifest?.trustTier ?? 1) / 10;
    const ageDays = Math.max(0, (Date.now() - claim.observedAt.getTime()) / 86_400_000);
    const recency = 1 / (1 + ageDays / 180);
    return trust * 0.5 + recency * 0.2 + claim.confidence * 0.3;
  }
}

const NULL_KEY = '<null>';

function valueKey(value: unknown): string {
  if (value === null || value === undefined) return NULL_KEY;
  if (typeof value === 'string') return value.trim().toLowerCase();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function rowToClaim(row: typeof claimTable.$inferSelect): Claim {
  return {
    id: row.id,
    runId: row.runId,
    subjectType: row.subjectType as SubjectType,
    subjectId: row.subjectId,
    field: row.field,
    fieldClass: row.fieldClass as Claim['fieldClass'],
    value: row.value,
    spans: (row.spans ?? []) as EvidenceSpan[],
    sourceId: row.sourceId,
    extractor: row.extractor as Claim['extractor'],
    confidence: row.confidence,
    status: row.status as Claim['status'],
    observedAt: row.observedAt,
    createdAt: row.createdAt,
    note: row.note,
  };
}
