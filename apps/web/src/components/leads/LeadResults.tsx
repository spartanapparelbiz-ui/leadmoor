'use client';

import { useMemo, useState } from 'react';
import type { LeadView } from '@/lib/leads';
import { LeadDrawer } from './LeadDrawer';
import { ScoreBadge } from './ScoreBreakdown';
import { IconColumns, IconFilter, IconSort } from '../Icons';

/**
 * The results surface: filter, sort, choose columns, open a lead.
 *
 * Filtering happens in the browser over rows the server already scoped to this workspace — it
 * narrows what is displayed, it is not a security boundary. Held leads are shown by default
 * because "we could not establish this" is a result the user needs to see, not noise to hide.
 */

type SortKey = 'score' | 'coverage' | 'company' | 'status' | 'found';

type ColumnKey = 'score' | 'company' | 'person' | 'title' | 'email' | 'why' | 'sources' | 'found';

/** `always` columns cannot be switched off — without them a row has nothing to identify it. */
const COLUMNS: ReadonlyArray<{ key: ColumnKey; label: string; always?: boolean }> = [
  { key: 'score', label: 'Score', always: true },
  { key: 'company', label: 'Company', always: true },
  { key: 'person', label: 'Decision maker' },
  { key: 'title', label: 'Role' },
  { key: 'email', label: 'Email' },
  { key: 'why', label: 'Why' },
  { key: 'sources', label: 'Sources' },
  { key: 'found', label: 'Found' },
];

const STATUS_FILTERS = [
  { key: 'qualified', label: 'Qualified' },
  { key: 'held_insufficient_evidence', label: 'Insufficient evidence' },
  { key: 'unqualified', label: 'Below threshold' },
  { key: 'disqualified', label: 'Disqualified' },
] as const;

const EMAIL_FILTERS = [
  { key: 'verified', label: 'Verified email' },
  { key: 'unverified', label: 'Unverified email' },
  { key: 'unavailable', label: 'No email' },
] as const;

export function LeadResults({
  views,
  runId,
  acrossRuns,
  initialStatus,
  initialEmail,
}: {
  views: LeadView[];
  runId?: string;
  /**
   * True on the cross-run view. The same company legitimately appears once per run it was found
   * in, so without a date those rows read as duplicates rather than as a history.
   */
  acrossRuns?: boolean;
  initialStatus?: string;
  initialEmail?: string;
}) {
  const [query, setQuery] = useState('');
  const [statuses, setStatuses] = useState<Set<string>>(new Set(initialStatus ? [initialStatus] : []));
  const [emails, setEmails] = useState<Set<string>>(new Set(initialEmail ? [initialEmail] : []));
  const [sort, setSort] = useState<SortKey>('score');
  const [openId, setOpenId] = useState<string | null>(null);
  const [columns, setColumns] = useState<Set<ColumnKey>>(
    new Set<ColumnKey>(
      acrossRuns
        ? ['score', 'company', 'person', 'title', 'email', 'found']
        : ['score', 'company', 'person', 'title', 'email', 'why'],
    ),
  );
  const [pickerOpen, setPickerOpen] = useState(false);

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    const rows = views.filter((v) => {
      if (statuses.size > 0 && !statuses.has(v.lead.status)) return false;
      if (emails.size > 0 && !emails.has(v.lead.emailStatus)) return false;
      if (!term) return true;
      return (
        (v.company?.canonicalName ?? '').toLowerCase().includes(term) ||
        (v.company?.primaryDomain ?? '').toLowerCase().includes(term) ||
        (v.person?.fullName ?? '').toLowerCase().includes(term) ||
        (v.person?.title ?? '').toLowerCase().includes(term)
      );
    });

    const sorted = [...rows];
    sorted.sort((a, b) => {
      if (sort === 'company') {
        return (a.company?.canonicalName ?? '').localeCompare(b.company?.canonicalName ?? '');
      }
      if (sort === 'coverage') return b.lead.coverage - a.lead.coverage || b.lead.score - a.lead.score;
      if (sort === 'status') return a.lead.status.localeCompare(b.lead.status) || b.lead.score - a.lead.score;
      if (sort === 'found') return b.lead.createdAt.getTime() - a.lead.createdAt.getTime();
      // Default: score, then coverage — a 90 proven on more of the rubric outranks a thin 90 —
      // then recency, so the newest evidence for an equal lead comes first.
      return (
        b.lead.score - a.lead.score ||
        b.lead.coverage - a.lead.coverage ||
        b.lead.createdAt.getTime() - a.lead.createdAt.getTime()
      );
    });
    return sorted;
  }, [views, query, statuses, emails, sort]);

  const open = openId ? (views.find((v) => v.lead.id === openId) ?? null) : null;
  const shown = COLUMNS.filter((c) => c.always || columns.has(c.key));

  const toggle = <T,>(set: Set<T>, value: T, apply: (next: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    apply(next);
  };

  return (
    <section className="col g-12">
      <div className="filterbar">
        <div className="row g-6" style={{ flex: '1 1 220px', minWidth: 0 }}>
          <IconFilter />
          <label htmlFor="lead-filter" className="sr-only">
            Filter results
          </label>
          <input
            id="lead-filter"
            className="input"
            placeholder="Filter by company, person, or role"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="row g-4 wrap">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className="chipbtn"
              aria-pressed={statuses.has(f.key)}
              onClick={() => toggle(statuses, f.key, setStatuses)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="row g-4 wrap">
          {EMAIL_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              className="chipbtn"
              aria-pressed={emails.has(f.key)}
              onClick={() => toggle(emails, f.key, setEmails)}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="grow" />

        <div className="row g-6">
          <IconSort />
          <label htmlFor="lead-sort" className="sr-only">
            Sort
          </label>
          <select
            id="lead-sort"
            className="select"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            <option value="score">Score</option>
            <option value="coverage">Evidence coverage</option>
            <option value="company">Company name</option>
            <option value="status">Status</option>
            <option value="found">Most recent</option>
          </select>
        </div>

        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => setPickerOpen((v) => !v)}
            aria-expanded={pickerOpen}
          >
            <IconColumns />
            Columns
          </button>
          {pickerOpen ? (
            <div className="popover" role="group" aria-label="Choose columns">
              {COLUMNS.map((c) => (
                <label key={c.key} className="checkline">
                  <input
                    type="checkbox"
                    checked={c.always || columns.has(c.key)}
                    disabled={c.always}
                    onChange={() => toggle(columns, c.key, setColumns)}
                  />
                  <span>{c.label}</span>
                </label>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <p className="faint t-xs" style={{ margin: 0 }} aria-live="polite">
        Showing {filtered.length} of {views.length} {views.length === 1 ? 'lead' : 'leads'}
        {statuses.size > 0 || emails.size > 0 || query ? ' (filtered)' : ''}
      </p>

      {filtered.length === 0 ? (
        <div className="card">
          <div className="empty">
            <p className="empty__title">No lead matches these filters</p>
            <p className="empty__body">
              Clear a filter to see the rest. Every lead this run produced is still here, including the ones
              held for insufficient evidence.
            </p>
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => {
                setQuery('');
                setStatuses(new Set());
                setEmails(new Set());
              }}
            >
              Clear filters
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="card desktoptable">
            <div className="tablewrap">
              <table className="tbl">
                <thead>
                  <tr>
                    {shown.map((c) => (
                      <th key={c.key} className={c.key === 'score' ? 'num' : undefined}>
                        {c.label}
                      </th>
                    ))}
                    <th>
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((v) => (
                    <LeadRow
                      key={v.lead.id}
                      view={v}
                      columns={shown.map((c) => c.key)}
                      onOpen={() => setOpenId(v.lead.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="cardlist">
            {filtered.map((v) => (
              <button key={v.lead.id} type="button" className="leadcard" onClick={() => setOpenId(v.lead.id)}>
                <div className="row g-10" style={{ alignItems: 'flex-start' }}>
                  <ScoreBadge
                    score={v.lead.score}
                    band={v.lead.band}
                    coverage={v.lead.coverage}
                    status={v.lead.status}
                  />
                  <div className="col g-2" style={{ minWidth: 0, textAlign: 'left' }}>
                    <strong className="truncate">{v.company?.canonicalName ?? 'Unknown company'}</strong>
                    <span className="faint t-xs truncate">
                      {v.company?.primaryDomain ?? 'no verified domain'}
                    </span>
                  </div>
                </div>
                <div className="row g-6 wrap" style={{ marginTop: 8 }}>
                  <StatusPill status={v.lead.status} />
                  <EmailPill status={v.lead.emailStatus} />
                  {acrossRuns ? <span className="mono t-xs faint">{v.foundLabel}</span> : null}
                </div>
                {v.person ? (
                  <p className="t-sm" style={{ margin: '8px 0 0', textAlign: 'left' }}>
                    {v.person.fullName}
                    {v.person.title ? <span className="muted"> · {v.person.title}</span> : null}
                  </p>
                ) : (
                  <p className="muted t-sm" style={{ margin: '8px 0 0', textAlign: 'left' }}>
                    No decision maker found in permitted sources.
                  </p>
                )}
              </button>
            ))}
          </div>
        </>
      )}

      {open ? <LeadDrawer view={open} runId={runId ?? open.lead.runId} onClose={() => setOpenId(null)} /> : null}
    </section>
  );
}

function LeadRow({
  view,
  columns,
  onOpen,
}: {
  view: LeadView;
  columns: ColumnKey[];
  onOpen: () => void;
}) {
  const { lead, company, person } = view;

  return (
    <tr>
      {columns.map((key) => {
        switch (key) {
          case 'score':
            return (
              <td key={key} className="num">
                <ScoreBadge score={lead.score} band={lead.band} coverage={lead.coverage} status={lead.status} />
              </td>
            );
          case 'company':
            return (
              <td key={key}>
                <button type="button" className="tbl__primary" onClick={onOpen}>
                  {company?.canonicalName ?? 'Unknown company'}
                </button>
                <div>
                  {company?.primaryDomain ? (
                    <a
                      href={`https://${company.primaryDomain}`}
                      className="mono t-xs faint"
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      {company.primaryDomain}
                    </a>
                  ) : (
                    <span className="mono t-xs faint">no verified domain</span>
                  )}
                </div>
              </td>
            );
          case 'person':
            return (
              <td key={key}>
                {person ? (
                  person.fullName
                ) : (
                  <span className="pill pill--unknown" title="No permitted source named a decision maker.">
                    None found
                  </span>
                )}
              </td>
            );
          case 'title':
            return (
              <td key={key} className="muted t-sm">
                {person?.title ?? '—'}
              </td>
            );
          case 'email':
            return (
              <td key={key}>
                <EmailPill status={lead.emailStatus} />
              </td>
            );
          case 'why':
            return (
              <td key={key} style={{ maxWidth: 300 }}>
                <span className="t-sm">{lead.heldReason ?? lead.rationale ?? '—'}</span>
                <div style={{ marginTop: 4 }}>
                  <StatusPill status={lead.status} />
                </div>
              </td>
            );
          case 'sources':
            return (
              <td key={key} className="mono t-sm">
                {view.sourceCount}
              </td>
            );
          case 'found':
            return (
              <td key={key} className="mono t-xs faint nowrap" title={view.foundAt}>
                {view.foundLabel}
              </td>
            );
          default:
            return <td key={key} />;
        }
      })}
      <td className="num">
        <button type="button" className="btn btn--ghost btn--sm" onClick={onOpen}>
          Open
        </button>
      </td>
    </tr>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string; title: string }> = {
    qualified: { cls: 'pill pill--ok', label: 'Qualified', title: 'Met the rubric threshold on cited evidence.' },
    held_insufficient_evidence: {
      cls: 'pill pill--unknown',
      label: 'Insufficient evidence',
      title: 'Too little of the rubric could be evaluated. Not a failure.',
    },
    disqualified: {
      cls: 'pill pill--crit',
      label: 'Disqualified',
      title: 'A disqualifying criterion was proven by two independent sources.',
    },
    suppressed: { cls: 'pill pill--warn', label: 'Suppressed', title: 'On the do-not-contact list.' },
  };
  const v = map[status] ?? { cls: 'pill pill--plain', label: 'Below threshold', title: 'Scored under the pass mark.' };
  return (
    <span className={v.cls} title={v.title}>
      {v.label}
    </span>
  );
}

function EmailPill({ status }: { status: string }) {
  if (status === 'verified') {
    return (
      <span className="pill pill--ok" title="The address appears verbatim in a stored document we cite.">
        Verified
      </span>
    );
  }
  if (status === 'unverified') {
    return (
      <span className="pill pill--warn" title="Found in one source and not corroborated. Never a guessed pattern.">
        Unverified
      </span>
    );
  }
  return (
    <span className="pill pill--plain" title="No permitted source contained an address. LeadMoor does not guess.">
      None found
    </span>
  );
}

export { StatusPill, EmailPill };
