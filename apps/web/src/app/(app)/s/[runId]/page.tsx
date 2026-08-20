import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { parseLeadSpec } from '@leadmoor/core';
import { ready } from '@/lib/services';
import { requireSession } from '@/lib/session';
import { loadLeads } from '@/lib/leads';
import { searchProgress } from '@/lib/actions/progress';
import { Progress } from '@/components/find/Progress';
import { Results } from '@/components/find/Results';
import { Criteria } from '@/components/find/Criteria';
import { SaveSearch } from '@/components/find/SaveSearch';
import { StopButton } from '@/components/find/StopButton';

export const metadata: Metadata = { title: 'Search' };
export const dynamic = 'force-dynamic';

export default async function SearchPage({ params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  await ready();
  const { scope } = await requireSession();

  const run = await scope.getRun(runId);
  if (!run) notFound();

  const specRow = await scope.getSpec(run.specId);
  const parsed = specRow ? parseLeadSpec(specRow.spec) : null;
  const spec = parsed?.ok ? parsed.spec : null;
  const request = specRow?.requestId ? await scope.getRequest(specRow.requestId) : null;

  const progress = await searchProgress(runId);
  const running = progress ? !progress.done : false;
  const leads = running ? [] : await loadLeads(scope, { runId, limit: 1000 });

  const fetches = running ? [] : await scope.listFetches(runId);
  const failures = fetches.filter((f) => f.status !== 'ok');
  const unranked = leads.filter((l) => !l.scoreShown).length;
  const blockedHosts = new Set(failures.map((f) => hostOf(f.url))).size;

  return (
    <div className="page">
      <div className="head">
        <div className="col g6" style={{ minWidth: 0, flex: '1 1 420px' }}>
          <span className="label">{running ? 'Searching' : 'Results'}</span>
          <h1 className="h1" style={{ maxWidth: '48ch' }}>
            {request?.rawText ?? spec?.name ?? 'Search'}
          </h1>
        </div>
        <div className="grow" />
        {running ? <StopButton runId={runId} /> : <SaveSearch runId={runId} name={spec?.name ?? 'Saved search'} />}
      </div>

      {spec ? <Criteria spec={spec} count={leads.length} running={running} /> : null}

      {run.isDemo ? (
        <p className="note note--warn sm" style={{ marginBottom: 16 }} role="note">
          <strong>Demo data.</strong> Produced by the real pipeline against a fixture corpus of fictional{' '}
          <code>.example</code> companies. Every claim and citation is a genuine output of the validator — the
          companies are not real.
        </p>
      ) : null}

      {run.error ? (
        <p className="note note--crit sm" style={{ marginBottom: 16 }} role="alert">
          <strong>Search stopped.</strong> {run.error}
        </p>
      ) : null}

      {!running && leads.length > 0 && unranked === leads.length ? (
        <p className="note note--warn sm" style={{ marginBottom: 16 }}>
          <strong>
            {leads.length} companies found, none could be ranked.
          </strong>{' '}
          LeadMoor reads a company&rsquo;s own pages to check size, location, and hiring signals. None of these
          sites responded{blockedHosts > 0 ? ` — ${blockedHosts} were refused or timed out` : ''}, so there was
          nothing to score against. The companies below are real; everything else about them is simply unknown,
          and nothing has been guessed to fill the gap.
        </p>
      ) : run.status === 'partial' && !running ? (
        <p className="note note--warn sm" style={{ marginBottom: 16 }}>
          <strong>Some sources were unreachable.</strong>{' '}
          {unranked > 0
            ? `${unranked} of ${leads.length} leads could not be ranked because their sites did not respond.`
            : 'These are the leads that could still be established.'}{' '}
          Nothing has been filled in to cover the gap.
        </p>
      ) : null}

      {running && progress ? (
        <Progress runId={runId} initial={progress} />
      ) : leads.length > 0 ? (
        <Results leads={leads} runId={runId} />
      ) : (
        <div className="empty">
          <h3>No leads found</h3>
          <p>
            {run.error
              ? 'The search stopped before it could produce results. The reason is above.'
              : failures.length > 0
                ? `Nothing matched. ${failures.length} source request${failures.length === 1 ? '' : 's'} failed or were refused, so less could be checked than usual.`
                : 'Every source responded, but nothing matched these criteria. Try widening the size range or the location.'}
          </p>
          <Link href="/" className="btn btn--pri btn--sm">
            Try another search
          </Link>
        </div>
      )}

      {!running && failures.length > 0 ? (
        <details className="card" style={{ marginTop: 24 }}>
          <summary className="card__h" style={{ cursor: 'pointer', listStyle: 'none' }}>
            <span className="h2">Sources that did not respond</span>
            <div className="grow" />
            <span className="mono xs faint">{failures.length}</span>
          </summary>
          <div className="card__b col g8">
            {failures.slice(0, 12).map((f) => (
              <div key={f.id} className="row g8 wrap">
                <span className={f.status === 'policy_denied' || f.status === 'robots_denied' ? 'pill pill--warn' : 'pill pill--crit'}>
                  {f.status.replace(/_/g, ' ')}
                </span>
                <span className="mono xs faint truncate">{hostOf(f.url)}</span>
                <span className="xs muted truncate">{f.denialReason ?? (f.httpStatus ? `HTTP ${f.httpStatus}` : '')}</span>
              </div>
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
