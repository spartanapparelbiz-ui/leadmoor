import 'server-only';
import type { WorkspaceScope } from '@leadmoor/db';

/**
 * Whether the caller's workspace contains demo output.
 *
 * `is_demo` is set by `scripts/demo.ts` and by nothing else — no application code path can raise
 * it. Wherever it is true the UI says so, so fixture output can never be mistaken for a real
 * search result.
 */
export async function isDemoWorkspace(scope: WorkspaceScope): Promise<boolean> {
  const runs = await scope.listRuns(50);
  return runs.some((r) => r.isDemo);
}
