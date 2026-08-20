import 'server-only';

/**
 * In-process rate limiting for expensive endpoints.
 *
 * A fixed-window counter per action key. This is a single-node guard against runaway cost — a
 * multi-node deployment should move the counter to Postgres or Redis, which is why the check is
 * behind one function rather than inlined at call sites.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function checkRateLimit(key: string, max: number, windowMs: number, now = Date.now()): RateLimitResult {
  const existing = windows.get(key);

  if (!existing || now >= existing.resetAt) {
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: max - 1, retryAfterMs: 0 };
  }

  if (existing.count >= max) {
    return { allowed: false, remaining: 0, retryAfterMs: existing.resetAt - now };
  }

  existing.count += 1;
  return { allowed: true, remaining: max - existing.count, retryAfterMs: 0 };
}

/** Test seam. */
export function resetRateLimits(): void {
  windows.clear();
}
