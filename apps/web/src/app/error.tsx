'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * The last-resort error surface.
 *
 * The user is told that something failed and that nothing was changed. The detail stays in the
 * server log: a stack trace or a query in the browser is a leak, not a courtesy. The digest is
 * shown so a support conversation can match the page to the log line.
 */
export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('render failed', error.digest ?? error.name);
  }, [error]);

  return (
    <div className="authwrap">
      <div className="authcard" style={{ textAlign: 'center' }}>
        <h1 className="t-page">Something went wrong</h1>
        <p className="muted t-sm" style={{ margin: '6px 0 18px' }}>
          This page could not be rendered, and nothing was changed. Trying again is safe. If it keeps
          happening, the server log carries the detail — it is deliberately not shown here.
        </p>
        <div className="col g-8">
          <button type="button" className="btn btn--primary btn--block" onClick={reset}>
            Try again
          </button>
          <Link href="/" className="btn btn--block">
            Back to LeadMoor
          </Link>
        </div>
        {error.digest ? (
          <p className="mono t-xs faint" style={{ marginTop: 16, marginBottom: 0 }}>
            reference {error.digest}
          </p>
        ) : null}
      </div>
    </div>
  );
}
