'use client';

import { useActionState, useRef, useState } from 'react';
import { createSearch, type ActionResult } from '@/lib/actions';
import { SubmitButton } from './SubmitButton';

/** The product's front door: one input, one action, with real examples to borrow from. */
export function NewSearchForm({ examples }: { examples: string[] }) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(createSearch, null);
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  return (
    <form action={formAction} className="stack gap-12" style={{ maxWidth: 760 }}>
      <label htmlFor="request">Describe who you want</label>
      <textarea
        id="request"
        name="request"
        ref={ref}
        rows={4}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Find 20 US B2B SaaS companies with 50–500 employees that are hiring security engineers, and identify the CTO or VP Engineering."
        aria-describedby={state?.error ? 'request-error' : 'request-help'}
        required
        minLength={12}
      />

      <div className="row gap-12 wrap">
        <SubmitButton pendingLabel="Building search…">Build search</SubmitButton>
        <span id="request-help" className="small muted">
          Nothing runs until you approve the search on the next screen.
        </span>
      </div>

      {state?.error ? (
        <p id="request-error" role="alert" className="notice notice--error small" style={{ margin: 0 }}>
          {state.error}
        </p>
      ) : null}

      <div className="stack gap-8" style={{ marginTop: 8 }}>
        <span className="eyebrow">Try one of these</span>
        <div className="stack gap-4">
          {examples.map((example) => (
            <button
              key={example}
              type="button"
              className="btn btn--ghost btn--sm"
              style={{ textAlign: 'left', justifyContent: 'flex-start', whiteSpace: 'normal', lineHeight: 1.45 }}
              onClick={() => {
                setValue(example);
                ref.current?.focus();
              }}
            >
              {example}
            </button>
          ))}
        </div>
      </div>
    </form>
  );
}
