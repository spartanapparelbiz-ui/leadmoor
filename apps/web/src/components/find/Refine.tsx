'use client';

import { useActionState, useState } from 'react';
import { refineSearch, type Result } from '@/lib/actions/find';
import { SubmitButton } from '../SubmitButton';
import { IconSparkle } from '../Icons';

/**
 * Refinement in words.
 *
 * "Only founders", "exclude agencies", "only Florida" — the change is compiled together with the
 * original request, so narrowing one thing does not silently discard the rest. It starts a new
 * search rather than editing this one, which keeps these results and their evidence intact.
 */

const SUGGESTIONS = [
  'Only companies with 100+ employees',
  'Only founders and CEOs',
  'Exclude agencies',
  'Only Florida',
  'Find 50 more',
];

export function Refine({ runId }: { runId: string }) {
  const [state, formAction] = useActionState<Result | null, FormData>(refineSearch, null);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');

  if (!open) {
    return (
      <button type="button" className="btn btn--sm" onClick={() => setOpen(true)}>
        <IconSparkle />
        Refine
      </button>
    );
  }

  return (
    <form action={formAction} className="col g8" style={{ flex: '1 1 340px', minWidth: 0 }}>
      <input type="hidden" name="runId" value={runId} />
      <div className="row g8">
        <label htmlFor="refine" className="sr">
          Refine these results
        </label>
        <input
          id="refine"
          name="refine"
          className="input"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Only founders. Only Florida. Exclude agencies."
          maxLength={600}
          required
          minLength={2}
        />
        <SubmitButton className="btn btn--pri btn--sm" pendingLabel="Applying…">
          Apply
        </SubmitButton>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>

      <div className="row g4 wrap">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" className="eg" onClick={() => setValue(s)}>
            {s}
          </button>
        ))}
      </div>

      {state?.error ? (
        <span className="xs" role="alert" style={{ color: 'var(--crit)' }}>
          {state.error}
        </span>
      ) : null}
      <span className="xs faint">Runs a fresh search. These results are kept.</span>
    </form>
  );
}
