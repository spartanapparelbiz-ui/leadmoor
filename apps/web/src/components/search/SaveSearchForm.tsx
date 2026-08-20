'use client';

import { useActionState } from 'react';
import { saveSearch, type ActionResult } from '@/lib/actions/search';
import { SubmitButton } from '../SubmitButton';
import { IconBookmark } from '../Icons';

/** Saves this definition so it can be re-run later without recompiling the request. */
export function SaveSearchForm({ specId, defaultName }: { specId: string; defaultName: string }) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(saveSearch, null);

  return (
    <form action={formAction} className="col g-8">
      <input type="hidden" name="specId" value={specId} />
      <div className="row g-8 wrap">
        <label htmlFor="saved-name" className="sr-only">
          List name
        </label>
        <input
          id="saved-name"
          name="name"
          className="input"
          defaultValue={defaultName}
          maxLength={140}
          required
          style={{ maxWidth: 320 }}
        />
        <SubmitButton className="btn btn--sm" pendingLabel="Saving…">
          <IconBookmark />
          Save as list
        </SubmitButton>
      </div>
      {state?.error ? (
        <p className="t-xs" role="alert" style={{ margin: 0, color: 'var(--crit)' }}>
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p className="t-xs" role="status" style={{ margin: 0, color: 'var(--accent)' }}>
          {state.notice}
        </p>
      ) : null}
    </form>
  );
}
