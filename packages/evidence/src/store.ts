import { and, eq, inArray } from 'drizzle-orm';
import { type Db, evidence as evidenceTable } from '@leadmoor/db';
import { newId, sha256, type EvidenceInput, type EvidenceRecord, type DocumentRole } from '@leadmoor/core';
import type { BlobStore } from './blob.js';

/**
 * EvidenceStore — persists retrieved documents and serves them back for citation validation.
 *
 * Built before the scoring layer on purpose: nothing may claim a fact until the document behind
 * it is stored and addressable.
 */
export class EvidenceStore {
  /** Per-instance cache so validating many citations against one document hits the DB once. */
  private readonly cache = new Map<string, EvidenceRecord>();

  constructor(
    private readonly db: Db,
    private readonly blobs: BlobStore,
  ) {}

  async put(input: EvidenceInput): Promise<EvidenceRecord> {
    const contentHash = sha256(input.rawBody);
    const id = newId();
    const fetchedAt = new Date();

    await this.blobs.put(contentHash, input.rawBody);

    const row = {
      id,
      runId: input.runId,
      sourceId: input.sourceId,
      url: input.url,
      title: input.title ?? null,
      documentRole: input.documentRole,
      httpStatus: input.httpStatus ?? null,
      contentHash,
      contentType: input.contentType ?? null,
      normalizedText: input.normalizedText,
      byteLength: Buffer.byteLength(input.rawBody, 'utf8'),
      robotsDecision: input.robotsDecision,
      metadata: input.metadata ?? {},
      fetchedAt,
    };
    await this.db.insert(evidenceTable).values(row);

    const record: EvidenceRecord = { ...row, documentRole: input.documentRole };
    this.cache.set(id, record);
    return record;
  }

  async get(id: string): Promise<EvidenceRecord | null> {
    const cached = this.cache.get(id);
    if (cached) return cached;

    const rows = await this.db.select().from(evidenceTable).where(eq(evidenceTable.id, id)).limit(1);
    const row = rows[0];
    if (!row) return null;

    const record = toRecord(row);
    this.cache.set(id, record);
    return record;
  }

  async getMany(ids: string[]): Promise<Map<string, EvidenceRecord>> {
    const out = new Map<string, EvidenceRecord>();
    const missing: string[] = [];
    for (const id of ids) {
      const cached = this.cache.get(id);
      if (cached) out.set(id, cached);
      else missing.push(id);
    }
    if (missing.length > 0) {
      const rows = await this.db.select().from(evidenceTable).where(inArray(evidenceTable.id, missing));
      for (const row of rows) {
        const record = toRecord(row);
        this.cache.set(record.id, record);
        out.set(record.id, record);
      }
    }
    return out;
  }

  async listForRun(runId: string, role?: DocumentRole): Promise<EvidenceRecord[]> {
    const where = role
      ? and(eq(evidenceTable.runId, runId), eq(evidenceTable.documentRole, role))
      : eq(evidenceTable.runId, runId);
    const rows = await this.db.select().from(evidenceTable).where(where);
    return rows.map(toRecord);
  }

  /** Re-read the original bytes. Proves a stored document has not drifted from its hash. */
  async rawBody(id: string): Promise<string | null> {
    const record = await this.get(id);
    if (!record) return null;
    return this.blobs.get(record.contentHash);
  }

  /** Confirms stored bytes still hash to the recorded value — the audit guarantee. */
  async verifyIntegrity(id: string): Promise<boolean> {
    const record = await this.get(id);
    if (!record) return false;
    const body = await this.blobs.get(record.contentHash);
    if (body === null) return false;
    return sha256(body) === record.contentHash;
  }
}

function toRecord(row: typeof evidenceTable.$inferSelect): EvidenceRecord {
  return {
    id: row.id,
    runId: row.runId,
    sourceId: row.sourceId,
    url: row.url,
    title: row.title,
    documentRole: row.documentRole as DocumentRole,
    httpStatus: row.httpStatus,
    contentHash: row.contentHash,
    contentType: row.contentType,
    normalizedText: row.normalizedText,
    byteLength: row.byteLength,
    fetchedAt: row.fetchedAt,
    robotsDecision: row.robotsDecision as 'allowed' | 'denied' | 'not_applicable',
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  };
}
