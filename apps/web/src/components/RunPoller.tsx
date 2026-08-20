'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { pumpWorker, runSummary } from '@/lib/actions';

/**
 * Keeps an in-flight run's page current.
 *
 * It refreshes from real run state — it never animates fake progress. When the embedded worker
 * mode is enabled it also advances the durable queue, so a single-process install still makes
 * progress; with a dedicated worker it only observes.
 */
export function RunPoller({ runId, embedded }: { runId: string; embedded: boolean }) {
  const router = useRouter();
  const stopped = useRef(false);

  useEffect(() => {
    stopped.current = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      if (stopped.current) return;
      try {
        if (embedded) await pumpWorker();
        const summary = await runSummary(runId);
        router.refresh();

        const finished =
          summary &&
          ['completed', 'failed', 'cancelled', 'budget_exhausted', 'partial'].includes(summary.status) &&
          summary.pending === 0;

        if (finished) {
          // router.refresh() is fire-and-forget, so stopping here would leave the page showing the
          // last in-flight render. One more refresh after a beat guarantees the terminal state
          // actually reaches the screen.
          timer = setTimeout(() => {
            if (!stopped.current) router.refresh();
          }, 900);
          return;
        }
      } catch {
        // A transient failure must not stop the page updating; the next tick retries.
      }
      timer = setTimeout(tick, embedded ? 1200 : 2500);
    };

    timer = setTimeout(tick, 600);
    return () => {
      stopped.current = true;
      clearTimeout(timer);
    };
  }, [runId, embedded, router]);

  return (
    <div aria-live="polite" className="sr-only">
      Run in progress. This page updates automatically.
    </div>
  );
}
