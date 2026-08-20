'use client';

import { useActionState } from 'react';
import type { ActionResult } from '@/lib/actions';
import { SubmitButton } from './SubmitButton';

/**
 * A form bound to a server action that surfaces the action's real result.
 *
 * Errors are rendered where the user can see them; a failed action never silently looks like a
 * success.
 */
export function ActionForm({
  action,
  children,
  submitLabel,
  pendingLabel,
  submitClassName,
  confirm,
}: {
  action: (prev: ActionResult | null, formData: FormData) => Promise<ActionResult>;
  children?: React.ReactNode;
  submitLabel: string;
  pendingLabel?: string;
  submitClassName?: string;
  confirm?: string;
}) {
  const [state, formAction] = useActionState(action, null);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
      className="stack gap-12"
    >
      {children}
      <div className="row gap-12 wrap">
        <SubmitButton pendingLabel={pendingLabel} className={submitClassName}>
          {submitLabel}
        </SubmitButton>
        {state?.error ? (
          <p className="notice notice--error small" role="alert" style={{ margin: 0 }}>
            {state.error}
          </p>
        ) : null}
        {state?.ok && state.notice ? (
          <p className="notice notice--info small" role="status" style={{ margin: 0 }}>
            {state.notice}
          </p>
        ) : null}
      </div>
    </form>
  );
}
