import Link from 'next/link';
import { Brandmark } from '@/components/shell/Brandmark';

export default function NotFound() {
  return (
    <div className="authwrap">
      <div className="authcard" style={{ textAlign: 'center' }}>
        <div className="row g8" style={{ justifyContent: 'center', marginBottom: 16 }}>
          <Brandmark />
          <strong>LeadMoor</strong>
        </div>
        <h1 className="h1">Not found</h1>
        <p className="sm muted" style={{ margin: '8px 0 18px' }}>
          That page does not exist, or you need to sign in to see it.
        </p>
        <Link href="/" className="btn btn--pri btn--block">
          Go to LeadMoor
        </Link>
      </div>
    </div>
  );
}
