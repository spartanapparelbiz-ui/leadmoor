'use client';

import { useState } from 'react';
import { exportCsv } from '@/lib/actions/export';
import { IconDownload } from '../Icons';

/**
 * One button, one file.
 *
 * The CSV is built on the server so suppression and each source's redistribution terms are applied
 * before anything reaches the browser. The result message reports what was withheld rather than
 * quietly shrinking the file.
 */
export function Export({ runId, count }: { runId: string; count: number }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const out = await exportCsv(runId);
      if (!out.ok || !out.csv) {
        setMsg({ ok: false, text: out.error ?? 'Export failed.' });
        return;
      }
      const url = URL.createObjectURL(new Blob([out.csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = out.filename ?? 'leadmoor.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setMsg({ ok: true, text: out.meta ?? 'Exported.' });
    } catch {
      setMsg({ ok: false, text: 'Export failed. Nothing was written.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="row g8">
      {msg ? (
        <span className="xs" role="status" style={{ color: msg.ok ? 'var(--accent)' : 'var(--crit)' }}>
          {msg.text}
        </span>
      ) : null}
      <button type="button" className="btn btn--sm" onClick={run} disabled={busy || count === 0} aria-busy={busy}>
        <IconDownload />
        {busy ? 'Building…' : 'Export CSV'}
      </button>
    </div>
  );
}
