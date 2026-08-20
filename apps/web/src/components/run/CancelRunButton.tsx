'use client';

import { useActionState } from 'react';
import { cancelRun, type ActionResult } from '@/lib/actions/search';
import { SubmitButton } from '../SubmitButton';
import { IconStop } from '../Icons';

export function CancelRunButton({ runId }: { runId: string }) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(cancelRun, null);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm('Cancel this run? Everything found so far is kept.')) e.preventDefault();
      }}
    >
      <input type="hidden" name="runId" value={runId} />
      <SubmitButton className="btn btn--sm" pendingLabel="Cancelling…">
        <IconStop />
        Cancel run
      </SubmitButton>
      {state?.error ? (
        <span className="t-xs" role="alert" style={{ color: 'var(--crit)', marginLeft: 8 }}>
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
