import {
  GLOBALLY_PROHIBITED_FIELD_CLASSES,
  newId,
  type Claim,
  type ClaimInput,
  type ClaimStatus,
  type EvidenceSpan,
  type FieldClass,
  type LlmJudgeResponse,
} from '@leadmoor/core';
import type { EvidenceStore } from './store.js';
import { verifySpan } from './spans.js';

/**
 * ProvenanceValidator — the deterministic gate every factual claim must pass.
 *
 * ARCHITECTURE.md §2.1: "The model never authors a fact." Nothing enforces that but this file.
 * It fails closed: anything it cannot positively verify becomes `insufficient_evidence` or
 * `rejected`, never a quietly-accepted value.
 */

export interface ValidationOutcome {
  status: ClaimStatus;
  /** Spans with offsets corrected where the quote was present but mis-located. */
  spans: EvidenceSpan[];
  /** Distinct source ids backing the surviving spans. Drives the two-source rule. */
  sourceIds: string[];
  confidence: number;
  reasons: string[];
}

export interface ValidatorOptions {
  /**
   * Post-extract gate. Returns false when the source's manifest does not permit this field class,
   * which turns the claim into a rejection rather than a stored value.
   */
  fieldClassPermitted?: (sourceId: string, fieldClass: FieldClass) => boolean;
  /** Restricts citations to evidence gathered in this run. */
  runId?: string | null;
  /** Evidence older than this contributes nothing. */
  maxEvidenceAgeDays?: number;
  now?: () => Date;
}

/** Confidence half-life by field class. Firmographics go stale faster than identity. */
const HALF_LIFE_DAYS: Record<FieldClass, number> = {
  company_identity: 1460,
  company_firmographic: 240,
  company_technographic: 300,
  company_signal: 120,
  person_identity: 730,
  person_role: 210,
  person_professional_profile: 365,
  person_work_email: 210,
  personal_direct_contact: 1,
};

/** Fields whose value must literally appear in the cited document. Blocks fabricated contacts. */
const VALUE_MUST_APPEAR_IN_EVIDENCE: ReadonlySet<FieldClass> = new Set<FieldClass>([
  'person_work_email',
  'person_identity',
]);

export function decayConfidence(base: number, ageDays: number, halfLifeDays: number): number {
  if (ageDays <= 0) return base;
  return base * Math.pow(0.5, ageDays / halfLifeDays);
}

export class ProvenanceValidator {
  constructor(
    private readonly evidence: EvidenceStore,
    private readonly options: ValidatorOptions = {},
  ) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  /**
   * Validate a proposed claim against stored evidence.
   *
   * Order matters: prohibited field classes are refused before any evidence is consulted, so a
   * forbidden value is never even matched against a document.
   */
  async validateClaim(input: ClaimInput): Promise<ValidationOutcome> {
    const reasons: string[] = [];

    if (GLOBALLY_PROHIBITED_FIELD_CLASSES.includes(input.fieldClass)) {
      return {
        status: 'rejected',
        spans: [],
        sourceIds: [],
        confidence: 0,
        reasons: [
          `field class "${input.fieldClass}" is prohibited by data minimization policy and is never collected`,
        ],
      };
    }

    if (this.options.fieldClassPermitted && !this.options.fieldClassPermitted(input.sourceId, input.fieldClass)) {
      return {
        status: 'rejected',
        spans: [],
        sourceIds: [],
        confidence: 0,
        reasons: [`source "${input.sourceId}" is not permitted to supply field class "${input.fieldClass}"`],
      };
    }

    if (input.spans.length === 0) {
      return {
        status: 'insufficient_evidence',
        spans: [],
        sourceIds: [],
        confidence: 0,
        reasons: ['no evidence cited'],
      };
    }

    const records = await this.evidence.getMany(input.spans.map((s) => s.evidenceId));
    const verified: EvidenceSpan[] = [];
    const sources = new Set<string>();
    let oldestAgeDays = 0;
    let fabricated = false;

    for (const span of input.spans) {
      const record = records.get(span.evidenceId);
      if (!record) {
        reasons.push(`cites evidence "${span.evidenceId}" which does not exist`);
        fabricated = true;
        continue;
      }
      if (this.options.runId !== undefined && record.runId !== null && record.runId !== this.options.runId) {
        reasons.push(`cites evidence "${span.evidenceId}" from a different run`);
        fabricated = true;
        continue;
      }

      const { verification, corrected } = verifySpan(record.normalizedText, span);
      if (verification === 'absent' || !corrected) {
        reasons.push(
          `quoted text is not present in cited document ${span.evidenceId} (${truncate(span.quote)})`,
        );
        fabricated = true;
        continue;
      }
      if (verification === 'repaired') reasons.push(`span offsets corrected for ${span.evidenceId}`);
      if (verification === 'fuzzy') reasons.push(`span matched after whitespace folding for ${span.evidenceId}`);

      const ageDays = (this.now().getTime() - record.fetchedAt.getTime()) / 86_400_000;
      if (this.options.maxEvidenceAgeDays !== undefined && ageDays > this.options.maxEvidenceAgeDays) {
        reasons.push(`evidence ${span.evidenceId} is older than the spec's ${this.options.maxEvidenceAgeDays}-day limit`);
        continue;
      }
      oldestAgeDays = Math.max(oldestAgeDays, ageDays);
      verified.push(corrected);
      sources.add(record.sourceId);
    }

    // A fabricated citation poisons the whole claim — we do not keep the parts that happened to check out.
    if (fabricated) {
      return { status: 'rejected', spans: [], sourceIds: [], confidence: 0, reasons };
    }
    if (verified.length === 0) {
      return { status: 'insufficient_evidence', spans: [], sourceIds: [], confidence: 0, reasons };
    }

    // The value itself must appear in the evidence for contact and identity fields.
    if (VALUE_MUST_APPEAR_IN_EVIDENCE.has(input.fieldClass) && typeof input.value === 'string') {
      const needle = input.value.trim().toLowerCase();
      let present = false;
      for (const span of verified) {
        const record = records.get(span.evidenceId);
        if (record && record.normalizedText.toLowerCase().includes(needle)) {
          present = true;
          break;
        }
      }
      if (!present) {
        return {
          status: 'rejected',
          spans: [],
          sourceIds: [],
          confidence: 0,
          reasons: [
            ...reasons,
            `value "${truncate(String(input.value))}" does not appear in any cited document — refusing a fabricated ${input.fieldClass}`,
          ],
        };
      }
    }

    const halfLife = HALF_LIFE_DAYS[input.fieldClass];
    const base = clamp01(input.confidence);
    const confidence = clamp01(decayConfidence(base, oldestAgeDays, halfLife));

    return { status: 'supported', spans: verified, sourceIds: [...sources], confidence, reasons };
  }

  /** Convenience: validate and materialize a Claim ready for persistence. */
  async toClaim(input: ClaimInput): Promise<{ claim: Claim; outcome: ValidationOutcome }> {
    const outcome = await this.validateClaim(input);
    const claim: Claim = {
      id: newId(),
      runId: input.runId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      field: input.field,
      fieldClass: input.fieldClass,
      value: outcome.status === 'supported' ? input.value : null,
      spans: outcome.spans,
      sourceId: input.sourceId,
      extractor: input.extractor,
      confidence: outcome.confidence,
      status: outcome.status,
      observedAt: input.observedAt ?? this.now(),
      createdAt: this.now(),
      note: outcome.reasons.length > 0 ? outcome.reasons.join('; ') : null,
    };
    return { claim, outcome };
  }

  /**
   * Validate an LLM judge's structured response. The model supplies (evidenceId, quote) pairs;
   * this converts them into verified spans or refuses the verdict outright.
   *
   * `allowedEvidenceIds` is the set of documents the judge was actually shown — citing anything
   * outside it means the model invented a source.
   */
  async validateJudgeResponse(
    response: LlmJudgeResponse,
    allowedEvidenceIds: string[],
  ): Promise<{ ok: boolean; spans: EvidenceSpan[]; sourceIds: string[]; reasons: string[] }> {
    const reasons: string[] = [];
    const allowed = new Set(allowedEvidenceIds);

    if (response.citations.length === 0) {
      // A `unknown` verdict legitimately has nothing to cite; pass and fail need evidence.
      if (response.verdict === 'unknown') return { ok: true, spans: [], sourceIds: [], reasons: [] };
      return { ok: false, spans: [], sourceIds: [], reasons: ['verdict cites no evidence'] };
    }

    const records = await this.evidence.getMany(response.citations.map((c) => c.evidenceId));
    const spans: EvidenceSpan[] = [];
    const sources = new Set<string>();

    for (const citation of response.citations) {
      if (!allowed.has(citation.evidenceId)) {
        reasons.push(`cited evidence "${citation.evidenceId}" was not supplied to the judge`);
        return { ok: false, spans: [], sourceIds: [], reasons };
      }
      const record = records.get(citation.evidenceId);
      if (!record) {
        reasons.push(`cited evidence "${citation.evidenceId}" does not exist`);
        return { ok: false, spans: [], sourceIds: [], reasons };
      }
      const { verification, corrected } = verifySpan(record.normalizedText, {
        evidenceId: citation.evidenceId,
        start: 0,
        end: 0,
        quote: citation.quote,
      });
      if (verification === 'absent' || !corrected) {
        reasons.push(`quote not found in ${citation.evidenceId}: ${truncate(citation.quote)}`);
        return { ok: false, spans: [], sourceIds: [], reasons };
      }
      spans.push(corrected);
      sources.add(record.sourceId);
    }

    return { ok: true, spans, sourceIds: [...sources], reasons };
  }
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function truncate(s: string, max = 80): string {
  return s.length <= max ? s : `${s.slice(0, max)}…`;
}
