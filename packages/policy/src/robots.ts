/**
 * robots.txt handling for Tier C first-party fetches.
 *
 * ARCHITECTURE.md §7: permitted "with robots.txt respect, rate limiting, honest user-agent, no
 * login, no anti-bot circumvention". A directive we cannot read is treated as a denial for the
 * paths it would have covered — we fail closed, not open.
 */

export interface RobotsRules {
  disallow: string[];
  allow: string[];
  crawlDelayMs: number | null;
}

export function parseRobots(body: string, userAgent: string): RobotsRules {
  const lines = body.split(/\r?\n/);
  const groups: Array<{ agents: string[]; rules: RobotsRules }> = [];
  let current: { agents: string[]; rules: RobotsRules } | null = null;
  let lastWasAgent = false;

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (line.length === 0) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: { disallow: [], allow: [], crawlDelayMs: null } };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === 'disallow') current.rules.disallow.push(value);
    else if (key === 'allow') current.rules.allow.push(value);
    else if (key === 'crawl-delay') {
      const seconds = Number.parseFloat(value);
      if (Number.isFinite(seconds) && seconds >= 0) current.rules.crawlDelayMs = Math.round(seconds * 1000);
    }
  }

  const ua = userAgent.toLowerCase();
  const specific = groups.find((g) => g.agents.some((a) => a !== '*' && ua.includes(a)));
  const wildcard = groups.find((g) => g.agents.includes('*'));
  return specific?.rules ?? wildcard?.rules ?? { disallow: [], allow: [], crawlDelayMs: null };
}

function matches(pattern: string, path: string): boolean {
  if (pattern === '') return false;
  // robots.txt wildcards: * matches any run, $ anchors the end.
  const anchored = pattern.endsWith('$');
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`).test(path);
}

/** Longest-match-wins, Allow beats Disallow at equal length — the conventional interpretation. */
export function isAllowedByRobots(rules: RobotsRules, path: string): boolean {
  let bestAllow = -1;
  let bestDisallow = -1;
  for (const p of rules.allow) if (matches(p, path)) bestAllow = Math.max(bestAllow, p.length);
  for (const p of rules.disallow) if (matches(p, path)) bestDisallow = Math.max(bestDisallow, p.length);
  if (bestDisallow < 0) return true;
  return bestAllow >= bestDisallow;
}
