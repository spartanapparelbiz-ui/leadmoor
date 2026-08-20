import Link from 'next/link';
import type { Metadata } from 'next';
import { AuthForm } from '@/components/auth/AuthForm';

export const metadata: Metadata = { title: 'Create account' };
export const dynamic = 'force-dynamic';

export default function SignupPage() {
  return (
    <>
      <h1 className="t-page" style={{ marginBottom: 4 }}>
        Create your workspace
      </h1>
      <p className="muted t-sm" style={{ margin: '0 0 20px' }}>
        Your searches, leads, and evidence stay inside the workspace you create here.
      </p>

      <AuthForm mode="signup" />

      <p className="muted t-sm" style={{ marginTop: 18, marginBottom: 0 }}>
        Already have an account? <Link href="/login">Sign in</Link>
      </p>
    </>
  );
}
