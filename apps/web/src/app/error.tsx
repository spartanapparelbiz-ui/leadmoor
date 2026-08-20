'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/** Safe error surface: the user sees that something failed, never an internal detail. */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('render failed', error.digest ?? error.name);
  }, [error]);

  return (
    <div className="shell">
      <div className="panel" style={{ marginTop: 64 }}>
        <div className="empty">
          <p className="h-section">Something went wrong</p>
          <p className="muted" style={{ maxWidth: '48ch', margin: '0 auto 20px' }}>
            The page could not be rendered. Nothing was changed. If it keeps happening, check the server logs —
            they carry the detail, which is deliberately not shown here.
          </p>
          <div className="row gap-12" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn btn--primary" onClick={reset}>
              Try again
            </button>
            <Link href="/" className="btn">
              Start over
            </Link>
          </div>
          {error.digest ? (
            <p className="mono small muted" style={{ marginTop: 18 }}>
              reference {error.digest}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
