import {
  GLOBALLY_PROHIBITED_FIELD_CLASSES,
  PolicyViolationError,
  type FieldClass,
} from '@leadmoor/core';
import type { SourceManifest } from './manifest.js';
import { isAllowedByRobots, parseRobots, type RobotsRules } from './robots.js';

/**
 * PolicyEngine — the three gates of ARCHITECTURE.md §2.3.
 *
 *   1. PRE-FETCH    may we request this URL from this source at all?
 *   2. POST-EXTRACT may this source supply this class of field?
 *   3. EXPORT       may this field class leave the system, given the source's redistribution terms?
 *
 * Every decision is returned as data and recorded in the audit log, so a run can be explained
 * after the fact — including the requests it refused to make.
 */

export type PolicyDecision =
  | { allowed: true; sourceId: string; reason: string; robotsDecision: 'allowed' | 'not_applicable'; waitMs: number }
  | { allowed: false; sourceId: string; reason: string; code: PolicyDenialCode };

export type PolicyDenialCode =
  | 'unknown_source'
  | 'host_not_permitted'
  | 'insecure_scheme'
  | 'credentials_in_url'
  | 'robots_denied'
  | 'robots_unreadable'
  | 'field_class_not_permitted'
  | 'field_class_globally_prohibited'
  | 'export_not_permitted'
  | 'rate_limited';

export interface RobotsFetcher {
  (origin: string): Promise<string | null>;
}

interface Bucket {
  tokens: number;
  lastRefillMs: number;
  lastRequestMs: number;
}

/**
 * Per-run allowlist for `run_scoped` sources. The pipeline adds a domain only after the company
 * was discovered through a permitted source, so first-party fetching can never wander.
 */
export interface RunHostAllowlist {
  permit(host: string): void;
  isPermitted(host: string): boolean;
  list(): string[];
}

export function createRunHostAllowlist(): RunHostAllowlist {
  const hosts = new Set<string>();
  const norm = (h: string) => h.trim().toLowerCase().replace(/^www\./, '');
  return {
    permit(host) {
      const n = norm(host);
      if (n.length > 0) hosts.add(n);
    },
    isPermitted(host) {
      const n = norm(host);
      if (hosts.has(n)) return true;
      for (const permitted of hosts) if (n.endsWith(`.${permitted}`)) return true;
      return false;
    },
    list() {
      return [...hosts];
    },
  };
}

export interface PolicyEngineOptions {
  /** Supplies robots.txt bodies. Omitted in tests that do not exercise Tier C fetching. */
  robotsFetcher?: RobotsFetcher;
  userAgent: string;
  now?: () => number;
  /** Treat an unreadable robots.txt as permission. Defaults to false — we fail closed. */
  allowOnRobotsError?: boolean;
  /** Required before any `run_scoped` source can fetch anything. */
  runHosts?: RunHostAllowlist;
}

export class PolicyEngine {
  private readonly buckets = new Map<string, Bucket>();
  private readonly robotsCache = new Map<string, RobotsRules | 'unreadable'>();

  constructor(
    private readonly sources: ReadonlyMap<string, SourceManifest>,
    private readonly options: PolicyEngineOptions,
  ) {}

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  getSource(sourceId: string): SourceManifest | undefined {
    return this.sources.get(sourceId);
  }

  /** GATE 1 — pre-fetch. */
  async checkFetch(sourceId: string, rawUrl: string): Promise<PolicyDecision> {
    const manifest = this.sources.get(sourceId);
    if (!manifest) {
      return { allowed: false, sourceId, reason: `source "${sourceId}" is not registered`, code: 'unknown_source' };
    }

    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return { allowed: false, sourceId, reason: `malformed URL: ${rawUrl}`, code: 'host_not_permitted' };
    }

    if (url.protocol !== 'https:') {
      return {
        allowed: false,
        sourceId,
        reason: `only https is permitted (got ${url.protocol})`,
        code: 'insecure_scheme',
      };
    }

    // Credentials in a URL would mean authenticated access — a Tier D practice.
    if (url.username !== '' || url.password !== '') {
      return {
        allowed: false,
        sourceId,
        reason: 'URL carries credentials; authenticated retrieval is not a permitted access mode',
        code: 'credentials_in_url',
      };
    }

    if (manifest.hostScope === 'run_scoped') {
      const allowlist = this.options.runHosts;
      if (!allowlist) {
        return {
          allowed: false,
          sourceId,
          reason: `source "${sourceId}" is run-scoped but no run host allowlist was provided`,
          code: 'host_not_permitted',
        };
      }
      if (!allowlist.isPermitted(url.hostname)) {
        return {
          allowed: false,
          sourceId,
          reason: `host "${url.hostname}" was not discovered by this run; first-party fetching is limited to discovered company domains`,
          code: 'host_not_permitted',
        };
      }
    } else if (!hostPermitted(url.hostname, manifest.hosts)) {
      return {
        allowed: false,
        sourceId,
        reason: `host "${url.hostname}" is not declared by source "${sourceId}"`,
        code: 'host_not_permitted',
      };
    }

    let robotsDecision: 'allowed' | 'not_applicable' = 'not_applicable';
    let crawlDelayMs = 0;

    if (manifest.robots === 'must_respect') {
      const rules = await this.robotsFor(url.origin);
      if (rules === 'unreadable') {
        if (!this.options.allowOnRobotsError) {
          return {
            allowed: false,
            sourceId,
            reason: `robots.txt for ${url.origin} could not be read; refusing to fetch`,
            code: 'robots_unreadable',
          };
        }
      } else {
        if (!isAllowedByRobots(rules, url.pathname)) {
          return {
            allowed: false,
            sourceId,
            reason: `robots.txt disallows ${url.pathname}`,
            code: 'robots_denied',
          };
        }
        crawlDelayMs = rules.crawlDelayMs ?? 0;
      }
      robotsDecision = 'allowed';
    }

    const wait = this.reserveToken(manifest, crawlDelayMs);
    if (wait === null) {
      return { allowed: false, sourceId, reason: 'rate limit exhausted for this source', code: 'rate_limited' };
    }

    return { allowed: true, sourceId, reason: 'permitted', robotsDecision, waitMs: wait };
  }

  /** GATE 2 — post-extract. Runs after a value is parsed, before it becomes a claim. */
  checkExtract(sourceId: string, fieldClass: FieldClass): PolicyDecision {
    if (GLOBALLY_PROHIBITED_FIELD_CLASSES.includes(fieldClass)) {
      return {
        allowed: false,
        sourceId,
        reason: `field class "${fieldClass}" is prohibited product-wide by data minimization policy`,
        code: 'field_class_globally_prohibited',
      };
    }
    const manifest = this.sources.get(sourceId);
    if (!manifest) {
      return { allowed: false, sourceId, reason: `source "${sourceId}" is not registered`, code: 'unknown_source' };
    }
    if (!manifest.permittedFieldClasses.includes(fieldClass)) {
      return {
        allowed: false,
        sourceId,
        reason: `source "${sourceId}" may not supply field class "${fieldClass}"`,
        code: 'field_class_not_permitted',
      };
    }
    return { allowed: true, sourceId, reason: 'permitted', robotsDecision: 'not_applicable', waitMs: 0 };
  }

  /** GATE 3 — export. Enforces each source's redistribution terms per field. */
  checkExport(sourceId: string, fieldClass: FieldClass): PolicyDecision {
    const manifest = this.sources.get(sourceId);
    if (!manifest) {
      return { allowed: false, sourceId, reason: `source "${sourceId}" is not registered`, code: 'unknown_source' };
    }
    if (!manifest.redistribution.export) {
      return {
        allowed: false,
        sourceId,
        reason: `source "${sourceId}" does not permit redistribution of its data`,
        code: 'export_not_permitted',
      };
    }
    const allowList = manifest.redistribution.exportableFieldClasses;
    if (allowList.length > 0 && !allowList.includes(fieldClass)) {
      return {
        allowed: false,
        sourceId,
        reason: `source "${sourceId}" does not permit exporting field class "${fieldClass}"`,
        code: 'export_not_permitted',
      };
    }
    return { allowed: true, sourceId, reason: 'permitted', robotsDecision: 'not_applicable', waitMs: 0 };
  }

  /** Throwing variant for call sites where a denial is a programming error, not a data outcome. */
  assertFetchAllowed(decision: PolicyDecision): asserts decision is Extract<PolicyDecision, { allowed: true }> {
    if (!decision.allowed) {
      throw new PolicyViolationError(decision.reason, { code: decision.code, sourceId: decision.sourceId });
    }
  }

  private async robotsFor(origin: string): Promise<RobotsRules | 'unreadable'> {
    const cached = this.robotsCache.get(origin);
    if (cached) return cached;

    if (!this.options.robotsFetcher) {
      const empty: RobotsRules = { disallow: [], allow: [], crawlDelayMs: null };
      this.robotsCache.set(origin, empty);
      return empty;
    }
    const body = await this.options.robotsFetcher(origin);
    // A 404 means "no restrictions published", which is permission. Only a transport failure
    // (null) is unreadable.
    const result: RobotsRules | 'unreadable' =
      body === null ? 'unreadable' : parseRobots(body, this.options.userAgent);
    this.robotsCache.set(origin, result);
    return result;
  }

  /** Token bucket + minimum spacing. Returns ms to wait, or null when the bucket is empty. */
  private reserveToken(manifest: SourceManifest, extraDelayMs: number): number | null {
    const now = this.now();
    const limit = manifest.rateLimit;
    let bucket = this.buckets.get(manifest.id);
    if (!bucket) {
      bucket = { tokens: limit.requests, lastRefillMs: now, lastRequestMs: 0 };
      this.buckets.set(manifest.id, bucket);
    }

    const elapsed = now - bucket.lastRefillMs;
    if (elapsed > 0) {
      const refill = (elapsed / limit.perMs) * limit.requests;
      if (refill >= 1) {
        bucket.tokens = Math.min(limit.requests, bucket.tokens + Math.floor(refill));
        bucket.lastRefillMs = now;
      }
    }
    if (bucket.tokens < 1) return null;
    bucket.tokens -= 1;

    const spacing = Math.max(limit.minIntervalMs, extraDelayMs);
    const since = now - bucket.lastRequestMs;
    const wait = bucket.lastRequestMs === 0 ? 0 : Math.max(0, spacing - since);
    bucket.lastRequestMs = now + wait;
    return wait;
  }
}

/** Exact host match, or a subdomain of a declared host. Never a suffix-substring match. */
function hostPermitted(hostname: string, hosts: readonly string[]): boolean {
  const h = hostname.toLowerCase();
  return hosts.some((declared) => {
    const d = declared.toLowerCase();
    if (d === '*') return false; // wildcards are never permitted — a source must name its hosts
    return h === d || h.endsWith(`.${d}`);
  });
}
