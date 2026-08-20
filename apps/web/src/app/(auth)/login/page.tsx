import Link from 'next/link';
import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/AuthForm';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return (
    <>
      <h1 className="t-page" style={{ marginBottom: 4 }}>
        Sign in
      </h1>
      <p className="muted t-sm" style={{ margin: '0 0 20px' }}>
        Evidence-first lead research. Every claim traces back to a stored document.
      </p>

      <AuthForm mode="signin" />

      <p className="muted t-sm" style={{ marginTop: 18, marginBottom: 0 }}>
        No account yet? <Link href="/signup">Create one</Link>
      </p>
    </>
  );
}
