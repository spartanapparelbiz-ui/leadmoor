'use client';

import { useActionState } from 'react';
import { deletePersonAction, suppressLead, type ActionResult } from '@/lib/actions/leads';
import { SubmitButton } from '../SubmitButton';
import { IconTrash } from '../Icons';

/**
 * Suppression and deletion.
 *
 * Suppression is workspace-wide and permanent by design: the key is a hash, so honouring it in
 * future runs never requires keeping the identifier it came from. Deletion removes the personal
 * record and its claims while leaving the audit trail intact.
 */
export function LeadActions({
  leadId,
  personId,
  personName,
  suppressed,
  onDone,
}: {
  leadId: string;
  personId: string | null;
  personName: string | null;
  suppressed: boolean;
  onDone?: () => void;
}) {
  const [suppressState, suppressAction] = useActionState<ActionResult | null, FormData>(suppressLead, null);
  const [deleteState, deleteAction] = useActionState<ActionResult | null, FormData>(deletePersonAction, null);
  const result = suppressState ?? deleteState;

  return (
    <div className="row g-8 wrap" style={{ justifyContent: 'flex-end' }}>
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

      {personId ? (
        <form
          action={deleteAction}
          onSubmit={(e) => {
            if (
              !window.confirm(
                `Delete ${personName ?? 'this person'}? Their name, role, claims, and any address are removed. The company and its score stay.`,
              )
            ) {
              e.preventDefault();
            } else {
              onDone?.();
            }
          }}
        >
          <input type="hidden" name="personId" value={personId} />
          <SubmitButton className="btn btn--ghost btn--sm" pendingLabel="Deleting…">
            <IconTrash />
            Delete person
          </SubmitButton>
        </form>
      ) : null}

      {!suppressed ? (
        <form
          action={suppressAction}
          onSubmit={(e) => {
            if (
              !window.confirm(
                'Suppress this lead? It will be excluded from results and exports across this workspace, including future runs.',
              )
            ) {
              e.preventDefault();
            } else {
              onDone?.();
            }
          }}
        >
          <input type="hidden" name="leadId" value={leadId} />
          <SubmitButton className="btn btn--danger btn--sm" pendingLabel="Suppressing…">
            Suppress
          </SubmitButton>
        </form>
      ) : (
        <span className="pill pill--warn">Suppressed</span>
      )}
    </div>
  );
}
