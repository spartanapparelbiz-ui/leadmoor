'use client';

import { useActionState, useState } from 'react';
import { updateSpec, type ActionResult } from '@/lib/actions/search';
import { SubmitButton } from '../SubmitButton';

/**
 * Direct editing of the LeadSpec.
 *
 * The spec is the contract between what was asked for and what runs, so it is editable in full
 * rather than through a lossy form. Whatever is saved is re-validated server-side; invalid JSON or
 * an invalid spec is rejected with the specific reason, never silently coerced.
 */
export function SpecEditor({ specId, initial }: { specId: string; initial: string }) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(updateSpec, null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(initial);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card__head">
        <span className="t-section">Advanced: edit the definition</span>
        <div className="grow" />
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          {open ? 'Close editor' : 'Open editor'}
        </button>
      </div>

      <div className="card__body">
        {open ? (
          <form action={formAction} className="col g-12">
            <input type="hidden" name="specId" value={specId} />
            <div className="field">
              <label htmlFor="spec-json">Search definition (JSON)</label>
              <textarea
                id="spec-json"
                name="spec"
                className="textarea mono"
                rows={24}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                spellCheck={false}
              />
            </div>
            <div className="row g-10 wrap">
              <SubmitButton className="btn btn--primary btn--sm" pendingLabel="Saving…">
                Save changes
              </SubmitButton>
              <button type="button" className="btn btn--sm" onClick={() => setValue(initial)}>
                Reset
              </button>
              <span className="faint t-xs">Saving re-validates everything and creates a new version.</span>
            </div>
            {state?.error ? (
              <p className="notice notice--crit t-sm" role="alert" style={{ margin: 0 }}>
                {state.error}
              </p>
            ) : null}
            {state?.ok ? (
              <p className="notice notice--ok t-sm" role="status" style={{ margin: 0 }}>
                {state.notice}
              </p>
            ) : null}
          </form>
        ) : (
          <p className="muted t-sm" style={{ margin: 0 }}>
            Change weights, filters, target titles, queries, or budget limits directly. Most searches do not
            need this — the sections above are the same document in readable form.
          </p>
        )}
      </div>
    </div>
  );
}
