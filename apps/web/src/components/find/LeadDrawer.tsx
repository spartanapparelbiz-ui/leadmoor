'use client';

import { useActionState, useEffect, useState } from 'react';
import type { Lead } from '@/lib/lead';
import { sourceName } from '@/lib/lead';
import { loadDossier, type Dossier } from '@/lib/actions/dossier';
import { findMoreLikeThis, type Result } from '@/lib/actions/find';
import { Conf, Email } from './Results';
import { Evidence } from './Evidence';
import { SubmitButton } from '../SubmitButton';
import { IconClose, IconExternal, IconSparkle } from '../Icons';

/**
 * One lead, in full.
 *
 * Opens over the results so the user does not lose their place. The evidence loads on demand
 * rather than travelling with the table, so a hundred-row result set stays fast.
 */
export function LeadDrawer({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [loading, setLoading] = useState(true);
  const [more, moreAction] = useActionState<Result | null, FormData>(findMoreLikeThis, null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    loadDossier(lead.id)
      .then((d) => !cancelled && setDossier(d))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [lead.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <>
      <div className="scrim" onClick={onClose} aria-hidden="true" />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={lead.company}>
        <header className="drawer__h">
          <div className="col g4" style={{ minWidth: 0 }}>
            <h2 className="h1 truncate">{lead.company}</h2>
            {lead.website ? (
              <a
                href={`https://${lead.website}`}
                target="_blank"
                rel="noreferrer noopener"
                className="mono xs"
                style={{ color: 'var(--accent)' }}
              >
                {lead.website} <IconExternal />
              </a>
            ) : (
              <span className="xs faint">No verified website</span>
            )}
          </div>
          <div className="grow" />
          <button type="button" className="btn btn--ghost btn--ico" onClick={onClose} aria-label="Close">
            <IconClose />
          </button>
        </header>

        <div className="drawer__b">
          <section className="row g24" style={{ alignItems: 'flex-start' }}>
            <div className="col g2">
              <span className={`score score--xl ${lead.scoreShown ? (lead.score >= 75 ? 'score--hi' : '') : 'score--none'}`}>
                {lead.scoreShown ? lead.score : '—'}
              </span>
              <span className="xs faint">{lead.scoreShown ? 'out of 100' : 'not ranked'}</span>
            </div>
            <div className="col g8 grow">
              <div className="row g6 wrap">
                <Conf lead={lead} />
                <Email lead={lead} />
              </div>
              <div className="meter">
                <i
                  className={lead.coverage < 0.6 ? 'warn' : ''}
                  style={{ width: `${Math.max(3, Math.round(lead.coverage * 100))}%` }}
                />
              </div>
              <span className="xs faint">
                {Math.round(lead.coverage * 100)}% of the criteria could be checked from evidence we retrieved
                {lead.sources.length > 0 ? `, across ${lead.sources.length} source${lead.sources.length === 1 ? '' : 's'}` : ''}.
              </span>
            </div>
          </section>

          {lead.heldReason ? (
            <p className="note note--warn sm">
              <strong>Not ranked.</strong> {lead.heldReason}. Too little was established to score this fairly —
              which is not the same as scoring it poorly.
            </p>
          ) : null}

          <section className="col g10">
            <span className="label">Why this is a lead</span>
            <ul className="col g6" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
              {lead.reasons.map((r, i) => (
                <li key={`${r.text}-${i}`} className="row g8 sm" style={{ alignItems: 'flex-start' }}>
                  <span
                    aria-hidden="true"
                    style={{ color: r.met ? 'var(--accent)' : 'var(--faint)', width: 12, flexShrink: 0 }}
                  >
                    {r.met ? '✓' : '·'}
                  </span>
                  <span style={{ color: r.met ? 'var(--ink-2)' : 'var(--faint)' }}>{r.text}</span>
                  <div className="grow" />
                  {r.points > 0 ? <span className="mono xs faint">+{r.points}</span> : null}
                </li>
              ))}
            </ul>
          </section>

          <section className="col g10">
            <span className="label">Company</span>
            <dl className="crit">
              <dt>Website</dt>
              <dd>{lead.website ?? <span className="faint">Not established</span>}</dd>
              <dt>Industry</dt>
              <dd>{lead.industry ?? <span className="faint">Not established</span>}</dd>
              <dt>Employees</dt>
              <dd>{lead.employees ?? <span className="faint">Not established</span>}</dd>
              <dt>Location</dt>
              <dd>{lead.location ?? <span className="faint">Not established</span>}</dd>
            </dl>
          </section>

          <section className="col g10">
            <span className="label">Contact</span>
            {lead.person ? (
              <dl className="crit">
                <dt>Name</dt>
                <dd>{lead.person}</dd>
                <dt>Role</dt>
                <dd>{lead.role ?? <span className="faint">Not established</span>}</dd>
                <dt>Email</dt>
                <dd>
                  {lead.email ? (
                    <a href={`mailto:${lead.email}`} className="mono" style={{ color: 'var(--accent)' }}>
                      {lead.email}
                    </a>
                  ) : (
                    <span className="faint">
                      Unavailable — no permitted source contained one, and LeadMoor does not guess.
                    </span>
                  )}
                </dd>
              </dl>
            ) : (
              <p className="sm muted" style={{ margin: 0 }}>
                No decision maker was named on this company&rsquo;s own pages or in a permitted API. The company
                is still ranked on its own merits.
              </p>
            )}
          </section>

          <section className="col g10">
            <div className="row g8">
              <span className="label">Evidence</span>
              <div className="grow" />
              <div className="row g4">
                {lead.sources.map((s) => (
                  <span key={s} className="pill pill--mono">
                    {sourceName(s)}
                  </span>
                ))}
              </div>
            </div>
            {loading ? (
              <div className="col g6">
                <span className="skel" style={{ height: 40 }} />
                <span className="skel" style={{ height: 40 }} />
              </div>
            ) : dossier ? (
              <Evidence dossier={dossier} />
            ) : (
              <p className="sm muted" style={{ margin: 0 }}>
                This lead is no longer available.
              </p>
            )}
          </section>
        </div>

        <footer className="drawer__f">
          <form action={moreAction}>
            <input type="hidden" name="leadId" value={lead.id} />
            <SubmitButton className="btn btn--pri btn--sm" pendingLabel="Searching…">
              <IconSparkle />
              Find more like this
            </SubmitButton>
          </form>
          {lead.email ? (
            <a href={`mailto:${lead.email}`} className="btn btn--sm">
              Email {lead.person?.split(' ')[0] ?? 'contact'}
            </a>
          ) : null}
          {more?.error ? (
            <span className="xs" role="alert" style={{ color: 'var(--crit)' }}>
              {more.error}
            </span>
          ) : null}
        </footer>
      </aside>
    </>
  );
}
