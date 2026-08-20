'use client';

import Link from 'next/link';
import { useEffect } from 'react';

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('render failed', error.digest ?? error.name);
  }, [error]);

  return (
    <div className="authwrap">
      <div className="authcard" style={{ textAlign: 'center' }}>
        <h1 className="h1">Something went wrong</h1>
        <p className="sm muted" style={{ margin: '8px 0 18px' }}>
          Nothing was changed. Trying again is safe.
        </p>
        <div className="col g8">
          <button type="button" className="btn btn--pri btn--block" onClick={reset}>
            Try again
          </button>
          <Link href="/" className="btn btn--block">
            Back to LeadMoor
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
