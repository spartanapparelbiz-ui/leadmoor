import Link from 'next/link';
import { Brandmark } from '@/components/shell/Brandmark';

/** The 404 a signed-out visitor sees. Signed-in users get the one inside the app shell. */
export default function NotFound() {
  return (
    <div className="authwrap">
      <div className="authcard" style={{ textAlign: 'center' }}>
        <div className="authcard__brand">
          <Brandmark />
          <span className="brandname" style={{ fontSize: 17 }}>
            LeadMoor
          </span>
        </div>
        <h1 className="t-page">Not found</h1>
        <p className="muted t-sm" style={{ margin: '6px 0 18px' }}>
          That page does not exist. If you were following a link to a search or a lead, it may have been
          deleted — or it may belong to a workspace you are not signed in to.
        </p>
        <Link href="/" className="btn btn--primary btn--block">
          Go to LeadMoor
        </Link>
      </div>
    </div>
  );
}
