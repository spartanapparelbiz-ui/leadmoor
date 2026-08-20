import Link from 'next/link';
import { notFound } from 'next/navigation';
import { and, asc, desc, eq } from 'drizzle-orm';
import { STAGE_LABELS, parseLeadSpec, type RunStage } from '@leadmoor/core';
import {
  company as companyTable,
  evidence as evidenceTable,
  fetchLog,
  lead as leadTable,
  leadSpec as leadSpecTable,
  person as personTable,
  run as runTable,
  runStage as runStageTable,
} from '@leadmoor/db';
import { ready, services, embeddedWorkerEnabled } from '@/lib/services';
import { bandClass, emailChip, relativeTime, runStatusChip, statusChip } from '@/lib/format';
import { RunPoller } from '@/components/RunPoller';
import { ExportButton } from '@/components/ExportButton';
import { DemoBanner } from '@/components/DemoBanner';

export const dynamic = 'force-dynamic';

export default async function RunPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  await ready();
  const db = services().db;

  const run = (await db.select().from(runTable).where(eq(runTable.id, runId)).limit(1))[0];
  if (!run) notFound();

  const specRow = (await db.select().from(leadSpecTable).where(eq(leadSpecTable.id, run.specId)).limit(1))[0];
  const parsedSpec = specRow ? parseLeadSpec(specRow.spec) : null;
  const spec = parsedSpec?.ok ? parsedSpec.spec : null;

  const stages = await db
    .select()
    .from(runStageTable)
    .where(eq(runStageTable.runId, runId))
    .orderBy(asc(runStageTable.ordinal));

  const leads = await db
    .select()
    .from(leadTable)
    .where(eq(leadTable.runId, runId))
    .orderBy(desc(leadTable.score), desc(leadTable.coverage));

  const companies = await db.select().from(companyTable).where(eq(companyTable.runId, runId));
  const people = await db.select().from(personTable).where(eq(personTable.runId, runId));
  const evidenceCount = (await db.select().from(evidenceTable).where(eq(evidenceTable.runId, runId))).length;
  const failures = (await db.select().from(fetchLog).where(eq(fetchLog.runId, runId))).filter(
    (f) => f.status !== 'ok',
  );

  const companyById = new Map(companies.map((c) => [c.id, c]));
  const personById = new Map(people.map((p) => [p.id, p]));

  const active = !['completed', 'failed', 'cancelled', 'budget_exhausted', 'partial'].includes(run.status);
  const chip = runStatusChip(run.status);
  const usage = (run.usage ?? {}) as Record<string, number>;

  const visible = leads.filter((l) => l.status !== 'suppressed');
  const qualified = visible.filter((l) => l.status === 'qualified');
  const held = visible.filter((l) => l.status === 'held_insufficient_evidence');
  const others = visible.filter((l) => l.status !== 'qualified' && l.status !== 'held_insufficient_evidence');

  return (
    <div className="shell shell--wide">
      {active ? <RunPoller runId={runId} embedded={embeddedWorkerEnabled()} /> : null}

      {run.isDemo ? <DemoBanner /> : null}

      <header style={{ padding: '36px 0 20px' }}>
        <div className="row gap-12 wrap">
          <div style={{ minWidth: 0 }}>
            <span className="eyebrow">Run</span>
            <h1 className="h-display" style={{ fontSize: '2rem', margin: '0.2em 0 0.3em' }}>
              {spec?.name ?? 'Lead run'}
            </h1>
          </div>
          <div className="spacer" />
          <div className="row gap-8 wrap">
            <span className={chip.className}>{chip.label}</span>
            {specRow ? (
              <Link href={`/searches/${specRow.id}`} className="btn btn--sm">
                View search
              </Link>
            ) : null}
            {qualified.length > 0 ? <ExportButton runId={runId} /> : null}
          </div>
        </div>

        {run.error ? (
          <p className="notice notice--error" style={{ marginTop: 16 }} role="alert">
            <strong>Run stopped.</strong> {run.error}
          </p>
        ) : null}

        {run.status === 'budget_exhausted' ? (
          <p className="notice" style={{ marginTop: 16 }}>
            <strong>Budget reached.</strong> The run stopped cleanly at its configured ceiling. Everything found
            before that point is kept below.
          </p>
        ) : null}
      </header>

      <div className="grid-2">
        <div className="stack gap-16">
          <div className="panel">
            <div className="panel__head">
              <span className="eyebrow">Progress</span>
              <div className="spacer" />
              {active ? <span className="mono small muted">updating…</span> : null}
            </div>
            <div className="stages">
              {stages.map((stage) => (
                <StageRow key={stage.id} stage={stage} />
              ))}
            </div>
          </div>

          {leads.length > 0 ? (
            <>
              {qualified.length > 0 ? (
                <LeadTable
                  title="Qualified leads"
                  subtitle={`${qualified.length} of ${visible.length} scored companies met the bar`}
                  leads={qualified}
                  companyById={companyById}
                  personById={personById}
                />
              ) : null}

              {held.length > 0 ? (
                <LeadTable
                  title="Held for insufficient evidence"
                  subtitle="Too little of the rubric could be evaluated to score these fairly. They are not failures."
                  leads={held}
                  companyById={companyById}
                  personById={personById}
                />
              ) : null}

              {others.length > 0 ? (
                <LeadTable
                  title="Did not qualify"
                  subtitle="Evaluated and scored below the threshold, or dropped by a hard filter."
                  leads={others}
                  companyById={companyById}
                  personById={personById}
                />
              ) : null}
            </>
          ) : (
            <div className="panel">
              <div className="empty">
                <p className="h-section">{active ? 'Working…' : 'No leads produced'}</p>
                <p className="muted" style={{ maxWidth: '52ch', margin: '0 auto' }}>
                  {active
                    ? 'Companies appear here as they are discovered, enriched, and scored.'
                    : run.error
                      ? 'The run stopped before it could produce leads. The reason is shown above and every attempt is recorded below.'
                      : 'No company matched the search. Try broadening the filters or the queries.'}
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="stack gap-16">
          <div className="panel">
            <div className="panel__head">
              <span className="eyebrow">This run</span>
            </div>
            <div className="panel__body">
              <dl className="kv small">
                <dt>Companies</dt>
                <dd className="mono">
                  {companies.length}
                  {spec ? <span className="muted"> / {spec.budget.maxCompanies}</span> : null}
                </dd>
                <dt>Documents</dt>
                <dd className="mono">
                  {evidenceCount}
                  {spec ? <span className="muted"> / {spec.budget.maxDocuments}</span> : null}
                </dd>
                <dt>People found</dt>
                <dd className="mono">{people.length}</dd>
                <dt>Model calls</dt>
                <dd className="mono">
                  {usage.modelCalls ?? 0}
                  {spec ? <span className="muted"> / {spec.budget.maxModelCalls}</span> : null}
                </dd>
                <dt>Started</dt>
                <dd className="mono">{relativeTime(run.startedAt)}</dd>
                {run.finishedAt ? (
                  <>
                    <dt>Finished</dt>
                    <dd className="mono">{relativeTime(run.finishedAt)}</dd>
                  </>
                ) : null}
              </dl>
            </div>
          </div>

          {failures.length > 0 ? (
            <div className="panel">
              <div className="panel__head">
                <span className="eyebrow">Retrieval problems</span>
                <div className="spacer" />
                <span className="mono small muted">{failures.length}</span>
              </div>
              <div className="panel__body panel__body--flush stack divide">
                {failures.slice(0, 4).map((f) => (
                  <div key={f.id} style={{ padding: '10px 18px' }}>
                    <div className="row gap-8">
                      <span
                        className={
                          f.status === 'policy_denied' || f.status === 'robots_denied'
                            ? 'chip chip--warn'
                            : 'chip chip--fail'
                        }
                      >
                        {f.status.replace(/_/g, ' ')}
                      </span>
                      <span className="mono small muted" style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {f.url.replace(/^https?:\/\//, '').slice(0, 46)}
                      </span>
                    </div>
                    {f.denialReason ? (
                      <p className="small muted" style={{ margin: '4px 0 0' }}>
                        {f.denialReason.slice(0, 160)}
                      </p>
                    ) : null}
                  </div>
                ))}
                {failures.length > 4 ? (
                  <details className="evidence" style={{ borderTop: 'none' }}>
                    <summary>
                      <span className="small muted">{failures.length - 4} more</span>
                    </summary>
                    <div className="evidence__body">
                      {failures.slice(4, 40).map((f) => (
                        <div key={f.id} className="small">
                          <span className="mono muted">{f.status}</span>{' '}
                          <span className="mono" style={{ wordBreak: 'break-all' }}>
                            {f.url.replace(/^https?:\/\//, '').slice(0, 70)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="panel">
            <div className="panel__head">
              <span className="eyebrow">Audit</span>
            </div>
            <div className="panel__body">
              <p className="small muted" style={{ margin: 0 }}>
                Every fetch, policy refusal, claim, rejection, and score in this run is recorded.
              </p>
              <Link href={`/runs/${runId}/audit`} className="btn btn--sm" style={{ marginTop: 12 }}>
                Open audit log
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StageRow({ stage }: { stage: { stage: string; status: string; detail: unknown; error: string | null } }) {
  const label = STAGE_LABELS[stage.stage as RunStage] ?? stage.stage;
  const modifier =
    stage.status === 'completed'
      ? 'done'
      : stage.status === 'running'
        ? 'running'
        : stage.status === 'failed'
          ? 'failed'
          : stage.status === 'blocked'
            ? 'blocked'
            : stage.status === 'partial'
              ? 'partial'
              : stage.status === 'skipped'
                ? 'skipped'
                : '';

  return (
    <div className="stage">
      <span className={`stage__dot ${modifier ? `stage__dot--${modifier}` : ''}`} aria-hidden="true">
        {stage.status === 'completed' ? '✓' : ''}
      </span>
      <div className="stage__label">
        {label}
        {stage.error ? <small style={{ color: 'var(--crit)' }}>{stage.error.slice(0, 220)}</small> : null}
        {!stage.error && stage.status !== 'pending' ? <small>{summarize(stage.detail)}</small> : null}
      </div>
      <span className={`chip ${chipFor(stage.status)}`}>{stage.status.replace(/_/g, ' ')}</span>
    </div>
  );
}

function chipFor(status: string): string {
  if (status === 'completed') return 'chip--pass';
  if (status === 'failed' || status === 'blocked') return 'chip--fail';
  if (status === 'partial' || status === 'running') return 'chip--warn';
  return 'chip--neutral';
}

/** Renders a stage's own counters. Never invents progress the pipeline did not report. */
function summarize(detail: unknown): string {
  if (!detail || typeof detail !== 'object') return '';
  const d = detail as Record<string, unknown>;

  const parts: string[] = [];
  const push = (key: string, label: string) => {
    if (typeof d[key] === 'number') parts.push(`${d[key]} ${label}`);
  };

  push('inserted', 'discovered');
  push('companies', 'companies');
  push('merged', 'merged');
  push('flaggedForReview', 'flagged for review');
  push('enriched', 'enriched');
  push('documents', 'documents');
  push('dropped', 'dropped');
  push('peopleFound', 'people');
  push('companiesWithoutPeople', 'without a person');
  push('unverified', 'unverified emails');
  push('unavailable', 'no email');
  push('scored', 'scored');
  push('qualified', 'qualified');
  push('held', 'held');
  push('leads', 'leads');

  if (typeof d.reason === 'string') parts.push(d.reason);
  if (Array.isArray(d.blocked) && d.blocked.length > 0) parts.push(String(d.blocked[0]).slice(0, 150));

  return parts.join(' · ');
}

function LeadTable({
  title,
  subtitle,
  leads,
  companyById,
  personById,
}: {
  title: string;
  subtitle: string;
  leads: Array<typeof leadTable.$inferSelect>;
  companyById: Map<string, typeof companyTable.$inferSelect>;
  personById: Map<string, typeof personTable.$inferSelect>;
}) {
  return (
    <div className="panel">
      <div className="panel__head">
        <div style={{ minWidth: 0 }}>
          <span className="eyebrow">{title}</span>
          <p className="small muted" style={{ margin: '3px 0 0' }}>
            {subtitle}
          </p>
        </div>
        <div className="spacer" />
        <span className="mono small muted">{leads.length}</span>
      </div>
      <div className="panel__body panel__body--flush">
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr>
                <th style={{ width: 76 }}>Score</th>
                <th>Company</th>
                <th>Decision maker</th>
                <th>Why</th>
                <th>Contact</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => {
                const company = companyById.get(lead.companyId);
                const person = lead.personId ? personById.get(lead.personId) : undefined;
                const status = statusChip(lead.status);
                const email = emailChip(lead.emailStatus);

                return (
                  <tr key={lead.id}>
                    <td>
                      <div
                        className={`score score--md ${
                          lead.coverage < 0.9 && lead.status !== 'held_insufficient_evidence'
                            ? 'score--partial'
                            : bandClass(lead.band)
                        }`}
                        title={
                          lead.coverage < 0.9
                            ? `Scored from ${Math.round(lead.coverage * 100)}% of the rubric — the rest could not be established`
                            : 'Scored from the full rubric'
                        }
                      >
                        {lead.status === 'held_insufficient_evidence' ? '—' : Math.round(lead.score)}
                      </div>
                      <span className={`score__coverage ${lead.coverage < 0.9 ? 'score__coverage--partial' : ''}`}>
                        {Math.round(lead.coverage * 100)}% evidence
                      </span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{company?.canonicalName ?? '—'}</div>
                      {company?.primaryDomain ? (
                        <a
                          href={`https://${company.primaryDomain}`}
                          className="mono small"
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          {company.primaryDomain}
                        </a>
                      ) : (
                        <span className="mono small muted">no verified domain</span>
                      )}
                    </td>
                    <td>
                      {person ? (
                        <div style={{ color: 'var(--ink)' }}>{person.fullName}</div>
                      ) : (
                        <span className="chip chip--unknown">No match found</span>
                      )}
                    </td>
                    <td style={{ maxWidth: 320 }}>
                      <span className="small">{lead.heldReason ?? lead.rationale ?? '—'}</span>
                      <div style={{ marginTop: 5 }}>
                        <span className={status.className}>{status.label}</span>
                      </div>
                    </td>
                    <td>
                      <span className={email.className}>{email.label}</span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <Link href={`/leads/${lead.id}`} className="btn btn--sm">
                        Open dossier
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
