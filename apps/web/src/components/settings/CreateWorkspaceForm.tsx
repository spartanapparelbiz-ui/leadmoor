'use client';

import { useActionState } from 'react';
import { createWorkspaceAction, type ActionResult } from '@/lib/actions/workspace';
import { SubmitButton } from '../SubmitButton';
import { IconPlus } from '../Icons';

export function CreateWorkspaceForm() {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(createWorkspaceAction, null);

  return (
    <form action={formAction} className="col g-8" style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
      <span className="t-label">New workspace</span>
      <div className="row g-8 wrap">
        <label htmlFor="ws-name" className="sr-only">
          Workspace name
        </label>
        <input
          id="ws-name"
          name="name"
          className="input"
          placeholder="Acme GTM"
          required
          minLength={2}
          maxLength={120}
          style={{ maxWidth: 280 }}
        />
        <SubmitButton className="btn btn--sm" pendingLabel="Creating…">
          <IconPlus />
          Create
        </SubmitButton>
      </div>
      <p className="faint t-xs" style={{ margin: 0 }}>
        A new workspace starts empty. Nothing is shared between workspaces — not leads, not evidence, not the
        do-not-contact list.
      </p>
      {state?.error ? (
        <p className="t-xs" role="alert" style={{ margin: 0, color: 'var(--crit)' }}>
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
