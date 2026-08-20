import Link from 'next/link';
import { providerStatus, ready } from '@/lib/services';
import { requireSession } from '@/lib/session';
import { Ask } from '@/components/find/Ask';
import { IconArrowRight } from '@/components/Icons';

export const dynamic = 'force-dynamic';

/** A run that has not executed yet has no lead count to report — only a state. */
const FINISHED = new Set(['completed', 'partial', 'failed', 'cancelled', 'budget_exhausted']);

export default async function Home() {
  await ready();
  const { scope } = await requireSession();
  const status = providerStatus();
  const recent = await scope.listRuns(4);
  const specs = new Map((await scope.listSpecs(40)).map((s) => [s.id, s]));

  return (
    <div className="page page--mid" style={{ paddingTop: 'clamp(40px, 12vh, 120px)' }}>
      <h1 className="hero" style={{ marginBottom: 12 }}>
        Who are you looking for?
      </h1>
      <p className="lede" style={{ marginBottom: 30 }}>
        Describe your ideal customer in plain words. LeadMoor searches permitted public sources, finds the
        companies and the people who decide, and shows you where every fact came from.
      </p>

      <Ask llmConfigured={status.llm.configured} />

      {recent.length > 0 ? (
        <section style={{ marginTop: 54 }}>
          <div className="row g8" style={{ marginBottom: 10 }}>
            <span className="label">Recent</span>
            <div className="grow" />
            <Link href="/searches" className="btn btn--ghost btn--sm">
              All searches <IconArrowRight />
            </Link>
          </div>
          <div className="col g6">
            {recent.map((run) => {
              const doc = specs.get(run.specId)?.spec as { sourceRequest?: string; name?: string } | undefined;
              const stats = (run.stats ?? {}) as Record<string, number>;
              return (
                <Link
                  key={run.id}
                  href={`/s/${run.id}`}
                  className="row g10 card"
                  style={{ padding: '11px 14px' }}
                >
                  <span className="truncate sm">{doc?.sourceRequest ?? doc?.name ?? 'Search'}</span>
                  <div className="grow" />
                  {FINISHED.has(run.status) ? (
                    <span className="mono xs nowrap" style={{ color: (stats.leads ?? 0) > 0 ? 'var(--accent)' : 'var(--faint)' }}>
                      {stats.leads ?? 0} leads
                    </span>
                  ) : (
                    <span className="xs faint nowrap">{run.status === 'running' ? 'running' : 'queued'}</span>
                  )}
                </Link>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}
