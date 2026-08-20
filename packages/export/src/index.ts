import { and, eq, isNull } from 'drizzle-orm';
import { newId, suppressionKey, type EmailStatus, type EvidenceSpan } from '@leadmoor/core';
import {
  AuditLog,
  claim as claimTable,
  company as companyTable,
  criterionVerdict as verdictTable,
  deletionRequest as deletionRequestTable,
  evidence as evidenceTable,
  exportRecord as exportTable,
  lead as leadTable,
  person as personTable,
  personIdentifier as personIdentifierTable,
  suppression as suppressionTable,
  type Db,
} from '@leadmoor/db';
import type { PolicyEngine } from '@leadmoor/policy';

/**
 * Export, suppression, and deletion.
 *
 * The export gate (ARCHITECTURE.md section 2.3, gate 3) runs here: a field is written only if the
 * source that produced it permits redistribution. Suppressed records never leave the system, and
 * an email is only ever exported with the status the evidence actually supports.
 */

export interface ExportRow {
  company: string;
  domain: string;
  person: string;
  role: string;
  email: string;
  email_status: EmailStatus;
  score: string;
  coverage: string;
  status: string;
  why_fit: string;
  evidence_count: string;
  source_urls: string;
}

export const EXPORT_COLUMNS: Array<keyof ExportRow> = [
  'company',
  'domain',
  'person',
  'role',
  'email',
  'email_status',
  'score',
  'coverage',
  'status',
  'why_fit',
  'evidence_count',
  'source_urls',
];

export interface ExportResult {
  rows: ExportRow[];
  csv: string;
  suppressedCount: number;
  withheldFields: string[];
  exportId: string;
}

export class ExportService {
  constructor(
    private readonly db: Db,
    private readonly policy: PolicyEngine,
    private readonly audit: AuditLog,
  ) {}

  /**
   * Build the export for a run.
   *
   * Only leads that are not suppressed and not deleted are included. Every value is checked against
   * its source's redistribution terms before it is written; a field the source forbids exporting is
   * omitted from every row and reported in `withheldFields` rather than silently blanked.
   */
  async exportRun(runId: string, opts: { includeUnqualified?: boolean } = {}): Promise<ExportResult> {
    const suppressedKeys = new Set(
      (await this.db.select({ key: suppressionTable.key }).from(suppressionTable)).map((r) => r.key),
    );

    const leads = await this.db
      .select()
      .from(leadTable)
      .where(and(eq(leadTable.runId, runId), isNull(leadTable.suppressedAt)));

    const rows: ExportRow[] = [];
    const withheld = new Set<string>();
    let suppressedCount = (
      await this.db.select({ id: leadTable.id }).from(leadTable).where(eq(leadTable.runId, runId))
    ).length - leads.length;

    for (const lead of leads) {
      if (!opts.includeUnqualified && lead.status !== 'qualified') continue;

      const company = (
        await this.db.select().from(companyTable).where(eq(companyTable.id, lead.companyId)).limit(1)
      )[0];
      if (!company) continue;

      // Suppression is hash-keyed, so a suppressed domain or person is excluded without us needing
      // to store the raw identifier anywhere.
      const domainKey = suppressionKey('domain', company.primaryDomain ?? company.canonicalName);
      if (suppressedKeys.has(domainKey)) {
        suppressedCount += 1;
        continue;
      }

      const person = lead.personId
        ? (await this.db.select().from(personTable).where(eq(personTable.id, lead.personId)).limit(1))[0]
        : undefined;

      if (person) {
        const personKey = suppressionKey('person', `${company.id}:${person.normalizedName}`);
        if (suppressedKeys.has(personKey)) {
          suppressedCount += 1;
          continue;
        }
      }

      if (lead.email && suppressedKeys.has(suppressionKey('email', lead.email))) {
        suppressedCount += 1;
        continue;
      }

      const claims = await this.db
        .select()
        .from(claimTable)
        .where(and(eq(claimTable.subjectType, 'company'), eq(claimTable.subjectId, company.id)));

      const roleClaim = person
        ? (
            await this.db
              .select()
              .from(claimTable)
              .where(
                and(
                  eq(claimTable.subjectType, 'person'),
                  eq(claimTable.subjectId, person.id),
                  eq(claimTable.field, 'person.role'),
                ),
              )
              .limit(1)
          )[0]
        : undefined;

      const verdicts = await this.db
        .select()
        .from(verdictTable)
        .where(and(eq(verdictTable.runId, runId), eq(verdictTable.subjectId, company.id)));

      const evidenceIds = new Set<string>();
      for (const verdict of verdicts) {
        for (const span of (verdict.spans ?? []) as EvidenceSpan[]) evidenceIds.add(span.evidenceId);
      }
      for (const c of claims) {
        for (const span of (c.spans ?? []) as EvidenceSpan[]) evidenceIds.add(span.evidenceId);
      }

      const urls = await this.urlsFor([...evidenceIds]);

      // Gate 3: may each field leave the system, given the source that produced it?
      const emailExportable =
        lead.email !== null && lead.emailSourceId !== null
          ? this.policy.checkExport(lead.emailSourceId, 'person_work_email').allowed
          : true;
      if (!emailExportable) withheld.add('email');

      const roleExportable = roleClaim ? this.policy.checkExport(roleClaim.sourceId, 'person_role').allowed : true;
      if (!roleExportable) withheld.add('role');

      rows.push({
        company: company.canonicalName,
        domain: company.primaryDomain ?? '',
        person: person?.fullName ?? '',
        role: roleExportable ? ((roleClaim?.value as string | null) ?? '') : '',
        // An unverified address is exported as unverified, never promoted.
        email: emailExportable ? (lead.email ?? '') : '',
        email_status: lead.emailStatus as EmailStatus,
        score: String(Math.round(lead.score)),
        coverage: `${Math.round(lead.coverage * 100)}%`,
        status: lead.status,
        why_fit: lead.rationale,
        evidence_count: String(evidenceIds.size),
        source_urls: urls.join(' | '),
      });
    }

    const exportId = newId();
    await this.db.insert(exportTable).values({
      id: exportId,
      runId,
      format: 'csv',
      rowCount: rows.length,
      suppressedCount,
      withheldFields: [...withheld] as never,
    });
    await this.audit.record('lead.exported', {
      runId,
      detail: { rows: rows.length, suppressed: suppressedCount, withheld: [...withheld] },
    });

    return { rows, csv: toCsv(rows), suppressedCount, withheldFields: [...withheld], exportId };
  }

  private async urlsFor(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];
    const urls: string[] = [];
    for (const id of ids.slice(0, 12)) {
      const row = (await this.db.select().from(evidenceTable).where(eq(evidenceTable.id, id)).limit(1))[0];
      if (row) urls.push(row.url);
    }
    return [...new Set(urls)];
  }
}

/** RFC 4180 CSV. Values are quoted whenever they could otherwise break a row. */
export function toCsv(rows: ExportRow[]): string {
  const header = EXPORT_COLUMNS.join(',');
  const body = rows.map((row) => EXPORT_COLUMNS.map((col) => csvCell(row[col])).join(','));
  return [header, ...body].join('\n');
}

function csvCell(value: string): string {
  const s = value ?? '';
  // Neutralize spreadsheet formula injection while keeping the value readable.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}


/**
 * Records a suppression key.
 *
 * Idempotent, with one exception: a deletion request upgrades an existing entry's reason. A
 * deletion is a legal obligation and an auditor asking "why is this suppressed?" must see that,
 * not an earlier ad-hoc preference.
 */
async function upsertSuppression(
  db: Db,
  key: string,
  kind: string,
  reason: string,
): Promise<void> {
  const insert = db.insert(suppressionTable).values({ id: newId(), key, kind, reason });
  if (reason === 'deletion_request') {
    await insert.onConflictDoUpdate({ target: suppressionTable.key, set: { reason } });
  } else {
    await insert.onConflictDoNothing();
  }
}

/* ── suppression ──────────────────────────────────────────────────────── */

export class SuppressionService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditLog,
  ) {}

  /** Suppresses a lead by company domain and, when present, by person. Idempotent. */
  async suppressLead(leadId: string, reason = 'user_request'): Promise<{ keys: string[] }> {
    const lead = (await this.db.select().from(leadTable).where(eq(leadTable.id, leadId)).limit(1))[0];
    if (!lead) throw new Error(`lead ${leadId} not found`);

    const company = (
      await this.db.select().from(companyTable).where(eq(companyTable.id, lead.companyId)).limit(1)
    )[0];
    const person = lead.personId
      ? (await this.db.select().from(personTable).where(eq(personTable.id, lead.personId)).limit(1))[0]
      : undefined;

    const keys: string[] = [];
    if (company) keys.push(suppressionKey('domain', company.primaryDomain ?? company.canonicalName));
    if (person && company) keys.push(suppressionKey('person', `${company.id}:${person.normalizedName}`));
    if (lead.email) keys.push(suppressionKey('email', lead.email));

    for (const key of keys) {
      await upsertSuppression(this.db, key, key.split(':')[0] ?? 'domain', reason);
    }

    await this.db
      .update(leadTable)
      .set({ status: 'suppressed', suppressedAt: new Date() })
      .where(eq(leadTable.id, leadId));

    await this.audit.record('lead.suppressed', { runId: lead.runId, subject: leadId, detail: { reason, keys: keys.length } });
    return { keys };
  }

  async suppressCompany(companyId: string, reason = 'user_request'): Promise<void> {
    const company = (await this.db.select().from(companyTable).where(eq(companyTable.id, companyId)).limit(1))[0];
    if (!company) throw new Error(`company ${companyId} not found`);

    const key = suppressionKey('domain', company.primaryDomain ?? company.canonicalName);
    await upsertSuppression(this.db, key, 'domain', reason);

    await this.db
      .update(leadTable)
      .set({ status: 'suppressed', suppressedAt: new Date() })
      .where(eq(leadTable.companyId, companyId));

    await this.audit.record('lead.suppressed', { subject: companyId, detail: { reason, scope: 'company' } });
  }

  async suppressPerson(personId: string, reason = 'user_request'): Promise<void> {
    const person = (await this.db.select().from(personTable).where(eq(personTable.id, personId)).limit(1))[0];
    if (!person) throw new Error(`person ${personId} not found`);

    const key = suppressionKey('person', `${person.companyId}:${person.normalizedName}`);
    await upsertSuppression(this.db, key, 'person', reason);

    await this.db
      .update(leadTable)
      .set({ status: 'suppressed', suppressedAt: new Date() })
      .where(eq(leadTable.personId, personId));

    await this.audit.record('lead.suppressed', { subject: personId, detail: { reason, scope: 'person' } });
  }

  async isSuppressed(kind: 'email' | 'domain' | 'person', value: string): Promise<boolean> {
    const key = suppressionKey(kind, value);
    const rows = await this.db.select().from(suppressionTable).where(eq(suppressionTable.key, key)).limit(1);
    return rows.length > 0;
  }

  async list(): Promise<Array<{ key: string; kind: string; reason: string }>> {
    return this.db
      .select({ key: suppressionTable.key, kind: suppressionTable.kind, reason: suppressionTable.reason })
      .from(suppressionTable);
  }
}

/* ── deletion ─────────────────────────────────────────────────────────── */

export class DeletionService {
  constructor(
    private readonly db: Db,
    private readonly audit: AuditLog,
    private readonly suppression: SuppressionService,
  ) {}

  /**
   * Deletes a person and everything personal about them.
   *
   * Claims, identifiers, the person row, and any email on their leads are removed. The audit trail
   * and the suppression key survive — the key is a hash, so honoring the deletion in future runs
   * does not require retaining the identifier it was derived from.
   */
  async deletePerson(personId: string, requestedBy = 'local'): Promise<{
    claimsDeleted: number;
    leadsUpdated: number;
    identifiersDeleted: number;
  }> {
    const person = (await this.db.select().from(personTable).where(eq(personTable.id, personId)).limit(1))[0];
    if (!person) throw new Error(`person ${personId} not found`);

    const requestId = newId();
    await this.db.insert(deletionRequestTable).values({
      id: requestId,
      subjectType: 'person',
      subjectId: personId,
      requestedBy,
      status: 'processing',
    });

    // Suppress first, so a concurrent run cannot re-add them between delete and suppress.
    await this.suppression.suppressPerson(personId, 'deletion_request');

    const claimsDeleted = (
      await this.db
        .delete(claimTable)
        .where(and(eq(claimTable.subjectType, 'person'), eq(claimTable.subjectId, personId)))
        .returning({ id: claimTable.id })
    ).length;

    const identifiersDeleted = (
      await this.db
        .delete(personIdentifierTable)
        .where(eq(personIdentifierTable.personId, personId))
        .returning({ id: personIdentifierTable.id })
    ).length;

    // Leads keep their company and score but lose every personal field — no orphaned contact data.
    const leadsUpdated = (
      await this.db
        .update(leadTable)
        .set({ personId: null, email: null, emailSourceId: null, emailStatus: 'unavailable' })
        .where(eq(leadTable.personId, personId))
        .returning({ id: leadTable.id })
    ).length;

    await this.db.delete(personTable).where(eq(personTable.id, personId));

    await this.db
      .update(deletionRequestTable)
      .set({ status: 'completed', claimsDeleted, leadsDeleted: leadsUpdated, identifiersDeleted, completedAt: new Date() })
      .where(eq(deletionRequestTable.id, requestId));

    await this.audit.record('record.deleted', {
      subject: personId,
      detail: { type: 'person', claimsDeleted, identifiersDeleted, leadsUpdated, requestId },
    });

    return { claimsDeleted, leadsUpdated, identifiersDeleted };
  }

  /** Removes a company, its people, and every claim about any of them. */
  async deleteCompany(companyId: string, requestedBy = 'local'): Promise<{ peopleDeleted: number; claimsDeleted: number }> {
    const company = (await this.db.select().from(companyTable).where(eq(companyTable.id, companyId)).limit(1))[0];
    if (!company) throw new Error(`company ${companyId} not found`);

    const requestId = newId();
    await this.db.insert(deletionRequestTable).values({
      id: requestId,
      subjectType: 'company',
      subjectId: companyId,
      requestedBy,
      status: 'processing',
    });

    await this.suppression.suppressCompany(companyId, 'deletion_request');

    const people = await this.db.select().from(personTable).where(eq(personTable.companyId, companyId));
    let claimsDeleted = 0;
    for (const person of people) {
      const result = await this.deletePerson(person.id, requestedBy);
      claimsDeleted += result.claimsDeleted;
    }

    claimsDeleted += (
      await this.db
        .delete(claimTable)
        .where(and(eq(claimTable.subjectType, 'company'), eq(claimTable.subjectId, companyId)))
        .returning({ id: claimTable.id })
    ).length;

    await this.db.delete(companyTable).where(eq(companyTable.id, companyId));

    await this.db
      .update(deletionRequestTable)
      .set({ status: 'completed', claimsDeleted, completedAt: new Date() })
      .where(eq(deletionRequestTable.id, requestId));

    await this.audit.record('record.deleted', {
      subject: companyId,
      detail: { type: 'company', peopleDeleted: people.length, claimsDeleted, requestId },
    });

    return { peopleDeleted: people.length, claimsDeleted };
  }
}
