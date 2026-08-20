'use client';

import { signOut } from '@/lib/actions/auth';
import { SubmitButton } from '../SubmitButton';
import { IconLogout } from '../Icons';

export function SignOutButton() {
  return (
    <form action={signOut}>
      <SubmitButton className="btn btn--sm" pendingLabel="Signing out…">
        <IconLogout />
        Sign out
      </SubmitButton>
    </form>
  );
}
