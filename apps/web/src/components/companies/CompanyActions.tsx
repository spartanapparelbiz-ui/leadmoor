'use client';

import { useActionState } from 'react';
import {
  deleteCompanyAction,
  suppressCompanyAction,
  type ActionResult,
} from '@/lib/actions/leads';
import { SubmitButton } from '../SubmitButton';
import { IconTrash } from '../Icons';

export function CompanyActions({ companyId, companyName }: { companyId: string; companyName: string }) {
  const [suppressState, suppressAction] = useActionState<ActionResult | null, FormData>(
    suppressCompanyAction,
    null,
  );
  const [deleteState, deleteAction] = useActionState<ActionResult | null, FormData>(deleteCompanyAction, null);
  const result = suppressState ?? deleteState;

  return (
    <div className="col g-6" style={{ alignItems: 'flex-end' }}>
      <div className="row g-8 wrap">
        <form
          action={suppressAction}
          onSubmit={(e) => {
            if (
              !window.confirm(
                `Suppress ${companyName}? It will be excluded from results and exports across this workspace, including future runs.`,
              )
            ) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="companyId" value={companyId} />
          <SubmitButton className="btn btn--sm" pendingLabel="Suppressing…">
            Suppress
          </SubmitButton>
        </form>

        <form
          action={deleteAction}
          onSubmit={(e) => {
            if (
              !window.confirm(
                `Delete ${companyName} and every person record attached to it? The audit trail is kept.`,
              )
            ) {
              e.preventDefault();
            }
          }}
        >
          <input type="hidden" name="companyId" value={companyId} />
          <SubmitButton className="btn btn--danger btn--sm" pendingLabel="Deleting…">
            <IconTrash />
            Delete
          </SubmitButton>
        </form>
      </div>

      {result?.error ? (
        <span className="t-xs" role="alert" style={{ color: 'var(--crit)' }}>
          {result.error}
        </span>
      ) : null}
      {result?.ok ? (
        <span className="t-xs" role="status" style={{ color: 'var(--accent)' }}>
          {result.notice}
        </span>
      ) : null}
    </div>
  );
}
