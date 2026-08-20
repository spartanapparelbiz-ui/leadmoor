import 'server-only';
import type { EvidenceSpan, LeadSpec } from '@leadmoor/core';
import { parseLeadSpec } from '@leadmoor/core';
import type { WorkspaceScope } from '@leadmoor/db';
import { confidenceOf, type Lead, type Reason } from './lead';

export type { Confidence, Lead, Reason } from './lead';
export { confidenceOf, sourceName } from './lead';

/**
 * Lead assembly.
 *
 * One place builds the shape the table, the drawer, and the export all read, so a lead cannot look
 * like one thing in a list and another when opened. Everything is read through a WorkspaceScope, so
 * a lead belonging to another account is simply not in the result.
 */

type Verdict = {
  subjectId: string;
  criterionId: string;
  verdict: string;
  status: string;
  pointsAwarded: number;
  weight: number;
  reasoning: string;
  sourceIds: unknown;
  spans: unknown;
};

export async function loadLeads(
  scope: WorkspaceScope,
  opts: { runId?: string; limit?: number } = {},
): Promise<Lead[]> {
  const rows = await scope.listLeads({ runId: opts.runId, limit: opts.limit ?? 500 });
  if (rows.length === 0) return [];

  const companies = new Map((await scope.listCompanies({ limit: 2000 })).map((c) => [c.id, c]));
  const people = new Map((await scope.listPeople({ limit: 2000 })).map((p) => [p.id, p]));

  const specByRun = new Map<string, LeadSpec | null>();
  const verdictsByRun = new Map<string, Verdict[]>();
  for (const runId of new Set(rows.map((r) => r.runId))) {
    const run = await scope.getRun(runId);
    const specRow = run ? await scope.getSpec(run.specId) : null;
    const parsed = specRow ? parseLeadSpec(specRow.spec) : null;
    specByRun.set(runId, parsed?.ok ? parsed.spec : null);
    verdictsByRun.set(runId, (await scope.verdictsFor(runId)) as Verdict[]);
  }

  // Facts live in the claim table, not on the entity — read the current value for each.
  const companyFacts = new Map<string, Map<string, string>>();
  for (const companyId of new Set(rows.map((r) => r.companyId))) {
    const map = new Map<string, string>();
    for (const claim of await scope.claimsFor('company', companyId)) {
      if (claim.status !== 'supported') continue;
      const existing = map.get(claim.field);
      if (existing === undefined) map.set(claim.field, String(claim.value ?? ''));
    }
    companyFacts.set(companyId, map);
  }

  const roleByPerson = new Map<string, string>();
  for (const personId of new Set(rows.map((r) => r.personId).filter((id): id is string => !!id))) {
    const role = (await scope.claimsFor('person', personId)).find((c) => c.field === 'person.role');
    if (role && typeof role.value === 'string') roleByPerson.set(personId, role.value);
  }

  return rows.map((row) => {
    const company = companies.get(row.companyId);
    const person = row.personId ? people.get(row.personId) : undefined;
    const facts = companyFacts.get(row.companyId) ?? new Map<string, string>();
    const spec = specByRun.get(row.runId) ?? null;
    const verdicts = (verdictsByRun.get(row.runId) ?? []).filter((v) => v.subjectId === row.companyId);

    const sources = new Set<string>();
    const evidenceIds = new Set<string>();
    for (const v of verdicts) {
      for (const id of Array.isArray(v.sourceIds) ? (v.sourceIds as string[]) : []) sources.add(id);
      for (const s of Array.isArray(v.spans) ? (v.spans as EvidenceSpan[]) : []) evidenceIds.add(s.evidenceId);
    }

    const reasons = buildReasons(verdicts, spec, person?.fullName ?? null, roleByPerson.get(person?.id ?? ''));
    const scored = row.status !== 'held_insufficient_evidence';

    return {
      id: row.id,
      runId: row.runId,
      companyId: row.companyId,
      personId: row.personId,

      company: company?.canonicalName ?? 'Unknown company',
      website: company?.primaryDomain ?? null,
      industry: facts.get('company.industry') ?? null,
      employees: facts.get('company.employeeCount') ?? null,
      location: facts.get('company.location') ?? facts.get('company.country') ?? company?.country ?? null,

      person: person?.fullName ?? null,
      role: person ? (roleByPerson.get(person.id) ?? null) : null,

      email: row.email,
      emailStatus: row.emailStatus as Lead['emailStatus'],

      score: Math.round(row.score),
      scoreShown: scored,
      confidence: confidenceOf(row.coverage, sources.size, scored),
      coverage: row.coverage,
      status: row.status,
      heldReason: row.heldReason,

      reasons,
      whyShort:
        reasons.filter((r) => r.met).slice(0, 3).map((r) => r.text).join(' · ') ||
        (scored ? 'No criterion could be confirmed' : 'Not enough evidence to rank'),
      sources: [...sources],
      evidenceCount: evidenceIds.size,
      foundLabel: relative(row.createdAt),
    };
  });
}

/**
 * The three-to-five reasons a lead is a lead.
 *
 * Each one is a criterion the rubric actually decided, phrased from the criterion's own name. A
 * criterion that could not be established is included as unmet rather than dropped, because "we
 * could not check this" is information the user needs before they pick up the phone.
 */
function buildReasons(
  verdicts: Verdict[],
  spec: LeadSpec | null,
  personName: string | null,
  role: string | undefined,
): Reason[] {
  const nameOf = (id: string) => spec?.rubric.criteria.find((c) => c.id === id)?.name ?? id.replace(/_/g, ' ');

  const out: Reason[] = verdicts
    .filter((v) => v.verdict === 'pass')
    .sort((a, b) => b.pointsAwarded - a.pointsAwarded)
    .map((v) => ({ text: nameOf(v.criterionId), met: true, points: Math.round(v.pointsAwarded) }));

  if (personName) {
    out.push({ text: role ? `${role} identified: ${personName}` : `Contact found: ${personName}`, met: true, points: 0 });
  }

  for (const v of verdicts.filter((v) => v.verdict !== 'pass').slice(0, 3)) {
    out.push({
      text: v.verdict === 'fail' ? `Did not meet: ${nameOf(v.criterionId)}` : `Could not check: ${nameOf(v.criterionId)}`,
      met: false,
      points: 0,
    });
  }

  return out.slice(0, 6);
}

function relative(date: Date): string {
  const s = Math.round((Date.now() - date.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
