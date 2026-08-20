'use client';

import { useActionState } from 'react';
import { cancelRun, type Result } from '@/lib/actions/find';
import { SubmitButton } from '../SubmitButton';

export function StopButton({ runId }: { runId: string }) {
  const [state, formAction] = useActionState<Result | null, FormData>(cancelRun, null);
  return (
    <form action={formAction}>
      <input type="hidden" name="runId" value={runId} />
      <SubmitButton className="btn btn--sm" pendingLabel="Stopping…">
        Stop
      </SubmitButton>
      {state?.error ? (
        <span className="xs" role="alert" style={{ color: 'var(--crit)' }}>
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
