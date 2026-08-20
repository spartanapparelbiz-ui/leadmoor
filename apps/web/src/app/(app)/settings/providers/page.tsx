import type { Metadata } from 'next';
import { SourceRegistry } from '@leadmoor/policy';
import { providerStatus, ready } from '@/lib/services';
import { requireSession } from '@/lib/session';
import { IconPlug } from '@/components/Icons';

export const metadata: Metadata = { title: 'Providers' };
export const dynamic = 'force-dynamic';

/**
 * Connector settings.
 *
 * Every source is listed with its real state. A provider whose credential is missing is shown as
 * not configured — it is never described as working, and no output is ever attributed to it.
 * Credentials themselves are read only on the server; this page names the environment variable and
 * nothing else.
 */
export default async function ProvidersPage() {
  await ready();
  await requireSession();

  const status = providerStatus();
  const sources = new SourceRegistry().all();
  const missing = new Map(status.missingCredentials.map((m) => [m.source, m.envVar]));

  return (
    <div className="page page--narrow">
      <div className="pagehead">
        <div>
          <h1 className="t-page">Providers</h1>
          <p className="muted t-sm" style={{ margin: '2px 0 0' }}>
            What LeadMoor is allowed to contact, and what is configured right now.
          </p>
        </div>
      </div>

      <section className="card">
        <div className="card__head">
          <span className="t-section">Language model</span>
          <div className="grow" />
          {status.llm.configured ? (
            <span className="pill pill--ok">Configured</span>
          ) : (
            <span className="pill pill--unknown">Not configured</span>
          )}
        </div>
        <div className="card__body">
          {status.llm.configured ? (
            <p className="muted t-sm" style={{ margin: 0 }}>
              The model compiles your request into a search specification and answers judgement criteria from
              cited passages. It never authors a fact: an answer whose quote is not present in the stored
              document is rejected by the provenance validator before it can become a claim.
            </p>
          ) : (
            <div className="col g-8">
              <p className="muted t-sm" style={{ margin: 0 }}>
                {status.llm.reason ?? 'No API key is set.'} Requests are structured by keyword matching instead,
                and criteria that need judgement are reported as <em>unknown</em> rather than guessed.
              </p>
              <p className="notice t-sm" style={{ margin: 0 }}>
                Set <code className="mono">ANTHROPIC_API_KEY</code> in the server environment and restart. The key
                is never sent to the browser.
              </p>
            </div>
          )}
        </div>
      </section>

      <section style={{ marginTop: 20 }}>
        <div className="subhead">
          <h2 className="t-section">Data sources</h2>
          <div className="grow" />
          <span className="mono t-xs faint">{sources.length}</span>
        </div>

        <div className="col g-10">
          {sources.map((source) => {
            const envVar = missing.get(source.id);
            const configured = !envVar;

            return (
              <div key={source.id} className="card">
                <div className="card__head">
                  <span className="row g-8" style={{ minWidth: 0 }}>
                    <IconPlug />
                    <strong className="t-sm truncate">{source.name}</strong>
                    <span className="pill pill--mono">Tier {source.tier}</span>
                  </span>
                  <div className="grow" />
                  {configured ? (
                    <span className="pill pill--ok">Ready</span>
                  ) : (
                    <span className="pill pill--unknown" title={`Set ${envVar} to enable this source.`}>
                      Not configured
                    </span>
                  )}
                </div>
                <div className="card__body col g-10">
                  <p className="muted t-sm" style={{ margin: 0 }}>
                    {source.legalBasis}
                  </p>

                  <div className="kv">
                    <Cell label="Access" value={source.accessMode.replace(/_/g, ' ')} />
                    <Cell
                      label="Robots"
                      value={source.robots === 'must_respect' ? 'Respected' : 'Not applicable (API)'}
                    />
                    <Cell
                      label="Hosts"
                      value={
                        source.hostScope === 'run_scoped'
                          ? 'Only domains this run discovered'
                          : source.hosts.join(', ')
                      }
                    />
                    <Cell
                      label="Rate limit"
                      value={`${source.rateLimit.requests} per ${Math.round(source.rateLimit.perMs / 1000)}s`}
                    />
                    <Cell label="Retention" value={`${source.retentionDays} days`} />
                    <Cell
                      label="Export"
                      value={
                        source.redistribution.export
                          ? source.redistribution.exportableFieldClasses.length > 0
                            ? `Permitted for ${source.redistribution.exportableFieldClasses.length} field class(es)`
                            : 'Permitted'
                          : 'Not permitted — rows sourced here are withheld'
                      }
                    />
                  </div>

                  {envVar ? (
                    <p className="notice t-sm" style={{ margin: 0 }}>
                      Set <code className="mono">{envVar}</code> in the server environment to enable this source.
                      Until then it is skipped, and nothing is attributed to it.
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <p className="notice t-sm" style={{ marginTop: 20 }} role="note">
        <strong>What is not here is deliberate.</strong> LeadMoor has no code path that can reach a source
        requiring authentication bypass, scraping behind a login, CAPTCHA evasion, or purchased personal contact
        data. Those practices are excluded at the type level, not merely switched off.
      </p>
    </div>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="kv__cell">
      <span className="t-label">{label}</span>
      <span className="t-sm">{value}</span>
    </div>
  );
}
