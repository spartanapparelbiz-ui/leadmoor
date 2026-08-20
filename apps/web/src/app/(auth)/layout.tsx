import { redirect } from 'next/navigation';
import { currentSession } from '@/lib/session';
import { Brandmark } from '@/components/shell/Brandmark';

/** Signed-out chrome. A visitor who already has a session is sent straight into the app. */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  if (await currentSession()) redirect('/');

  return (
    <div className="authwrap">
      <div className="authcard">
        <div className="authcard__brand">
          <Brandmark />
          <span className="brandname" style={{ fontSize: 17 }}>
            LeadMoor
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
