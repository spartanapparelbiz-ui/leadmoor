import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { STAGE_LABELS, parseLeadSpec, type RunStage } from '@leadmoor/core';
import { embeddedWorkerEnabled, ready } from '@/lib/services';
import { requireSession } from '@/lib/session';
import { absoluteTime, durationOf, hostOf, runStatusPill } from '@/lib/format';
import { RunLive } from '@/components/run/RunLive';
import { CancelRunButton } from '@/components/run/CancelRunButton';
import { ExportModal } from '@/components/leads/ExportModal';
import { LeadResults } from '@/components/leads/LeadResults';
import { DemoBanner } from '@/components/DemoBanner';
import { EmptyState } from '@/components/EmptyState';
import { IconArrowRight, IconTarget } from '@/components/Icons';
import { loadLeadViews } from '@/lib/leads';

export const metadata: Metadata = { title: 'Run' };
export const dynamic = 'force-dynamic';

const TERMINAL = ['completed', 'failed', 'cancelled', 'budget_exhausted', 'partial'];

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  await ready();
  const { scope } = await requireSession();

  const run = await scope.getRun(runId);
  if (!run) notFound();

  const specRow = await scope.getSpec(run.specId);
  const parsed = specRow ? parseLeadSpec(specRow.spec) : null;
  const spec = parsed?.ok ? parsed.spec : null;

  const [stages, counters, views, fetches] = await Promise.all([
    scope.stagesFor(runId),
    scope.runCounters(runId),
    loadLeadViews(scope, { runId, includeSuppressed: false }),
    scope.listFetches(runId),
  ]);

  const active = !TERMINAL.includes(run.status);
  const pill = runStatusPill(run.status);
  const failures = fetches.filter((f) => f.status !== 'ok');
  const qualified = views.filter((v) => v.lead.status === 'qualified').length;

  return (
    <div className="page">
      <div className="pagehead">
        <div style={{ minWidth: 0 }}>
          <span className="t-label">Run · {absoluteTime(run.startedAt ?? run.createdAt)}</span>
          <h1 className="t-page" style={{ marginTop: 2 }}>
            {spec?.name ?? 'Lead run'}
          </h1>
        </div>
        <div className="grow" />
        <span className={pill.className} title={pill.title}>
          {pill.label}
        </span>
        {specRow ? (
          <Link href={`/searches/${specRow.id}`} className="btn btn--sm">
            View search <IconArrowRight />
          </Link>
        ) : null}
        {active ? <CancelRunButton runId={runId} /> : null}
        {qualified > 0 ? <ExportModal runId={runId} qualified={qualified} total={views.length} /> : null}
      </div>

      {run.isDemo ? <DemoBanner /> : null}

      {run.error ? (
        <p className="notice notice--crit t-sm" role="alert">
          <strong>Run stopped.</strong> {run.error}
        </p>
      ) : null}

      {run.status === 'budget_exhausted' ? (
        <p className="notice notice--warn t-sm">
          <strong>Budget reached.</strong> The run stopped cleanly at its configured ceiling. Everything found
          before that point is kept. Raise <code className="mono">budget</code> in the search to go further.
        </p>
      ) : null}

      {run.status === 'partial' ? (
        <p className="notice notice--warn t-sm">
          <strong>Some stages failed.</strong> The results below are what completed. The step list shows exactly
          which stage stopped and why — nothing has been filled in to cover the gap.
        </p>
      ) : null}

      <RunLive
        runId={runId}
        active={active}
        embedded={embeddedWorkerEnabled()}
        initialStages={stages.map((s) => ({
          stage: s.stage,
          label: STAGE_LABELS[s.stage as RunStage] ?? s.stage,
          status: s.status,
          startedAt: s.startedAt ? s.startedAt.toISOString() : null,
          finishedAt: s.finishedAt ? s.finishedAt.toISOString() : null,
          attempts: s.attempts,
          error: s.error,
          detail: (s.detail ?? {}) as Record<string, unknown>,
        }))}
        initialCounters={counters}
        budget={
          spec
            ? {
                companies: spec.budget.maxCompanies,
                documents: spec.budget.maxDocuments,
                modelCalls: spec.budget.maxModelCalls,
              }
            : null
        }
      />

      {views.length > 0 ? (
        <LeadResults views={views} runId={runId} />
      ) : (
        <EmptyState
          icon={<IconTarget />}
          title={active ? 'Working…' : 'No leads produced'}
          body={
            active
              ? 'Companies appear here as they are discovered, enriched, and scored. The step list above is live.'
              : run.error
                ? 'The run stopped before it could produce leads. The reason is above, and every attempt is in the audit log.'
                : 'No company cleared the search. Widen the employee range, add discovery queries, or lower the pass threshold.'
          }
          hints={
            active
              ? []
              : [
                  failures.length > 0
                    ? `${failures.length} retrieval attempt(s) were refused or failed — see the audit log for each one.`
                    : 'Every stage completed; the rubric simply found no match.',
                  'Editing the search creates a new version; the original run stays intact.',
                ]
          }
          action={specRow ? { href: `/searches/${specRow.id}`, label: 'Review the search' } : undefined}
        />
      )}

      <section className="grid-side" style={{ marginTop: 24 }}>
        <div className="card">
          <div className="card__head">
            <span className="t-section">This run</span>
          </div>
          <div className="card__body">
            <dl className="dl">
              <dt>Companies</dt>
              <dd className="mono">
                {counters.companies}
                {spec ? <span className="faint"> / {spec.budget.maxCompanies}</span> : null}
              </dd>
              <dt>Documents stored</dt>
              <dd className="mono">
                {counters.documents}
                {spec ? <span className="faint"> / {spec.budget.maxDocuments}</span> : null}
              </dd>
              <dt>People found</dt>
              <dd className="mono">{counters.people}</dd>
              <dt>Model calls</dt>
              <dd className="mono">
                {counters.modelCalls}
                {spec ? <span className="faint"> / {spec.budget.maxModelCalls}</span> : null}
              </dd>
              <dt>Duration</dt>
              <dd className="mono">{durationOf(run.startedAt, run.finishedAt)}</dd>
            </dl>
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <span className="t-section">Retrieval problems</span>
            <div className="grow" />
            <span className="mono t-xs faint">{failures.length}</span>
          </div>
          <div className="card__body">
            {failures.length === 0 ? (
              <p className="muted t-sm" style={{ margin: 0 }}>
                Every fetch this run attempted succeeded.
              </p>
            ) : (
              <div className="col g-8">
                {failures.slice(0, 5).map((f) => (
                  <div key={f.id} className="col g-2">
                    <div className="row g-6">
                      <span
                        className={
                          f.status === 'policy_denied' || f.status === 'robots_denied'
                            ? 'pill pill--warn'
                            : 'pill pill--crit'
                        }
                      >
                        {f.status.replace(/_/g, ' ')}
                      </span>
                      <span className="mono t-xs faint truncate">{hostOf(f.url)}</span>
                    </div>
                    {f.denialReason ? (
                      <span className="muted t-xs">{f.denialReason.slice(0, 150)}</span>
                    ) : null}
                  </div>
                ))}
                {failures.length > 5 ? (
                  <Link href={`/runs/${runId}/audit`} className="t-xs">
                    {failures.length - 5} more in the audit log
                  </Link>
                ) : null}
              </div>
            )}
            <Link href={`/runs/${runId}/audit`} className="btn btn--sm" style={{ marginTop: 12 }}>
              Open audit log
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
