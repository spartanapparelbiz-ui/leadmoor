import Link from 'next/link';
import { providerStatus, ready } from '@/lib/services';
import { requireSession } from '@/lib/session';
import { NewSearchComposer } from '@/components/search/NewSearchComposer';
import { relativeTime } from '@/lib/format';
import { IconArrowRight, IconShield, IconSparkle, IconTarget } from '@/components/Icons';

export const dynamic = 'force-dynamic';

const EXAMPLES = [
  {
    title: 'Security buyers at mid-market SaaS',
    text: 'Find 20 US B2B SaaS companies with 50–500 employees that are hiring security engineers, and identify the CTO or VP Engineering.',
  },
  {
    title: 'Compliance-driven fintech',
    text: 'US fintech companies with 100–400 employees that mention SOC 2 or ISO 27001, and their Head of Security.',
  },
  {
    title: 'Platform teams running Kubernetes',
    text: 'US infrastructure software companies running Kubernetes that are hiring platform engineers, and their VP Engineering.',
  },
];

export default async function HomePage() {
  await ready();
  const { scope } = await requireSession();
  const status = providerStatus();

  const [specs, counts] = await Promise.all([scope.listSpecs(5), scope.counts()]);

  return (
    <div className="page page--narrow">
      <section style={{ paddingTop: 'clamp(20px, 5vh, 56px)' }}>
        <h1 className="t-hero" style={{ maxWidth: '15ch', marginBottom: 10 }}>
          Describe who you want to sell to.
        </h1>
        <p className="t-lede" style={{ marginBottom: 28 }}>
          LeadMoor finds those companies from permitted public sources, proves why each one fits, and shows
          you the exact sentence every fact came from. You approve the search before anything runs.
        </p>

        <NewSearchComposer examples={EXAMPLES} llmConfigured={status.llm.configured} />
      </section>

      {counts.runs > 0 ? (
        <section className="statgrid" style={{ marginTop: 36 }}>
          <Stat label="Leads" value={counts.leads} href="/leads" />
          <Stat label="Qualified" value={counts.qualified} href="/leads?status=qualified" accent />
          <Stat label="Companies" value={counts.companies} href="/companies" />
          <Stat label="Verified emails" value={counts.verifiedEmails} href="/leads?email=verified" />
        </section>
      ) : null}

      <section style={{ marginTop: 36 }}>
        <div className="row g-8" style={{ marginBottom: 12 }}>
          <h2 className="t-section">How a search works</h2>
        </div>
        <div className="card">
          <div className="card__body col g-18">
            <Step
              n={1}
              icon={<IconSparkle />}
              title="Your sentence becomes a search you can read and edit"
              body="Filters, target roles, and a scoring rubric — written out in full. Nothing is hidden in a prompt, and nothing runs until you approve it."
            />
            <Step
              n={2}
              icon={<IconShield />}
              title="We retrieve, then we cite"
              body="Public registries, official APIs, and companies' own pages — logged out, rate limited, robots respected. Every page read is stored and addressable by its hash."
            />
            <Step
              n={3}
              icon={<IconTarget />}
              title="Nothing is scored that isn't proven"
              body="Each criterion gets a verdict backed by a quoted span. What we could not establish is reported as unknown — never as a failure, and never as a guess."
            />
          </div>
        </div>
      </section>

      {specs.length > 0 ? (
        <section style={{ marginTop: 36 }}>
          <div className="row g-8" style={{ marginBottom: 12 }}>
            <h2 className="t-section">Recent searches</h2>
            <div className="grow" />
            <Link href="/searches" className="btn btn--ghost btn--sm">
              All searches <IconArrowRight />
            </Link>
          </div>
          <div className="card">
            <div className="card__body card__body--flush divide">
              {specs.map((spec) => {
                const doc = spec.spec as { name?: string };
                return (
                  <Link key={spec.id} href={`/searches/${spec.id}`} className="rowbtn">
                    <span className="truncate" style={{ fontWeight: 550 }}>
                      {doc.name ?? 'Untitled search'}
                    </span>
                    <div className="grow" />
                    {spec.approvedAt ? (
                      <span className="pill pill--ok">Approved</span>
                    ) : (
                      <span className="pill pill--plain">Draft</span>
                    )}
                    <span className="mono t-xs faint nowrap">{relativeTime(spec.createdAt)}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function Stat({ label, value, href, accent }: { label: string; value: number; href: string; accent?: boolean }) {
  return (
    <Link href={href} className="stat">
      <span className="t-label">{label}</span>
      <span className="stat__value mono" style={accent ? { color: 'var(--accent)' } : undefined}>
        {value}
      </span>
    </Link>
  );
}

function Step({ n, icon, title, body }: { n: number; icon: React.ReactNode; title: string; body: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '30px minmax(0,1fr)', gap: 14, alignItems: 'start' }}>
      <span
        aria-hidden="true"
        style={{
          width: 28,
          height: 28,
          display: 'grid',
          placeItems: 'center',
          borderRadius: 'var(--r-md)',
          background: 'var(--accent-soft)',
          color: 'var(--accent)',
          border: '1px solid var(--accent-border)',
        }}
      >
        {icon}
      </span>
      <div>
        <h3 className="t-section" style={{ marginBottom: 2 }}>
          <span className="mono faint" style={{ marginRight: 8 }}>
            {n}
          </span>
          {title}
        </h3>
        <p className="muted t-sm" style={{ margin: 0, maxWidth: '68ch' }}>
          {body}
        </p>
      </div>
    </div>
  );
}
