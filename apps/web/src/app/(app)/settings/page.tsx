import type { Metadata } from 'next';
import { SourceRegistry } from '@leadmoor/policy';
import { providerStatus, ready } from '@/lib/services';
import { requireSession } from '@/lib/session';
import { SignOutButton } from '@/components/auth/SignOutButton';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

/**
 * Settings, kept to what matters: who you are, and what LeadMoor can actually reach.
 *
 * A source without its credential is shown as not connected. It is never described as working, and
 * nothing in the results is ever attributed to it.
 */
export default async function Settings() {
  await ready();
  const { ctx } = await requireSession();
  const status = providerStatus();
  const sources = new SourceRegistry().all();
  const missing = new Map(status.missingCredentials.map((m) => [m.source, m.envVar]));

  return (
    <div className="page page--mid">
      <div className="head">
        <h1 className="h1">Settings</h1>
      </div>

      <section className="card" style={{ marginBottom: 20 }}>
        <div className="card__b col g14">
          <dl className="crit">
            <dt>Signed in</dt>
            <dd>{ctx.email}</dd>
            <dt>Account</dt>
            <dd>{ctx.workspaceName}</dd>
          </dl>
          <div className="row g8">
            <SignOutButton />
          </div>
        </div>
      </section>

      <section className="card" style={{ marginBottom: 20 }}>
        <div className="card__h">
          <span className="h2">Language model</span>
          <div className="grow" />
          <span className={status.llm.configured ? 'pill pill--ok' : 'pill pill--flat'}>
            {status.llm.configured ? 'Connected' : 'Not connected'}
          </span>
        </div>
        <div className="card__b">
          <p className="sm muted" style={{ margin: 0 }}>
            {status.llm.configured
              ? 'Used to read your request and to judge evidence it is shown. It never writes a fact: an answer whose quote is absent from the stored document is rejected before it can become a claim.'
              : 'Requests are parsed by keyword matching instead, and criteria needing judgement are reported as unknown rather than guessed. Set ANTHROPIC_API_KEY on the server to connect one.'}
          </p>
        </div>
      </section>

      <section>
        <div className="row g8" style={{ marginBottom: 10 }}>
          <span className="label">Data sources</span>
          <div className="grow" />
          <span className="mono xs faint">
            {sources.length - missing.size} of {sources.length} connected
          </span>
        </div>
        <div className="col g6">
          {sources.map((s) => {
            const envVar = missing.get(s.id);
            return (
              <div key={s.id} className="card row g10" style={{ padding: '12px 14px' }}>
                <span className="col g2" style={{ minWidth: 0 }}>
                  <span className="sm" style={{ fontWeight: 550 }}>
                    {s.name}
                  </span>
                  <span className="xs faint truncate">
                    {envVar ? `Set ${envVar} to connect` : s.legalBasis}
                  </span>
                </span>
                <div className="grow" />
                <span className={envVar ? 'pill pill--flat' : 'pill pill--ok'}>
                  {envVar ? 'Not connected' : 'Connected'}
                </span>
              </div>
            );
          })}
        </div>
        <p className="note sm" style={{ marginTop: 14 }} role="note">
          More providers can be added — the connector interface is a manifest plus a fetch. What LeadMoor will
          never do is reach a source that requires bypassing a login, a paywall, a CAPTCHA, or a rate limit;
          those are excluded at the type level, not merely switched off.
        </p>
      </section>
    </div>
  );
}
