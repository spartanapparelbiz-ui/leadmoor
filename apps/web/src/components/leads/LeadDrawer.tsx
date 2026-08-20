'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { LeadView } from '@/lib/leads';
import { loadDossier, type Dossier } from '@/lib/actions/dossier';
import { EvidenceList } from './EvidencePanel';
import { ScoreBadge, ScoreBreakdown } from './ScoreBreakdown';
import { EmailPill, StatusPill } from './LeadResults';
import { LeadActions } from './LeadActions';
import { IconClose, IconExternal } from '../Icons';

/**
 * The lead drawer.
 *
 * Opens over the results without losing the user's place in the list. The dossier — every claim,
 * every criterion verdict, every cited document — loads on demand rather than being sent with the
 * table, so a hundred-row result set stays fast.
 */
export function LeadDrawer({ view, runId, onClose }: { view: LeadView; runId: string; onClose: () => void }) {
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'why' | 'facts' | 'sources'>('why');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setDossier(null);
    loadDossier(view.lead.id)
      .then((d) => {
        if (!cancelled) setDossier(d);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [view.lead.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  const { lead, company, person } = view;
  const passing = dossier?.criteria.filter((c) => c.verdict === 'pass') ?? [];
  const unknown = dossier?.criteria.filter((c) => c.verdict === 'unknown') ?? [];
  const failing = dossier?.criteria.filter((c) => c.verdict === 'fail') ?? [];

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Lead: ${company?.canonicalName ?? ''}`}>
        <header className="drawer__head">
          <div className="col g-2" style={{ minWidth: 0 }}>
            <h2 className="t-section truncate">{company?.canonicalName ?? 'Unknown company'}</h2>
            <div className="row g-6 wrap">
              {company?.primaryDomain ? (
                <a
                  href={`https://${company.primaryDomain}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="mono t-xs"
                >
                  {company.primaryDomain} <IconExternal />
                </a>
              ) : (
                <span className="pill pill--unknown">No verified domain</span>
              )}
              <StatusPill status={lead.status} />
            </div>
          </div>
          <div className="grow" />
          <button type="button" className="btn btn--ghost btn--icon" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </header>

        <div className="drawer__body col g-18">
          <section className="row g-20 wrap" style={{ alignItems: 'flex-start' }}>
            <ScoreBadge
              score={lead.score}
              band={lead.band}
              coverage={lead.coverage}
              status={lead.status}
              size="xl"
            />
            <div className="grow" style={{ minWidth: 200 }}>
              <ScoreBreakdown subScores={view.subScores} />
            </div>
          </section>

          {lead.heldReason ? (
            <p className="notice t-sm" style={{ margin: 0 }}>
              <strong>Held rather than scored.</strong> {lead.heldReason}. Too little was established to rank
              this company fairly — which is not the same as ranking it poorly.
            </p>
          ) : null}

          <section className="card" style={{ margin: 0 }}>
            <div className="card__body col g-8">
              <span className="t-label">Decision maker</span>
              {person ? (
                <>
                  <div className="row g-8 wrap">
                    <strong>{person.fullName}</strong>
                    {person.title ? <span className="muted t-sm">{person.title}</span> : null}
                  </div>
                  <div className="row g-8 wrap">
                    <EmailPill status={lead.emailStatus} />
                    {lead.email ? (
                      <a href={`mailto:${lead.email}`} className="mono t-sm">
                        {lead.email}
                      </a>
                    ) : (
                      <span className="muted t-sm">
                        No address appeared in any permitted source. LeadMoor never guesses one from a pattern.
                      </span>
                    )}
                  </div>
                </>
              ) : (
                <p className="muted t-sm" style={{ margin: 0 }}>
                  No decision maker was named on this company&rsquo;s own pages or in a permitted API. The
                  company still scored on its own merits.
                </p>
              )}
            </div>
          </section>

          <div className="tabs" role="tablist" aria-label="Dossier sections">
            {(
              [
                ['why', 'Why this lead'],
                ['facts', 'Facts and sources'],
                ['sources', 'Documents'],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={tab === key}
                className="tab"
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="col g-8">
              <span className="skeleton" style={{ height: 18, width: '60%' }} />
              <span className="skeleton" style={{ height: 52 }} />
              <span className="skeleton" style={{ height: 52 }} />
            </div>
          ) : !dossier ? (
            <p className="muted t-sm">This lead is no longer available.</p>
          ) : tab === 'why' ? (
            <section className="col g-14">
              <p className="t-sm" style={{ margin: 0 }}>
                {dossier.rationale || 'No criterion could be confirmed from the evidence we retrieved.'}
              </p>

              {passing.map((c) => (
                <div key={c.criterionId} className="col g-6">
                  <div className="row g-8">
                    <span className="pill pill--ok">Pass</span>
                    <strong className="t-sm">{c.name}</strong>
                    <div className="grow" />
                    <span className="mono t-xs faint">
                      +{Math.round(c.pointsAwarded)} of {Math.round(c.weight)}
                    </span>
                  </div>
                  {c.reasoning ? (
                    <p className="muted t-sm" style={{ margin: 0 }}>
                      {c.reasoning}
                    </p>
                  ) : null}
                  <EvidenceList citations={c.citations} />
                </div>
              ))}

              {failing.map((c) => (
                <div key={c.criterionId} className="col g-6">
                  <div className="row g-8">
                    <span className="pill pill--crit">Fail</span>
                    <strong className="t-sm">{c.name}</strong>
                  </div>
                  {c.reasoning ? (
                    <p className="muted t-sm" style={{ margin: 0 }}>
                      {c.reasoning}
                    </p>
                  ) : null}
                  <EvidenceList citations={c.citations} />
                </div>
              ))}

              {unknown.length > 0 || dossier.notEstablished.length > 0 ? (
                <div className="col g-6">
                  <span className="t-label">Could not be established</span>
                  <p className="muted t-sm" style={{ margin: 0 }}>
                    These counted as unknown, not as failures — they neither added points nor subtracted them.
                  </p>
                  <div className="row g-4 wrap">
                    {unknown.map((c) => (
                      <span key={c.criterionId} className="pill pill--unknown" title={c.reasoning}>
                        {c.name}
                      </span>
                    ))}
                    {dossier.notEstablished.map((name) => (
                      <span key={name} className="pill pill--unknown" title="No verdict was produced for this criterion.">
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </section>
          ) : tab === 'facts' ? (
            <section className="col g-14">
              {dossier.facts.length === 0 && dossier.personFacts.length === 0 ? (
                <p className="muted t-sm" style={{ margin: 0 }}>
                  No supported claim was recorded for this company. Every fact LeadMoor stores must cite a
                  document, so an empty list means nothing could be retrieved — not that the facts are unknown
                  to the world.
                </p>
              ) : null}

              {dossier.facts.map((fact) => (
                <FactBlock key={`${fact.field}-${fact.value}`} fact={fact} />
              ))}

              {dossier.personFacts.length > 0 ? (
                <>
                  <span className="t-label">About {dossier.personName}</span>
                  {dossier.personFacts.map((fact) => (
                    <FactBlock key={`p-${fact.field}-${fact.value}`} fact={fact} />
                  ))}
                </>
              ) : null}
            </section>
          ) : (
            <section className="col g-8">
              <p className="muted t-sm" style={{ margin: 0 }}>
                {dossier.documents.length} document{dossier.documents.length === 1 ? '' : 's'} were retrieved and
                stored for this lead. Each is content-addressed, so a citation always points at the exact bytes
                that were read.
              </p>
              {dossier.documents.map((doc) => (
                <div key={doc.evidenceId} className="col g-2" style={{ paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                  <a href={doc.url} target="_blank" rel="noreferrer noopener" className="t-sm truncate">
                    {doc.title ?? doc.host}
                  </a>
                  <span className="mono t-xs faint truncate">
                    {doc.sourceId} · {doc.contentHash.slice(0, 16)}… · {new Date(doc.fetchedAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </section>
          )}
        </div>

        <footer className="drawer__foot">
          <Link href={`/companies/${lead.companyId}`} className="btn btn--sm">
            Company page
          </Link>
          <Link href={`/runs/${runId}`} className="btn btn--ghost btn--sm">
            View run
          </Link>
          <div className="grow" />
          <LeadActions
            leadId={lead.id}
            personId={lead.personId}
            personName={person?.fullName ?? null}
            suppressed={lead.status === 'suppressed'}
            onDone={onClose}
          />
        </footer>
      </aside>
    </>
  );
}

function FactBlock({ fact }: { fact: import('@/lib/actions/dossier').DossierFact }) {
  return (
    <div className="col g-6">
      <div className="row g-8 wrap">
        <span className="t-label">{fact.label}</span>
        <strong className="t-sm">{fact.value}</strong>
        {fact.conflicting ? (
          <span
            className="pill pill--warn"
            title="Two sources disagree about this value. Both claims are kept; the higher-confidence one is shown."
          >
            Sources disagree
          </span>
        ) : null}
      </div>
      <EvidenceList citations={fact.citations} />
    </div>
  );
}
