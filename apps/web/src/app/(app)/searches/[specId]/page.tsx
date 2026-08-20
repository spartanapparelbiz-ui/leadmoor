import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { Criterion, LeadSpec } from '@leadmoor/core';
import { ready } from '@/lib/services';
import { requireSession } from '@/lib/session';
import { absoluteTime, humanize, runStatusPill } from '@/lib/format';
import { SpecSections } from '@/components/search/SpecSections';
import { SpecEditor } from '@/components/search/SpecEditor';
import { ApproveBar } from '@/components/search/ApproveBar';
import { SaveSearchForm } from '@/components/search/SaveSearchForm';
import { IconArrowRight } from '@/components/Icons';

export const metadata: Metadata = { title: 'Review search' };
export const dynamic = 'force-dynamic';

export default async function SpecPage({ params }: { params: Promise<{ specId: string }> }) {
  const { specId } = await params;
  await ready();
  const { scope } = await requireSession();

  const record = await scope.getSpec(specId);
  if (!record) notFound();

  const spec = record.spec as unknown as LeadSpec;
  const run = await scope.runForSpec(specId);
  const pill = run ? runStatusPill(run.status) : null;

  const evaluable = spec.rubric.criteria.filter((c: Criterion) => c.evaluator.type !== 'llm_judge').length;

  return (
    <div className="page page--narrow">
      <div className="pagehead">
        <div style={{ minWidth: 0 }}>
          <span className="t-label">Search {record.approvedAt ? 'approved' : 'draft'} · v{record.version}</span>
          <h1 className="t-page" style={{ marginTop: 2 }}>
            {spec.name}
          </h1>
        </div>
        <div className="grow" />
        {pill && run ? (
          <Link href={`/runs/${run.id}`} className="row g-8" style={{ textDecoration: 'none' }}>
            <span className={pill.className}>{pill.label}</span>
            <span className="btn btn--ghost btn--sm">
              Open run <IconArrowRight />
            </span>
          </Link>
        ) : null}
      </div>

      <p className="notice t-sm" role="note" style={{ marginTop: 0 }}>
        <strong>This is the whole search.</strong> Everything the pipeline will do is written below — read it,
        change anything that is wrong, then approve. {evaluable} of {spec.rubric.criteria.length} criteria can be
        decided without a language model.
      </p>

      <SpecSections spec={spec} />

      {!record.approvedAt ? (
        <>
          <SpecEditor specId={specId} initial={JSON.stringify(spec, null, 2)} />
          <ApproveBar specId={specId} companyCap={spec.discovery.maxCompanies} />
        </>
      ) : (
        <div className="card" style={{ marginTop: 20 }}>
          <div className="card__body col g-10">
            <span className="t-label">Approved {absoluteTime(record.approvedAt)}</span>
            <p className="muted t-sm" style={{ margin: 0 }}>
              An approved search is frozen so its results stay reproducible. To change it, save it as a list and
              run an edited copy.
            </p>
            <SaveSearchForm specId={specId} defaultName={spec.name} />
          </div>
        </div>
      )}

      <details className="card" style={{ marginTop: 20 }}>
        <summary
          className="card__head"
          style={{ cursor: 'pointer', listStyle: 'none', display: 'flex', alignItems: 'center' }}
        >
          <span className="t-section">Original request</span>
        </summary>
        <div className="card__body">
          <p className="t-sm" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {spec.sourceRequest}
          </p>
          <p className="faint t-xs" style={{ marginBottom: 0 }}>
            Compiled by {humanize(record.origin)} · {absoluteTime(record.createdAt)}
          </p>
        </div>
      </details>
    </div>
  );
}
