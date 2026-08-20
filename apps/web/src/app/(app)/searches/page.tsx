import Link from 'next/link';
import type { Metadata } from 'next';
import type { LeadSpec } from '@leadmoor/core';
import { ready } from '@/lib/services';
import { requireSession } from '@/lib/session';
import { relativeTime, runStatusPill } from '@/lib/format';
import { EmptyState } from '@/components/EmptyState';
import { IconPlus, IconSearch } from '@/components/Icons';

export const metadata: Metadata = { title: 'Searches' };
export const dynamic = 'force-dynamic';

export default async function SearchesPage() {
  await ready();
  const { scope } = await requireSession();

  const specs = await scope.listSpecs(100);
  const runs = await scope.listRuns(200);
  const runBySpec = new Map<string, (typeof runs)[number]>();
  for (const run of runs) if (!runBySpec.has(run.specId)) runBySpec.set(run.specId, run);

  return (
    <div className="page">
      <div className="pagehead">
        <div>
          <h1 className="t-page">Searches</h1>
          <p className="muted t-sm" style={{ margin: '2px 0 0' }}>
            Every request you have compiled, and the run it produced.
          </p>
        </div>
        <div className="grow" />
        <Link href="/" className="btn btn--primary btn--sm">
          <IconPlus />
          New search
        </Link>
      </div>

      {specs.length === 0 ? (
        <EmptyState
          icon={<IconSearch />}
          title="No searches yet"
          body="A search starts with a sentence describing who you want to reach. LeadMoor turns it into a specification you can read and edit before anything runs."
          hints={[
            'Say the country, company size, and the signal that matters — for example “hiring security engineers”.',
            'Name the role you want to reach, so people discovery knows who to look for.',
          ]}
          action={{ href: '/', label: 'Start your first search' }}
        />
      ) : (
        <div className="card">
          <div className="card__body card__body--flush divide">
            {specs.map((spec) => {
              const doc = spec.spec as unknown as LeadSpec;
              const run = runBySpec.get(spec.id);
              const pill = run ? runStatusPill(run.status) : null;

              return (
                <Link key={spec.id} href={`/searches/${spec.id}`} className="rowbtn">
                  <span className="col g-2" style={{ minWidth: 0 }}>
                    <span className="truncate" style={{ fontWeight: 550 }}>
                      {doc.name ?? 'Untitled search'}
                    </span>
                    <span className="faint t-xs truncate">
                      {doc.geography?.countries?.join(', ')} ·{' '}
                      {doc.rubric?.criteria?.length ?? 0} criteria · {doc.personas?.titles?.[0] ?? 'no persona'}
                    </span>
                  </span>
                  <div className="grow" />
                  {pill ? <span className={pill.className}>{pill.label}</span> : null}
                  {!spec.approvedAt ? <span className="pill pill--plain">Draft</span> : null}
                  <span className="mono t-xs faint nowrap">{relativeTime(spec.createdAt)}</span>
                </Link>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
