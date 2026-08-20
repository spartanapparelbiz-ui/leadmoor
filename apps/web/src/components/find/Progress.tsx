'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { searchProgress, type Progress as P } from '@/lib/actions/progress';

/**
 * The search, while it runs.
 *
 * Real stages, real counters, polled from the database. When it finishes, the page refreshes into
 * the results — the user never has to press anything.
 */
export function Progress({ runId, initial }: { runId: string; initial: P }) {
  const router = useRouter();
  const [p, setP] = useState(initial);
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (stopped.current) return;
      try {
        const next = await searchProgress(runId);
        if (next && !stopped.current) {
          setP(next);
          if (next.done) {
            router.refresh();
            // router.refresh() is fire-and-forget; one more pass makes sure the finished view lands.
            timer = setTimeout(() => !stopped.current && router.refresh(), 800);
            return;
          }
        }
      } catch {
        // A transient failure must not freeze the page; the next tick retries.
      }
      timer = setTimeout(tick, 1100);
    };

    timer = setTimeout(tick, 400);
    return () => {
      stopped.current = true;
      clearTimeout(timer);
    };
  }, [runId, router]);

  return (
    <div className="col g24" style={{ maxWidth: 560 }}>
      <div className="row g10">
        <span className="spin" />
        <span className="h2">Searching…</span>
      </div>

      <ol className="steps" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {p.steps.map((s, i) => {
          const mod =
            s.status === 'completed'
              ? 'done'
              : s.status === 'running'
                ? 'run'
                : s.status === 'failed' || s.status === 'blocked'
                  ? 'fail'
                  : s.status === 'partial' || s.status === 'skipped'
                    ? 'warn'
                    : '';
          return (
            <li key={s.key} className="step">
              <span className={`dot ${mod ? `dot--${mod}` : ''}`} aria-hidden="true">
                {s.status === 'completed' ? '✓' : s.status === 'failed' ? '!' : i + 1}
              </span>
              <span className="col g2">
                <span className="step__n">{s.label}</span>
                {s.error ? (
                  <span className="step__d" style={{ color: 'var(--crit)' }}>
                    {s.error.slice(0, 180)}
                  </span>
                ) : s.note ? (
                  <span className="step__d">{s.note}</span>
                ) : s.status === 'pending' ? (
                  <span className="step__d faint">Waiting</span>
                ) : null}
              </span>
              {s.count !== null ? <span className="step__c">{s.count}</span> : null}
            </li>
          );
        })}
      </ol>

      <div aria-live="polite" className="sr">
        {p.counts.companies} companies, {p.counts.people} people, {p.counts.leads} leads so far.
      </div>
    </div>
  );
}
