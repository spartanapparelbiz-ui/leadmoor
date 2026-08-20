'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { pumpWorker, runProgress, type RunProgress } from '@/lib/actions/leads';
import { humanize, relativeTime } from '@/lib/format';

/**
 * The live run view: real pipeline steps, real counters, real activity.
 *
 * Everything shown here is read back from the database each tick. There is no simulated progress
 * bar and no interpolation — a stage that has not started shows as pending, and a stage that
 * failed says so with its own error text.
 */

type Stage = RunProgress['stages'][number];
type Counters = RunProgress['counters'];

const TERMINAL = ['completed', 'failed', 'cancelled', 'budget_exhausted', 'partial'];

export function RunLive({
  runId,
  active,
  embedded,
  initialStages,
  initialCounters,
  budget,
}: {
  runId: string;
  active: boolean;
  embedded: boolean;
  initialStages: Stage[];
  initialCounters: Counters;
  budget: { companies: number; documents: number; modelCalls: number } | null;
}) {
  const router = useRouter();
  const [stages, setStages] = useState(initialStages);
  const [counters, setCounters] = useState(initialCounters);
  const [activity, setActivity] = useState<RunProgress['activity']>([]);
  const [live, setLive] = useState(active);
  const stopped = useRef(false);

  // Server-rendered state wins whenever the page re-renders around us.
  useEffect(() => {
    setStages(initialStages);
    setCounters(initialCounters);
  }, [initialStages, initialCounters]);

  useEffect(() => {
    if (!active) {
      setLive(false);
      return;
    }
    stopped.current = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (stopped.current) return;
      try {
        if (embedded) await pumpWorker();
        const progress = await runProgress(runId);

        if (progress && !stopped.current) {
          setStages(progress.stages);
          setCounters(progress.counters);
          setActivity(progress.activity);

          if (TERMINAL.includes(progress.status) && progress.pending === 0) {
            setLive(false);
            // router.refresh() is fire-and-forget; one more pass after a beat makes sure the
            // terminal render actually reaches the screen instead of the last in-flight one.
            router.refresh();
            timer = setTimeout(() => {
              if (!stopped.current) router.refresh();
            }, 900);
            return;
          }
          router.refresh();
        }
      } catch {
        // A transient failure must not freeze the page; the next tick retries.
      }
      timer = setTimeout(tick, embedded ? 1200 : 2500);
    };

    timer = setTimeout(tick, 500);
    return () => {
      stopped.current = true;
      clearTimeout(timer);
    };
  }, [runId, active, embedded, router]);

  const done = stages.filter((s) => s.status === 'completed').length;

  return (
    <section className="card" style={{ marginBottom: 20 }}>
      <div className="card__head">
        <span className="t-section">Pipeline</span>
        <div className="grow" />
        <span className="mono t-xs faint">
          {done}/{stages.length} stages
        </span>
        {live ? (
          <span className="row g-6 t-xs" style={{ color: 'var(--warn)' }}>
            <span className="spinner" />
            live
          </span>
        ) : null}
      </div>

      <div className="card__body">
        <div className="runsplit">
          <ol className="steps">
            {stages.map((stage, index) => (
              <StepRow key={stage.stage} stage={stage} index={index} />
            ))}
          </ol>

          <div className="col g-14">
            <div className="col g-8">
              <span className="t-label">Counters</span>
              <Counter label="Companies" value={counters.companies} cap={budget?.companies} />
              <Counter label="Documents stored" value={counters.documents} cap={budget?.documents} />
              <Counter label="People found" value={counters.people} />
              <Counter label="Leads scored" value={counters.leads} />
              <Counter label="Model calls" value={counters.modelCalls} cap={budget?.modelCalls} />
            </div>

            {activity.length > 0 ? (
              <div className="col g-6">
                <span className="t-label">Activity</span>
                <div className="activity">
                  {activity.slice(0, 14).map((line, i) => (
                    <div key={`${line.at}-${i}`} className="activity__line">
                      <span className="activity__time mono">{relativeTime(line.at)}</span>
                      <span className="truncate" title={line.detail}>
                        {humanize(line.action)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div aria-live="polite" className="sr-only">
        {live ? `Run in progress, ${done} of ${stages.length} stages complete.` : 'Run finished.'}
      </div>
    </section>
  );
}

function StepRow({ stage, index }: { stage: Stage; index: number }) {
  const label = stage.label || humanize(stage.stage);
  const modifier =
    stage.status === 'completed'
      ? 'done'
      : stage.status === 'running'
        ? 'running'
        : stage.status === 'failed' || stage.status === 'blocked'
          ? 'failed'
          : stage.status === 'partial' || stage.status === 'skipped'
            ? 'warn'
            : '';

  return (
    <li className="step">
      <span className={`step__idx ${modifier ? `step__idx--${modifier}` : ''}`} aria-hidden="true">
        {stage.status === 'completed' ? '✓' : stage.status === 'failed' ? '!' : index + 1}
      </span>
      <div className="col g-2" style={{ minWidth: 0 }}>
        <span className="step__name">{label}</span>
        {stage.error ? (
          <span className="step__detail" style={{ color: 'var(--crit)' }}>
            {stage.error.slice(0, 220)}
          </span>
        ) : (
          <span className="step__detail">{summarize(stage.detail) || statusWord(stage.status)}</span>
        )}
      </div>
      {stage.attempts > 1 ? <span className="pill pill--warn">retried {stage.attempts}×</span> : null}
    </li>
  );
}

function statusWord(status: string): string {
  if (status === 'pending') return 'Waiting';
  if (status === 'running') return 'Working…';
  if (status === 'skipped') return 'Skipped';
  return '';
}

/** Renders a stage's own counters. Never invents progress the pipeline did not report. */
function summarize(detail: Record<string, unknown>): string {
  const parts: string[] = [];
  const push = (key: string, label: string) => {
    if (typeof detail[key] === 'number') parts.push(`${detail[key]} ${label}`);
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

  if (typeof detail.reason === 'string') parts.push(detail.reason);
  if (Array.isArray(detail.blocked) && detail.blocked.length > 0) parts.push(String(detail.blocked[0]).slice(0, 140));

  return parts.join(' · ');
}

function Counter({ label, value, cap }: { label: string; value: number; cap?: number }) {
  const pct = cap && cap > 0 ? Math.min(100, (value / cap) * 100) : null;
  return (
    <div className="col g-4">
      <div className="row g-8">
        <span className="t-sm muted">{label}</span>
        <div className="grow" />
        <span className="mono t-sm">
          {value}
          {cap ? <span className="faint"> / {cap}</span> : null}
        </span>
      </div>
      {pct !== null ? (
        <div className="bar" aria-hidden="true">
          <div className={`bar__fill ${pct > 90 ? 'bar__fill--warn' : ''}`} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
    </div>
  );
}
