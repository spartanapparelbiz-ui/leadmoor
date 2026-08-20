import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { ready } from '@/lib/services';
import { requireSession } from '@/lib/session';
import { absoluteTime, hostOf, relativeTime } from '@/lib/format';
import { IconArrowRight } from '@/components/Icons';

export const metadata: Metadata = { title: 'Audit log' };
export const dynamic = 'force-dynamic';

/** The append-only record of what a run did — and what it refused to do. */
export default async function AuditPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  await ready();
  const { scope } = await requireSession();

  const run = await scope.getRun(runId);
  if (!run) notFound();

  const [events, fetches] = await Promise.all([
    scope.listAudit({ runId, limit: 400 }),
    scope.listFetches(runId),
  ]);

  const refusals = fetches.filter((f) => f.status !== 'ok');

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <Link href={`/runs/${runId}`} className="btn btn--ghost btn--sm" style={{ marginBottom: 8 }}>
            Back to run <IconArrowRight />
          </Link>
          <h1 className="t-page">What this run did</h1>
          <p className="muted t-sm" style={{ margin: '2px 0 0' }}>
            Append-only. Refusals are recorded alongside successes, and no credential is ever written here.
          </p>
        </div>
      </div>

      <section className="card">
        <div className="card__head">
          <span className="t-section">Retrieval</span>
          <div className="grow" />
          <span className="mono t-xs faint">
            {fetches.length} attempted · {refusals.length} refused or failed
          </span>
        </div>
        <div className="tablewrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>Outcome</th>
                <th>Host</th>
                <th>Source</th>
                <th>Robots</th>
                <th>Reason</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {fetches.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted t-sm">
                    Nothing was fetched in this run.
                  </td>
                </tr>
              ) : (
                fetches.slice(0, 300).map((f) => (
                  <tr key={f.id}>
                    <td>
                      <span
                        className={
                          f.status === 'ok'
                            ? 'pill pill--ok'
                            : f.status === 'policy_denied' || f.status === 'robots_denied'
                              ? 'pill pill--warn'
                              : 'pill pill--crit'
                        }
                      >
                        {f.status.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="mono t-xs">
                      <a href={f.url} target="_blank" rel="noreferrer noopener" title={f.url}>
                        {hostOf(f.url)}
                      </a>
                    </td>
                    <td className="mono t-xs faint">{f.sourceId}</td>
                    <td className="mono t-xs faint">{f.robotsDecision.replace(/_/g, ' ')}</td>
                    <td className="muted t-xs" style={{ maxWidth: 320 }}>
                      {f.denialReason ?? (f.httpStatus ? `HTTP ${f.httpStatus}` : '—')}
                    </td>
                    <td className="mono t-xs faint nowrap" title={absoluteTime(f.fetchedAt)}>
                      {relativeTime(f.fetchedAt)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card" style={{ marginTop: 20 }}>
        <div className="card__head">
          <span className="t-section">Events</span>
          <div className="grow" />
          <span className="mono t-xs faint">{events.length}</span>
        </div>
        <div className="tablewrap">
          <table className="tbl">
            <thead>
              <tr>
                <th>When</th>
                <th>Action</th>
                <th>Subject</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted t-sm">
                    No events recorded for this run.
                  </td>
                </tr>
              ) : (
                events.map((event) => (
                  <tr key={event.id}>
                    <td className="mono t-xs faint nowrap" title={absoluteTime(event.createdAt)}>
                      {relativeTime(event.createdAt)}
                    </td>
                    <td>
                      <span className={pillFor(event.action)}>{event.action}</span>
                    </td>
                    <td className="mono t-xs" style={{ wordBreak: 'break-all', maxWidth: 240 }}>
                      {event.subject ?? '—'}
                    </td>
                    <td className="mono t-xs faint" style={{ wordBreak: 'break-word', maxWidth: 420 }}>
                      {JSON.stringify(event.detail).slice(0, 300)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function pillFor(action: string): string {
  if (action.includes('denied') || action.includes('rejected') || action.includes('failed')) {
    return 'pill pill--crit';
  }
  if (action.includes('suppress') || action.includes('deleted') || action.includes('conflict')) {
    return 'pill pill--warn';
  }
  if (action.includes('claim') || action.includes('scored') || action.includes('completed')) {
    return 'pill pill--ok';
  }
  return 'pill pill--plain';
}
