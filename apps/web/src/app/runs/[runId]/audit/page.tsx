import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { run as runTable } from '@leadmoor/db';
import { audit, ready, services } from '@/lib/services';
import { relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

/** The append-only record of what the run did — and what it refused to do. */
export default async function AuditPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  await ready();

  const run = (await services().db.select().from(runTable).where(eq(runTable.id, runId)).limit(1))[0];
  if (!run) notFound();

  const events = await audit().forRun(runId, 400);

  return (
    <div className="shell">
      <nav style={{ paddingTop: 28 }} aria-label="Breadcrumb">
        <Link href={`/runs/${runId}`} className="btn btn--ghost btn--sm">
          ← Back to run
        </Link>
      </nav>

      <header style={{ padding: '12px 0 24px' }}>
        <span className="eyebrow">Audit</span>
        <h1 className="h-display" style={{ fontSize: '2rem', marginTop: '0.2em' }}>
          What this run did
        </h1>
        <p className="lede small" style={{ fontSize: '0.95rem', marginTop: 10 }}>
          Append-only. Refusals are recorded alongside successes, and no credential is ever written here.
        </p>
      </header>

      <div className="panel">
        <div className="panel__body panel__body--flush">
          <div className="tablewrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 96 }}>When</th>
                  <th style={{ width: 190 }}>Action</th>
                  <th>Subject</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td className="mono small muted">{relativeTime(event.createdAt)}</td>
                    <td>
                      <span className={`chip ${chipFor(event.action)}`}>{event.action}</span>
                    </td>
                    <td className="mono small" style={{ wordBreak: 'break-all', maxWidth: 260 }}>
                      {event.subject ?? '—'}
                    </td>
                    <td className="mono small muted" style={{ wordBreak: 'break-word', maxWidth: 420 }}>
                      {JSON.stringify(event.detail).slice(0, 300)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {events.length === 0 ? (
            <p className="small muted" style={{ padding: 20, margin: 0 }}>
              No events recorded for this run.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function chipFor(action: string): string {
  if (action.includes('rejected') || action.includes('failed') || action.includes('denied')) return 'chip--fail';
  if (action.includes('insufficient') || action.includes('unavailable') || action.includes('not_configured')) {
    return 'chip--warn';
  }
  if (action.includes('created') || action.includes('completed') || action.includes('retrieved')) return 'chip--pass';
  return 'chip--neutral';
}
