import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { EvidenceSpan } from '@leadmoor/core';
import { ready } from '@/lib/services';
import { requireSession } from '@/lib/session';
import { absoluteTime, hostOf, humanize, relativeTime } from '@/lib/format';
import { CompanyActions } from '@/components/companies/CompanyActions';
import { EmailPill } from '@/components/leads/LeadResults';
import { IconExternal } from '@/components/Icons';

export const metadata: Metadata = { title: 'Company' };
export const dynamic = 'force-dynamic';

/**
 * The company page.
 *
 * A timeline, not a profile card: every claim carries when it was observed and which document said
 * so, so a value that changed over time reads as a history rather than as a contradiction.
 */
export default async function CompanyPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  await ready();
  const { scope } = await requireSession();

  const company = await scope.getCompany(companyId);
  if (!company) notFound();

  const [claims, people, leads] = await Promise.all([
    scope.claimsFor('company', companyId),
    scope.listPeople({ companyId, limit: 100 }),
    scope.listLeads({ limit: 2000, includeSuppressed: true }),
  ]);

  const companyLeads = leads.filter((l) => l.companyId === companyId);
  const evidenceIds = new Set<string>();
  for (const c of claims) {
    for (const s of (Array.isArray(c.spans) ? (c.spans as EvidenceSpan[]) : [])) evidenceIds.add(s.evidenceId);
  }
  const docs = await scope.evidenceByIds([...evidenceIds]);
  const docById = new Map(docs.map((d) => [d.id, d]));

  const timeline = [...claims].sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());

  return (
    <div className="page page--narrow">
      <div className="pagehead">
        <div style={{ minWidth: 0 }}>
          <span className="t-label">Company</span>
          <h1 className="t-page" style={{ marginTop: 2 }}>
            {company.canonicalName}
          </h1>
          <div className="row g-8 wrap" style={{ marginTop: 4 }}>
            {company.primaryDomain ? (
              <a
                href={`https://${company.primaryDomain}`}
                target="_blank"
                rel="noreferrer noopener"
                className="mono t-xs"
              >
                {company.primaryDomain} <IconExternal />
              </a>
            ) : (
              <span className="pill pill--unknown" title="No domain could be verified from a permitted source.">
                No verified domain
              </span>
            )}
            {company.country ? <span className="pill pill--plain">{company.country}</span> : null}
          </div>
        </div>
        <div className="grow" />
        <CompanyActions companyId={companyId} companyName={company.canonicalName} />
      </div>

      <section className="grid-side">
        <div className="card">
          <div className="card__head">
            <span className="t-section">Leads</span>
          </div>
          <div className="card__body col g-8">
            {companyLeads.length === 0 ? (
              <p className="muted t-sm" style={{ margin: 0 }}>
                No lead has been produced for this company yet.
              </p>
            ) : (
              companyLeads.map((lead) => (
                <Link key={lead.id} href={`/leads?lead=${lead.id}`} className="row g-8" style={{ padding: '4px 0' }}>
                  <span className="mono" style={{ fontWeight: 600, minWidth: 30 }}>
                    {lead.status === 'held_insufficient_evidence' ? '—' : Math.round(lead.score)}
                  </span>
                  <span className="t-sm truncate">{lead.rationale || lead.heldReason || 'Scored'}</span>
                  <div className="grow" />
                  <span className="mono t-xs faint">{relativeTime(lead.createdAt)}</span>
                </Link>
              ))
            )}
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <span className="t-section">People</span>
            <div className="grow" />
            <span className="mono t-xs faint">{people.length}</span>
          </div>
          <div className="card__body col g-8">
            {people.length === 0 ? (
              <p className="muted t-sm" style={{ margin: 0 }}>
                No named role holder was found on a permitted public page.
              </p>
            ) : (
              people.map((p) => {
                const lead = companyLeads.find((l) => l.personId === p.id);
                return (
                  <div key={p.id} className="row g-8">
                    <span className="t-sm">{p.fullName}</span>
                    <div className="grow" />
                    <EmailPill status={lead?.emailStatus ?? 'unavailable'} />
                  </div>
                );
              })
            )}
          </div>
        </div>
      </section>

      <section style={{ marginTop: 24 }}>
        <div className="subhead">
          <h2 className="t-section">What we know, and when we learned it</h2>
          <div className="grow" />
          <span className="mono t-xs faint">{timeline.length} claims</span>
        </div>

        {timeline.length === 0 ? (
          <div className="card">
            <div className="card__body">
              <p className="muted t-sm" style={{ margin: 0 }}>
                No claim has been recorded for this company. LeadMoor stores a fact only when a retrieved
                document supports it, so an empty history means nothing could be retrieved — not that the
                company has no attributes.
              </p>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="card__body">
              <ol className="timeline">
                {timeline.map((claim) => {
                  const spans = Array.isArray(claim.spans) ? (claim.spans as EvidenceSpan[]) : [];
                  const doc = spans[0] ? docById.get(spans[0].evidenceId) : undefined;

                  return (
                    <li key={claim.id} className="timeline__item">
                      <div className="row g-8 wrap">
                        <span className="t-label">{humanize(claim.field.replace(/^company\./, ''))}</span>
                        <strong className="t-sm">{String(claim.value)}</strong>
                        <div className="grow" />
                        {claim.status !== 'supported' ? (
                          <span className="pill pill--warn">{claim.status.replace(/_/g, ' ')}</span>
                        ) : null}
                        <span className="mono t-xs faint" title={absoluteTime(claim.observedAt)}>
                          {relativeTime(claim.observedAt)}
                        </span>
                      </div>
                      {spans[0]?.quote ? (
                        <p className="quote" style={{ marginTop: 6 }}>
                          “{spans[0].quote}”
                        </p>
                      ) : null}
                      <div className="row g-8 wrap" style={{ marginTop: 4 }}>
                        <span className="mono t-xs faint">{claim.sourceId}</span>
                        {doc ? (
                          <a
                            href={doc.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="mono t-xs truncate"
                            style={{ maxWidth: 260 }}
                          >
                            {hostOf(doc.url)}
                          </a>
                        ) : null}
                        <span className="mono t-xs faint">confidence {claim.confidence.toFixed(2)}</span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
