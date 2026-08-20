import { Shell } from '@/components/shell/Shell';
import { requireSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

/** `requireSession` runs here, so every page beneath it is authenticated by construction. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { ctx, scope } = await requireSession();
  const runs = await scope.listRuns(20);

  return (
    <Shell email={ctx.email} demo={runs.some((r) => r.isDemo)}>
      {children}
    </Shell>
  );
}
