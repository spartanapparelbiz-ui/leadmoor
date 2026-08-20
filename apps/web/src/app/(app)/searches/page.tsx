import Link from 'next/link';
import type { Metadata } from 'next';
import { ready } from '@/lib/services';
import { requireSession } from '@/lib/session';
import { SavedRow } from '@/components/find/SavedRow';

export const metadata: Metadata = { title: 'Searches' };
export const dynamic = 'force-dynamic';

const FINISHED = new Set(['completed', 'partial', 'failed', 'cancelled', 'budget_exhausted']);

export default async function Searches() {
  await ready();
  const { scope } = await requireSession();

  const [saved, runs, specs] = await Promise.all([
    scope.listSavedSearches(),
    scope.listRuns(40),
    scope.listSpecs(80),
  ]);
  const specById = new Map(specs.map((s) => [s.id, s]));
  const requests = new Map<string, string>();
  for (const spec of specs) {
    if (!spec.requestId) continue;
    const req = await scope.getRequest(spec.requestId);
    if (req) requests.set(spec.id, req.rawText);
  }

  return (
    <div className="page page--mid">
      <div className="head">
        <h1 className="h1">Searches</h1>
      </div>

      {saved.length > 0 ? (
        <section style={{ marginBottom: 34 }}>
          <span className="label">Saved</span>
          <div className="col g6" style={{ marginTop: 10 }}>
            {saved.map((s) => (
              <SavedRow key={s.id} id={s.id} name={s.name} request={s.sourceRequest} lastRunId={s.lastRunId} />
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <span className="label">History</span>
        {runs.length === 0 ? (
          <div className="empty" style={{ marginTop: 10 }}>
            <h3>Nothing yet</h3>
            <p>Describe who you are looking for and LeadMoor will start searching straight away.</p>
            <Link href="/" className="btn btn--pri btn--sm">
              New search
            </Link>
          </div>
        ) : (
          <div className="col g6" style={{ marginTop: 10 }}>
            {runs.map((run) => {
              const stats = (run.stats ?? {}) as Record<string, number>;
              const ask = requests.get(run.specId) ?? (specById.get(run.specId)?.spec as { name?: string })?.name;
              return (
                <Link key={run.id} href={`/s/${run.id}`} className="card row g10" style={{ padding: '12px 14px' }}>
                  <span className="col g2" style={{ minWidth: 0 }}>
                    <span className="sm truncate">{ask ?? 'Search'}</span>
                    <span className="xs faint">{statusLabel(run.status)}</span>
                  </span>
                  <div className="grow" />
                  {FINISHED.has(run.status) ? (
                    <>
                      <span className="mono sm nowrap" style={{ color: (stats.leads ?? 0) > 0 ? 'var(--accent)' : 'var(--faint)' }}>
                        {stats.leads ?? 0}
                      </span>
                      <span className="xs faint nowrap">leads</span>
                    </>
                  ) : null}
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function statusLabel(status: string): string {
  switch (status) {
    case 'completed':
      return 'Complete';
    case 'partial':
      return 'Complete — some sources were unreachable';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Stopped';
    case 'budget_exhausted':
      return 'Stopped at its limit';
    case 'running':
      return 'Running';
    default:
      return 'Queued';
  }
}
