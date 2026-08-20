'use client';

import { useState } from 'react';
import { exportRunCsv, type ExportOutcome } from '@/lib/actions/leads';
import { IconDownload } from '../Icons';

/**
 * Export, with the choices made explicit before anything is written.
 *
 * Column selection is cosmetic. What may leave the system at all was already decided by the export
 * gate: a field whose source forbids redistribution is withheld from every row and named in the
 * result, rather than being blanked as if it were simply missing.
 */

const COLUMNS: Array<{ key: string; label: string; note?: string }> = [
  { key: 'company', label: 'Company' },
  { key: 'domain', label: 'Domain' },
  { key: 'person', label: 'Decision maker' },
  { key: 'role', label: 'Role' },
  { key: 'email', label: 'Email' },
  { key: 'email_status', label: 'Email status', note: 'verified / unverified / unavailable' },
  { key: 'score', label: 'Score' },
  { key: 'coverage', label: 'Evidence coverage' },
  { key: 'status', label: 'Status' },
  { key: 'why_fit', label: 'Why it fits' },
  { key: 'evidence_count', label: 'Evidence count' },
  { key: 'source_urls', label: 'Source URLs' },
];

export function ExportModal({ runId, qualified, total }: { runId: string; qualified: number; total: number }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ExportOutcome | null>(null);
  const [includeUnqualified, setIncludeUnqualified] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set(COLUMNS.map((c) => c.key)));

  const toggle = (key: string) => {
    const next = new Set(chosen);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setChosen(next);
  };

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const outcome = await exportRunCsv({ runId, columns: [...chosen], includeUnqualified });
      setResult(outcome);

      if (outcome.ok && outcome.csv) {
        const blob = new Blob([outcome.csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = outcome.filename ?? 'leadmoor.csv';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
    } catch {
      setResult({ ok: false, error: 'Export failed. Nothing was written.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="btn btn--primary btn--sm" onClick={() => setOpen(true)}>
        <IconDownload />
        Export
      </button>

      {open ? (
        <div
          className="modal"
          role="dialog"
          aria-modal="true"
          aria-label="Export leads"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="modal__panel">
            <header className="modal__head">
              <strong className="t-section">Export to CSV</strong>
              <div className="grow" />
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(false)}>
                Close
              </button>
            </header>

            <div className="modal__body col g-16">
              <div className="col g-8">
                <span className="t-label">Rows</span>
                <label className="checkline">
                  <input
                    type="checkbox"
                    checked={includeUnqualified}
                    onChange={(e) => setIncludeUnqualified(e.target.checked)}
                  />
                  <span>
                    Include leads that did not qualify
                    <span className="faint t-xs" style={{ display: 'block' }}>
                      {includeUnqualified
                        ? `Up to ${total} rows, including held and below-threshold leads.`
                        : `${qualified} qualified ${qualified === 1 ? 'lead' : 'leads'} only.`}
                    </span>
                  </span>
                </label>
              </div>

              <div className="col g-8">
                <div className="row g-8">
                  <span className="t-label">Columns</span>
                  <div className="grow" />
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm"
                    onClick={() => setChosen(new Set(COLUMNS.map((c) => c.key)))}
                  >
                    Select all
                  </button>
                </div>
                {COLUMNS.map((c) => (
                  <label key={c.key} className="checkline">
                    <input type="checkbox" checked={chosen.has(c.key)} onChange={() => toggle(c.key)} />
                    <span>
                      {c.label}
                      {c.note ? (
                        <span className="faint t-xs" style={{ display: 'block' }}>
                          {c.note}
                        </span>
                      ) : null}
                    </span>
                  </label>
                ))}
              </div>

              <p className="notice t-sm" style={{ margin: 0 }} role="note">
                Suppressed leads are excluded, and every field is checked against its source&rsquo;s
                redistribution terms before it is written. An unverified address is exported as unverified.
              </p>

              {result?.error ? (
                <p className="notice notice--crit t-sm" role="alert" style={{ margin: 0 }}>
                  {result.error}
                </p>
              ) : null}
              {result?.ok ? (
                <p className="notice notice--ok t-sm" role="status" style={{ margin: 0 }}>
                  {result.meta}
                </p>
              ) : null}
            </div>

            <footer className="modal__foot">
              <span className="faint t-xs">
                {chosen.size} of {COLUMNS.length} columns
              </span>
              <div className="grow" />
              <button type="button" className="btn btn--sm" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                onClick={run}
                disabled={busy || chosen.size === 0}
                aria-busy={busy}
              >
                {busy ? 'Building…' : 'Download CSV'}
              </button>
            </footer>
          </div>
        </div>
      ) : null}
    </>
  );
}
