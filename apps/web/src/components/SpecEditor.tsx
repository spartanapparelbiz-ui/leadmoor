'use client';

import { useActionState, useState } from 'react';
import { updateSpec, type ActionResult } from '@/lib/actions';
import { SubmitButton } from './SubmitButton';

/**
 * Direct editing of the LeadSpec.
 *
 * The spec is the contract between what the user asked for and what runs, so it is editable in
 * full rather than through a lossy form. Whatever is saved is re-validated server-side; invalid
 * JSON or an invalid spec is rejected with the specific reason.
 */
export function SpecEditor({ specId, initial }: { specId: string; initial: string }) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(updateSpec, null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(initial);

  return (
    <div className="panel">
      <div className="panel__head">
        <span className="eyebrow">Edit search</span>
        <div className="spacer" />
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? 'Close editor' : 'Open editor'}
        </button>
      </div>

      {open ? (
        <div className="panel__body">
          <form action={formAction} className="stack gap-12">
            <input type="hidden" name="specId" value={specId} />
            <label htmlFor="spec-json">Search definition</label>
            <textarea
              id="spec-json"
              name="spec"
              className="mono"
              rows={22}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              spellCheck={false}
            />
            <div className="row gap-12 wrap">
              <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
              <button type="button" className="btn btn--sm" onClick={() => setValue(initial)}>
                Reset
              </button>
              <span className="small muted">
                Adjust weights, filters, target titles, queries, or the budget. Saving re-validates everything.
              </span>
            </div>
            {state?.error ? (
              <p className="notice notice--error small" role="alert" style={{ margin: 0 }}>
                {state.error}
              </p>
            ) : null}
            {state?.ok ? (
              <p className="notice notice--info small" role="status" style={{ margin: 0 }}>
                {state.notice}
              </p>
            ) : null}
          </form>
        </div>
      ) : (
        <div className="panel__body">
          <p className="small muted" style={{ margin: 0 }}>
            Change filters, target titles, scoring weights, search queries, or budget limits before approving.
          </p>
        </div>
      )}
    </div>
  );
}
