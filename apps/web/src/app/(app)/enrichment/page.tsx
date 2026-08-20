import Link from 'next/link';
import type { Metadata } from 'next';
import { SourceRegistry } from '@leadmoor/policy';
import { providerStatus, ready } from '@/lib/services';
import { requireSession } from '@/lib/session';
import { humanize } from '@/lib/format';
import { EmptyState } from '@/components/EmptyState';
import { IconSparkle } from '@/components/Icons';

export const metadata: Metadata = { title: 'Enrichment' };
export const dynamic = 'force-dynamic';

/**
 * Enrichment coverage.
 *
 * This screen answers one question honestly: for the data you have, what could be established and
 * what could not? A field with no coverage is reported as unavailable — LeadMoor has no code path
 * that fills such a gap by inference, and this page never implies otherwise.
 */
export default async function EnrichmentPage() {
  await ready();
  const { scope } = await requireSession();
  const status = providerStatus();

  const [companies, people, leads] = await Promise.all([
    scope.listCompanies({ limit: 2000 }),
    scope.listPeople({ limit: 2000 }),
    scope.listLeads({ limit: 2000, includeSuppressed: false }),
  ]);

  if (companies.length === 0) {
    return (
      <div className="page page--narrow">
        <div className="pagehead">
          <h1 className="t-page">Enrichment</h1>
        </div>
        <EmptyState
          icon={<IconSparkle />}
          title="Nothing to enrich yet"
          body="Once a search has discovered companies, this page shows exactly which attributes could be established from evidence and which could not — with no gap silently filled in."
          action={{ href: '/', label: 'Start a search' }}
        />
      </div>
    );
  }

  const withDomain = companies.filter((c) => c.primaryDomain).length;
  const withPerson = new Set(people.map((p) => p.companyId)).size;
  const verified = leads.filter((l) => l.emailStatus === 'verified').length;
  const unverified = leads.filter((l) => l.emailStatus === 'unverified').length;
  const noEmail = leads.filter((l) => l.emailStatus === 'unavailable').length;

  const fieldCoverage = await coverageByField(scope, companies.map((c) => c.id));
  const registry = new SourceRegistry();
  const missing = status.missingCredentials;

  return (
    <div className="page page--narrow">
      <div className="pagehead">
        <div>
          <h1 className="t-page">Enrichment</h1>
          <p className="muted t-sm" style={{ margin: '2px 0 0' }}>
            What could be established from evidence, and what could not.
          </p>
        </div>
      </div>

      <section className="statgrid">
        <Stat label="Companies" value={companies.length} />
        <Stat label="With verified domain" value={withDomain} of={companies.length} />
        <Stat label="With a named person" value={withPerson} of={companies.length} />
        <Stat label="Verified emails" value={verified} of={leads.length} />
      </section>

      <section className="card" style={{ marginTop: 20 }}>
        <div className="card__head">
          <span className="t-section">Contact coverage</span>
        </div>
        <div className="card__body col g-12">
          <CoverageRow label="Verified email" count={verified} total={leads.length} tone="ok" />
          <CoverageRow label="Unverified email" count={unverified} total={leads.length} tone="warn" />
          <CoverageRow label="No address found" count={noEmail} total={leads.length} tone="plain" />
          <p className="notice t-sm" style={{ margin: 0 }} role="note">
            <strong>No address is ever inferred.</strong> An email appears only when it was found verbatim in a
            document LeadMoor retrieved and cites. There is no pattern guessing, and no third-party address
            provider is wired in — so &ldquo;no address found&rdquo; means exactly that.
          </p>
        </div>
      </section>

      <section className="card" style={{ marginTop: 20 }}>
        <div className="card__head">
          <span className="t-section">Attribute coverage</span>
        </div>
        <div className="card__body col g-12">
          {fieldCoverage.length === 0 ? (
            <p className="muted t-sm" style={{ margin: 0 }}>
              No company attribute has been established yet.
            </p>
          ) : (
            fieldCoverage.map((f) => (
              <CoverageRow
                key={f.field}
                label={humanize(f.field.replace(/^company\./, ''))}
                count={f.count}
                total={companies.length}
                tone={f.count / companies.length > 0.6 ? 'ok' : 'warn'}
              />
            ))
          )}
        </div>
      </section>

      <section className="card" style={{ marginTop: 20 }}>
        <div className="card__head">
          <span className="t-section">What would improve coverage</span>
        </div>
        <div className="card__body col g-10">
          {missing.length === 0 ? (
            <p className="muted t-sm" style={{ margin: 0 }}>
              Every source in the registry is configured. Coverage gaps are down to what the sources actually
              published, not to a missing credential.
            </p>
          ) : (
            <>
              <p className="muted t-sm" style={{ margin: 0 }}>
                {missing.length} of {registry.all().length} sources are not configured. Their field classes are
                simply absent from results — they are never approximated from elsewhere.
              </p>
              <div className="row g-6 wrap">
                {missing.map((m) => (
                  <span key={m.source} className="pill pill--unknown mono" title={`Set ${m.envVar}`}>
                    {m.source}
                  </span>
                ))}
              </div>
              <Link href="/settings/providers" className="btn btn--sm" style={{ alignSelf: 'flex-start' }}>
                Configure providers
              </Link>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

async function coverageByField(
  scope: Awaited<ReturnType<typeof requireSession>>['scope'],
  companyIds: string[],
): Promise<Array<{ field: string; count: number }>> {
  const counts = new Map<string, Set<string>>();
  for (const id of companyIds.slice(0, 400)) {
    for (const claim of await scope.claimsFor('company', id)) {
      if (claim.status !== 'supported') continue;
      const set = counts.get(claim.field) ?? new Set<string>();
      set.add(id);
      counts.set(claim.field, set);
    }
  }
  return [...counts.entries()]
    .map(([field, set]) => ({ field, count: set.size }))
    .sort((a, b) => b.count - a.count);
}

function Stat({ label, value, of }: { label: string; value: number; of?: number }) {
  return (
    <div className="stat">
      <span className="t-label">{label}</span>
      <span className="stat__value mono">
        {value}
        {of !== undefined ? <span className="faint" style={{ fontSize: '0.5em' }}> / {of}</span> : null}
      </span>
    </div>
  );
}

function CoverageRow({
  label,
  count,
  total,
  tone,
}: {
  label: string;
  count: number;
  total: number;
  tone: 'ok' | 'warn' | 'plain';
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="col g-4">
      <div className="row g-8">
        <span className="t-sm">{label}</span>
        <div className="grow" />
        <span className="mono t-sm">
          {count} <span className="faint">({pct}%)</span>
        </span>
      </div>
      <div className="bar" aria-hidden="true">
        <div
          className={`bar__fill ${tone === 'warn' ? 'bar__fill--warn' : ''}`}
          style={{ width: `${Math.max(1, pct)}%`, opacity: tone === 'plain' ? 0.35 : 1 }}
        />
      </div>
    </div>
  );
}
