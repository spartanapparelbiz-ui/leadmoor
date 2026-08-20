import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="shell">
      <div className="panel" style={{ marginTop: 64 }}>
        <div className="empty">
          <p className="h-section">Not found</p>
          <p className="muted" style={{ maxWidth: '44ch', margin: '0 auto 20px' }}>
            That search, run, or lead does not exist — it may have been deleted.
          </p>
          <Link href="/" className="btn btn--primary">
            Start a search
          </Link>
        </div>
      </div>
    </div>
  );
}
