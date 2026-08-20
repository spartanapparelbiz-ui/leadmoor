-- LeadMoor schema DDL. Applied by `pnpm db:push`. Idempotent.
-- Kept hand-written (no codegen step) and covered by a drift test that asserts every table in
-- schema.ts appears here.

CREATE TABLE IF NOT EXISTS lead_request (
  id            TEXT PRIMARY KEY,
  raw_text      TEXT NOT NULL,
  created_by    TEXT NOT NULL DEFAULT 'local',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lead_spec (
  id            TEXT PRIMARY KEY,
  request_id    TEXT NOT NULL REFERENCES lead_request(id) ON DELETE CASCADE,
  version       INTEGER NOT NULL DEFAULT 1,
  spec          JSONB NOT NULL,
  origin        TEXT NOT NULL DEFAULT 'compiled',
  approved_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_spec_request_idx ON lead_spec (request_id, version);

CREATE TABLE IF NOT EXISTS run (
  id            TEXT PRIMARY KEY,
  spec_id       TEXT NOT NULL REFERENCES lead_spec(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'queued',
  usage         JSONB NOT NULL DEFAULT '{}'::jsonb,
  stats         JSONB NOT NULL DEFAULT '{}'::jsonb,
  error         TEXT,
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS run_status_idx ON run (status);

CREATE TABLE IF NOT EXISTS run_stage (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES run(id) ON DELETE CASCADE,
  stage         TEXT NOT NULL,
  ordinal       INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',
  attempts      INTEGER NOT NULL DEFAULT 0,
  detail        JSONB NOT NULL DEFAULT '{}'::jsonb,
  error         TEXT,
  started_at    TIMESTAMPTZ,
  finished_at   TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS run_stage_uniq ON run_stage (run_id, stage);

CREATE TABLE IF NOT EXISTS job (
  id            TEXT PRIMARY KEY,
  run_id        TEXT NOT NULL REFERENCES run(id) ON DELETE CASCADE,
  stage         TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'queued',
  attempts      INTEGER NOT NULL DEFAULT 0,
  max_attempts  INTEGER NOT NULL DEFAULT 3,
  run_after     TIMESTAMPTZ NOT NULL DEFAULT now(),
  leased_until  TIMESTAMPTZ,
  leased_by     TEXT,
  last_error    TEXT,
  payload       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_claimable_idx ON job (status, run_after);
CREATE INDEX IF NOT EXISTS job_run_idx ON job (run_id);

CREATE TABLE IF NOT EXISTS source (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  tier          TEXT NOT NULL,
  access_mode   TEXT NOT NULL,
  manifest      JSONB NOT NULL,
  trust_tier    INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fetch_log (
  id              TEXT PRIMARY KEY,
  run_id          TEXT REFERENCES run(id) ON DELETE CASCADE,
  source_id       TEXT NOT NULL,
  url             TEXT NOT NULL,
  method          TEXT NOT NULL DEFAULT 'GET',
  status          TEXT NOT NULL,
  http_status     INTEGER,
  robots_decision TEXT NOT NULL DEFAULT 'not_applicable',
  denial_reason   TEXT,
  duration_ms     INTEGER,
  evidence_id     TEXT,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fetch_run_idx ON fetch_log (run_id);
CREATE INDEX IF NOT EXISTS fetch_url_idx ON fetch_log (url);

CREATE TABLE IF NOT EXISTS evidence (
  id              TEXT PRIMARY KEY,
  run_id          TEXT REFERENCES run(id) ON DELETE CASCADE,
  source_id       TEXT NOT NULL,
  url             TEXT NOT NULL,
  title           TEXT,
  document_role   TEXT NOT NULL DEFAULT 'other',
  http_status     INTEGER,
  content_hash    TEXT NOT NULL,
  content_type    TEXT,
  normalized_text TEXT NOT NULL,
  byte_length     INTEGER NOT NULL DEFAULT 0,
  robots_decision TEXT NOT NULL DEFAULT 'not_applicable',
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS evidence_hash_idx ON evidence (content_hash);
CREATE INDEX IF NOT EXISTS evidence_run_idx ON evidence (run_id);

CREATE TABLE IF NOT EXISTS company (
  id              TEXT PRIMARY KEY,
  run_id          TEXT REFERENCES run(id) ON DELETE CASCADE,
  canonical_name  TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  primary_domain  TEXT,
  country         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS company_domain_idx ON company (run_id, primary_domain);
CREATE INDEX IF NOT EXISTS company_norm_idx ON company (run_id, normalized_name);

CREATE TABLE IF NOT EXISTS company_identifier (
  id          TEXT PRIMARY KEY,
  company_id  TEXT NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  value       TEXT NOT NULL,
  strength    TEXT NOT NULL DEFAULT 'medium',
  source_id   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS company_identifier_uniq ON company_identifier (company_id, kind, value);

CREATE TABLE IF NOT EXISTS company_alias (
  id               TEXT PRIMARY KEY,
  company_id       TEXT NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  alias            TEXT NOT NULL,
  normalized_alias TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS person (
  id              TEXT PRIMARY KEY,
  run_id          TEXT REFERENCES run(id) ON DELETE CASCADE,
  company_id      TEXT NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  full_name       TEXT NOT NULL,
  normalized_name TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS person_company_idx ON person (company_id, normalized_name);

CREATE TABLE IF NOT EXISTS person_identifier (
  id         TEXT PRIMARY KEY,
  person_id  TEXT NOT NULL REFERENCES person(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  value      TEXT NOT NULL,
  source_id  TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS person_identifier_uniq ON person_identifier (person_id, kind, value);

CREATE TABLE IF NOT EXISTS entity_link (
  id           TEXT PRIMARY KEY,
  run_id       TEXT REFERENCES run(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  canonical_id TEXT NOT NULL,
  match_score  REAL NOT NULL,
  method       TEXT NOT NULL,
  decided_by   TEXT NOT NULL DEFAULT 'auto',
  reversed_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS claim (
  id           TEXT PRIMARY KEY,
  run_id       TEXT REFERENCES run(id) ON DELETE CASCADE,
  subject_type TEXT NOT NULL,
  subject_id   TEXT NOT NULL,
  field        TEXT NOT NULL,
  field_class  TEXT NOT NULL,
  value        JSONB,
  spans        JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_id    TEXT NOT NULL,
  extractor    TEXT NOT NULL,
  confidence   REAL NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'supported',
  note         TEXT,
  observed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS claim_subject_idx ON claim (subject_type, subject_id, field);
CREATE INDEX IF NOT EXISTS claim_run_idx ON claim (run_id);

CREATE TABLE IF NOT EXISTS conflict (
  id               TEXT PRIMARY KEY,
  run_id           TEXT REFERENCES run(id) ON DELETE CASCADE,
  subject_type     TEXT NOT NULL,
  subject_id       TEXT NOT NULL,
  field            TEXT NOT NULL,
  claim_ids        JSONB NOT NULL DEFAULT '[]'::jsonb,
  winning_claim_id TEXT,
  rule             TEXT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS criterion_verdict (
  id             TEXT PRIMARY KEY,
  run_id         TEXT NOT NULL REFERENCES run(id) ON DELETE CASCADE,
  subject_type   TEXT NOT NULL,
  subject_id     TEXT NOT NULL,
  criterion_id   TEXT NOT NULL,
  verdict        TEXT NOT NULL,
  status         TEXT NOT NULL,
  confidence     REAL NOT NULL DEFAULT 0,
  points_awarded REAL NOT NULL DEFAULT 0,
  weight         REAL NOT NULL DEFAULT 0,
  spans          JSONB NOT NULL DEFAULT '[]'::jsonb,
  source_ids     JSONB NOT NULL DEFAULT '[]'::jsonb,
  reasoning      TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verdict_subject_idx ON criterion_verdict (run_id, subject_id);

CREATE TABLE IF NOT EXISTS lead (
  id              TEXT PRIMARY KEY,
  run_id          TEXT NOT NULL REFERENCES run(id) ON DELETE CASCADE,
  company_id      TEXT NOT NULL REFERENCES company(id) ON DELETE CASCADE,
  person_id       TEXT REFERENCES person(id) ON DELETE SET NULL,
  score           REAL NOT NULL DEFAULT 0,
  band            TEXT NOT NULL DEFAULT 'unqualified',
  coverage        REAL NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'unqualified',
  held_reason     TEXT,
  email_status    TEXT NOT NULL DEFAULT 'unavailable',
  email           TEXT,
  email_source_id TEXT,
  rationale       TEXT NOT NULL DEFAULT '',
  suppressed_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS lead_run_idx ON lead (run_id, score);
CREATE UNIQUE INDEX IF NOT EXISTS lead_uniq ON lead (run_id, company_id, person_id);

CREATE TABLE IF NOT EXISTS suppression (
  id         TEXT PRIMARY KEY,
  key        TEXT NOT NULL,
  kind       TEXT NOT NULL,
  reason     TEXT NOT NULL DEFAULT 'user_request',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS suppression_key_uniq ON suppression (key);

CREATE TABLE IF NOT EXISTS deletion_request (
  id                   TEXT PRIMARY KEY,
  subject_type         TEXT NOT NULL,
  subject_id           TEXT NOT NULL,
  requested_by         TEXT NOT NULL DEFAULT 'local',
  status               TEXT NOT NULL DEFAULT 'pending',
  claims_deleted       INTEGER NOT NULL DEFAULT 0,
  leads_deleted        INTEGER NOT NULL DEFAULT 0,
  identifiers_deleted  INTEGER NOT NULL DEFAULT 0,
  completed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS export (
  id               TEXT PRIMARY KEY,
  run_id           TEXT NOT NULL REFERENCES run(id) ON DELETE CASCADE,
  format           TEXT NOT NULL,
  row_count        INTEGER NOT NULL DEFAULT 0,
  suppressed_count INTEGER NOT NULL DEFAULT 0,
  withheld_fields  JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id         TEXT PRIMARY KEY,
  run_id     TEXT,
  action     TEXT NOT NULL,
  subject    TEXT,
  detail     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_run_idx ON audit_log (run_id, created_at);
