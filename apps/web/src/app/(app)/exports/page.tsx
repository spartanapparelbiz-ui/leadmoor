import Link from 'next/link';
import type { Metadata } from 'next';
import { ready } from '@/lib/services';
import { requireSession } from '@/lib/session';
import { absoluteTime, relativeTime } from '@/lib/format';
import { EmptyState } from '@/components/EmptyState';
import { IconDownload } from '@/components/Icons';

export const metadata: Metadata = { title: 'Exports' };
export const dynamic = 'force-dynamic';

export default async function ExportsPage() {
  await ready();
  const { scope } = await requireSession();

  const [exports, suppressions] = await Promise.all([scope.listExports(100), scope.listSuppressions()]);

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1 className="t-page">Exports</h1>
          <p className="muted t-sm" style={{ margin: '2px 0 0' }}>
            Every export is recorded with what it contained and what its sources would not permit.
          </p>
        </div>
      </div>

      {exports.length === 0 ? (
        <EmptyState
          icon={<IconDownload />}
          title="Nothing exported yet"
          body="Open a run with qualified leads and choose Export. Before a file is written, each field is checked against the redistribution terms of the source that produced it."
          action={{ href: '/runs', label: 'Open run history' }}
        />
      ) : (
        <div className="card">
          <div className="tablewrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Export</th>
                  <th className="num">Rows</th>
                  <th>Withheld fields</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {exports.map((e) => {
                  const withheld = Array.isArray(e.withheldFields) ? (e.withheldFields as string[]) : [];
                  return (
                    <tr key={e.id}>
                      <td>
                        <Link href={`/runs/${e.runId}`} className="tbl__primary">
                          {e.format.toUpperCase()} export
                        </Link>
                      </td>
                      <td className="num mono">{e.rowCount}</td>
                      <td>
                        {withheld.length === 0 ? (
                          <span className="pill pill--ok">None</span>
                        ) : (
                          <span
                            className="pill pill--warn"
                            title={`Source terms forbid redistributing: ${withheld.join(', ')}`}
                          >
                            {withheld.join(', ')}
                          </span>
                        )}
                      </td>
                      <td className="mono t-xs faint" title={absoluteTime(e.createdAt)}>
                        {relativeTime(e.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <section style={{ marginTop: 28 }}>
        <div className="subhead">
          <h2 className="t-section">Do-not-contact list</h2>
          <div className="grow" />
          <span className="mono t-xs faint">{suppressions.length}</span>
        </div>
        <div className="card">
          <div className="card__body">
            {suppressions.length === 0 ? (
              <p className="muted t-sm" style={{ margin: 0 }}>
                Nothing is suppressed in this workspace. Suppressing a lead, person, or company excludes it from
                every result and export from that point on, including future runs.
              </p>
            ) : (
              <>
                <p className="muted t-sm" style={{ marginTop: 0 }}>
                  Entries are stored as hashes, so honouring a suppression in future runs never requires keeping
                  the identifier it came from.
                </p>
                <div className="row g-6 wrap">
                  {suppressions.map((s) => (
                    <span key={s.key} className="pill pill--mono" title={`${s.kind} · ${s.reason}`}>
                      {s.kind}:{s.key.slice(s.key.indexOf(':') + 1, s.key.indexOf(':') + 13)}…
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
