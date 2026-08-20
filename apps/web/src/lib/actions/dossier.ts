'use server';

import { z } from 'zod';
import type { EvidenceSpan } from '@leadmoor/core';
import { parseLeadSpec } from '@leadmoor/core';
import { hostOf, humanize } from '../format';
import { ready, services } from '../services';
import { requireSession } from '../session';

/**
 * The evidence dossier behind one lead.
 *
 * Loaded on demand so opening the drawer does not cost a full page load, and scoped to the
 * caller's workspace like every other read. Every citation carries the document it came from, the
 * exact quoted span, the source that produced it, and when it was observed — because a claim
 * without those four things is an assertion, and LeadMoor does not make assertions.
 */

export interface Citation {
  evidenceId: string;
  quote: string;
  url: string;
  host: string;
  title: string | null;
  sourceId: string;
  contentHash: string;
  fetchedAt: string;
  documentRole: string;
  /** True when the quote was found byte-for-byte in the stored document at render time. */
  verified: boolean;
}

export interface DossierFact {
  field: string;
  label: string;
  value: string;
  status: string;
  confidence: number;
  observedAt: string;
  sourceId: string;
  citations: Citation[];
  conflicting: boolean;
}

export interface DossierCriterion {
  criterionId: string;
  name: string;
  verdict: string;
  status: string;
  weight: number;
  pointsAwarded: number;
  reasoning: string;
  citations: Citation[];
}

export interface Dossier {
  leadId: string;
  companyName: string;
  domain: string | null;
  companyId: string;
  personId: string | null;
  personName: string | null;
  rationale: string;
  heldReason: string | null;
  email: string | null;
  emailStatus: string;
  facts: DossierFact[];
  personFacts: DossierFact[];
  criteria: DossierCriterion[];
  documents: Array<{ evidenceId: string; url: string; host: string; title: string | null; sourceId: string; contentHash: string; fetchedAt: string }>;
  notEstablished: string[];
}

const FIELD_LABELS: Record<string, string> = {
  'company.employeeCount': 'Employees',
  'company.industry': 'Industry',
  'company.country': 'Country',
  'company.description': 'Description',
  'company.hiringSignal': 'Hiring signal',
  'company.techStack': 'Technology',
  'company.legalName': 'Legal name',
  'company.domain': 'Domain',
  'person.role': 'Role',
  'person.fullName': 'Name',
  'person.workEmail': 'Work email',
};

export async function loadDossier(leadId: string): Promise<Dossier | null> {
  const { scope } = await requireSession();

  const parsedId = z.string().uuid().safeParse(leadId);
  if (!parsedId.success) return null;

  await ready();
  const lead = await scope.getLead(parsedId.data);
  if (!lead) return null;

  const company = await scope.getCompany(lead.companyId);
  if (!company) return null;

  const person = lead.personId ? await scope.getPerson(lead.personId) : null;
  const run = await scope.getRun(lead.runId);
  const specRow = run ? await scope.getSpec(run.specId) : null;
  const parsedSpec = specRow ? parseLeadSpec(specRow.spec) : null;
  const spec = parsedSpec?.ok ? parsedSpec.spec : null;

  const verdicts = await scope.verdictsFor(lead.runId, company.id);
  const companyClaims = await scope.claimsFor('company', company.id);
  const personClaims = person ? await scope.claimsFor('person', person.id) : [];

  // Only the documents actually cited in this dossier are loaded.
  const citedIds = new Set<string>();
  const spansOf = (value: unknown): EvidenceSpan[] => (Array.isArray(value) ? (value as EvidenceSpan[]) : []);
  for (const v of verdicts) for (const s of spansOf(v.spans)) citedIds.add(s.evidenceId);
  for (const c of [...companyClaims, ...personClaims]) for (const s of spansOf(c.spans)) citedIds.add(s.evidenceId);

  const docs = await scope.evidenceByIds([...citedIds]);
  const docById = new Map(docs.map((d) => [d.id, d]));

  /**
   * Builds a citation and re-checks the quote against the stored text.
   *
   * The validator already rejected anything unquotable at write time. Re-checking at render time
   * costs nothing and means the UI states a fact about the bytes on disk, not about a promise made
   * earlier by another process.
   */
  const cite = (spans: EvidenceSpan[]): Citation[] =>
    spans.flatMap((span) => {
      const doc = docById.get(span.evidenceId);
      if (!doc) return [];
      return [
        {
          evidenceId: doc.id,
          quote: span.quote,
          url: doc.url,
          host: hostOf(doc.url),
          title: doc.title,
          sourceId: doc.sourceId,
          contentHash: doc.contentHash,
          fetchedAt: doc.fetchedAt.toISOString(),
          documentRole: doc.documentRole,
          verified: doc.normalizedText.includes(span.quote),
        },
      ];
    });

  const toFact = (claim: (typeof companyClaims)[number], conflicting: boolean): DossierFact => ({
    field: claim.field,
    label: FIELD_LABELS[claim.field] ?? humanize(claim.field.replace(/^\w+\./, '')),
    value: String(claim.value ?? ''),
    status: claim.status,
    confidence: claim.confidence,
    observedAt: claim.observedAt.toISOString(),
    sourceId: claim.sourceId,
    citations: cite(spansOf(claim.spans)),
    conflicting,
  });

  const supported = (claims: typeof companyClaims) => {
    const byField = new Map<string, typeof claims>();
    for (const c of claims) {
      if (c.status !== 'supported') continue;
      const list = byField.get(c.field);
      if (list) list.push(c);
      else byField.set(c.field, [c]);
    }

    const out: DossierFact[] = [];
    for (const [, list] of byField) {
      // Highest confidence wins for display; a differing value on another claim is a conflict and
      // is surfaced as one rather than silently discarded.
      const ranked = [...list].sort((a, b) => b.confidence - a.confidence);
      const winner = ranked[0];
      if (!winner) continue;
      const conflicting = ranked.some((c) => String(c.value) !== String(winner.value));
      out.push(toFact(winner, conflicting));
    }
    return out.sort((a, b) => a.label.localeCompare(b.label));
  };

  const criteria: DossierCriterion[] = verdicts.map((v) => ({
    criterionId: v.criterionId,
    name: spec?.rubric.criteria.find((c) => c.id === v.criterionId)?.name ?? v.criterionId,
    verdict: v.verdict,
    status: v.status,
    weight: v.weight,
    pointsAwarded: v.pointsAwarded,
    reasoning: v.reasoning,
    citations: cite(spansOf(v.spans)),
  }));

  // Criteria the rubric asked about but which produced no verdict row at all.
  const answered = new Set(verdicts.map((v) => v.criterionId));
  const notEstablished = (spec?.rubric.criteria ?? [])
    .filter((c) => !answered.has(c.id))
    .map((c) => c.name);

  return {
    leadId: lead.id,
    companyId: company.id,
    companyName: company.canonicalName,
    domain: company.primaryDomain,
    personId: person?.id ?? null,
    personName: person?.fullName ?? null,
    rationale: lead.rationale,
    heldReason: lead.heldReason,
    email: lead.email,
    emailStatus: lead.emailStatus,
    facts: supported(companyClaims),
    personFacts: supported(personClaims),
    criteria: criteria.sort((a, b) => b.pointsAwarded - a.pointsAwarded || a.name.localeCompare(b.name)),
    documents: docs
      .map((d) => ({
        evidenceId: d.id,
        url: d.url,
        host: hostOf(d.url),
        title: d.title,
        sourceId: d.sourceId,
        contentHash: d.contentHash,
        fetchedAt: d.fetchedAt.toISOString(),
      }))
      .sort((a, b) => a.host.localeCompare(b.host)),
    notEstablished,
  };
}

/** Reads a stored document's normalized text so a citation can be shown in context. */
export async function loadEvidenceText(
  evidenceId: string,
): Promise<{ text: string; url: string; contentHash: string } | null> {
  const { scope } = await requireSession();

  const parsed = z.string().uuid().safeParse(evidenceId);
  if (!parsed.success) return null;

  await ready();
  const doc = await scope.getEvidence(parsed.data);
  if (!doc) return null;

  void services();
  return { text: doc.normalizedText.slice(0, 20_000), url: doc.url, contentHash: doc.contentHash };
}
