import { and, eq } from 'drizzle-orm';
import {
  newId,
  type Claim,
  type EvidenceRecord,
  type FieldView,
  type LeadSpec,
  type Logger,
  type RunStage,
  type StageStatus,
} from '@leadmoor/core';
import { nullLogger, suppressionKey } from '@leadmoor/core';
import { normalizeText } from '@leadmoor/evidence';
import {
  AuditLog,
  company as companyTable,
  companyIdentifier as companyIdentifierTable,
  criterionVerdict as verdictTable,
  entityLink as entityLinkTable,
  evidence as evidenceTable,
  lead as leadTable,
  person as personTable,
  personIdentifier as personIdentifierTable,
  run as runTable,
  runStage as runStageTable,
  suppression as suppressionTable,
  type Db,
} from '@leadmoor/db';
import type { ClaimEngine } from '@leadmoor/claims';
import type { EvidenceStore } from '@leadmoor/evidence';
import type { RunHostAllowlist } from '@leadmoor/policy';
import {
  extractCompanyClaims,
  extractPeople,
  rankAgainstPersona,
  type CandidateCompany,
  type DiscoveryConnector,
  type DiscoveryReport,
  type EmailEnrichmentProvider,
  type EvidenceConnector,
} from '@leadmoor/connectors';
import { normalizeCompanyName, normalizePersonName, registrableDomain, resolve, type ResolvableEntity } from '@leadmoor/resolution';
import { explainScore, scoreSubject, type EvaluationContext } from '@leadmoor/scoring';
import type { EvidenceJudge } from '@leadmoor/llm';
import type { BudgetGovernor } from './budget.js';

/**
 * The deterministic pipeline of ARCHITECTURE.md section 3.
 *
 * No language model appears in this control flow. Stages run in a fixed order, each is independently
 * resumable, and each records its own status so a partial run reports exactly how far it got and
 * why it stopped. A failure in one company never destroys the run.
 */

export interface PipelineContext {
  db: Db;
  runId: string;
  spec: LeadSpec;
  claims: ClaimEngine;
  evidence: EvidenceStore;
  audit: AuditLog;
  budget: BudgetGovernor;
  runHosts: RunHostAllowlist;
  discovery: DiscoveryConnector[];
  siteEvidence: EvidenceConnector;
  email: EmailEnrichmentProvider;
  judge: EvidenceJudge | null;
  logger?: Logger;
}

export interface StageResult {
  status: StageStatus;
  detail: Record<string, unknown>;
  error?: string;
}

const STAGE_ORDER: RunStage[] = [
  'source_planning',
  'discovery',
  'company_resolution',
  'company_enrichment',
  'hard_filter_gate',
  'people_discovery',
  'people_resolution',
  'scoring',
  'evidence_assembly',
];

export function stageOrdinal(stage: RunStage): number {
  return STAGE_ORDER.indexOf(stage);
}

export function nextStage(stage: RunStage): RunStage | null {
  const idx = STAGE_ORDER.indexOf(stage);
  return idx >= 0 && idx < STAGE_ORDER.length - 1 ? (STAGE_ORDER[idx + 1] as RunStage) : null;
}

export async function runStageHandler(ctx: PipelineContext, stage: RunStage): Promise<StageResult> {
  const log = (ctx.logger ?? nullLogger).child({ runId: ctx.runId, stage });
  log.info('stage starting');

  // A ceiling reached mid-run stops the pipeline cleanly, keeping everything done so far.
  if (ctx.budget.isExhausted()) {
    return {
      status: 'skipped',
      detail: { reason: `budget exhausted (${ctx.budget.exhaustedLimit()})`, usage: ctx.budget.usage() },
    };
  }

  switch (stage) {
    case 'source_planning':
      return planSources(ctx);
    case 'discovery':
      return discoverCompanies(ctx);
    case 'company_resolution':
      return resolveCompanies(ctx);
    case 'company_enrichment':
      return enrichCompanies(ctx);
    case 'hard_filter_gate':
      return applyHardFilters(ctx);
    case 'people_discovery':
      return discoverPeople(ctx);
    case 'people_resolution':
      return resolvePeople(ctx);
    case 'scoring':
      return scoreLeads(ctx);
    case 'evidence_assembly':
      return assembleDossiers(ctx);
  }
}

/* ── stage 2: source planning ─────────────────────────────────────────── */

async function planSources(ctx: PipelineContext): Promise<StageResult> {
  const available: string[] = [];
  const unavailable: Array<{ connector: string; reason: string; message: string; envVar?: string }> = [];

  for (const connector of ctx.discovery) {
    const status = await connector.availability();
    if (status.available) {
      available.push(connector.id);
    } else {
      unavailable.push({
        connector: connector.id,
        reason: status.reason,
        message: status.message,
        ...(status.reason === 'not_configured' ? { envVar: status.envVar } : {}),
      });
      await ctx.audit.record(status.reason === 'not_configured' ? 'provider.not_configured' : 'provider.unavailable', {
        runId: ctx.runId,
        subject: connector.id,
        detail: { message: status.message },
      });
    }
  }

  if (available.length === 0) {
    return {
      status: 'blocked',
      detail: { available, unavailable },
      error: 'No discovery connector is available. ' + unavailable.map((u) => u.message).join(' '),
    };
  }

  return { status: 'completed', detail: { available, unavailable } };
}

/* ── stage 3: discovery ───────────────────────────────────────────────── */

async function discoverCompanies(ctx: PipelineContext): Promise<StageResult> {
  const reports: DiscoveryReport[] = [];
  const seen = new Set<string>();
  let inserted = 0;

  const limit = Math.min(ctx.spec.discovery.maxCompanies, ctx.spec.budget.maxCompanies);

  for (const connector of ctx.discovery) {
    if (inserted >= limit || ctx.budget.isExhausted()) break;

    const status = await connector.availability();
    if (!status.available) {
      reports.push({
        connectorId: connector.id,
        attempted: 0,
        found: 0,
        status: status.reason === 'not_configured' ? 'not_configured' : 'unreachable',
        message: status.message,
        failures: [],
      });
      continue;
    }

    try {
      const report = await connector.discover({
        spec: ctx.spec,
        runId: ctx.runId,
        limit: limit - inserted,
        onCandidate: async (candidate) => {
          const key = dedupeKey(candidate);
          if (seen.has(key)) return;
          seen.add(key);
          if (!ctx.budget.tryConsume('companies')) return;
          await persistCandidate(ctx, candidate);
          inserted += 1;
        },
      });
      reports.push(report);
    } catch (error) {
      // One connector failing must not end discovery.
      reports.push({
        connectorId: connector.id,
        attempted: 0,
        found: 0,
        status: 'failed',
        message: (error as Error).message,
        failures: [],
      });
    }
  }

  const anyUsable = reports.some((r) => r.status === 'completed' || r.status === 'partial');
  const blockedMessages = reports
    .filter((r) => r.status === 'not_configured' || r.status === 'unreachable' || r.status === 'failed')
    .map((r) => `${r.connectorId}: ${r.message ?? r.status}`);

  if (inserted === 0) {
    return {
      status: anyUsable ? 'completed' : 'blocked',
      detail: { reports, inserted },
      error:
        blockedMessages.length > 0
          ? `No companies discovered. ${blockedMessages.join(' | ')}`
          : 'No companies matched the search queries.',
    };
  }

  return {
    status: blockedMessages.length > 0 ? 'partial' : 'completed',
    detail: { reports, inserted, blocked: blockedMessages },
  };
}

async function persistCandidate(ctx: PipelineContext, candidate: CandidateCompany): Promise<void> {
  const companyId = newId();
  const domain = registrableDomain(candidate.domain);

  await ctx.db.insert(companyTable).values({
    id: companyId,
    runId: ctx.runId,
    canonicalName: candidate.name.slice(0, 300),
    normalizedName: normalizeCompanyName(candidate.name),
    primaryDomain: domain,
    country: candidate.country,
  });

  for (const identifier of candidate.identifiers) {
    await ctx.db
      .insert(companyIdentifierTable)
      .values({
        id: newId(),
        companyId,
        kind: identifier.kind,
        value: identifier.value,
        strength: identifier.strength,
        sourceId: candidate.sourceId,
      })
      .onConflictDoNothing();
  }

  // First-party fetching is limited to domains a permitted source actually gave us.
  if (domain) ctx.runHosts.permit(domain);

  for (const claim of candidate.claims) {
    await ctx.claims.createClaim({ ...claim, subjectId: companyId, runId: ctx.runId });
  }

  await ctx.audit.record('connector.used', {
    runId: ctx.runId,
    subject: candidate.sourceId,
    detail: { company: candidate.name, query: candidate.discoveryQuery },
  });
}

function dedupeKey(candidate: CandidateCompany): string {
  const domain = registrableDomain(candidate.domain);
  return domain ? `d:${domain}` : `n:${normalizeCompanyName(candidate.name)}`;
}

/* ── stage 4: company resolution ──────────────────────────────────────── */

async function resolveCompanies(ctx: PipelineContext): Promise<StageResult> {
  const rows = await ctx.db.select().from(companyTable).where(eq(companyTable.runId, ctx.runId));
  if (rows.length === 0) return { status: 'completed', detail: { companies: 0, merged: 0 } };

  const identifiers = await ctx.db.select().from(companyIdentifierTable);
  const byCompany = new Map<string, ResolvableEntity['identifiers']>();
  for (const id of identifiers) {
    const list = byCompany.get(id.companyId) ?? [];
    list.push({ kind: id.kind, value: id.value, strength: id.strength as 'strong' | 'medium' | 'weak' });
    byCompany.set(id.companyId, list);
  }

  const entities: ResolvableEntity[] = rows.map((r) => ({
    id: r.id,
    name: r.canonicalName,
    domain: r.primaryDomain,
    country: r.country,
    identifiers: byCompany.get(r.id) ?? [],
  }));

  const { canonical, decisions } = resolve(entities);
  const merges = decisions.filter((d) => d.decision === 'merge');
  const reviews = decisions.filter((d) => d.decision === 'review');

  for (const decision of decisions) {
    await ctx.db.insert(entityLinkTable).values({
      id: newId(),
      runId: ctx.runId,
      subjectType: 'company',
      candidateId: decision.candidateId,
      canonicalId: decision.canonicalId,
      matchScore: decision.score,
      method: decision.method,
      decidedBy: decision.decision === 'merge' ? 'auto' : 'review_queue',
    });
  }

  // Merges are expressed as links; the duplicate row is removed only after its link is recorded,
  // so the decision stays reversible from entity_link.
  for (const merge of merges) {
    await ctx.db.delete(companyTable).where(eq(companyTable.id, merge.candidateId));
  }

  // Survivors may have gained a domain during the merge.
  for (const entity of canonical) {
    if (entity.domain) {
      const domain = registrableDomain(entity.domain);
      if (domain) {
        ctx.runHosts.permit(domain);
        await ctx.db.update(companyTable).set({ primaryDomain: domain }).where(eq(companyTable.id, entity.id));
      }
    }
  }

  return {
    status: 'completed',
    detail: { companies: canonical.length, merged: merges.length, flaggedForReview: reviews.length },
  };
}

/* ── stage 5: company enrichment ──────────────────────────────────────── */

async function enrichCompanies(ctx: PipelineContext): Promise<StageResult> {
  const companies = await ctx.db.select().from(companyTable).where(eq(companyTable.runId, ctx.runId));
  let enriched = 0;
  let documents = 0;
  const failures: Array<{ company: string; reason: string }> = [];

  for (const company of companies) {
    if (ctx.budget.isExhausted()) break;
    if (!company.primaryDomain) {
      failures.push({ company: company.canonicalName, reason: 'no verified domain to fetch from' });
      continue;
    }

    const allowance = Math.min(
      ctx.budget.documentsPerCompany(),
      Math.max(0, ctx.spec.budget.maxDocuments - ctx.budget.usage().documents),
    );
    if (allowance <= 0) break;

    try {
      const result = await ctx.siteEvidence.collect({
        runId: ctx.runId,
        companyId: company.id,
        domain: company.primaryDomain,
        companyName: company.canonicalName,
        maxDocuments: allowance,
      });

      for (let i = 0; i < result.evidence.length; i++) ctx.budget.tryConsume('documents');
      documents += result.evidence.length;

      if (result.evidence.length === 0) {
        const reason = result.failures[0]?.reason ?? 'no pages could be retrieved';
        failures.push({ company: company.canonicalName, reason });
        continue;
      }

      // Associate each document with this company so the dossier can find it later.
      for (const doc of result.evidence) {
        await ctx.db
          .update(evidenceTable)
          .set({ metadata: { ...doc.metadata, companyId: company.id } as never })
          .where(eq(evidenceTable.id, doc.id));
      }

      const extracted = extractCompanyClaims(result.evidence, ctx.siteEvidence.sourceId);
      for (const claim of extracted) {
        await ctx.claims.createClaim({ ...claim, subjectId: company.id, runId: ctx.runId });
      }
      await ctx.claims.recordConflict('company', company.id, 'company.employeeCount', ctx.runId);
      enriched += 1;
    } catch (error) {
      failures.push({ company: company.canonicalName, reason: (error as Error).message });
    }
  }

  return {
    status: enriched === 0 && companies.length > 0 ? 'partial' : 'completed',
    detail: { companies: companies.length, enriched, documents, failures: failures.slice(0, 25) },
  };
}

/* ── stage 6: hard filter gate ────────────────────────────────────────── */

async function applyHardFilters(ctx: PipelineContext): Promise<StageResult> {
  const hardFilters = ctx.spec.rubric.criteria.filter((c) => c.kind === 'hard_filter');
  if (hardFilters.length === 0) return { status: 'skipped', detail: { reason: 'no hard filters in rubric' } };

  const companies = await ctx.db.select().from(companyTable).where(eq(companyTable.runId, ctx.runId));
  let dropped = 0;
  const reasons: Array<{ company: string; criterion: string }> = [];

  for (const company of companies) {
    const ctxForCompany = await buildEvaluationContext(ctx, company.id);
    const result = await scoreSubject({
      spec: { ...ctx.spec, rubric: { ...ctx.spec.rubric, criteria: hardFilters } },
      ctx: ctxForCompany,
    });

    if (result.failedHardFilters.length > 0) {
      dropped += 1;
      reasons.push({ company: company.canonicalName, criterion: result.failedHardFilters.join(', ') });
      // The reason is retained as a lead row so a dropped company is explainable, not invisible.
      await ctx.db.insert(leadTable).values({
        id: newId(),
        runId: ctx.runId,
        companyId: company.id,
        personId: null,
        score: 0,
        band: 'unqualified',
        coverage: result.coverage,
        status: 'unqualified',
        heldReason: `failed hard filter: ${result.failedHardFilters.join(', ')}`,
        rationale: explainScore(result),
      });
    }
  }

  return { status: 'completed', detail: { evaluated: companies.length, dropped, reasons: reasons.slice(0, 25) } };
}

/* ── stage 7: people discovery ────────────────────────────────────────── */

async function discoverPeople(ctx: PipelineContext): Promise<StageResult> {
  const companies = await survivingCompanies(ctx);
  let peopleFound = 0;
  let companiesWithoutPeople = 0;

  for (const company of companies) {
    if (ctx.budget.isExhausted()) break;

    const docs = await evidenceForCompany(ctx, company.id);
    const observations = extractPeople(docs, {
      persona: ctx.spec.personas,
      maxPeople: Math.min(ctx.spec.personas.maxPerCompany, ctx.budget.peoplePerCompany()),
      sourceId: ctx.siteEvidence.sourceId,
    });

    if (observations.length === 0) {
      companiesWithoutPeople += 1;
      continue;
    }

    for (const observation of observations) {
      const personId = newId();
      await ctx.db.insert(personTable).values({
        id: personId,
        runId: ctx.runId,
        companyId: company.id,
        fullName: observation.fullName.slice(0, 200),
        normalizedName: normalizePersonName(observation.fullName),
      });

      // Both halves of a person are claims: the name and, separately, the role.
      const nameClaim = await ctx.claims.createClaim({
        runId: ctx.runId,
        subjectType: 'person',
        subjectId: personId,
        field: 'person.fullName',
        fieldClass: 'person_identity',
        value: observation.fullName,
        spans: [
          {
            evidenceId: observation.nameEvidence.evidenceId,
            start: 0,
            end: 0,
            quote: observation.nameEvidence.quote,
          },
        ],
        sourceId: observation.sourceId,
        extractor: 'html_extraction',
        confidence: observation.confidence,
      });

      if (observation.role && observation.roleEvidence) {
        await ctx.claims.createClaim({
          runId: ctx.runId,
          subjectType: 'person',
          subjectId: personId,
          field: 'person.role',
          fieldClass: 'person_role',
          value: observation.role,
          spans: [
            {
              evidenceId: observation.roleEvidence.evidenceId,
              start: 0,
              end: 0,
              quote: observation.roleEvidence.quote,
            },
          ],
          sourceId: observation.sourceId,
          extractor: 'html_extraction',
          confidence: observation.confidence,
        });
      }

      // A person whose name could not be verified against evidence is removed, not kept.
      if (nameClaim.status !== 'supported') {
        await ctx.db.delete(personTable).where(eq(personTable.id, personId));
        continue;
      }

      peopleFound += 1;
      await ctx.audit.record('person.discovered', {
        runId: ctx.runId,
        subject: personId,
        detail: { company: company.canonicalName, role: observation.role },
      });
    }
  }

  return {
    status: 'completed',
    detail: { companies: companies.length, peopleFound, companiesWithoutPeople },
  };
}

/* ── stage 8: people resolution and email ─────────────────────────────── */

async function resolvePeople(ctx: PipelineContext): Promise<StageResult> {
  const people = await ctx.db.select().from(personTable).where(eq(personTable.runId, ctx.runId));
  const companies = new Map((await survivingCompanies(ctx)).map((c) => [c.id, c]));

  const counts = { verified: 0, unverified: 0, unavailable: 0 };
  const availability = await ctx.email.availability();

  for (const person of people) {
    const company = companies.get(person.companyId);
    if (!availability.available) {
      counts.unavailable += 1;
      continue;
    }

    const resolution = await ctx.email.resolve({
      runId: ctx.runId,
      personId: person.id,
      fullName: person.fullName,
      companyDomain: company?.primaryDomain ?? null,
      companyId: person.companyId,
    });

    if (resolution.status === 'unavailable' || !resolution.email || !resolution.evidenceId) {
      counts.unavailable += 1;
      await ctx.audit.record('email.unavailable', {
        runId: ctx.runId,
        subject: person.id,
        detail: { reason: resolution.reason },
      });
      continue;
    }

    // The address must survive claim validation, which requires it to literally appear in the
    // cited document. A fabricated address cannot get past this.
    const claim = await ctx.claims.createClaim({
      runId: ctx.runId,
      subjectType: 'person',
      subjectId: person.id,
      field: 'person.workEmail',
      fieldClass: 'person_work_email',
      value: resolution.email,
      spans: [{ evidenceId: resolution.evidenceId, start: 0, end: 0, quote: resolution.quote ?? resolution.email }],
      sourceId: resolution.sourceId ?? ctx.siteEvidence.sourceId,
      extractor: 'pattern_match',
      confidence: resolution.status === 'verified' ? 0.9 : 0.6,
    });

    if (claim.status !== 'supported') {
      counts.unavailable += 1;
      continue;
    }

    await ctx.db
      .insert(personIdentifierTable)
      .values({
        id: newId(),
        personId: person.id,
        kind: 'email_hash',
        value: suppressionKey('email', resolution.email),
        sourceId: resolution.sourceId ?? ctx.siteEvidence.sourceId,
      })
      .onConflictDoNothing();

    if (resolution.status === 'verified') counts.verified += 1;
    else counts.unverified += 1;

    await ctx.audit.record('email.resolved', {
      runId: ctx.runId,
      subject: person.id,
      detail: { status: resolution.status, sourceId: resolution.sourceId },
    });
  }

  return {
    status: 'completed',
    detail: {
      people: people.length,
      ...counts,
      provider: availability.available ? ctx.email.id : 'not_configured',
      providerMessage: availability.available ? null : availability.message,
    },
  };
}

/* ── stage 9: scoring ─────────────────────────────────────────────────── */

async function scoreLeads(ctx: PipelineContext): Promise<StageResult> {
  const companies = await survivingCompanies(ctx);
  const suppressed = await loadSuppressionKeys(ctx);

  let scored = 0;
  let qualified = 0;
  let held = 0;

  for (const company of companies) {
    if (ctx.budget.isExhausted()) break;

    const evaluation = await buildEvaluationContext(ctx, company.id);
    const people = await ctx.db
      .select()
      .from(personTable)
      .where(and(eq(personTable.runId, ctx.runId), eq(personTable.companyId, company.id)));

    // The best person for this company participates in scoring via person.* field views.
    const primary = await pickPrimaryPerson(ctx, people, evaluation);
    if (primary) {
      for (const [field, view] of primary.views) evaluation.views.set(field, view);
    }

    const judgeFn = ctx.judge
      ? async (criterion: Parameters<NonNullable<typeof ctx.judge>['judge']>[0]['criterion']) => {
          if (!ctx.budget.tryConsume('modelCalls')) {
            return {
              criterionId: criterion.id,
              verdict: 'unknown' as const,
              status: 'insufficient_evidence' as const,
              confidence: 0,
              spans: [],
              sourceIds: [],
              reasoning: 'model call budget reached before this criterion could be judged',
            };
          }
          const outcome = await ctx.judge!.judge({
            criterion,
            evidence: evaluation.evidence,
            companyName: company.canonicalName,
          });
          return { criterionId: criterion.id, ...outcome };
        }
      : undefined;

    const result = await scoreSubject({ spec: ctx.spec, ctx: evaluation, judge: judgeFn });

    for (const verdict of result.verdicts) {
      await ctx.db.insert(verdictTable).values({
        id: newId(),
        runId: ctx.runId,
        subjectType: 'company',
        subjectId: company.id,
        criterionId: verdict.criterionId,
        verdict: verdict.verdict,
        status: verdict.status,
        confidence: verdict.confidence,
        pointsAwarded: verdict.pointsAwarded,
        weight: verdict.weight,
        spans: verdict.spans as never,
        sourceIds: verdict.sourceIds as never,
        reasoning: verdict.reasoning,
      });
    }

    const isSuppressed =
      suppressed.has(suppressionKey('domain', company.primaryDomain ?? company.canonicalName)) ||
      (primary ? suppressed.has(suppressionKey('person', `${company.id}:${primary.person.normalizedName}`)) : false);

    const status = isSuppressed
      ? 'suppressed'
      : result.disqualified
        ? 'disqualified'
        : result.heldReason
          ? 'held_insufficient_evidence'
          : result.qualified
            ? 'qualified'
            : 'unqualified';

    await ctx.db
      .insert(leadTable)
      .values({
        id: newId(),
        runId: ctx.runId,
        companyId: company.id,
        personId: primary?.person.id ?? null,
        score: result.score,
        band: result.band,
        coverage: result.coverage,
        status,
        heldReason: result.heldReason,
        emailStatus: primary?.emailStatus ?? 'unavailable',
        email: primary?.email ?? null,
        emailSourceId: primary?.emailSourceId ?? null,
        rationale: explainScore(result),
        suppressedAt: isSuppressed ? new Date() : null,
      })
      .onConflictDoNothing();

    scored += 1;
    if (status === 'qualified') qualified += 1;
    if (status === 'held_insufficient_evidence') held += 1;

    await ctx.audit.record('score.generated', {
      runId: ctx.runId,
      subject: company.id,
      detail: { score: result.score, coverage: result.coverage, status },
    });
  }

  return { status: 'completed', detail: { scored, qualified, held } };
}

/* ── stage 10: dossier assembly ───────────────────────────────────────── */

async function assembleDossiers(ctx: PipelineContext): Promise<StageResult> {
  const leads = await ctx.db.select().from(leadTable).where(eq(leadTable.runId, ctx.runId));
  const evidenceCount = (await ctx.db.select().from(evidenceTable).where(eq(evidenceTable.runId, ctx.runId))).length;

  const byStatus: Record<string, number> = {};
  for (const lead of leads) byStatus[lead.status] = (byStatus[lead.status] ?? 0) + 1;

  return {
    status: 'completed',
    detail: { leads: leads.length, byStatus, evidenceDocuments: evidenceCount, usage: ctx.budget.usage() },
  };
}

/* ── shared helpers ───────────────────────────────────────────────────── */

async function survivingCompanies(ctx: PipelineContext) {
  const dropped = new Set(
    (
      await ctx.db
        .select({ companyId: leadTable.companyId })
        .from(leadTable)
        .where(and(eq(leadTable.runId, ctx.runId), eq(leadTable.status, 'unqualified')))
    ).map((r) => r.companyId),
  );
  const companies = await ctx.db.select().from(companyTable).where(eq(companyTable.runId, ctx.runId));
  return companies.filter((c) => !dropped.has(c.id));
}

async function evidenceForCompany(ctx: PipelineContext, companyId: string): Promise<EvidenceRecord[]> {
  const all = await ctx.evidence.listForRun(ctx.runId);
  return all.filter((doc) => (doc.metadata as { companyId?: string }).companyId === companyId);
}

async function buildEvaluationContext(ctx: PipelineContext, companyId: string): Promise<EvaluationContext> {
  const claims = await ctx.claims.getClaims('company', companyId);
  const fields = new Set(claims.map((c) => c.field));
  const views = new Map<string, FieldView>();
  for (const field of fields) {
    views.set(field, await ctx.claims.getFieldView('company', companyId, field));
  }
  return { spec: ctx.spec, views, claims, evidence: await evidenceForCompany(ctx, companyId) };
}

/** Picks the person best matching the persona, with their field views and email status. */
async function pickPrimaryPerson(
  ctx: PipelineContext,
  people: Array<typeof personTable.$inferSelect>,
  _evaluation: EvaluationContext,
): Promise<{
  person: typeof personTable.$inferSelect;
  views: Map<string, FieldView>;
  email: string | null;
  emailStatus: 'verified' | 'unverified' | 'unavailable';
  emailSourceId: string | null;
} | null> {
  let best: {
    person: typeof personTable.$inferSelect;
    views: Map<string, FieldView>;
    rank: number;
    email: string | null;
    emailStatus: 'verified' | 'unverified' | 'unavailable';
    emailSourceId: string | null;
  } | null = null;

  for (const person of people) {
    const claims = await ctx.claims.getClaims('person', person.id);
    const views = new Map<string, FieldView>();
    for (const field of new Set(claims.map((c) => c.field))) {
      views.set(field, await ctx.claims.getFieldView('person', person.id, field));
    }

    const role = views.get('person.role')?.value;
    const rank = rankAgainstPersona(typeof role === 'string' ? role : null, ctx.spec.personas.titles);

    const emailView = views.get('person.workEmail');
    const emailClaim = emailView?.candidates.find((c) => c.id === emailView.winningClaimId);
    const email = typeof emailView?.value === 'string' ? emailView.value : null;

    if (!best || rank < best.rank) {
      best = {
        person,
        views,
        rank,
        email,
        // Published-but-unverified is the honest ceiling for a web-sourced address.
        emailStatus: email ? 'unverified' : 'unavailable',
        emailSourceId: emailClaim?.sourceId ?? null,
      };
    }
  }

  return best ? { person: best.person, views: best.views, email: best.email, emailStatus: best.emailStatus, emailSourceId: best.emailSourceId } : null;
}

async function loadSuppressionKeys(ctx: PipelineContext): Promise<Set<string>> {
  const rows = await ctx.db.select({ key: suppressionTable.key }).from(suppressionTable);
  return new Set(rows.map((r) => r.key));
}

/* ── run/stage bookkeeping ────────────────────────────────────────────── */

export async function initializeStages(db: Db, runId: string): Promise<void> {
  for (const [ordinal, stage] of STAGE_ORDER.entries()) {
    await db
      .insert(runStageTable)
      .values({ id: newId(), runId, stage, ordinal, status: 'pending' })
      .onConflictDoNothing();
  }
}

export async function markStage(
  db: Db,
  runId: string,
  stage: RunStage,
  status: StageStatus,
  detail: Record<string, unknown> = {},
  error?: string,
): Promise<void> {
  const patch: Record<string, unknown> = { status, detail: detail as never };
  if (status === 'running') patch.startedAt = new Date();
  if (['completed', 'failed', 'partial', 'skipped', 'blocked', 'insufficient_evidence'].includes(status)) {
    patch.finishedAt = new Date();
  }
  if (error !== undefined) patch.error = normalizeText(error).slice(0, 2000);

  await db
    .update(runStageTable)
    .set(patch as never)
    .where(and(eq(runStageTable.runId, runId), eq(runStageTable.stage, stage)));
}

export async function updateRunUsage(db: Db, runId: string, budget: BudgetGovernor): Promise<void> {
  await db
    .update(runTable)
    .set({ usage: budget.usage() as never })
    .where(eq(runTable.id, runId));
}

export { STAGE_ORDER };
export type { Claim };
