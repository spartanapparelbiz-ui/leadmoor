'use client';

import { useState } from 'react';
import { exportRunCsv } from '@/lib/actions';

/**
 * Exports the run to CSV.
 *
 * The file is produced server-side so suppression and the per-source export gate are applied
 * before anything reaches the browser. The result message reports how many rows were withheld
 * rather than silently shrinking the file.
 */
export function ExportButton({ runId }: { runId: string }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function handleExport() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await exportRunCsv(runId);
      if (!result.ok || !result.csv) {
        setMessage({ ok: false, text: result.error ?? 'Export failed.' });
        return;
      }
      const blob = new Blob([result.csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `leadmoor-${runId.slice(0, 8)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setMessage({ ok: true, text: result.meta ?? 'Exported.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="row gap-8 wrap">
      <button type="button" className="btn btn--primary btn--sm" onClick={handleExport} disabled={busy} aria-busy={busy}>
        {busy ? 'Preparing…' : 'Export CSV'}
      </button>
      {message ? (
        <span className={`small ${message.ok ? 'muted' : ''}`} role="status" style={message.ok ? {} : { color: 'var(--crit)' }}>
          {message.text}
        </span>
      ) : null}
    </span>
  );
}
