import 'server-only';
import type { LeadSpec } from '@leadmoor/core';
import { parseLeadSpec } from '@leadmoor/core';
import type { WorkspaceScope } from '@leadmoor/db';
import { computeSubScores, type SubScore, type Verdict } from '@leadmoor/scoring';

export type { SubScore } from '@leadmoor/scoring';

/** One lead, with everything the table, the drawer, and the export preview need to render it. */
export interface LeadView {
  lead: {
    id: string;
    runId: string;
    companyId: string;
    personId: string | null;
    score: number;
    band: string;
    coverage: number;
    status: string;
    heldReason: string | null;
    emailStatus: string;
    email: string | null;
    emailSourceId: string | null;
    rationale: string;
    createdAt: Date;
  };
  company: { id: string; canonicalName: string; primaryDomain: string | null; country: string | null } | null;
  person: { id: string; fullName: string; title: string | null } | null;
  subScores: SubScore[];
  sourceCount: number;
}

/**
 * Lead view assembly.
 *
 * One place builds the shape the results table, the drawer, and the export preview all read, so a
 * lead cannot look like one thing in a list and another thing when opened. Everything here is read
 * through a WorkspaceScope, so a lead from another tenant is simply not in the result.
 */

/** Loads leads with their company, person, and sub-scores, ready to render. */
export async function loadLeadViews(
  scope: WorkspaceScope,
  opts: { runId?: string; includeSuppressed?: boolean; limit?: number } = {},
): Promise<LeadView[]> {
  const leads = await scope.listLeads(opts);
  if (leads.length === 0) return [];

  const runIds = [...new Set(leads.map((l) => l.runId))];
  const companies = new Map((await scope.listCompanies({ limit: 2000 })).map((c) => [c.id, c]));
  const people = new Map((await scope.listPeople({ limit: 2000 })).map((p) => [p.id, p]));

  const specByRun = new Map<string, LeadSpec | null>();
  const verdictsByRun = new Map<string, Verdict[]>();

  for (const runId of runIds) {
    const run = await scope.getRun(runId);
    const specRow = run ? await scope.getSpec(run.specId) : null;
    const parsed = specRow ? parseLeadSpec(specRow.spec) : null;
    specByRun.set(runId, parsed?.ok ? parsed.spec : null);
    verdictsByRun.set(runId, (await scope.verdictsFor(runId)) as Verdict[]);
  }

  // A person's current title is a claim like any other, so it is read from the claim table.
  const titleByPerson = new Map<string, string>();
  for (const personId of new Set(leads.map((l) => l.personId).filter((id): id is string => !!id))) {
    const claims = await scope.claimsFor('person', personId);
    const role = claims.find((c) => c.field === 'person.role');
    if (role && typeof role.value === 'string') titleByPerson.set(personId, role.value);
  }

  return leads.map((lead) => {
    const company = companies.get(lead.companyId) ?? null;
    const personRow = lead.personId ? (people.get(lead.personId) ?? null) : null;
    const person = personRow
      ? { id: personRow.id, fullName: personRow.fullName, title: titleByPerson.get(personRow.id) ?? null }
      : null;

    const view: LeadView['lead'] = {
      id: lead.id,
      runId: lead.runId,
      companyId: lead.companyId,
      personId: lead.personId,
      score: lead.score,
      band: lead.band,
      coverage: lead.coverage,
      status: lead.status,
      heldReason: lead.heldReason,
      emailStatus: lead.emailStatus,
      email: lead.email,
      emailSourceId: lead.emailSourceId,
      rationale: lead.rationale,
      createdAt: lead.createdAt,
    };

    const relevant = (verdictsByRun.get(lead.runId) ?? []).filter((v) => v.subjectId === lead.companyId);
    const { subScores, sourceCount } = computeSubScores(view, person, specByRun.get(lead.runId) ?? null, relevant);

    return {
      lead: view,
      company: company
        ? {
            id: company.id,
            canonicalName: company.canonicalName,
            primaryDomain: company.primaryDomain,
            country: company.country,
          }
        : null,
      person,
      subScores,
      sourceCount,
    };
  });
}
