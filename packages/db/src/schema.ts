import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * LeadMoor schema. Mirrors ARCHITECTURE.md §9.
 *
 * The load-bearing table is `claim`: factual values live there with provenance, not as mutable
 * columns on `company` / `person`. Those two tables carry identity only.
 */

const id = () => text('id').primaryKey();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();


/* ── identity and workspaces ──────────────────────────────────────────── */

export const appUser = pgTable(
  'app_user',
  {
    id: id(),
    email: text('email').notNull(),
    /** Lower-cased copy carrying the uniqueness constraint, so logins are case-insensitive. */
    emailLower: text('email_lower').notNull(),
    name: text('name').notNull().default(''),
    /** scrypt: salt:derivedKey. The plaintext never leaves the request that created it. */
    passwordHash: text('password_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => ({ uniq: uniqueIndex('app_user_email_uniq').on(t.emailLower) }),
);

export const workspace = pgTable(
  'workspace',
  {
    id: id(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    createdBy: text('created_by').references(() => appUser.id, { onDelete: 'set null' }),
    settings: jsonb('settings').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => ({ uniq: uniqueIndex('workspace_slug_uniq').on(t.slug) }),
);

export const workspaceMember = pgTable(
  'workspace_member',
  {
    id: id(),
    workspaceId: text('workspace_id').notNull().references(() => workspace.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
    /** owner | admin | member */
    role: text('role').notNull().default('member'),
    createdAt: createdAt(),
  },
  (t) => ({
    uniq: uniqueIndex('workspace_member_uniq').on(t.workspaceId, t.userId),
    byUser: index('workspace_member_user_idx').on(t.userId),
  }),
);

export const userSession = pgTable(
  'user_session',
  {
    id: id(),
    /** sha256 of the cookie value. The raw token is never stored. */
    tokenHash: text('token_hash').notNull(),
    userId: text('user_id').notNull().references(() => appUser.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'set null' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => ({
    uniq: uniqueIndex('user_session_token_uniq').on(t.tokenHash),
    byUser: index('user_session_user_idx').on(t.userId),
  }),
);

export const savedSearch = pgTable(
  'saved_search',
  {
    id: id(),
    workspaceId: text('workspace_id').notNull().references(() => workspace.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    spec: jsonb('spec').notNull(),
    sourceRequest: text('source_request').notNull().default(''),
    createdBy: text('created_by').references(() => appUser.id, { onDelete: 'set null' }),
    lastRunId: text('last_run_id'),
    lastRunAt: timestamp('last_run_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => ({ byWorkspace: index('saved_search_ws_idx').on(t.workspaceId, t.createdAt) }),
);

/* ── request → spec → run ─────────────────────────────────────────────── */


export const leadRequest = pgTable('lead_request', {
  id: id(),
  workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
  rawText: text('raw_text').notNull(),
  createdBy: text('created_by').notNull().default('local'),
  createdAt: createdAt(),
});

export const leadSpec = pgTable(
  'lead_spec',
  {
    id: id(),
    requestId: text('request_id').notNull().references(() => leadRequest.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    version: integer('version').notNull().default(1),
    /** The typed LeadSpec document. Validated by Zod on every read and write. */
    spec: jsonb('spec').notNull(),
    /** How this version came about: 'compiled' by the LLM, or 'edited' by the user. */
    origin: text('origin').notNull().default('compiled'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => ({ byRequest: index('lead_spec_request_idx').on(t.requestId, t.version) }),
);

export const run = pgTable(
  'run',
  {
    id: id(),
    specId: text('spec_id').notNull().references(() => leadSpec.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    status: text('status').notNull().default('queued'),
    /**
     * True only for runs created by the demo seeder. Production code never sets this, and the UI
     * labels every demo run, so demo output can never be mistaken for a real search.
     */
    isDemo: boolean('is_demo').notNull().default(false),
    /** Budget counters, checked before every expensive operation. */
    usage: jsonb('usage').notNull().default({}),
    stats: jsonb('stats').notNull().default({}),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => ({ byStatus: index('run_status_idx').on(t.status) }),
);

export const runStage = pgTable(
  'run_stage',
  {
    id: id(),
    runId: text('run_id').notNull().references(() => run.id, { onDelete: 'cascade' }),
    stage: text('stage').notNull(),
    ordinal: integer('ordinal').notNull(),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    detail: jsonb('detail').notNull().default({}),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => ({ uniq: uniqueIndex('run_stage_uniq').on(t.runId, t.stage) }),
);

/**
 * Durable job queue. The RunEngine port's Postgres adapter claims rows with
 * SELECT ... FOR UPDATE SKIP LOCKED, so a crashed worker's lease expires and the job is retried
 * rather than lost.
 */
export const job = pgTable(
  'job',
  {
    id: id(),
    runId: text('run_id').notNull().references(() => run.id, { onDelete: 'cascade' }),
    stage: text('stage').notNull(),
    status: text('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    leasedUntil: timestamp('leased_until', { withTimezone: true }),
    leasedBy: text('leased_by'),
    lastError: text('last_error'),
    payload: jsonb('payload').notNull().default({}),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    claimable: index('job_claimable_idx').on(t.status, t.runAfter),
    byRun: index('job_run_idx').on(t.runId),
  }),
);

/* ── sources, fetches, evidence ───────────────────────────────────────── */

/** Registry snapshot. The in-code manifest is authoritative; this row records what was used. */
export const source = pgTable('source', {
  id: id(),
  name: text('name').notNull(),
  tier: text('tier').notNull(),
  accessMode: text('access_mode').notNull(),
  manifest: jsonb('manifest').notNull(),
  trustTier: integer('trust_tier').notNull().default(1),
  createdAt: createdAt(),
});

export const fetchLog = pgTable(
  'fetch_log',
  {
    id: id(),
    runId: text('run_id').references(() => run.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').notNull(),
    url: text('url').notNull(),
    method: text('method').notNull().default('GET'),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    httpStatus: integer('http_status'),
    robotsDecision: text('robots_decision').notNull().default('not_applicable'),
    denialReason: text('denial_reason'),
    durationMs: integer('duration_ms'),
    evidenceId: text('evidence_id'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byRun: index('fetch_run_idx').on(t.runId), byUrl: index('fetch_url_idx').on(t.url) }),
);

/** Content-addressed snapshot. `contentHash` is sha256 of the raw body. */
export const evidence = pgTable(
  'evidence',
  {
    id: id(),
    runId: text('run_id').references(() => run.id, { onDelete: 'cascade' }),
    sourceId: text('source_id').notNull(),
    url: text('url').notNull(),
    title: text('title'),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    documentRole: text('document_role').notNull().default('other'),
    httpStatus: integer('http_status'),
    contentHash: text('content_hash').notNull(),
    contentType: text('content_type'),
    /** Normalized text. Every EvidenceSpan offset indexes into this exact string. */
    normalizedText: text('normalized_text').notNull(),
    byteLength: integer('byte_length').notNull().default(0),
    robotsDecision: text('robots_decision').notNull().default('not_applicable'),
    metadata: jsonb('metadata').notNull().default({}),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byHash: index('evidence_hash_idx').on(t.contentHash),
    byRun: index('evidence_run_idx').on(t.runId),
  }),
);

/* ── entities (identity only — facts live in `claim`) ─────────────────── */

export const company = pgTable(
  'company',
  {
    id: id(),
    runId: text('run_id').references(() => run.id, { onDelete: 'cascade' }),
    /** Display name. Identity, not a fact claim. */
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    canonicalName: text('canonical_name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    /** Identity spine, per §6. Nullable until a domain is verified. */
    primaryDomain: text('primary_domain'),
    country: text('country'),
    createdAt: createdAt(),
  },
  (t) => ({
    byDomain: index('company_domain_idx').on(t.runId, t.primaryDomain),
    byNorm: index('company_norm_idx').on(t.runId, t.normalizedName),
  }),
);

export const companyIdentifier = pgTable(
  'company_identifier',
  {
    id: id(),
    companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
    /** domain | lei | cik | ticker | github_org */
    kind: text('kind').notNull(),
    value: text('value').notNull(),
    strength: text('strength').notNull().default('medium'),
    sourceId: text('source_id').notNull(),
  },
  (t) => ({ uniq: uniqueIndex('company_identifier_uniq').on(t.companyId, t.kind, t.value) }),
);

export const companyAlias = pgTable('company_alias', {
  id: id(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  alias: text('alias').notNull(),
  normalizedAlias: text('normalized_alias').notNull(),
});

export const person = pgTable(
  'person',
  {
    id: id(),
    runId: text('run_id').references(() => run.id, { onDelete: 'cascade' }),
    companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
    fullName: text('full_name').notNull(),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    normalizedName: text('normalized_name').notNull(),
    createdAt: createdAt(),
  },
  (t) => ({ byCompany: index('person_company_idx').on(t.companyId, t.normalizedName) }),
);

export const personIdentifier = pgTable(
  'person_identifier',
  {
    id: id(),
    personId: text('person_id').notNull().references(() => person.id, { onDelete: 'cascade' }),
    /** email_hash | profile_url | github_login */
    kind: text('kind').notNull(),
    value: text('value').notNull(),
    sourceId: text('source_id').notNull(),
  },
  (t) => ({ uniq: uniqueIndex('person_identifier_uniq').on(t.personId, t.kind, t.value) }),
);

/** Reversible resolution link. Merges are never destructive — §6. */
export const entityLink = pgTable('entity_link', {
  id: id(),
  runId: text('run_id').references(() => run.id, { onDelete: 'cascade' }),
  subjectType: text('subject_type').notNull(),
  candidateId: text('candidate_id').notNull(),
  canonicalId: text('canonical_id').notNull(),
  matchScore: real('match_score').notNull(),
  method: text('method').notNull(),
  decidedBy: text('decided_by').notNull().default('auto'),
  reversedAt: timestamp('reversed_at', { withTimezone: true }),
  createdAt: createdAt(),
});

/* ── the load-bearing table ───────────────────────────────────────────── */

export const claim = pgTable(
  'claim',
  {
    id: id(),
    runId: text('run_id').references(() => run.id, { onDelete: 'cascade' }),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    field: text('field').notNull(),
    fieldClass: text('field_class').notNull(),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    value: jsonb('value'),
    /** EvidenceSpan[]. A claim with an empty array can never reach status 'supported'. */
    spans: jsonb('spans').notNull().default([]),
    sourceId: text('source_id').notNull(),
    extractor: text('extractor').notNull(),
    confidence: real('confidence').notNull().default(0),
    status: text('status').notNull().default('supported'),
    note: text('note'),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => ({
    bySubject: index('claim_subject_idx').on(t.subjectType, t.subjectId, t.field),
    byRun: index('claim_run_idx').on(t.runId),
  }),
);

/** Recorded when two supported claims disagree. Surfaced in the dossier, never auto-collapsed. */
export const conflict = pgTable('conflict', {
  id: id(),
  runId: text('run_id').references(() => run.id, { onDelete: 'cascade' }),
  subjectType: text('subject_type').notNull(),
  subjectId: text('subject_id').notNull(),
  field: text('field').notNull(),
  claimIds: jsonb('claim_ids').notNull().default([]),
  winningClaimId: text('winning_claim_id'),
  rule: text('rule').notNull(),
  createdAt: createdAt(),
});

/* ── scoring and leads ────────────────────────────────────────────────── */

export const criterionVerdict = pgTable(
  'criterion_verdict',
  {
    id: id(),
    runId: text('run_id').notNull().references(() => run.id, { onDelete: 'cascade' }),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    criterionId: text('criterion_id').notNull(),
    verdict: text('verdict').notNull(),
    status: text('status').notNull(),
    confidence: real('confidence').notNull().default(0),
    pointsAwarded: real('points_awarded').notNull().default(0),
    weight: real('weight').notNull().default(0),
    spans: jsonb('spans').notNull().default([]),
    sourceIds: jsonb('source_ids').notNull().default([]),
    reasoning: text('reasoning').notNull().default(''),
    createdAt: createdAt(),
  },
  (t) => ({ bySubject: index('verdict_subject_idx').on(t.runId, t.subjectId) }),
);

export const lead = pgTable(
  'lead',
  {
    id: id(),
    runId: text('run_id').notNull().references(() => run.id, { onDelete: 'cascade' }),
    companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    personId: text('person_id').references(() => person.id, { onDelete: 'set null' }),
    score: real('score').notNull().default(0),
    band: text('band').notNull().default('unqualified'),
    coverage: real('coverage').notNull().default(0),
    status: text('status').notNull().default('unqualified'),
    heldReason: text('held_reason'),
    /** verified | unverified | unavailable — never a guess. */
    emailStatus: text('email_status').notNull().default('unavailable'),
    email: text('email'),
    emailSourceId: text('email_source_id'),
    rationale: text('rationale').notNull().default(''),
    suppressedAt: timestamp('suppressed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => ({
    byRun: index('lead_run_idx').on(t.runId, t.score),
    uniq: uniqueIndex('lead_uniq').on(t.runId, t.companyId, t.personId),
  }),
);

/* ── compliance ───────────────────────────────────────────────────────── */

/** Hash-keyed so a suppressed identifier need not be stored in the clear. */
export const suppression = pgTable(
  'suppression',
  {
    id: id(),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    kind: text('kind').notNull(),
    reason: text('reason').notNull().default('user_request'),
    createdAt: createdAt(),
  },
  (t) => ({ uniq: uniqueIndex('suppression_key_uniq').on(t.key) }),
);

export const deletionRequest = pgTable('deletion_request', {
  id: id(),
  workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
  subjectType: text('subject_type').notNull(),
  subjectId: text('subject_id').notNull(),
  requestedBy: text('requested_by').notNull().default('local'),
  status: text('status').notNull().default('pending'),
  claimsDeleted: integer('claims_deleted').notNull().default(0),
  leadsDeleted: integer('leads_deleted').notNull().default(0),
  identifiersDeleted: integer('identifiers_deleted').notNull().default(0),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const exportRecord = pgTable('export', {
  id: id(),
  workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
  runId: text('run_id').notNull().references(() => run.id, { onDelete: 'cascade' }),
  format: text('format').notNull(),
  rowCount: integer('row_count').notNull().default(0),
  suppressedCount: integer('suppressed_count').notNull().default(0),
  withheldFields: jsonb('withheld_fields').notNull().default([]),
  createdAt: createdAt(),
});

/** Append-only. Every fetch, policy denial, and deletion lands here. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    workspaceId: text('workspace_id').references(() => workspace.id, { onDelete: 'cascade' }),
    runId: text('run_id'),
    action: text('action').notNull(),
    subject: text('subject'),
    detail: jsonb('detail').notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => ({ byRun: index('audit_run_idx').on(t.runId, t.createdAt) }),
);

export const schema = {
  appUser,
  workspace,
  workspaceMember,
  userSession,
  savedSearch,
  leadRequest,
  leadSpec,
  run,
  runStage,
  job,
  source,
  fetchLog,
  evidence,
  company,
  companyIdentifier,
  companyAlias,
  person,
  personIdentifier,
  entityLink,
  claim,
  conflict,
  criterionVerdict,
  lead,
  suppression,
  deletionRequest,
  exportRecord,
  auditLog,
};
