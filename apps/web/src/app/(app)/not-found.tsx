import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="page page--mid">
      <div className="empty" style={{ marginTop: 40 }}>
        <h3>Not found</h3>
        <p>That search or lead does not exist here. It may have been deleted, or it may belong to another account.</p>
        <Link href="/" className="btn btn--pri btn--sm">
          New search
        </Link>
      </div>
    </div>
  );
}
