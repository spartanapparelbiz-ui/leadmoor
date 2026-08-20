'use client';

import { useActionState, useRef, useState } from 'react';
import { findLeads, type Result } from '@/lib/actions/find';
import { SubmitButton } from '../SubmitButton';
import { IconSearch } from '../Icons';

/**
 * The front door: one box, one button.
 *
 * The examples are requests the pipeline can actually execute, not marketing copy — clicking one
 * fills the box so a first-time user can run something that works.
 */

const EXAMPLES = [
  'US SaaS companies with 50–500 employees that are hiring salespeople',
  'Miami businesses with outdated websites',
  'US ecommerce brands doing $1M–$10M',
  'Founders of recently funded startups',
];

export function Ask({ llmConfigured }: { llmConfigured: boolean }) {
  const [state, formAction] = useActionState<Result | null, FormData>(findLeads, null);
  const [value, setValue] = useState('');
  const box = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="col g16">
      <form action={formAction} className="ask">
        <label htmlFor="ask" className="sr">
          Describe who you want to find
        </label>
        <textarea
          id="ask"
          name="ask"
          ref={box}
          rows={3}
          className="ask__in"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Find US roofing companies with 10–100 employees that could use a new website."
          required
          minLength={8}
          maxLength={2000}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') e.currentTarget.form?.requestSubmit();
          }}
        />
        <div className="ask__foot">
          <span className="xs faint">
            <kbd>⌘</kbd> <kbd>↵</kbd> to search
          </span>
          <div className="grow" />
          <SubmitButton className="btn btn--pri btn--big" pendingLabel="Starting…">
            <IconSearch />
            Find Leads
          </SubmitButton>
        </div>
      </form>

      {state?.error ? (
        <p className="note note--crit sm" role="alert">
          {state.error}
        </p>
      ) : null}

      <div className="egs">
        {EXAMPLES.map((e) => (
          <button
            key={e}
            type="button"
            className="eg"
            onClick={() => {
              setValue(e);
              box.current?.focus();
            }}
          >
            {e}
          </button>
        ))}
      </div>

      {!llmConfigured ? (
        <p className="note sm" role="note">
          <strong>No language model connected.</strong> Requests are parsed by keyword matching instead, so plain
          descriptions work best. Set <code>ANTHROPIC_API_KEY</code> for better reading of loose phrasing.
        </p>
      ) : null}
    </div>
  );
}
