'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { deleteSavedSearch, runSavedSearch, type Result } from '@/lib/actions/find';
import { SubmitButton } from '../SubmitButton';
import { IconPlay, IconTrash } from '../Icons';

export function SavedRow({
  id,
  name,
  request,
  lastRunId,
}: {
  id: string;
  name: string;
  request: string;
  lastRunId: string | null;
}) {
  const [runState, runAction] = useActionState<Result | null, FormData>(runSavedSearch, null);
  const [delState, delAction] = useActionState<Result | null, FormData>(deleteSavedSearch, null);
  const error = runState?.error ?? delState?.error;

  return (
    <div className="card row g10 wrap" style={{ padding: '12px 14px' }}>
      <span className="col g2" style={{ minWidth: 0, flex: '1 1 220px' }}>
        <span className="sm" style={{ fontWeight: 550 }}>
          {name}
        </span>
        <span className="xs faint truncate">{request}</span>
        {error ? (
          <span className="xs" role="alert" style={{ color: 'var(--crit)' }}>
            {error}
          </span>
        ) : null}
      </span>

      {lastRunId ? (
        <Link href={`/s/${lastRunId}`} className="btn btn--ghost btn--sm">
          Last results
        </Link>
      ) : null}

      <form action={runAction}>
        <input type="hidden" name="savedId" value={id} />
        <SubmitButton className="btn btn--sm" pendingLabel="Starting…">
          <IconPlay />
          Run
        </SubmitButton>
      </form>

      <form
        action={delAction}
        onSubmit={(e) => {
          if (!window.confirm(`Delete “${name}”? Past results are kept.`)) e.preventDefault();
        }}
      >
        <input type="hidden" name="savedId" value={id} />
        <SubmitButton className="btn btn--ghost btn--sm" pendingLabel="…">
          <IconTrash />
          <span className="sr">Delete {name}</span>
        </SubmitButton>
      </form>
    </div>
  );
}
