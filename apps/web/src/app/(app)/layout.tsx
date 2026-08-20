import { AppShell } from '@/components/shell/AppShell';
import { authService, requireSession } from '@/lib/session';
import { isDemoWorkspace } from '@/lib/demo';

export const dynamic = 'force-dynamic';

/**
 * The signed-in shell.
 *
 * `requireSession` runs here, so every page beneath this layout is behind authentication by
 * construction rather than by each page remembering to check. The counts in the sidebar come from
 * the workspace scope, so they are the caller's own numbers.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { ctx, scope } = await requireSession();
  const auth = await authService();

  const [counts, workspaces, demo] = await Promise.all([
    scope.counts(),
    auth.workspacesFor(ctx.userId),
    isDemoWorkspace(scope),
  ]);

  return (
    <AppShell
      counts={{
        leads: counts.leads,
        companies: counts.companies,
        people: counts.people,
        savedSearches: counts.savedSearches,
        runs: counts.runs,
      }}
      user={{ name: ctx.name, email: ctx.email, role: ctx.role }}
      workspaces={workspaces}
      activeWorkspaceId={ctx.workspaceId}
      demo={demo}
    >
      {children}
    </AppShell>
  );
}
