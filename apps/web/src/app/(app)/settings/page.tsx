import Link from 'next/link';
import type { Metadata } from 'next';
import { ready } from '@/lib/services';
import { requireSession } from '@/lib/session';
import { absoluteTime, humanize, relativeTime } from '@/lib/format';
import { SignOutButton } from '@/components/auth/SignOutButton';
import { IconArrowRight, IconLayers, IconPlug, IconShield } from '@/components/Icons';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  await ready();
  const { ctx, scope } = await requireSession();
  const audit = await scope.listAudit({ limit: 25 });

  return (
    <div className="page page--narrow">
      <div className="pagehead">
        <div>
          <h1 className="t-page">Settings</h1>
          <p className="muted t-sm" style={{ margin: '2px 0 0' }}>
            Your account, this workspace, and what has happened in it.
          </p>
        </div>
      </div>

      <section className="card">
        <div className="card__head">
          <span className="t-section">Account</span>
        </div>
        <div className="card__body col g-12">
          <div className="kv">
            <Cell label="Name" value={ctx.name || '—'} />
            <Cell label="Email" value={ctx.email} />
            <Cell label="Workspace" value={ctx.workspaceName} />
            <Cell label="Your role" value={humanize(ctx.role)} />
          </div>
          <div className="row g-8">
            <SignOutButton />
          </div>
        </div>
      </section>

      <section className="col g-10" style={{ marginTop: 20 }}>
        <SettingsLink
          href="/settings/workspace"
          icon={<IconLayers />}
          title="Workspace and members"
          body="Rename the workspace, invite teammates, and control who can see this data."
        />
        <SettingsLink
          href="/settings/providers"
          icon={<IconPlug />}
          title="Providers and sources"
          body="What LeadMoor may contact, and which credentials are configured."
        />
        <SettingsLink
          href="/exports"
          icon={<IconShield />}
          title="Exports and do-not-contact"
          body="Export history and the suppression list this workspace enforces."
        />
      </section>

      <section style={{ marginTop: 28 }}>
        <div className="subhead">
          <h2 className="t-section">Recent activity</h2>
          <div className="grow" />
          <span className="faint t-xs">Append-only</span>
        </div>
        <div className="card">
          <div className="card__body card__body--flush divide">
            {audit.length === 0 ? (
              <p className="muted t-sm" style={{ padding: 14, margin: 0 }}>
                Nothing has happened in this workspace yet.
              </p>
            ) : (
              audit.map((entry) => (
                <div key={entry.id} className="row g-10" style={{ padding: '9px 14px' }}>
                  <span className="mono t-xs" style={{ minWidth: 150 }}>
                    {entry.action}
                  </span>
                  <span className="muted t-xs truncate">{entry.subject ?? ''}</span>
                  <div className="grow" />
                  <span className="mono t-xs faint nowrap" title={absoluteTime(entry.createdAt)}>
                    {relativeTime(entry.createdAt)}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function SettingsLink({
  href,
  icon,
  title,
  body,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <Link href={href} className="card rowbtn" style={{ padding: '14px 16px' }}>
      <span className="row g-10" style={{ minWidth: 0 }}>
        <span style={{ color: 'var(--muted)' }}>{icon}</span>
        <span className="col g-2" style={{ minWidth: 0 }}>
          <strong className="t-sm">{title}</strong>
          <span className="muted t-xs">{body}</span>
        </span>
      </span>
      <div className="grow" />
      <IconArrowRight />
    </Link>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="kv__cell">
      <span className="t-label">{label}</span>
      <span className="t-sm">{value}</span>
    </div>
  );
}
