'use client';

import { useActionState, useRef, useState } from 'react';
import { createSearch, type ActionResult } from '@/lib/actions/search';
import { SubmitButton } from '../SubmitButton';
import { IconSparkle } from '../Icons';

/**
 * The product's front door.
 *
 * One input, one action. The examples are real requests the pipeline can execute, not marketing
 * copy — clicking one fills the box so a first-time user can run something that works.
 */
export function NewSearchComposer({
  examples,
  llmConfigured,
}: {
  examples: Array<{ title: string; text: string }>;
  llmConfigured: boolean;
}) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(createSearch, null);
  const [value, setValue] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="col g-14">
      <form action={formAction} className="composer">
        <label htmlFor="request" className="sr-only">
          Describe who you want to reach
        </label>
        <textarea
          id="request"
          name="request"
          ref={ref}
          rows={4}
          className="composer__input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Find 20 US B2B SaaS companies with 50–500 employees that are hiring security engineers, and identify the CTO or VP Engineering."
          aria-describedby={state?.error ? 'request-error' : 'request-help'}
          required
          minLength={12}
          maxLength={4000}
        />
        <div className="composer__foot">
          <span id="request-help" className="faint t-xs">
            {value.length > 0 ? `${value.length} characters · ` : ''}Nothing runs until you approve the search.
          </span>
          <div className="grow" />
          <SubmitButton className="btn btn--primary" pendingLabel="Building search…">
            <IconSparkle />
            Build search
          </SubmitButton>
        </div>
      </form>

      {state?.error ? (
        <p id="request-error" role="alert" className="notice notice--crit t-sm" style={{ margin: 0 }}>
          {state.error}
        </p>
      ) : null}

      {!llmConfigured ? (
        <p className="notice t-sm" style={{ margin: 0 }} role="note">
          <strong>No language model configured.</strong> Requests are structured by keyword matching instead,
          and criteria that need judgement are reported as <em>unknown</em> rather than guessed. Set{' '}
          <code className="mono">ANTHROPIC_API_KEY</code> to enable both.
        </p>
      ) : null}

      <div className="col g-6">
        <span className="t-label">Start from an example</span>
        <div className="row g-8 wrap">
          {examples.map((example) => (
            <button
              key={example.title}
              type="button"
              className="chipbtn"
              onClick={() => {
                setValue(example.text);
                ref.current?.focus();
              }}
              title={example.text}
            >
              {example.title}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
