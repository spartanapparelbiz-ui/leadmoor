'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { deleteSavedSearch, runSavedSearch, type ActionResult } from '@/lib/actions/search';
import { SubmitButton } from '../SubmitButton';
import { IconPlay, IconTrash } from '../Icons';

export function SavedSearchRow({
  id,
  name,
  summary,
  lastRunId,
  lastRunLabel,
}: {
  id: string;
  name: string;
  summary: string;
  lastRunId: string | null;
  lastRunLabel: string | null;
}) {
  const [runState, runAction] = useActionState<ActionResult | null, FormData>(runSavedSearch, null);
  const [deleteState, deleteAction] = useActionState<ActionResult | null, FormData>(deleteSavedSearch, null);
  const error = runState?.error ?? deleteState?.error;

  return (
    <div className="row g-10 wrap" style={{ padding: '12px 16px' }}>
      <span className="col g-2" style={{ minWidth: 0, flex: '1 1 240px' }}>
        <strong className="t-sm truncate">{name}</strong>
        <span className="faint t-xs truncate">{summary}</span>
        {error ? (
          <span className="t-xs" role="alert" style={{ color: 'var(--crit)' }}>
            {error}
          </span>
        ) : null}
      </span>

      {lastRunId && lastRunLabel ? (
        <Link href={`/runs/${lastRunId}`} className="mono t-xs faint nowrap">
          last run {lastRunLabel}
        </Link>
      ) : (
        <span className="faint t-xs nowrap">never run</span>
      )}

      <form action={runAction}>
        <input type="hidden" name="savedId" value={id} />
        <SubmitButton className="btn btn--sm" pendingLabel="Starting…">
          <IconPlay />
          Run again
        </SubmitButton>
      </form>

      <form
        action={deleteAction}
        onSubmit={(e) => {
          if (!window.confirm(`Delete the saved list “${name}”? Past runs and their leads are kept.`)) {
            e.preventDefault();
          }
        }}
      >
        <input type="hidden" name="savedId" value={id} />
        <SubmitButton className="btn btn--ghost btn--sm" pendingLabel="Deleting…">
          <IconTrash />
          <span className="sr-only">Delete {name}</span>
        </SubmitButton>
      </form>
    </div>
  );
}
