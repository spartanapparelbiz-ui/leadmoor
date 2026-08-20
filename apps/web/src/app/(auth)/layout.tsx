import { redirect } from 'next/navigation';
import { currentSession } from '@/lib/session';
import { Brandmark } from '@/components/shell/Brandmark';

/** Signed-out chrome. A visitor who already has a session is sent straight into the app. */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await currentSession()) redirect('/');

  return (
    <div className="authwrap">
      <div className="authcard">
        <div className="row g8" style={{ justifyContent: 'center', marginBottom: 18 }}>
          <Brandmark />
          <span style={{ fontSize: 17, fontWeight: 600 }}>
            LeadMoor
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
