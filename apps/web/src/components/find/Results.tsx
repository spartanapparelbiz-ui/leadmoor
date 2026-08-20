'use client';

import { useMemo, useState } from 'react';
import type { Lead } from '@/lib/lead';
import { sourceName } from '@/lib/lead';
import { LeadDrawer } from './LeadDrawer';
import { Refine } from './Refine';
import { Export } from './Export';
import { IconSearch } from '../Icons';

/**
 * The results.
 *
 * Filtering narrows what is displayed over rows the server already scoped to this account — it is
 * a convenience, not a security boundary. Leads held for insufficient evidence are shown by
 * default, because "we could not establish enough to rank this" is a result the user needs rather
 * than noise to hide.
 */

const EMAIL_FILTERS = [
  { key: 'verified', label: 'Verified email' },
  { key: 'unverified', label: 'Unverified' },
  { key: 'unavailable', label: 'No email' },
] as const;

const CONF_FILTERS = [
  { key: 'high', label: 'High confidence' },
  { key: 'medium', label: 'Medium' },
  { key: 'low', label: 'Low' },
] as const;

export function Results({ leads, runId }: { leads: Lead[]; runId: string }) {
  const [q, setQ] = useState('');
  const [minScore, setMinScore] = useState(0);
  const [emails, setEmails] = useState<Set<string>>(new Set());
  const [confs, setConfs] = useState<Set<string>>(new Set());
  const [roleOnly, setRoleOnly] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    return leads.filter((l) => {
      if (l.scoreShown && l.score < minScore) return false;
      if (emails.size > 0 && !emails.has(l.emailStatus)) return false;
      if (confs.size > 0 && !confs.has(l.confidence)) return false;
      if (roleOnly && !l.person) return false;
      if (!term) return true;
      return [l.company, l.website, l.person, l.role, l.industry, l.location]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(term));
    });
  }, [leads, q, minScore, emails, confs, roleOnly]);

  const toggle = (set: Set<string>, key: string, apply: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    apply(next);
  };

  const clear = () => {
    setQ('');
    setMinScore(0);
    setEmails(new Set());
    setConfs(new Set());
    setRoleOnly(false);
  };

  const lead = open ? (leads.find((l) => l.id === open) ?? null) : null;

  return (
    <div className="col g16">
      <div className="row g10 wrap">
        <div className="row g6" style={{ flex: '1 1 260px', minWidth: 0 }}>
          <IconSearch />
          <label htmlFor="q" className="sr">
            Filter results
          </label>
          <input
            id="q"
            className="input"
            placeholder="Filter by company, person, role, or place"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <div className="grow" />
        <Refine runId={runId} />
        <Export runId={runId} count={shown.length} />
      </div>

      <div className="filters">
        <label className="row g6 xs muted" style={{ gap: 8 }}>
          Score ≥
          <input
            type="range"
            min={0}
            max={90}
            step={10}
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            style={{ width: 96, accentColor: 'var(--accent)' }}
            aria-label="Minimum score"
          />
          <span className="mono" style={{ width: 20, color: 'var(--ink)' }}>
            {minScore}
          </span>
        </label>

        {CONF_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className="chip"
            aria-pressed={confs.has(f.key)}
            onClick={() => toggle(confs, f.key, setConfs)}
          >
            {f.label}
          </button>
        ))}
        {EMAIL_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className="chip"
            aria-pressed={emails.has(f.key)}
            onClick={() => toggle(emails, f.key, setEmails)}
          >
            {f.label}
          </button>
        ))}
        <button type="button" className="chip" aria-pressed={roleOnly} onClick={() => setRoleOnly((v) => !v)}>
          Has a contact
        </button>

        <div className="grow" />
        <span className="xs faint nowrap" aria-live="polite">
          {shown.length} of {leads.length}
        </span>
      </div>

      {shown.length === 0 ? (
        <div className="empty">
          <h3>Nothing matches those filters</h3>
          <p>Every lead this search found is still here — clear a filter to see them.</p>
          <button type="button" className="btn btn--sm" onClick={clear}>
            Clear filters
          </button>
        </div>
      ) : (
        <>
          <div className="tw desk">
            <table className="t">
              <thead>
                <tr>
                  <th className="num">Score</th>
                  <th>Company</th>
                  <th>Person</th>
                  <th>Role</th>
                  <th>Email</th>
                  <th>Why they fit</th>
                  <th>Source</th>
                  <th>Confidence</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((l) => (
                  <tr key={l.id}>
                    <td className="num">
                      <Score lead={l} />
                    </td>
                    <td>
                      <button type="button" className="tname" onClick={() => setOpen(l.id)}>
                        {l.company}
                      </button>
                      <div className="mono xs faint truncate" style={{ maxWidth: 190 }}>
                        {l.website ?? 'no verified site'}
                      </div>
                    </td>
                    <td>{l.person ?? <span className="faint">—</span>}</td>
                    <td className="muted">{l.role ?? <span className="faint">—</span>}</td>
                    <td>
                      <Email lead={l} />
                    </td>
                    <td style={{ maxWidth: 300 }}>
                      <span className="sm">{l.whyShort}</span>
                    </td>
                    <td>
                      <div className="row g4 wrap" style={{ maxWidth: 140 }}>
                        {l.sources.length === 0 ? (
                          <span className="faint xs">—</span>
                        ) : (
                          l.sources.slice(0, 2).map((s) => (
                            <span key={s} className="pill pill--mono">
                              {sourceName(s)}
                            </span>
                          ))
                        )}
                      </div>
                    </td>
                    <td>
                      <Conf lead={l} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="cards">
            {shown.map((l) => (
              <button key={l.id} type="button" className="leadcard" onClick={() => setOpen(l.id)}>
                <div className="row g12" style={{ alignItems: 'flex-start' }}>
                  <Score lead={l} />
                  <span className="col g2" style={{ minWidth: 0 }}>
                    <strong className="truncate">{l.company}</strong>
                    <span className="mono xs faint truncate">{l.website ?? 'no verified site'}</span>
                  </span>
                </div>
                <div className="row g6 wrap" style={{ marginTop: 10 }}>
                  <Email lead={l} />
                  <Conf lead={l} />
                </div>
                {l.person ? (
                  <p className="sm" style={{ margin: '10px 0 0' }}>
                    {l.person}
                    {l.role ? <span className="muted"> · {l.role}</span> : null}
                  </p>
                ) : null}
                <p className="sm muted" style={{ margin: '8px 0 0' }}>
                  {l.whyShort}
                </p>
              </button>
            ))}
          </div>
        </>
      )}

      {lead ? <LeadDrawer lead={lead} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

function Score({ lead }: { lead: Lead }) {
  if (!lead.scoreShown) {
    return (
      <span className="score score--none" title={lead.heldReason ?? 'Not enough evidence to rank this.'}>
        —
      </span>
    );
  }
  const cls = lead.score >= 75 ? 'score--hi' : lead.score >= 50 ? 'score--mid' : 'score--lo';
  return <span className={`score ${cls}`}>{lead.score}</span>;
}

export function Email({ lead }: { lead: Lead }) {
  if (lead.emailStatus === 'verified') {
    return (
      <span className="pill pill--ok" title="This address appears in a document we retrieved and cite.">
        Verified
      </span>
    );
  }
  if (lead.emailStatus === 'unverified') {
    return (
      <span className="pill pill--warn" title="Found in one source and not corroborated. Never a guessed pattern.">
        Unverified
      </span>
    );
  }
  return (
    <span className="pill pill--flat" title="No permitted source contained an address. LeadMoor does not guess.">
      Unavailable
    </span>
  );
}

export function Conf({ lead }: { lead: Lead }) {
  const map = {
    high: { cls: 'pill pill--ok', label: 'High' },
    medium: { cls: 'pill pill--flat', label: 'Medium' },
    low: { cls: 'pill pill--flat', label: 'Low' },
  } as const;
  const v = map[lead.confidence];
  return (
    <span
      className={v.cls}
      title={`${Math.round(lead.coverage * 100)}% of the criteria could be checked, across ${lead.sources.length} source(s).`}
    >
      {v.label}
    </span>
  );
}
