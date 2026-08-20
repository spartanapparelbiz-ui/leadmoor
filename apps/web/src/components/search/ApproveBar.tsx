'use client';

import { useActionState } from 'react';
import { approveAndRun, type ActionResult } from '@/lib/actions/search';
import { SubmitButton } from '../SubmitButton';
import { IconPlay } from '../Icons';

/** Approval is the only place where retrieval starts. Nothing expensive happens before it. */
export function ApproveBar({ specId, companyCap }: { specId: string; companyCap: number }) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(approveAndRun, null);

  return (
    <form action={formAction} className="approvebar">
      <input type="hidden" name="specId" value={specId} />
      <div className="col g-2" style={{ minWidth: 0 }}>
        <strong className="t-sm">Ready to run</strong>
        <span className="faint t-xs">
          Fetching begins now, up to {companyCap} companies. You can cancel at any point.
        </span>
      </div>
      <div className="grow" />
      {state?.error ? (
        <p className="notice notice--crit t-sm" role="alert" style={{ margin: 0 }}>
          {state.error}
        </p>
      ) : null}
      <SubmitButton className="btn btn--primary" pendingLabel="Starting…">
        <IconPlay />
        Approve and run
      </SubmitButton>
    </form>
  );
}
