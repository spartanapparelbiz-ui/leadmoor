import Link from 'next/link';
import { desc } from 'drizzle-orm';
import { leadSpec as leadSpecTable } from '@leadmoor/db';
import { providerStatus, ready, services } from '@/lib/services';
import { NewSearchForm } from '@/components/NewSearchForm';
import { relativeTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

const EXAMPLES = [
  'Find 20 US B2B SaaS companies with 50–500 employees that are hiring security engineers, and identify the CTO or VP Engineering.',
  'US fintech companies with 100–400 employees that mention SOC 2 or ISO 27001, and their Head of Security.',
  'US infrastructure software companies running Kubernetes that are hiring platform engineers, and their VP Engineering.',
];

export default async function HomePage() {
  await ready();
  const status = providerStatus();

  const recent = await services()
    .db.select()
    .from(leadSpecTable)
    .orderBy(desc(leadSpecTable.createdAt))
    .limit(5);

  return (
    <div className="shell">
      <section style={{ paddingTop: 'clamp(48px, 9vh, 104px)', paddingBottom: 40 }}>
        <span className="eyebrow">Evidence-first lead research</span>
        <h1 className="h-display" style={{ margin: '0.3em 0 0.35em', maxWidth: '17ch' }}>
          Find your next customers.
        </h1>
        <p className="lede" style={{ marginBottom: 32 }}>
          Describe who you want to sell to. LeadMoor finds them from permitted public sources, proves why
          each one fits, and shows you exactly where every fact came from.
        </p>

        <NewSearchForm examples={EXAMPLES} />
      </section>

      <section className="grid-2" style={{ marginTop: 8 }}>
        <div className="panel">
          <div className="panel__head">
            <span className="eyebrow">How it works</span>
          </div>
          <div className="panel__body stack gap-16">
            <Step
              n="1"
              title="Your request becomes a search you can read"
              body="We turn your sentence into a typed specification: filters, target roles, and a scoring rubric. You review and edit it before anything runs."
            />
            <Step
              n="2"
              title="We retrieve, then we cite"
              body="Public registries, official APIs, and companies' own pages — logged out, rate limited, robots respected. Every page we read is stored and addressable."
            />
            <Step
              n="3"
              title="Nothing is scored that isn't proven"
              body="Each criterion gets a verdict backed by a quoted span. What we could not establish is reported as unknown, never as a failure and never as a guess."
            />
          </div>
        </div>

        <div className="stack gap-16">
          <div className="panel">
            <div className="panel__head">
              <span className="eyebrow">Providers</span>
            </div>
            <div className="panel__body stack gap-12">
              <div className="stack gap-8">
                <div className="row gap-8">
                  <span className={status.llm.configured ? 'chip chip--pass' : 'chip chip--unknown'}>
                    {status.llm.configured ? 'Language model ready' : 'Language model not configured'}
                  </span>
                </div>
                {!status.llm.configured ? (
                  <p className="small muted" style={{ margin: 0 }}>
                    Requests are structured by keyword matching instead, and criteria that need judgement are
                    reported as unknown. Set <code className="mono">ANTHROPIC_API_KEY</code> to enable both.
                  </p>
                ) : null}
              </div>

              <div className="stack gap-8">
                <span className="eyebrow">Works with no keys</span>
                <div className="row gap-4 wrap">
                  {status.credentialFreeSources.map((id) => (
                    <span key={id} className="chip chip--neutral mono">
                      {id}
                    </span>
                  ))}
                </div>
              </div>

              {status.missingCredentials.length > 0 ? (
                <div className="stack gap-8">
                  <span className="eyebrow">Needs a key</span>
                  <div className="row gap-4 wrap">
                    {status.missingCredentials.map((m) => (
                      <span key={m.source} className="chip chip--warn mono" title={`Set ${m.envVar}`}>
                        {m.source}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {recent.length > 0 ? (
            <div className="panel">
              <div className="panel__head">
                <span className="eyebrow">Recent searches</span>
              </div>
              <div className="panel__body panel__body--flush stack divide">
                {recent.map((spec) => {
                  const doc = spec.spec as { name?: string };
                  return (
                    <Link
                      key={spec.id}
                      href={`/searches/${spec.id}`}
                      style={{ padding: '12px 20px', textDecoration: 'none', color: 'inherit', display: 'block' }}
                    >
                      <div className="row gap-8">
                        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{doc.name ?? 'Untitled search'}</span>
                        <div className="spacer" />
                        <span className="mono small muted">{relativeTime(spec.createdAt)}</span>
                      </div>
                      {spec.approvedAt ? (
                        <span className="chip chip--pass" style={{ marginTop: 6 }}>
                          Approved
                        </span>
                      ) : (
                        <span className="chip chip--neutral" style={{ marginTop: 6 }}>
                          Awaiting approval
                        </span>
                      )}
                    </Link>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '26px minmax(0,1fr)', gap: 14, alignItems: 'start' }}>
      <span
        className="mono"
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: 'var(--accent)',
          background: 'var(--accent-soft)',
          width: 24,
          height: 24,
          display: 'grid',
          placeItems: 'center',
          borderRadius: 2,
        }}
      >
        {n}
      </span>
      <div>
        <h3 className="h-sub" style={{ marginBottom: 3 }}>
          {title}
        </h3>
        <p className="small muted" style={{ margin: 0, maxWidth: '60ch' }}>
          {body}
        </p>
      </div>
    </div>
  );
}
