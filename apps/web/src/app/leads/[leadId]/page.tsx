import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, eq } from 'drizzle-orm';
import { parseLeadSpec, type EvidenceSpan, type LeadSpec } from '@leadmoor/core';
import {
  claim as claimTable,
  company as companyTable,
  conflict as conflictTable,
  criterionVerdict as verdictTable,
  evidence as evidenceTable,
  lead as leadTable,
  leadSpec as leadSpecTable,
  person as personTable,
  run as runTable,
} from '@leadmoor/db';
import { ready, services } from '@/lib/services';
import { bandClass, emailChip, hostOf, statusChip, verdictChip } from '@/lib/format';
import { ActionForm } from '@/components/ActionForm';
import { DemoBanner } from '@/components/DemoBanner';
import { deleteCompanyAction, deletePersonAction, suppressLead } from '@/lib/actions';

export const dynamic = 'force-dynamic';

export default async function DossierPage({ params }: { params: Promise<{ leadId: string }> }) {
  const { leadId } = await params;
  await ready();
  const db = services().db;

  const lead = (await db.select().from(leadTable).where(eq(leadTable.id, leadId)).limit(1))[0];
  if (!lead) notFound();

  const company = (await db.select().from(companyTable).where(eq(companyTable.id, lead.companyId)).limit(1))[0];
  if (!company) notFound();

  const person = lead.personId
    ? (await db.select().from(personTable).where(eq(personTable.id, lead.personId)).limit(1))[0]
    : undefined;

  const run = (await db.select().from(runTable).where(eq(runTable.id, lead.runId)).limit(1))[0];
  const specRow = run ? (await db.select().from(leadSpecTable).where(eq(leadSpecTable.id, run.specId)).limit(1))[0] : undefined;
  const parsedSpec = specRow ? parseLeadSpec(specRow.spec) : null;
  const spec: LeadSpec | null = parsedSpec?.ok ? parsedSpec.spec : null;

  const verdicts = await db
    .select()
    .from(verdictTable)
    .where(and(eq(verdictTable.runId, lead.runId), eq(verdictTable.subjectId, company.id)));

  const companyClaims = await services().claims.getClaims('company', company.id);
  const personClaims = person ? await services().claims.getClaims('person', person.id) : [];
  const conflicts = await db
    .select()
    .from(conflictTable)
    .where(and(eq(conflictTable.subjectId, company.id)));

  // Load only the documents actually cited anywhere in this dossier.
  const citedIds = new Set<string>();
  for (const v of verdicts) for (const s of (v.spans ?? []) as EvidenceSpan[]) citedIds.add(s.evidenceId);
  for (const c of [...companyClaims, ...personClaims]) for (const s of c.spans) citedIds.add(s.evidenceId);
  const docs = await services().evidence.getMany([...citedIds]);

  const status = statusChip(lead.status);
  const email = emailChip(lead.emailStatus);
  const roleClaim = personClaims.find((c) => c.field === 'person.role' && c.status === 'supported');
  const nameClaim = personClaims.find((c) => c.field === 'person.fullName' && c.status === 'supported');
  const emailClaim = personClaims.find((c) => c.field === 'person.workEmail' && c.status === 'supported');

  const passing = verdicts.filter((v) => v.verdict === 'pass');
  const unknown = verdicts.filter((v) => v.verdict === 'unknown');
  const failing = verdicts.filter((v) => v.verdict === 'fail');

  return (
    <div className="shell shell--wide">
      {run?.isDemo ? <DemoBanner /> : null}

      <nav style={{ paddingTop: 28 }} aria-label="Breadcrumb">
        <Link href={`/runs/${lead.runId}`} className="btn btn--ghost btn--sm">
          ← Back to run
        </Link>
      </nav>

      <header style={{ padding: '12px 0 24px' }}>
        <div className="row gap-24 wrap" style={{ alignItems: 'flex-start' }}>
          <div style={{ minWidth: 0, flex: '1 1 340px' }}>
            <span className="eyebrow">Lead dossier</span>
            <h1 className="h-display" style={{ fontSize: '2.3rem', margin: '0.2em 0 0.25em' }}>
              {company.canonicalName}
            </h1>
            <div className="row gap-8 wrap">
              {company.primaryDomain ? (
                <a
                  href={`https://${company.primaryDomain}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mono small"
                >
                  {company.primaryDomain} ↗
                </a>
              ) : (
                <span className="chip chip--unknown">No verified domain</span>
              )}
              <span className={status.className}>{status.label}</span>
            </div>
          </div>

          <div style={{ textAlign: 'right' }}>
            <div className={`score score--lg ${bandClass(lead.band)}`}>
              {lead.status === 'held_insufficient_evidence' ? '—' : Math.round(lead.score)}
              <span className="score__of"> / 100</span>
            </div>
            <div className="stack gap-4" style={{ marginTop: 8, minWidth: 190 }}>
              <div className="meter" aria-hidden="true">
                <div
                  className={`meter__fill ${lead.coverage < 0.75 ? 'meter__fill--partial' : ''}`}
                  style={{ width: `${Math.round(lead.coverage * 100)}%` }}
                />
              </div>
              <span className="mono small muted">
                {Math.round(lead.coverage * 100)}% of the rubric could be evaluated
              </span>
            </div>
          </div>
        </div>

        {lead.heldReason ? (
          <p className="notice" style={{ marginTop: 18 }}>
            <strong>Held rather than scored.</strong> {lead.heldReason}. Too little was established to rank this
            company fairly — that is different from ranking it poorly.
          </p>
        ) : null}
      </header>

      <div className="grid-2">
        <div className="stack gap-16">
          <section className="panel">
            <div className="panel__head">
              <span className="eyebrow">Why this company</span>
            </div>
            <div className="panel__body stack gap-12">
              <p style={{ margin: 0 }}>{lead.rationale || 'No criteria could be confirmed from retrieved evidence.'}</p>
              {passing.length > 0 ? (
                <ul className="stack gap-4" style={{ margin: 0, paddingLeft: '1.1em' }}>
                  {passing.map((v) => (
                    <li key={v.id} className="small">
                      <strong>{criterionName(spec, v.criterionId)}</strong> — {v.reasoning}
                    </li>
                  ))}
                </ul>
              ) : null}
              {unknown.length > 0 ? (
                <p className="small muted" style={{ margin: 0 }}>
                  {unknown.length} criterion(s) could not be established from what we retrieved. They count as
                  unknown, not as failures.
                </p>
              ) : null}
            </div>
          </section>

          <section className="panel">
            <div className="panel__head">
              <span className="eyebrow">Qualification criteria</span>
              <div className="spacer" />
              <span className="mono small muted">
                {passing.length} pass · {unknown.length} unknown · {failing.length} fail
              </span>
            </div>
            <div className="stack">
              {verdicts.length === 0 ? (
                <p className="small muted" style={{ padding: 20, margin: 0 }}>
                  This company was dropped before scoring.
                </p>
              ) : (
                verdicts.map((v) => {
                  const chip = verdictChip(v.verdict, v.status);
                  const spans = (v.spans ?? []) as EvidenceSpan[];
                  return (
                    <details key={v.id} className="evidence">
                      <summary>
                        <span className={chip.className}>{chip.label}</span>
                        <span style={{ fontWeight: 600, minWidth: 0 }}>{criterionName(spec, v.criterionId)}</span>
                        {v.pointsAwarded > 0 ? (
                          <span className="mono small" style={{ color: 'var(--accent)' }}>
                            +{Math.round(v.pointsAwarded)}
                          </span>
                        ) : null}
                        <span className="mono small muted">
                          {spans.length > 0 ? `${spans.length} citation${spans.length === 1 ? '' : 's'}` : 'no citation'}
                        </span>
                      </summary>
                      <div className="evidence__body">
                        <p className="small" style={{ margin: 0 }}>
                          {v.reasoning}
                        </p>
                        {spans.length === 0 ? (
                          <p className="small muted" style={{ margin: 0 }}>
                            {v.status === 'not_configured'
                              ? 'This criterion needs a language model to judge, and none is configured. It contributed nothing to the score.'
                              : 'Nothing in the retrieved documents settled this, so it contributed nothing to the score.'}
                          </p>
                        ) : (
                          spans.map((span, i) => <EvidenceQuote key={i} span={span} docs={docs} />)
                        )}
                      </div>
                    </details>
                  );
                })
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel__head">
              <span className="eyebrow">Company facts and their sources</span>
            </div>
            <div className="stack">
              {companyClaims.length === 0 ? (
                <p className="small muted" style={{ padding: 20, margin: 0 }}>
                  No claims were recorded for this company.
                </p>
              ) : (
                companyClaims.map((claim) => (
                  <details key={claim.id} className="evidence">
                    <summary>
                      <span
                        className={
                          claim.status === 'supported'
                            ? 'chip chip--pass'
                            : claim.status === 'rejected'
                              ? 'chip chip--fail'
                              : 'chip chip--unknown'
                        }
                      >
                        {claim.status === 'supported' ? 'Supported' : claim.status === 'rejected' ? 'Rejected' : 'Insufficient'}
                      </span>
                      <span className="mono small" style={{ minWidth: 0 }}>
                        {claim.field}
                      </span>
                      <span style={{ fontWeight: 600 }}>
                        {claim.value === null ? '—' : String(claim.value)}
                      </span>
                    </summary>
                    <div className="evidence__body">
                      <div className="row gap-8 wrap small muted">
                        <span className="mono">{claim.sourceId}</span>
                        <span>·</span>
                        <span>{claim.extractor.replace(/_/g, ' ')}</span>
                        <span>·</span>
                        <span>confidence {claim.confidence.toFixed(2)}</span>
                        <span>·</span>
                        <span>observed {claim.observedAt.toISOString().slice(0, 10)}</span>
                      </div>
                      {claim.note ? (
                        <p className="small" style={{ margin: 0, color: 'var(--copper)' }}>
                          {claim.note}
                        </p>
                      ) : null}
                      {claim.spans.map((span, i) => (
                        <EvidenceQuote key={i} span={span} docs={docs} />
                      ))}
                    </div>
                  </details>
                ))
              )}
            </div>
          </section>

          {conflicts.length > 0 ? (
            <section className="panel">
              <div className="panel__head">
                <span className="eyebrow">Sources disagree</span>
              </div>
              <div className="panel__body stack gap-12">
                <p className="small muted" style={{ margin: 0 }}>
                  More than one source made a supported but different claim. Nothing was overwritten — the
                  highest-trust, most recent claim is shown above and the rest are kept.
                </p>
                {conflicts.map((c) => (
                  <div key={c.id} className="row gap-8">
                    <span className="chip chip--warn">{c.field}</span>
                    <span className="mono small muted">
                      {(c.claimIds as string[]).length} competing claims · {c.rule}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="stack gap-16">
          <section className="panel">
            <div className="panel__head">
              <span className="eyebrow">Decision maker</span>
            </div>
            <div className="panel__body stack gap-12">
              {person ? (
                <>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '1.05rem' }}>{person.fullName}</div>
                    <div className="muted">
                      {(roleClaim?.value as string | undefined) ?? 'Role not established'}
                    </div>
                  </div>

                  <div className="stack gap-8">
                    {nameClaim ? <MiniCite label="Name evidence" claimSpans={nameClaim.spans} docs={docs} /> : null}
                    {roleClaim ? <MiniCite label="Role evidence" claimSpans={roleClaim.spans} docs={docs} /> : null}
                  </div>

                  <div className="stack gap-8" style={{ borderTop: '1px solid var(--rule)', paddingTop: 12 }}>
                    <span className="eyebrow">Contact</span>
                    <span className={email.className}>{email.label}</span>
                    {lead.email ? (
                      <>
                        <span className="mono small">{lead.email}</span>
                        <p className="small muted" style={{ margin: 0 }}>
                          Published on the company&rsquo;s own site. Nobody has confirmed it is deliverable, so it is
                          reported as unverified — it was never guessed from a name pattern.
                        </p>
                        {emailClaim ? <MiniCite label="Where we found it" claimSpans={emailClaim.spans} docs={docs} /> : null}
                      </>
                    ) : (
                      <p className="small muted" style={{ margin: 0 }}>
                        No address for this person appeared in anything we retrieved. LeadMoor does not construct
                        addresses from name patterns, so this stays unavailable.
                      </p>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <span className="chip chip--unknown">No match found</span>
                  <p className="small muted" style={{ margin: 0 }}>
                    No person matching {spec ? spec.personas.titles.slice(0, 3).join(', ') : 'the target roles'} could
                    be identified with evidence on the pages we retrieved. Rather than guess, the lead is reported
                    without a contact.
                  </p>
                </>
              )}
            </div>
          </section>

          <section className="panel">
            <div className="panel__head">
              <span className="eyebrow">Sources</span>
              <div className="spacer" />
              <span className="mono small muted">{docs.size}</span>
            </div>
            <div className="panel__body panel__body--flush stack divide">
              {[...docs.values()].map((doc) => (
                <a
                  key={doc.id}
                  href={doc.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  style={{ padding: '11px 18px', display: 'block', textDecoration: 'none', color: 'inherit' }}
                >
                  <div className="row gap-8">
                    <span className="chip chip--neutral">{doc.documentRole.replace(/_/g, ' ')}</span>
                    <div className="spacer" />
                    <span className="mono small muted">{doc.fetchedAt.toISOString().slice(0, 10)}</span>
                  </div>
                  <div className="mono small" style={{ marginTop: 4, color: 'var(--accent)', wordBreak: 'break-all' }}>
                    {hostOf(doc.url)}
                    {new URL(doc.url).pathname === '/' ? '' : new URL(doc.url).pathname}
                  </div>
                  <div className="mono small muted" style={{ marginTop: 2 }}>
                    {doc.sourceId} · sha256 {doc.contentHash.slice(0, 12)}…
                  </div>
                </a>
              ))}
              {docs.size === 0 ? (
                <p className="small muted" style={{ padding: 18, margin: 0 }}>
                  No documents are cited by this lead.
                </p>
              ) : null}
            </div>
          </section>

          <section className="panel">
            <div className="panel__head">
              <span className="eyebrow">Manage</span>
            </div>
            <div className="panel__body stack gap-16">
              {lead.status !== 'suppressed' ? (
                <ActionForm
                  action={suppressLead}
                  submitLabel="Suppress this lead"
                  pendingLabel="Suppressing…"
                  submitClassName="btn btn--sm"
                  confirm="Suppress this lead? It will disappear from results and exports, here and in future runs."
                >
                  <input type="hidden" name="leadId" value={lead.id} />
                  <p className="small muted" style={{ margin: 0 }}>
                    Removes it from results and exports, now and in future runs. The record stays auditable.
                  </p>
                </ActionForm>
              ) : (
                <span className="chip chip--warn">Suppressed</span>
              )}

              {person ? (
                <ActionForm
                  action={deletePersonAction}
                  submitLabel="Delete this person"
                  pendingLabel="Deleting…"
                  submitClassName="btn btn--sm btn--danger"
                  confirm="Delete every personal record for this person? Their claims, identifiers, and email are removed permanently."
                >
                  <input type="hidden" name="personId" value={person.id} />
                  <input type="hidden" name="leadId" value={lead.id} />
                  <p className="small muted" style={{ margin: 0 }}>
                    Erases their claims, identifiers, and any address. The company and its score remain.
                  </p>
                </ActionForm>
              ) : null}

              <ActionForm
                action={deleteCompanyAction}
                submitLabel="Delete company and people"
                pendingLabel="Deleting…"
                submitClassName="btn btn--sm btn--danger"
                confirm="Delete this company and every person and claim attached to it? This cannot be undone."
              >
                <input type="hidden" name="companyId" value={company.id} />
                <p className="small muted" style={{ margin: 0 }}>
                  Erases the company, its people, and every claim about them.
                </p>
              </ActionForm>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

function criterionName(spec: LeadSpec | null, criterionId: string): string {
  return spec?.rubric.criteria.find((c) => c.id === criterionId)?.name ?? criterionId;
}

/**
 * Renders a citation with its surrounding text and the exact matched span highlighted.
 * A citation whose document is missing says so rather than rendering an unopenable link.
 */
function EvidenceQuote({
  span,
  docs,
}: {
  span: EvidenceSpan;
  docs: Map<string, { id: string; url: string; normalizedText: string; fetchedAt: Date; sourceId: string }>;
}) {
  const doc = docs.get(span.evidenceId);
  if (!doc) {
    return (
      <p className="small" style={{ margin: 0, color: 'var(--crit)' }}>
        Cited document {span.evidenceId} is no longer available.
      </p>
    );
  }

  const contextStart = Math.max(0, span.start - 220);
  const contextEnd = Math.min(doc.normalizedText.length, span.end + 220);
  const before = doc.normalizedText.slice(contextStart, span.start);
  const match = doc.normalizedText.slice(span.start, span.end);
  const after = doc.normalizedText.slice(span.end, contextEnd);

  return (
    <figure style={{ margin: 0 }}>
      <blockquote className="quote">
        {contextStart > 0 ? '…' : ''}
        {before}
        <mark>{match}</mark>
        {after}
        {contextEnd < doc.normalizedText.length ? '…' : ''}
      </blockquote>
      <figcaption className="row gap-8 wrap small muted" style={{ marginTop: 6 }}>
        <a href={doc.url} target="_blank" rel="noreferrer noopener" className="mono">
          {hostOf(doc.url)} ↗
        </a>
        <span>·</span>
        <span className="mono">{doc.sourceId}</span>
        <span>·</span>
        <span>retrieved {doc.fetchedAt.toISOString().replace('T', ' ').slice(0, 16)}</span>
        <span>·</span>
        <span className="mono">
          chars {span.start}–{span.end}
        </span>
      </figcaption>
    </figure>
  );
}

function MiniCite({
  label,
  claimSpans,
  docs,
}: {
  label: string;
  claimSpans: EvidenceSpan[];
  docs: Map<string, { id: string; url: string; normalizedText: string; fetchedAt: Date; sourceId: string }>;
}) {
  const span = claimSpans[0];
  if (!span) return null;
  const doc = docs.get(span.evidenceId);

  return (
    <div className="stack gap-4">
      <span className="eyebrow">{label}</span>
      <blockquote className="quote small" style={{ fontSize: '0.85rem' }}>
        {span.quote}
      </blockquote>
      {doc ? (
        <a href={doc.url} target="_blank" rel="noreferrer noopener" className="mono small">
          {hostOf(doc.url)} ↗
        </a>
      ) : null}
    </div>
  );
}
