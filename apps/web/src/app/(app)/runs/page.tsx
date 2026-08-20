import Link from 'next/link';
import type { Metadata } from 'next';
import type { LeadSpec } from '@leadmoor/core';
import { ready } from '@/lib/services';
import { requireSession } from '@/lib/session';
import { durationOf, relativeTime, runStatusPill } from '@/lib/format';
import { EmptyState } from '@/components/EmptyState';
import { IconHistory } from '@/components/Icons';

export const metadata: Metadata = { title: 'Run history' };
export const dynamic = 'force-dynamic';

export default async function RunsPage() {
  await ready();
  const { scope } = await requireSession();

  const runs = await scope.listRuns(100);
  const specs = await scope.listSpecs(200);
  const specById = new Map(specs.map((s) => [s.id, s]));

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1 className="t-page">Run history</h1>
          <p className="muted t-sm" style={{ margin: '2px 0 0' }}>
            Every execution, including the ones that failed or hit their budget.
          </p>
        </div>
      </div>

      {runs.length === 0 ? (
        <EmptyState
          icon={<IconHistory />}
          title="Nothing has run yet"
          body="A run starts when you approve a search. Each one records every page it fetched, every claim it extracted, and every refusal — so you can always check its work."
          action={{ href: '/', label: 'Start a search' }}
        />
      ) : (
        <div className="card">
          <div className="tablewrap">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Search</th>
                  <th>Status</th>
                  <th className="num">Leads</th>
                  <th className="num">Docs</th>
                  <th>Duration</th>
                  <th>Started</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => {
                  const spec = specById.get(run.specId);
                  const doc = spec?.spec as unknown as LeadSpec | undefined;
                  const pill = runStatusPill(run.status);
                  const stats = (run.stats ?? {}) as Record<string, number>;
                  const usage = (run.usage ?? {}) as Record<string, number>;

                  return (
                    <tr key={run.id}>
                      <td>
                        <Link href={`/runs/${run.id}`} className="tbl__primary">
                          {doc?.name ?? 'Lead run'}
                        </Link>
                        {run.isDemo ? (
                          <span className="pill pill--warn" style={{ marginLeft: 6 }}>
                            Demo
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <span className={pill.className} title={run.error ?? pill.title}>
                          {pill.label}
                        </span>
                      </td>
                      <td className="num mono">{stats.leads ?? 0}</td>
                      <td className="num mono">{usage.documents ?? 0}</td>
                      <td className="mono t-xs">{durationOf(run.startedAt, run.finishedAt)}</td>
                      <td className="mono t-xs faint">{relativeTime(run.startedAt ?? run.createdAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
