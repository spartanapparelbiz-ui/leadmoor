'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/** An error inside the app keeps the shell, so the user can navigate away rather than reload. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('render failed', error.digest ?? error.name);
  }, [error]);

  return (
    <div className="page page--narrow">
      <div className="card" style={{ marginTop: 40 }}>
        <div className="card__body col g-14" style={{ textAlign: 'center', padding: 32 }}>
          <h1 className="t-page">This page could not be loaded</h1>
          <p className="muted t-sm" style={{ margin: 0, maxWidth: '54ch', marginInline: 'auto' }}>
            Nothing was changed. Trying again is safe. The detail is in the server log rather than here,
            because an error message in a browser can leak more than it explains.
          </p>
          <div className="row g-8" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn btn--primary btn--sm" onClick={reset}>
              Try again
            </button>
            <Link href="/leads" className="btn btn--sm">
              Back to leads
            </Link>
          </div>
          {error.digest ? (
            <p className="mono t-xs faint" style={{ margin: 0 }}>
              reference {error.digest}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
