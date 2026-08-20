import { z } from 'zod';
import type { EvidenceSpan } from './evidence.js';

/** Per-criterion outcome. `unknown` is never treated as `fail` — ARCHITECTURE.md §4. */
export const verdictSchema = z.enum(['pass', 'fail', 'unknown']);
export type Verdict = z.infer<typeof verdictSchema>;

export const verdictStatusSchema = z.enum(['evaluated', 'insufficient_evidence', 'not_configured', 'rejected']);
export type VerdictStatus = z.infer<typeof verdictStatusSchema>;

export interface CriterionVerdict {
  criterionId: string;
  criterionName: string;
  kind: 'hard_filter' | 'weighted' | 'bonus' | 'disqualifier';
  verdict: Verdict;
  status: VerdictStatus;
  confidence: number;
  /** Points this verdict contributed to the aggregate. Always derivable from weight × verdict. */
  pointsAwarded: number;
  weight: number;
  spans: EvidenceSpan[];
  /** Distinct source ids backing this verdict. */
  sourceIds: string[];
  /** Human-readable reason. Grounded in the spans above; never a free-form model assertion. */
  reasoning: string;
}

/**
 * The shape an LLM judge must return. Validated against this schema *and* against stored
 * evidence before it is allowed to influence a score.
 */
export const llmJudgeResponseSchema = z.object({
  verdict: verdictSchema,
  confidence: z.number().min(0).max(1),
  citations: z
    .array(z.object({ evidenceId: z.string().min(1), quote: z.string().min(1) }))
    .default([]),
  reasoning: z.string().min(1).max(2000),
});
export type LlmJudgeResponse = z.infer<typeof llmJudgeResponseSchema>;

export interface LeadScore {
  /** 0-100, normalized against evaluable weight. */
  score: number;
  band: 'A' | 'B' | 'C' | 'unqualified';
  /** Fraction of rubric weight that could actually be evaluated. */
  coverage: number;
  qualified: boolean;
  disqualified: boolean;
  disqualifiedBy: string[];
  failedHardFilters: string[];
  verdicts: CriterionVerdict[];
  /** Present when coverage fell below the spec's minimum — the lead is held, not scored low. */
  heldReason: string | null;
}
