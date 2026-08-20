import { and, desc, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { Db } from './client.js';
import {
  auditLog,
  claim,
  company,
  criterionVerdict,
  evidence,
  exportRecord,
  fetchLog,
  lead,
  leadRequest,
  leadSpec,
  person,
  run,
  runStage,
  savedSearch,
  suppression,
} from './schema.js';

/**
 * WorkspaceScope — the read path for everything a workspace owns.
 *
 * Every method applies `workspace_id = $scope` in SQL. Application code never builds a query
 * against these tables directly, so there is no route through which a caller could omit the
 * predicate and see another workspace's rows. The scope is constructed only from an authenticated
 * context whose membership has already been verified.
 *
 * Rows created before workspaces existed carry a NULL workspace_id. They are visible to nobody
 * rather than to everybody — a null scope is a closed scope.
 */
export class WorkspaceScope {
  constructor(
    readonly db: Db,
    readonly workspaceId: string,
  ) {}

  /** The predicate every scoped query shares. */
  private owned(column: { workspaceId: unknown }): SQL {
    return eq(column.workspaceId as never, this.workspaceId);
  }

  /* ── searches ───────────────────────────────────────────────────────── */

  async listSpecs(limit = 50) {
    return this.db
      .select()
      .from(leadSpec)
      .where(this.owned(leadSpec))
      .orderBy(desc(leadSpec.createdAt))
      .limit(limit);
  }

  async getSpec(specId: string) {
    const rows = await this.db
      .select()
      .from(leadSpec)
      .where(and(eq(leadSpec.id, specId), this.owned(leadSpec)))
      .limit(1);
    return rows[0] ?? null;
  }

  async getRequest(requestId: string) {
    const rows = await this.db
      .select()
      .from(leadRequest)
      .where(and(eq(leadRequest.id, requestId), this.owned(leadRequest)))
      .limit(1);
    return rows[0] ?? null;
  }

  /* ── runs ───────────────────────────────────────────────────────────── */

  async listRuns(limit = 50) {
    return this.db.select().from(run).where(this.owned(run)).orderBy(desc(run.createdAt)).limit(limit);
  }

  async getRun(runId: string) {
    const rows = await this.db
      .select()
      .from(run)
      .where(and(eq(run.id, runId), this.owned(run)))
      .limit(1);
    return rows[0] ?? null;
  }

  async runForSpec(specId: string) {
    const rows = await this.db
      .select()
      .from(run)
      .where(and(eq(run.specId, specId), this.owned(run)))
      .orderBy(desc(run.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Stage rows for a run.
   *
   * `run_stage` has no workspace column of its own — it hangs off a run that does. Ownership is
   * therefore established on the parent first, and an unowned run id yields an empty list rather
   * than another tenant's pipeline.
   */
  async stagesFor(runId: string) {
    if (!(await this.getRun(runId))) return [];
    return this.db.select().from(runStage).where(eq(runStage.runId, runId)).orderBy(runStage.ordinal);
  }

  /** Live counters for the run screen. Every count is scoped, not just the run lookup. */
  async runCounters(runId: string): Promise<{
    companies: number;
    people: number;
    leads: number;
    documents: number;
    modelCalls: number;
  }> {
    const runRow = await this.getRun(runId);
    if (!runRow) return { companies: 0, people: 0, leads: 0, documents: 0, modelCalls: 0 };

    const usage = (runRow.usage ?? {}) as { documents?: number; modelCalls?: number };
    const [companies, people, leads, docs] = await Promise.all([
      this.db.select({ id: company.id }).from(company).where(and(eq(company.runId, runId), this.owned(company))),
      this.db.select({ id: person.id }).from(person).where(and(eq(person.runId, runId), this.owned(person))),
      this.db
        .select({ id: lead.id })
        .from(lead)
        .where(and(eq(lead.runId, runId), this.owned(lead), isNull(lead.suppressedAt))),
      this.db.select({ id: evidence.id }).from(evidence).where(and(eq(evidence.runId, runId), this.owned(evidence))),
    ]);

    return {
      companies: companies.length,
      people: people.length,
      leads: leads.length,
      documents: docs.length,
      modelCalls: Number(usage.modelCalls ?? 0),
    };
  }

  /* ── leads, companies, people ───────────────────────────────────────── */

  async listLeads(opts: { runId?: string; includeSuppressed?: boolean; limit?: number } = {}) {
    const clauses: SQL[] = [this.owned(lead)];
    if (opts.runId) clauses.push(eq(lead.runId, opts.runId));
    if (!opts.includeSuppressed) clauses.push(isNull(lead.suppressedAt));

    return this.db
      .select()
      .from(lead)
      .where(and(...clauses))
      .orderBy(desc(lead.score), desc(lead.coverage))
      .limit(opts.limit ?? 500);
  }

  async getLead(leadId: string) {
    const rows = await this.db
      .select()
      .from(lead)
      .where(and(eq(lead.id, leadId), this.owned(lead)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listCompanies(opts: { runId?: string; limit?: number } = {}) {
    const clauses: SQL[] = [this.owned(company)];
    if (opts.runId) clauses.push(eq(company.runId, opts.runId));
    return this.db
      .select()
      .from(company)
      .where(and(...clauses))
      .orderBy(desc(company.createdAt))
      .limit(opts.limit ?? 500);
  }

  async getCompany(companyId: string) {
    const rows = await this.db
      .select()
      .from(company)
      .where(and(eq(company.id, companyId), this.owned(company)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listPeople(opts: { runId?: string; companyId?: string; limit?: number } = {}) {
    const clauses: SQL[] = [this.owned(person)];
    if (opts.runId) clauses.push(eq(person.runId, opts.runId));
    if (opts.companyId) clauses.push(eq(person.companyId, opts.companyId));
    return this.db
      .select()
      .from(person)
      .where(and(...clauses))
      .orderBy(desc(person.createdAt))
      .limit(opts.limit ?? 500);
  }

  async getPerson(personId: string) {
    const rows = await this.db
      .select()
      .from(person)
      .where(and(eq(person.id, personId), this.owned(person)))
      .limit(1);
    return rows[0] ?? null;
  }

  /* ── evidence and claims ────────────────────────────────────────────── */

  async getEvidence(evidenceId: string) {
    const rows = await this.db
      .select()
      .from(evidence)
      .where(and(eq(evidence.id, evidenceId), this.owned(evidence)))
      .limit(1);
    return rows[0] ?? null;
  }

  async evidenceByIds(ids: string[]) {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(evidence)
      .where(and(inArray(evidence.id, ids), this.owned(evidence)));
  }

  async listEvidence(runId: string) {
    return this.db
      .select()
      .from(evidence)
      .where(and(eq(evidence.runId, runId), this.owned(evidence)));
  }

  async claimsFor(subjectType: 'company' | 'person', subjectId: string) {
    return this.db
      .select()
      .from(claim)
      .where(and(eq(claim.subjectType, subjectType), eq(claim.subjectId, subjectId), this.owned(claim)));
  }

  /**
   * Criterion verdicts for a run.
   *
   * Like `run_stage`, `criterion_verdict` hangs off a run rather than carrying its own workspace
   * column, so ownership is established on the run first.
   */
  async verdictsFor(runId: string, subjectId?: string) {
    if (!(await this.getRun(runId))) return [];
    const clauses: SQL[] = [eq(criterionVerdict.runId, runId)];
    if (subjectId) clauses.push(eq(criterionVerdict.subjectId, subjectId));
    return this.db
      .select()
      .from(criterionVerdict)
      .where(and(...clauses));
  }

  async listFetches(runId: string) {
    return this.db
      .select()
      .from(fetchLog)
      .where(and(eq(fetchLog.runId, runId), this.owned(fetchLog)));
  }

  /* ── compliance ─────────────────────────────────────────────────────── */

  async listSuppressions() {
    return this.db.select().from(suppression).where(this.owned(suppression));
  }

  async suppressionKeys(): Promise<Set<string>> {
    const rows = await this.db
      .select({ key: suppression.key })
      .from(suppression)
      .where(this.owned(suppression));
    return new Set(rows.map((r) => r.key));
  }

  async listExports(limit = 50) {
    return this.db
      .select()
      .from(exportRecord)
      .where(this.owned(exportRecord))
      .orderBy(desc(exportRecord.createdAt))
      .limit(limit);
  }

  async listAudit(opts: { runId?: string; limit?: number } = {}) {
    const clauses: SQL[] = [this.owned(auditLog)];
    if (opts.runId) clauses.push(eq(auditLog.runId, opts.runId));
    return this.db
      .select()
      .from(auditLog)
      .where(and(...clauses))
      .orderBy(desc(auditLog.createdAt))
      .limit(opts.limit ?? 400);
  }

  /* ── saved searches ─────────────────────────────────────────────────── */

  async listSavedSearches() {
    return this.db
      .select()
      .from(savedSearch)
      .where(this.owned(savedSearch))
      .orderBy(desc(savedSearch.createdAt));
  }

  async getSavedSearch(id: string) {
    const rows = await this.db
      .select()
      .from(savedSearch)
      .where(and(eq(savedSearch.id, id), this.owned(savedSearch)))
      .limit(1);
    return rows[0] ?? null;
  }

  /* ── aggregate counts for the shell and dashboards ──────────────────── */

  async counts(): Promise<{
    runs: number;
    leads: number;
    qualified: number;
    companies: number;
    people: number;
    savedSearches: number;
    verifiedEmails: number;
  }> {
    const one = async (table: 'run' | 'lead' | 'company' | 'person' | 'saved_search', extra = ''): Promise<number> => {
      const result = await this.db.execute(
        sql.raw(
          `SELECT count(*)::int AS n FROM ${table} WHERE workspace_id = '${escapeLiteral(this.workspaceId)}'${extra}`,
        ),
      );
      const rows = (Array.isArray(result) ? result : ((result as { rows?: unknown[] }).rows ?? [])) as Array<{
        n: number;
      }>;
      return Number(rows[0]?.n ?? 0);
    };

    return {
      runs: await one('run'),
      leads: await one('lead', ' AND suppressed_at IS NULL'),
      qualified: await one('lead', " AND status = 'qualified' AND suppressed_at IS NULL"),
      companies: await one('company'),
      people: await one('person'),
      savedSearches: await one('saved_search'),
      verifiedEmails: await one('lead', " AND email_status = 'verified' AND suppressed_at IS NULL"),
    };
  }
}

/**
 * The workspace id always originates from a verified session, never from user input — but this
 * function exists so the one place that interpolates it cannot be the place a mistake gets in.
 */
function escapeLiteral(value: string): string {
  if (!/^[A-Za-z0-9-]{1,64}$/.test(value)) throw new Error('invalid workspace id');
  return value;
}

/** Values every workspace-owned insert must carry. */
export function ownedBy(workspaceId: string): { workspaceId: string } {
  return { workspaceId };
}
