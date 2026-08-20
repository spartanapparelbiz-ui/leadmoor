import type { Metadata } from 'next';
import { ready } from '@/lib/services';
import { authService, requireSession } from '@/lib/session';
import { absoluteTime, humanize } from '@/lib/format';
import { MemberManager } from '@/components/settings/MemberManager';
import { CreateWorkspaceForm } from '@/components/settings/CreateWorkspaceForm';

export const metadata: Metadata = { title: 'Workspace' };
export const dynamic = 'force-dynamic';

/**
 * Workspace membership.
 *
 * The controls a member cannot use are not shown, but that is presentation only — every action
 * re-checks the caller's role on the server, so hiding a button is never what enforces anything.
 */
export default async function WorkspaceSettingsPage() {
  await ready();
  const { ctx, scope } = await requireSession();
  const auth = await authService();

  const [members, counts, workspaces] = await Promise.all([
    auth.membersOf(ctx.workspaceId),
    scope.counts(),
    auth.workspacesFor(ctx.userId),
  ]);

  const canManage = ctx.role === 'owner' || ctx.role === 'admin';

  return (
    <div className="page page--narrow">
      <div className="pagehead">
        <div>
          <h1 className="t-page">{ctx.workspaceName}</h1>
          <p className="muted t-sm" style={{ margin: '2px 0 0' }}>
            Everything in this workspace is isolated from every other one, in the database and not just in the
            interface.
          </p>
        </div>
      </div>

      <section className="statgrid">
        <div className="stat">
          <span className="t-label">Runs</span>
          <span className="stat__value mono">{counts.runs}</span>
        </div>
        <div className="stat">
          <span className="t-label">Leads</span>
          <span className="stat__value mono">{counts.leads}</span>
        </div>
        <div className="stat">
          <span className="t-label">Companies</span>
          <span className="stat__value mono">{counts.companies}</span>
        </div>
        <div className="stat">
          <span className="t-label">People</span>
          <span className="stat__value mono">{counts.people}</span>
        </div>
      </section>

      <section className="card" style={{ marginTop: 20 }}>
        <div className="card__head">
          <span className="t-section">Members</span>
          <div className="grow" />
          <span className="mono t-xs faint">{members.length}</span>
        </div>
        <div className="card__body col g-14">
          <div className="col g-8">
            {members.map((m) => (
              <div key={m.userId} className="row g-10 wrap">
                <span className="avatar avatar--muted">{(m.name || m.email).slice(0, 1).toUpperCase()}</span>
                <span className="col g-2" style={{ minWidth: 0 }}>
                  <strong className="t-sm truncate">{m.name || m.email}</strong>
                  <span className="faint t-xs truncate">{m.email}</span>
                </span>
                <div className="grow" />
                <span className="pill pill--plain">{humanize(m.role)}</span>
                <span className="mono t-xs faint nowrap">{absoluteTime(m.joinedAt)}</span>
                {canManage && m.userId !== ctx.userId ? (
                  <MemberManager mode="remove" userId={m.userId} name={m.name || m.email} />
                ) : null}
              </div>
            ))}
          </div>

          {canManage ? (
            <MemberManager mode="add" canAddOwner={ctx.role === 'owner'} />
          ) : (
            <p className="muted t-sm" style={{ margin: 0 }}>
              Only an owner or admin can change who has access. Ask one of them if you need to add someone.
            </p>
          )}
        </div>
      </section>

      <section className="card" style={{ marginTop: 20 }}>
        <div className="card__head">
          <span className="t-section">Your workspaces</span>
        </div>
        <div className="card__body col g-12">
          <div className="col g-6">
            {workspaces.map((w) => (
              <div key={w.id} className="row g-8">
                <span className="t-sm">{w.name}</span>
                {w.id === ctx.workspaceId ? <span className="pill pill--ok">Current</span> : null}
                <div className="grow" />
                <span className="pill pill--plain">{humanize(w.role)}</span>
              </div>
            ))}
          </div>
          <CreateWorkspaceForm />
        </div>
      </section>
    </div>
  );
}
