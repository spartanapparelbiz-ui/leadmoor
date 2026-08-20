# LeadMoor

Describe who you want to sell to. LeadMoor finds those companies and the people who decide, tells
you why each one fits, and shows you the sentence every fact came from.

```
you type          "US SaaS companies with 20–200 employees that are hiring salespeople"
        ↓
LeadMoor          reads your request, searches permitted public sources, finds companies,
                  finds the decision makers, checks what it can, ranks what it found
        ↓
you get           a table you can filter, a reason for every lead, and a CSV
```

One input. One button. No filter panel to configure, no specification to approve.

> **Standalone.** LeadMoor shares no code, database, runtime, or credentials with MOOR.
> See [ADR-0001](docs/adr/0001-standalone-from-moor.md); `pnpm check:no-moor` enforces it in CI.

---

## The product, in one screen

| | |
|---|---|
| **Ask** | A single box. Type a sentence; press Find Leads. The interpretation is shown on the results page, not put in front of you as a form to sign off. |
| **Watch** | Real pipeline stages with real counters, read back from the database. Nothing counts up on a timer. |
| **Results** | Score, company, person, role, email, why they fit, source, confidence. Filter by score, confidence, email state, or whether a contact was found. |
| **Open a lead** | Three to six reasons it was picked, what is known about the company, the contact and their email state, and the quoted evidence behind each claim. |
| **Refine** | Type "only founders" or "exclude agencies". It is compiled on top of your original request and run fresh; the previous results are kept. |
| **Find more like this** | One click from any lead builds a new search from what is actually known about it — its industry, size band, location, and the role that was found. |
| **Export** | One button, one CSV. |

---

## The three invariants

Everything in this repository follows from three rules. They are enforced in code, and there are
tests that fail if any of them is relaxed.

### 1. The model never authors a fact

The language model may do exactly three things: read your request into a typed specification,
propose search queries, and judge supplied evidence while citing the spans it used. It is never
asked "which companies match this?" and never permitted to emit a company name, a headcount, or an
email address from its own weights.

Every factual value passes `ProvenanceValidator`, which rejects:

| Failure | Outcome |
|---|---|
| No evidence cited | `insufficient_evidence` |
| Cites an evidence id that does not exist | `rejected` |
| Quotes text absent from the cited document | `rejected` |
| Cites a document the judge was never shown | `rejected` |
| Value does not appear in any cited document (emails, names) | `rejected` |
| Field class the source may not supply | `rejected` |

It fails closed. An unknown is always reported as unknown and never scored as a zero.

### 2. A non-deterministic planner over a deterministic substrate

The model's only output is a **LeadSpec** — a typed, readable document of filters, personas,
scoring rubric, and budget. You review and edit it before anything runs. Execution is then an
ordinary deterministic pipeline with no model in the control flow, which is what makes runs
reproducible and cost ceilings real.

### 3. Permission is a code path, not a policy document

Every connector ships a manifest declaring its legal basis, jurisdiction, permitted field classes,
robots posture, rate limits, and redistribution rights. A policy engine evaluates it at three
gates: **pre-fetch**, **post-extract**, and **export**.

**Tier D is unreachable.** It is absent from the `PermittedTier` union, so a Tier D source is not
merely disabled — it cannot be constructed. `defineSource` and the registry both refuse one, and
there is no access mode for logged-in scraping, paywall or CAPTCHA circumvention, or anti-bot
evasion. `personal_direct_contact` is refused globally regardless of what a manifest claims.

### And: no fabricated emails, ever

Three states only — `verified`, `unverified`, `unavailable`. An address is reported only when it
literally appears in a document we retrieved and stored, sits on the company's own domain, and is
attributable to that specific person. Nothing constructs `first.last@company.com`. Publication is
not deliverability, so a web-sourced address is `unverified`; only a real verification provider
may return `verified`, and none ships in M0.

---

## Quick start

```bash
pnpm install
cp .env.example .env          # works as-is; every provider key is optional
pnpm db:push                  # apply the schema
pnpm dev                      # http://localhost:3000 — create an account to begin
```

`.env` lives at the repository root and configures the web app, the worker, and the scripts alike.

With `LEADMOOR_EMBEDDED_WORKER=1` (the default in `.env.example`) the web process drains the job
queue itself. For production, run a dedicated worker instead:

```bash
pnpm worker
```

To see the product working end to end without any credentials:

```bash
pnpm demo:seed                # real pipeline, fixture corpus, clearly labelled
```

It creates an account (`demo@leadmoor.local` / `demo-password-1`), runs the real nine-stage
pipeline against a corpus of fictional `.example` companies served at the HTTP transport seam, and
flags the run `is_demo` so every screen labels it. Nothing about the pipeline is bypassed: the
claims, citations, conflicts, and scores are genuine outputs of the same validator and scorer that
production uses. Only the documents are fixtures.

### Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Run the app in development |
| `pnpm worker` | Run the durable job worker |
| `pnpm build` | Production build |
| `pnpm test` | Full test suite |
| `pnpm typecheck` | Typecheck packages and the app |
| `pnpm check:no-moor` | ADR-0001 enforcement |
| `pnpm verify` | All of the above |
| `pnpm db:push` | Apply the schema (idempotent) |
| `pnpm demo:seed` | Seed a demo run through the real pipeline |
| `pnpm acceptance` | Drive a real request against the live stack and report honestly |
| `pnpm e2e` | Drive the running app in a real browser and check it against the database |

---

## What works without any API keys

| Capability | Without keys | With keys |
|---|---|---|
| Request → LeadSpec | Keyword-matching compiler, labelled as such | Compiled by Claude (`ANTHROPIC_API_KEY`) |
| Discovery — SEC EDGAR (Tier B) | ✅ | — |
| Discovery — GLEIF (Tier B) | ✅ | — |
| Discovery — GitHub public API (Tier C) | ✅ unauthenticated | Higher rate limit (`GITHUB_TOKEN`) |
| Company site evidence (Tier C) | ✅ | — |
| Web-search discovery | Reports *provider not configured* | `BRAVE_SEARCH_API_KEY` or `EXA_API_KEY` |
| Deterministic criteria | ✅ with real citations | — |
| Fuzzy criteria (`llm_judge`) | Reported `not_configured`, contribute nothing | Judged with mandatory citations |
| People discovery, scoring, dossiers, export, suppression, deletion | ✅ | — |

A missing credential is always reported as **provider not configured** — never as *0 leads found*
and never as *search complete*.

---

## Architecture

[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) is the canonical specification. In brief:

```
apps/
  web/        Next.js — four screens: ask, results, searches, settings
  worker/     durable job worker
packages/
  auth/       password hashing, sessions, workspaces, membership, roles
  core/       domain types, LeadSpec schema, tier guards, logger
  db/         Drizzle schema, DDL, dual-driver client, workspace scope, audit log
  policy/     source manifests, registry, three-gate policy engine, robots
  evidence/   content-addressed store, span location, ProvenanceValidator
  claims/     claim engine, survivorship, conflict records
  connectors/ fetcher, search ports, discovery, extraction, email
  resolution/ normalization, blocking, matching, clustering
  scoring/    evaluators, two-source rule, deterministic aggregation, score decomposition
  llm/        Claude client, request compiler, evidence judge
  runtime/    budget governor, job queue, pipeline, run engine, services
  export/     CSV export gate, suppression, deletion
```

### The pipeline

Nine stages, each independently resumable, each recording its own status:

```
source planning → discovery → company resolution → company enrichment
→ hard-filter gate → people discovery → people resolution → scoring → dossiers
```

The ordering is the economics. The hard-filter gate sits deliberately *before* people discovery
and email resolution, which are the expensive operations.

### Claims, not fields

`company` and `person` carry identity only. Every factual value lives in `claim` with its evidence
spans, source, extractor, confidence, and observation time. The "current" value of a field is a
*view* computed by survivorship (source trust × recency × corroboration), never a stored truth.
Two sources disagreeing produces a `conflict` record the dossier shows, rather than a silent
overwrite.

### Scoring

Judgment and arithmetic are kept apart. Evaluators decide pass/fail/unknown against evidence; a
deterministic aggregator turns those verdicts into a number. No model ever emits a score, which is
what makes it tunable, auditable, and explainable.

- **Coverage** is reported alongside every score — the fraction of rubric weight that could
  actually be evaluated. A score derived from 55% of the rubric is rendered differently from one
  derived from all of it.
- **Unknown ≠ false.** Not finding "SOC 2" on the pages we retrieved is not evidence a company
  lacks it.
- **Two-source rule.** A disqualifying criterion needs two independent sources, so one weak source
  can never silently eliminate a lead.
- Below the spec's minimum coverage a lead is **held**, not scored low.

### Durability

A run is a saga, not a request. Jobs are rows claimed with `FOR UPDATE SKIP LOCKED` under a lease;
a worker that dies has its jobs picked up once the lease expires. Failures retry with exponential
backoff, a bad page never destroys a run, and the budget governor stops a run cleanly at its
ceiling while keeping everything found so far.

---

## Data sources

Tiered by permission posture, per `docs/ARCHITECTURE.md` §7. The line drawn is not "public vs.
private" but **logged-out and un-circumvented vs. everything else** — the distinction that
`hiQ v. LinkedIn`, `Meta v. Bright Data`, and `Reddit v. Perplexity` actually turn on.

| Tier | Sources | Posture |
|---|---|---|
| **B** | SEC EDGAR, GLEIF | Open government and CC0 data. Highest trust for survivorship. |
| **C** | Brave / Exa search APIs, GitHub public API, company websites | Official APIs and logged-out first-party fetch, robots respected, rate limited, honest user-agent. |
| **A** | *(none in M0)* | Licensed APIs. Redistribution terms must be read before a connector is written. |
| **D** | — | Excluded. No connector may be registered; no code path reaches it. |

First-party website fetching is **run-scoped**: a run may only fetch the site of a company it
legitimately discovered through a permitted source, never an arbitrary URL.

---

## Accounts

Everything LeadMoor stores belongs to an account: searches, leads, companies, people, evidence,
exports, and the audit trail. That is not a filter applied at render time — it is a `workspace_id`
predicate applied in SQL by `WorkspaceScope`, which is the only read path any route uses. A row
with no owner is visible to nobody rather than to everybody.

`requireSession()` runs in the signed-in layout, so every page beneath it is authenticated by
construction, and it re-reads membership on every request. Two test suites keep this honest:
`workspace-isolation` is adversarial — it holds a real id from one account and tries to read,
export, and delete it while scoped to another — and `scope-and-membership` covers the tables that
carry no owner column of their own and hang off a run instead, which is where a leak would hide.

The data model supports several people per account; the interface does not yet expose inviting
them, because a lead-finding tool does not need a members screen to be useful.

## Security

- All credentials are server-side. The service module is `server-only`; importing it from a client
  component is a build error. There is no `NEXT_PUBLIC_` variable in this product.
- Structured logs redact anything key-shaped, including inside error objects.
- Every server action validates input with Zod and returns safe messages.
- Expensive endpoints are rate limited.
- The fetcher permits only HTTPS, refuses URLs carrying credentials, re-checks policy on every
  redirect so a redirect cannot walk a fetch off an allowed host, and never retries a 403.
- CSV export neutralizes spreadsheet formula injection.
- Suppression is hash-keyed, so a suppressed identifier need not be stored in the clear.
- There is no endpoint that fetches a URL supplied by the browser. First-party fetching is limited
  to domains a permitted source actually discovered during that run.
- Passwords are scrypt-hashed; session tokens are stored as SHA-256 digests behind an httpOnly,
  same-site cookie. A sign-in attempt for an unknown account still performs a hash comparison, so
  response time does not disclose whether an account exists.

## Compliance

M0 is US-scoped. `docs/ARCHITECTURE.md` §8 and §15 carry the full reasoning; in the product:

- **Suppression** — company, person, or lead. Suppressed records vanish from results and exports,
  here and in future runs, and stay auditable.
- **Deletion** — removes a person's claims, identifiers, and every personal field on their leads.
  The audit trail and the suppression hash survive, so the deletion keeps being honored without
  retaining the identifier it was derived from.
- **Audit** — append-only. Refusals are recorded alongside successes.
- **Data minimization** — business-context fields only. Personal mobile numbers and home addresses
  are refused globally.

---

## Testing

```bash
pnpm test
```

Unit and integration tests covering LeadSpec parsing and validation, claims, evidence, provenance,
conflicts, scoring, the two-source rule, all three policy gates, Tier D unreachability, robots
handling, budget limits, job retry and crash recovery, suppression, deletion, export filtering,
and fabricated-claim and fabricated-email rejection.

The integration suite runs the **real** pipeline — real policy gates, real fetcher, real validator,
real scorer, real job queue — against a stubbed HTTP transport. Fixtures exist at exactly one seam:
the network. The production pipeline never returns fixture data.

Presentation is tested too, because the interface is where an honest pipeline is easiest to
misrepresent. `presentation.test.ts` locks in the two rules a reader relies on fastest: a lead's
confidence describes the *evidence* rather than the score — full coverage from one source is not
the same claim as full coverage from three, and a lead that could not be ranked is never shown as
high confidence — and sources are named rather than shown as internal identifiers.

### In a browser

```bash
pnpm demo:seed && pnpm build && pnpm start
pnpm e2e
```

`pnpm e2e` runs the brief's own final test in Chromium: open LeadMoor, sign up, type a request,
click Find Leads, watch the search run, get companies and people, see the email states, open a
lead and read why it was picked, filter, export, refine in words, save and re-run, and find more
like a lead. It checks the screen against the database at every step — that the number of rows
displayed equals the number stored, that a quote shown in the interface exists byte-for-byte in a
stored document, that an export was recorded with its row count, and that a second account gets a
404 on the first account's search. Fifty checks; it exits non-zero if any fails.
