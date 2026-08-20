'use client';

import { useActionState, useState } from 'react';
import { saveSearch, type Result } from '@/lib/actions/find';
import { SubmitButton } from '../SubmitButton';
import { IconBookmark } from '../Icons';

export function SaveSearch({ runId, name }: { runId: string; name: string }) {
  const [state, formAction] = useActionState<Result | null, FormData>(saveSearch, null);
  const [open, setOpen] = useState(false);

  if (state?.ok) {
    return (
      <span className="xs" role="status" style={{ color: 'var(--accent)' }}>
        {state.notice}
      </span>
    );
  }

  if (!open) {
    return (
      <button type="button" className="btn btn--sm" onClick={() => setOpen(true)}>
        <IconBookmark />
        Save search
      </button>
    );
  }

  return (
    <form action={formAction} className="row g8">
      <input type="hidden" name="runId" value={runId} />
      <label htmlFor="save-name" className="sr">
        Name
      </label>
      <input
        id="save-name"
        name="name"
        className="input"
        defaultValue={name}
        maxLength={140}
        required
        autoFocus
        style={{ width: 240 }}
      />
      <SubmitButton className="btn btn--pri btn--sm" pendingLabel="Saving…">
        Save
      </SubmitButton>
      {state?.error ? (
        <span className="xs" role="alert" style={{ color: 'var(--crit)' }}>
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
