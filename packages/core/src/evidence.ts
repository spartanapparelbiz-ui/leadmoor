import { z } from 'zod';

/**
 * Evidence — a content-addressed snapshot of something we actually retrieved.
 * ARCHITECTURE.md §4: "A score from three months ago can be re-audited against exactly the
 * bytes that produced it."
 */

/** What role a retrieved document plays. Used to target extraction and to scope keyword criteria. */
export const DOCUMENT_ROLES = [
  'company_home',
  'company_about',
  'company_team',
  'company_careers',
  'company_job_posting',
  'company_security',
  'company_pricing',
  'company_blog',
  'press_release',
  'registry_record',
  'code_repository',
  'search_result',
  'other',
] as const;
export type DocumentRole = (typeof DOCUMENT_ROLES)[number];
export const documentRoleSchema = z.enum(DOCUMENT_ROLES);

export const fetchStatusSchema = z.enum([
  'ok',
  'http_error',
  'robots_denied',
  'policy_denied',
  'network_blocked',
  'not_configured',
  'rate_limited',
  'timeout',
  'too_large',
]);
export type FetchStatus = z.infer<typeof fetchStatusSchema>;

/** A span located inside an evidence document's normalized text. Byte-exact and re-verifiable. */
export const evidenceSpanSchema = z.object({
  evidenceId: z.string().min(1),
  start: z.number().int().min(0),
  end: z.number().int().min(0),
  /** The literal text at [start, end) in the normalized document at capture time. */
  quote: z.string().min(1),
});
export type EvidenceSpan = z.infer<typeof evidenceSpanSchema>;

export interface EvidenceRecord {
  id: string;
  runId: string | null;
  sourceId: string;
  url: string;
  title: string | null;
  documentRole: DocumentRole;
  httpStatus: number | null;
  contentHash: string;
  contentType: string | null;
  /** Normalized, extracted plain text. Spans index into this string. */
  normalizedText: string;
  byteLength: number;
  fetchedAt: Date;
  robotsDecision: 'allowed' | 'denied' | 'not_applicable';
  metadata: Record<string, unknown>;
}

/** The input to the evidence store — everything needed to persist and later re-audit a fetch. */
export interface EvidenceInput {
  runId: string | null;
  sourceId: string;
  url: string;
  title?: string | null;
  documentRole: DocumentRole;
  httpStatus?: number | null;
  rawBody: string;
  normalizedText: string;
  contentType?: string | null;
  robotsDecision: 'allowed' | 'denied' | 'not_applicable';
  metadata?: Record<string, unknown>;
}
