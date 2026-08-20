'use client';

import { useActionState } from 'react';
import { addMemberAction, removeMemberAction, type ActionResult } from '@/lib/actions/workspace';
import { SubmitButton } from '../SubmitButton';
import { IconPlus, IconTrash } from '../Icons';

/** Invite and removal. Both actions re-check the caller's role server-side before doing anything. */
export function MemberManager(
  props: { mode: 'add'; canAddOwner: boolean } | { mode: 'remove'; userId: string; name: string },
) {
  if (props.mode === 'remove') return <RemoveMember userId={props.userId} name={props.name} />;
  return <AddMember canAddOwner={props.canAddOwner} />;
}

function AddMember({ canAddOwner }: { canAddOwner: boolean }) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(addMemberAction, null);

  return (
    <form action={formAction} className="col g-8" style={{ borderTop: '1px solid var(--border)', paddingTop: 14 }}>
      <span className="t-label">Add a member</span>
      <div className="row g-8 wrap">
        <label htmlFor="member-email" className="sr-only">
          Email
        </label>
        <input
          id="member-email"
          name="email"
          type="email"
          className="input"
          placeholder="teammate@company.com"
          required
          style={{ maxWidth: 280 }}
        />
        <label htmlFor="member-role" className="sr-only">
          Role
        </label>
        <select id="member-role" name="role" className="select" defaultValue="member">
          <option value="member">Member</option>
          <option value="admin">Admin</option>
          {canAddOwner ? <option value="owner">Owner</option> : null}
        </select>
        <SubmitButton className="btn btn--sm" pendingLabel="Adding…">
          <IconPlus />
          Add
        </SubmitButton>
      </div>
      <p className="faint t-xs" style={{ margin: 0 }}>
        They need an existing LeadMoor account. Adding them grants access to everything in this workspace.
      </p>
      {state?.error ? (
        <p className="t-xs" role="alert" style={{ margin: 0, color: 'var(--crit)' }}>
          {state.error}
        </p>
      ) : null}
      {state?.ok ? (
        <p className="t-xs" role="status" style={{ margin: 0, color: 'var(--accent)' }}>
          {state.notice}
        </p>
      ) : null}
    </form>
  );
}

function RemoveMember({ userId, name }: { userId: string; name: string }) {
  const [state, formAction] = useActionState<ActionResult | null, FormData>(removeMemberAction, null);

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        if (!window.confirm(`Remove ${name} from this workspace? They lose access immediately.`)) {
          e.preventDefault();
        }
      }}
    >
      <input type="hidden" name="userId" value={userId} />
      <SubmitButton className="btn btn--ghost btn--sm" pendingLabel="Removing…">
        <IconTrash />
        <span className="sr-only">Remove {name}</span>
      </SubmitButton>
      {state?.error ? (
        <span className="t-xs" role="alert" style={{ color: 'var(--crit)' }}>
          {state.error}
        </span>
      ) : null}
    </form>
  );
}
