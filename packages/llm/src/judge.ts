import {
  ProviderNotConfiguredError,
  ProviderUnreachableError,
  llmJudgeResponseSchema,
  type Criterion,
  type EvidenceRecord,
} from '@leadmoor/core';
import type { ProvenanceValidator } from '@leadmoor/evidence';
import type { LLMClient } from './client.js';

/**
 * Evidence judging — the model's third and last permitted job.
 *
 * The judge is shown a fixed set of retrieved documents and asked one yes/no question about them.
 * It must quote the text it relied on. Its answer then goes through ProvenanceValidator, which
 * checks every quote actually appears in the document it was attributed to. A verdict that cites
 * a document it was not shown, or quotes text that is not there, is discarded outright — the
 * criterion becomes `insufficient_evidence` rather than being retried into compliance.
 */

export const JUDGE_SYSTEM = `You judge whether a single criterion is supported by supplied evidence documents.

You are shown numbered documents. Answer ONLY from those documents.

Rules:
- "pass" means the documents contain text that directly supports the criterion.
- "fail" means the documents contain text that directly contradicts it.
- "unknown" means the documents do not settle it. Absence of mention is "unknown", never "fail".
- Every citation must quote text copied EXACTLY from a document, character for character.
- Never cite a document id you were not shown.
- Never assert anything the quoted text does not itself say.
- If you cannot quote supporting text, the answer is "unknown".`;

export interface JudgeArgs {
  criterion: Criterion;
  evidence: EvidenceRecord[];
  companyName: string;
  /** Characters of each document to show. Keeps the per-lead payload small. */
  excerptChars?: number;
}

export interface JudgeOutcome {
  verdict: 'pass' | 'fail' | 'unknown';
  status: 'evaluated' | 'insufficient_evidence' | 'not_configured' | 'rejected';
  confidence: number;
  spans: Array<{ evidenceId: string; start: number; end: number; quote: string }>;
  sourceIds: string[];
  reasoning: string;
}

export class EvidenceJudge {
  constructor(
    private readonly llm: LLMClient,
    private readonly validator: ProvenanceValidator,
  ) {}

  async judge(args: JudgeArgs): Promise<JudgeOutcome> {
    if (args.criterion.evaluator.type !== 'llm_judge') {
      throw new Error(`criterion "${args.criterion.id}" is not an llm_judge criterion`);
    }
    if (!this.llm.isConfigured()) {
      return notConfigured(this.llm.unavailableReason() ?? 'no language model configured');
    }
    if (args.evidence.length === 0) {
      return {
        verdict: 'unknown',
        status: 'insufficient_evidence',
        confidence: 0,
        spans: [],
        sourceIds: [],
        reasoning: 'no documents were retrieved for this company, so the criterion could not be judged',
      };
    }

    const excerptChars = args.excerptChars ?? 6000;
    const shown = args.evidence.slice(0, 8);
    const corpus = shown
      .map(
        (doc, i) =>
          `--- DOCUMENT ${i + 1} ---\nid: ${doc.id}\nurl: ${doc.url}\nretrieved: ${doc.fetchedAt.toISOString()}\n\n${doc.normalizedText.slice(0, excerptChars)}`,
      )
      .join('\n\n');

    let response;
    try {
      response = await this.llm.structured({
        tier: 'judge',
        // Stable across every lead in the run, so it lands in the cached prefix.
        systemPrefix: `${JUDGE_SYSTEM}\n\nCRITERION\nname: ${args.criterion.name}\nquestion: ${args.criterion.evaluator.question}`,
        user: `Company: ${args.companyName}\n\n${corpus}`,
        schema: llmJudgeResponseSchema,
        toolName: 'record_verdict',
        toolDescription: 'Record the verdict for this criterion, citing exact quotes from the documents shown.',
        maxTokens: 1500,
      });
    } catch (error) {
      if (error instanceof ProviderNotConfiguredError) return notConfigured(error.message);
      if (error instanceof ProviderUnreachableError) {
        return {
          verdict: 'unknown',
          status: 'not_configured',
          confidence: 0,
          spans: [],
          sourceIds: [],
          reasoning: `language model unreachable: ${error.message}`,
        };
      }
      // Schema validation failure — malformed output is rejected, not repaired.
      return {
        verdict: 'unknown',
        status: 'rejected',
        confidence: 0,
        spans: [],
        sourceIds: [],
        reasoning: `model output rejected: ${(error as Error).message}`,
      };
    }

    const check = await this.validator.validateJudgeResponse(
      response,
      shown.map((d) => d.id),
    );

    if (!check.ok) {
      return {
        verdict: 'unknown',
        status: 'rejected',
        confidence: 0,
        spans: [],
        sourceIds: [],
        reasoning: `citation validation failed: ${check.reasons.join('; ')}`,
      };
    }

    // A pass or fail with no surviving citation is not a judgement we will act on.
    if (response.verdict !== 'unknown' && check.spans.length === 0) {
      return {
        verdict: 'unknown',
        status: 'insufficient_evidence',
        confidence: 0,
        spans: [],
        sourceIds: [],
        reasoning: 'verdict was not accompanied by verifiable evidence',
      };
    }

    return {
      verdict: response.verdict,
      status: response.verdict === 'unknown' ? 'insufficient_evidence' : 'evaluated',
      confidence: Math.min(0.95, response.confidence),
      spans: check.spans,
      sourceIds: check.sourceIds,
      reasoning: response.reasoning,
    };
  }
}

function notConfigured(reason: string): JudgeOutcome {
  return {
    verdict: 'unknown',
    status: 'not_configured',
    confidence: 0,
    spans: [],
    sourceIds: [],
    reasoning: reason,
  };
}
