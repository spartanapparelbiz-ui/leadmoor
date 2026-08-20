'use client';

import Link from 'next/link';
import { useEffect } from 'react';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('render failed', error.digest ?? error.name);
  }, [error]);

  return (
    <div className="page page--mid">
      <div className="empty" style={{ marginTop: 40 }}>
        <h3>This page could not load</h3>
        <p>
          Nothing was changed, and trying again is safe. The detail is in the server log rather than here — an
          error message in a browser leaks more than it explains.
        </p>
        <div className="row g8" style={{ justifyContent: 'center' }}>
          <button type="button" className="btn btn--pri btn--sm" onClick={reset}>
            Try again
          </button>
          <Link href="/" className="btn btn--sm">
            New search
          </Link>
        </div>
        {error.digest ? (
          <p className="mono xs faint" style={{ marginTop: 14, marginBottom: 0 }}>
            {error.digest}
          </p>
        ) : null}
      </div>
    </div>
  );
}
