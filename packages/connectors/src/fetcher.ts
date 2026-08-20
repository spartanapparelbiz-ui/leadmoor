import { newId, type DocumentRole, type FetchStatus, type Logger } from '@leadmoor/core';
import { nullLogger } from '@leadmoor/core';
import { type Db, fetchLog, AuditLog } from '@leadmoor/db';
import { EvidenceStore, htmlToText, extractTitle, normalizeText } from '@leadmoor/evidence';
import type { PolicyEngine } from '@leadmoor/policy';
import type { Fetcher, FetchOutcome } from './types.js';

export const DEFAULT_USER_AGENT =
  'LeadMoor/0.1 (+https://github.com/spartanapparelbiz-ui/leadmoor; contact via repository issues)';

const MAX_BYTES = 3_000_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 4;

export interface HttpFetcherOptions {
  /** Stamped on every fetch record so retrieval history is workspace-scoped. */
  workspaceId?: string | null;
  userAgent?: string;
  timeoutMs?: number;
  logger?: Logger;
  /** Injected for tests. Defaults to global fetch. */
  transport?: typeof globalThis.fetch;
  /** Budget hook: return false to stop before issuing the request. */
  onBeforeFetch?: () => boolean;
}

/**
 * The only component in the system that performs outbound HTTP.
 *
 * Every request passes the pre-fetch policy gate first, so there is no generic "fetch any URL"
 * capability: a caller must name a registered source, and the URL must satisfy that source's
 * manifest. Redirects are followed manually and re-checked, so a redirect cannot walk a fetch
 * off an allowed host.
 *
 * No cookie jar, no credential injection, no retry-on-403, no user-agent rotation. A refusal is
 * recorded and returned, never worked around.
 */
export class HttpFetcher implements Fetcher {
  private readonly userAgent: string;
  private readonly timeoutMs: number;
  private readonly log: Logger;
  private readonly transport: typeof globalThis.fetch;

  constructor(
    private readonly db: Db,
    private readonly policy: PolicyEngine,
    private readonly evidence: EvidenceStore,
    private readonly audit: AuditLog,
    private readonly options: HttpFetcherOptions = {},
  ) {
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.log = options.logger ?? nullLogger;
    this.transport = options.transport ?? globalThis.fetch;
  }

  async fetch(args: {
    sourceId: string;
    url: string;
    documentRole: DocumentRole;
    runId: string | null;
    headers?: Record<string, string>;
    json?: unknown;
  }): Promise<FetchOutcome> {
    const started = Date.now();
    let url = args.url;
    let redirects = 0;

    for (;;) {
      const decision = await this.policy.checkFetch(args.sourceId, url);
      if (!decision.allowed) {
        await this.record({
          runId: args.runId,
          sourceId: args.sourceId,
          url,
          status: 'policy_denied',
          reason: decision.reason,
          durationMs: Date.now() - started,
        });
        await this.audit.record('fetch.denied', {
          runId: args.runId,
          subject: url,
          detail: { sourceId: args.sourceId, code: decision.code, reason: decision.reason },
        });
        const status: FetchStatus = decision.code === 'robots_denied' ? 'robots_denied' : 'policy_denied';
        return { status, evidence: null, httpStatus: null, reason: decision.reason, url, sourceId: args.sourceId };
      }

      if (this.options.onBeforeFetch && !this.options.onBeforeFetch()) {
        return {
          status: 'policy_denied',
          evidence: null,
          httpStatus: null,
          reason: 'run budget reached before request was issued',
          url,
          sourceId: args.sourceId,
        };
      }

      if (decision.waitMs > 0) await sleep(decision.waitMs);

      const attempt = await this.issue(url, args.headers, args.json);

      if (attempt.kind === 'redirect') {
        redirects += 1;
        if (redirects > MAX_REDIRECTS) {
          await this.record({
            runId: args.runId,
            sourceId: args.sourceId,
            url,
            status: 'http_error',
            reason: 'too many redirects',
            httpStatus: attempt.httpStatus,
            durationMs: Date.now() - started,
          });
          return {
            status: 'http_error',
            evidence: null,
            httpStatus: attempt.httpStatus,
            reason: 'too many redirects',
            url,
            sourceId: args.sourceId,
          };
        }
        // Loop re-runs the policy gate against the redirect target.
        url = attempt.location;
        continue;
      }

      if (attempt.kind === 'error') {
        await this.record({
          runId: args.runId,
          sourceId: args.sourceId,
          url,
          status: attempt.status,
          reason: attempt.reason,
          httpStatus: attempt.httpStatus ?? null,
          durationMs: Date.now() - started,
        });
        await this.audit.record('fetch.failed', {
          runId: args.runId,
          subject: url,
          detail: { sourceId: args.sourceId, status: attempt.status, reason: attempt.reason },
        });
        return {
          status: attempt.status,
          evidence: null,
          httpStatus: attempt.httpStatus ?? null,
          reason: attempt.reason,
          url,
          sourceId: args.sourceId,
        };
      }

      const isHtml = (attempt.contentType ?? '').includes('html') || /^\s*<(?:!doctype|html)/i.test(attempt.body);
      const normalized = isHtml ? htmlToText(attempt.body) : normalizeText(attempt.body);
      const title = isHtml ? extractTitle(attempt.body) : null;

      const record = await this.evidence.put({
        runId: args.runId,
        sourceId: args.sourceId,
        url,
        title,
        documentRole: args.documentRole,
        httpStatus: attempt.httpStatus,
        rawBody: attempt.body,
        normalizedText: normalized,
        contentType: attempt.contentType,
        robotsDecision: decision.robotsDecision === 'allowed' ? 'allowed' : 'not_applicable',
        metadata: { finalUrl: url, redirects },
      });

      await this.record({
        runId: args.runId,
        sourceId: args.sourceId,
        url,
        status: 'ok',
        httpStatus: attempt.httpStatus,
        evidenceId: record.id,
        robotsDecision: decision.robotsDecision,
        durationMs: Date.now() - started,
      });
      await this.audit.record('document.retrieved', {
        runId: args.runId,
        subject: url,
        detail: { sourceId: args.sourceId, evidenceId: record.id, role: args.documentRole, bytes: record.byteLength },
      });

      this.log.debug('fetched', { url, sourceId: args.sourceId, bytes: record.byteLength });
      return { status: 'ok', evidence: record, httpStatus: attempt.httpStatus, reason: null, url, sourceId: args.sourceId };
    }
  }

  /** Single HTTP round trip. Classifies failures precisely so the UI never shows a blank success. */
  private async issue(
    url: string,
    headers: Record<string, string> | undefined,
    json: unknown,
  ): Promise<
    | { kind: 'ok'; body: string; httpStatus: number; contentType: string | null }
    | { kind: 'redirect'; location: string; httpStatus: number }
    | { kind: 'error'; status: FetchStatus; reason: string; httpStatus?: number }
  > {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.transport(url, {
        method: json === undefined ? 'GET' : 'POST',
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': this.userAgent,
          Accept: 'text/html,application/json,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
          'Accept-Language': 'en-US,en;q=0.9',
          ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        },
        ...(json === undefined ? {} : { body: JSON.stringify(json) }),
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) {
          return { kind: 'error', status: 'http_error', reason: `redirect without location`, httpStatus: response.status };
        }
        return { kind: 'redirect', location: new URL(location, url).toString(), httpStatus: response.status };
      }

      if (response.status === 429) {
        return { kind: 'error', status: 'rate_limited', reason: 'provider returned 429', httpStatus: 429 };
      }
      if (!response.ok) {
        return {
          kind: 'error',
          status: 'http_error',
          reason: `HTTP ${response.status} ${response.statusText}`.trim(),
          httpStatus: response.status,
        };
      }

      const length = Number(response.headers.get('content-length') ?? '0');
      if (length > MAX_BYTES) {
        return { kind: 'error', status: 'too_large', reason: `content-length ${length} exceeds cap`, httpStatus: response.status };
      }

      const body = await response.text();
      if (body.length > MAX_BYTES) {
        return { kind: 'error', status: 'too_large', reason: `body ${body.length} exceeds cap`, httpStatus: response.status };
      }

      return { kind: 'ok', body, httpStatus: response.status, contentType: response.headers.get('content-type') };
    } catch (error) {
      const err = error as Error & { cause?: { code?: string } };
      if (err.name === 'AbortError') return { kind: 'error', status: 'timeout', reason: `timed out after ${this.timeoutMs}ms` };
      const code = err.cause?.code ?? '';
      return {
        kind: 'error',
        status: 'network_blocked',
        reason: `network unreachable${code ? ` (${code})` : ''}: ${err.message}`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async record(row: {
    runId: string | null;
    sourceId: string;
    url: string;
    status: FetchStatus;
    reason?: string | null;
    httpStatus?: number | null;
    evidenceId?: string | null;
    robotsDecision?: string;
    durationMs: number;
  }): Promise<void> {
    await this.db.insert(fetchLog).values({
      id: newId(),
      workspaceId: this.options.workspaceId ?? null,
      runId: row.runId,
      sourceId: row.sourceId,
      url: row.url,
      method: 'GET',
      status: row.status,
      httpStatus: row.httpStatus ?? null,
      robotsDecision: row.robotsDecision ?? 'not_applicable',
      denialReason: row.reason ?? null,
      durationMs: row.durationMs,
      evidenceId: row.evidenceId ?? null,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
