import Link from 'next/link';
import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { parseLeadSpec, type LeadSpec } from '@leadmoor/core';
import { leadSpec as leadSpecTable, run as runTable } from '@leadmoor/db';
import { ready, services } from '@/lib/services';
import { SpecEditor } from '@/components/SpecEditor';
import { ActionForm } from '@/components/ActionForm';
import { approveAndRun } from '@/lib/actions';

export const dynamic = 'force-dynamic';

export default async function SpecPage({ params }: { params: Promise<{ specId: string }> }) {
  const { specId } = await params;
  await ready();
  const db = services().db;

  const row = (await db.select().from(leadSpecTable).where(eq(leadSpecTable.id, specId)).limit(1))[0];
  if (!row) notFound();

  const parsed = parseLeadSpec(row.spec);
  const existingRun = (await db.select().from(runTable).where(eq(runTable.specId, specId)).limit(1))[0];

  if (!parsed.ok) {
    return (
      <div className="shell">
        <div className="panel" style={{ marginTop: 48 }}>
          <div className="panel__body stack gap-16">
            <h1 className="h-section">This search is not valid</h1>
            <ul className="small muted">
              {parsed.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
            <Link href="/" className="btn">
              Start again
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const spec = parsed.spec;
  const origin =
    row.origin === 'compiled' ? 'Built by the model' : row.origin === 'edited' ? 'Edited by you' : 'Keyword draft';

  return (
    <div className="shell">
      <header style={{ padding: '40px 0 20px' }}>
        <span className="eyebrow">Review before running</span>
        <h1 className="h-display" style={{ fontSize: '2.1rem', margin: '0.25em 0 0.4em' }}>
          {spec.name}
        </h1>
        <p className="lede small" style={{ fontSize: '0.95rem' }}>
          &ldquo;{spec.sourceRequest}&rdquo;
        </p>
        <div className="row gap-8 wrap" style={{ marginTop: 14 }}>
          <span className="chip chip--neutral">{origin}</span>
          <span className="chip chip--neutral mono">v{row.version}</span>
          {existingRun ? <span className="chip chip--warn">Already run</span> : null}
        </div>
      </header>

      {row.origin === 'heuristic' ? (
        <p className="notice" style={{ marginBottom: 20 }}>
          <strong>Drafted without a language model.</strong> This search was structured by matching keywords in
          your request. Read it carefully and edit anything it missed — set{' '}
          <code className="mono">ANTHROPIC_API_KEY</code> for a considered reading of your intent.
        </p>
      ) : null}

      <div className="grid-2">
        <div className="stack gap-16">
          <SpecSummary spec={spec} />
          <RubricPanel spec={spec} />
        </div>

        <div className="stack gap-16">
          <div className="panel">
            <div className="panel__head">
              <span className="eyebrow">Ready to run</span>
            </div>
            <div className="panel__body stack gap-16">
              {existingRun ? (
                <>
                  <p className="small muted" style={{ margin: 0 }}>
                    This search has already been approved and run.
                  </p>
                  <Link href={`/runs/${existingRun.id}`} className="btn btn--primary">
                    Open the run
                  </Link>
                </>
              ) : (
                <>
                  <p className="small muted" style={{ margin: 0 }}>
                    Approving starts a durable run against permitted sources. It stops on its own at{' '}
                    <span className="mono">{spec.budget.maxCompanies}</span> companies,{' '}
                    <span className="mono">{spec.budget.maxDocuments}</span> documents, or{' '}
                    <span className="mono">{Math.round(spec.budget.maxRuntimeMs / 60000)}</span> minutes.
                  </p>
                  <ActionForm action={approveAndRun} submitLabel="Approve &amp; find leads" pendingLabel="Starting…">
                    <input type="hidden" name="specId" value={specId} />
                  </ActionForm>
                </>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="panel__head">
              <span className="eyebrow">Budget</span>
            </div>
            <div className="panel__body">
              <dl className="kv small">
                <dt>Companies</dt>
                <dd className="mono">{spec.budget.maxCompanies}</dd>
                <dt>Documents</dt>
                <dd className="mono">{spec.budget.maxDocuments}</dd>
                <dt>Pages/company</dt>
                <dd className="mono">{spec.budget.maxFetchesPerCompany}</dd>
                <dt>People/company</dt>
                <dd className="mono">{spec.budget.maxPeoplePerCompany}</dd>
                <dt>Model calls</dt>
                <dd className="mono">{spec.budget.maxModelCalls}</dd>
                <dt>Runtime</dt>
                <dd className="mono">{Math.round(spec.budget.maxRuntimeMs / 60000)} min</dd>
              </dl>
            </div>
          </div>
        </div>
      </div>

      {!existingRun ? (
        <div style={{ marginTop: 24 }}>
          <SpecEditor specId={specId} initial={JSON.stringify(spec, null, 2)} />
        </div>
      ) : null}
    </div>
  );
}

function SpecSummary({ spec }: { spec: LeadSpec }) {
  const range = spec.company.employeeRange;
  const size = range
    ? `${range.min ?? 'any'}–${range.max ?? 'any'} employees`
    : 'Not specified';

  return (
    <div className="panel">
      <div className="panel__head">
        <span className="eyebrow">Your search</span>
      </div>
      <div className="panel__body">
        <dl className="kv">
          <dt>Location</dt>
          <dd>{spec.geography.countries.join(', ')}</dd>

          <dt>Company type</dt>
          <dd>{spec.company.descriptors.length > 0 ? spec.company.descriptors.join(', ') : 'Any'}</dd>

          <dt>Employees</dt>
          <dd>{size}</dd>

          <dt>Signals</dt>
          <dd>
            {spec.signals.length > 0 ? (
              <div className="row gap-4 wrap">
                {spec.signals.map((s) => (
                  <span key={s} className="chip chip--neutral">
                    {s}
                  </span>
                ))}
              </div>
            ) : (
              <span className="muted">None</span>
            )}
          </dd>

          <dt>People</dt>
          <dd>
            <div className="row gap-4 wrap">
              {spec.personas.titles.map((t) => (
                <span key={t} className="chip chip--neutral">
                  {t}
                </span>
              ))}
            </div>
          </dd>

          <dt>Sources</dt>
          <dd className="mono small">{spec.discovery.sources.join(', ')}</dd>

          <dt>Queries</dt>
          <dd>
            <ul className="small muted" style={{ margin: 0, paddingLeft: '1.1em' }}>
              {spec.discovery.queries.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </dd>
        </dl>
      </div>
    </div>
  );
}

function RubricPanel({ spec }: { spec: LeadSpec }) {
  const total = spec.rubric.criteria
    .filter((c) => c.kind === 'weighted' || c.kind === 'bonus')
    .reduce((sum, c) => sum + c.weight, 0);

  return (
    <div className="panel">
      <div className="panel__head">
        <span className="eyebrow">How leads will be scored</span>
        <div className="spacer" />
        <span className="mono small muted">pass at {spec.rubric.passThreshold}</span>
      </div>
      <div className="panel__body panel__body--flush">
        <div className="tablewrap">
          <table className="data">
            <thead>
              <tr>
                <th>Criterion</th>
                <th>Kind</th>
                <th>How it is decided</th>
                <th style={{ textAlign: 'right' }}>Weight</th>
              </tr>
            </thead>
            <tbody>
              {spec.rubric.criteria.map((c) => (
                <tr key={c.id}>
                  <td>
                    <div style={{ fontWeight: 600, color: 'var(--ink)' }}>{c.name}</div>
                    <div className="mono small muted">{c.id}</div>
                  </td>
                  <td>
                    <span
                      className={
                        c.kind === 'disqualifier'
                          ? 'chip chip--fail'
                          : c.kind === 'hard_filter'
                            ? 'chip chip--warn'
                            : 'chip chip--neutral'
                      }
                    >
                      {c.kind.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="small">{describeEvaluator(c.evaluator)}</td>
                  <td className="mono" style={{ textAlign: 'right' }}>
                    {c.kind === 'hard_filter' ? '—' : `${Math.round((c.weight / Math.max(1, total)) * 100)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function describeEvaluator(evaluator: LeadSpec['rubric']['criteria'][number]['evaluator']): string {
  switch (evaluator.type) {
    case 'numeric_range': {
      const bounds = [
        evaluator.min !== undefined ? `at least ${evaluator.min}` : null,
        evaluator.max !== undefined ? `at most ${evaluator.max}` : null,
      ]
        .filter(Boolean)
        .join(' and ');
      return `${evaluator.field} is ${bounds}`;
    }
    case 'structured_predicate':
      return `${evaluator.field} ${evaluator.op.replace('_', ' ')}${
        evaluator.value === undefined ? '' : ` ${Array.isArray(evaluator.value) ? evaluator.value.slice(0, 3).join(', ') : String(evaluator.value)}`
      }`;
    case 'evidence_keyword':
      return `a retrieved page contains ${evaluator.anyOf.slice(0, 4).map((t) => `“${t}”`).join(' or ')}`;
    case 'llm_judge':
      return `judged from evidence: ${evaluator.question}`;
  }
}
