import { z } from 'zod';
import type { FieldClass } from './tiers.js';
import type { EvidenceSpan } from './evidence.js';

/**
 * Claim — ARCHITECTURE.md §4 and §9. "A company record is not a row of values. It is a set of
 * claims." The current value of a field is a *view* computed by survivorship, never a stored
 * truth, and conflicting claims coexist rather than overwriting each other.
 */

export const claimStatusSchema = z.enum([
  /** Backed by evidence that passed citation validation. */
  'supported',
  /** Asserted but the evidence did not support it. Retained for audit; never scored. */
  'insufficient_evidence',
  /** Failed validation outright (fabricated citation, forbidden field class, bad shape). */
  'rejected',
]);
export type ClaimStatus = z.infer<typeof claimStatusSchema>;

export const subjectTypeSchema = z.enum(['company', 'person']);
export type SubjectType = z.infer<typeof subjectTypeSchema>;

/** How a claim was produced. `model_judgement` claims carry the heaviest validation burden. */
export const extractorKindSchema = z.enum([
  'registry_field',
  'structured_api_field',
  'html_extraction',
  'pattern_match',
  'model_judgement',
]);
export type ExtractorKind = z.infer<typeof extractorKindSchema>;

export interface Claim {
  id: string;
  runId: string | null;
  subjectType: SubjectType;
  subjectId: string;
  /** Dotted field path, e.g. "company.employeeCount" or "person.role". */
  field: string;
  fieldClass: FieldClass;
  value: unknown;
  /** Evidence backing this claim. A claim with zero spans can never be `supported`. */
  spans: EvidenceSpan[];
  sourceId: string;
  extractor: ExtractorKind;
  confidence: number;
  status: ClaimStatus;
  observedAt: Date;
  createdAt: Date;
  /** Why a claim was rejected or held. Null when supported. */
  note: string | null;
}

export interface ClaimInput {
  runId: string | null;
  subjectType: SubjectType;
  subjectId: string;
  field: string;
  fieldClass: FieldClass;
  value: unknown;
  spans: EvidenceSpan[];
  sourceId: string;
  extractor: ExtractorKind;
  confidence: number;
  observedAt?: Date;
}

/**
 * A resolved view over competing claims for one field. `conflicting` is true whenever two
 * supported claims disagree on value — surfaced in the UI rather than silently collapsed.
 */
export interface FieldView<T = unknown> {
  field: string;
  value: T | null;
  /** The claim that won survivorship, if any. */
  winningClaimId: string | null;
  conflicting: boolean;
  /** Every supported claim for this field, strongest first. */
  candidates: Claim[];
  /** Distinct sources supporting the winning value. Drives the two-source rule. */
  supportingSourceCount: number;
  confidence: number;
}
