import { z } from 'zod';
import { fieldClassSchema } from './tiers.js';

/**
 * LeadSpec — the typed IR of ARCHITECTURE.md §2.2.
 *
 * This is the *only* place the user's intent is interpreted. The LLM compiles natural language
 * into this document; the user reads and edits it; the pipeline then executes it deterministically
 * with no model in the control flow.
 */

export const LEADSPEC_VERSION = 1 as const;

/** Evaluators. Only `llm_judge` requires a model — the rest are deterministic and evidence-backed. */
export const numericRangeEvaluator = z.object({
  type: z.literal('numeric_range'),
  field: z.string().min(1),
  min: z.number().optional(),
  max: z.number().optional(),
});

export const structuredPredicateEvaluator = z.object({
  type: z.literal('structured_predicate'),
  field: z.string().min(1),
  op: z.enum(['equals', 'not_equals', 'includes', 'excludes', 'exists']),
  value: z.union([z.string(), z.number(), z.boolean(), z.array(z.string())]).optional(),
});

/**
 * Deterministic keyword evaluator over *stored evidence text*. Produces a real citation (the
 * matched span and its byte offsets) without a model. This is what lets the rubric return
 * honest, cited verdicts when no LLM credential is configured.
 */
export const evidenceKeywordEvaluator = z.object({
  type: z.literal('evidence_keyword'),
  anyOf: z.array(z.string().min(2)).min(1),
  allOf: z.array(z.string().min(2)).default([]),
  fieldClass: fieldClassSchema,
  minMatches: z.number().int().min(1).default(1),
  /** Restrict matching to evidence captured from these document roles, when set. */
  documentRoles: z.array(z.string()).default([]),
});

export const llmJudgeEvaluator = z.object({
  type: z.literal('llm_judge'),
  question: z.string().min(1),
  fieldClass: fieldClassSchema,
});

export const evaluatorSchema = z.discriminatedUnion('type', [
  numericRangeEvaluator,
  structuredPredicateEvaluator,
  evidenceKeywordEvaluator,
  llmJudgeEvaluator,
]);
export type Evaluator = z.infer<typeof evaluatorSchema>;

export const criterionKindSchema = z.enum(['hard_filter', 'weighted', 'bonus', 'disqualifier']);
export type CriterionKind = z.infer<typeof criterionKindSchema>;

export const criterionSchema = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/, 'criterion id must be lower_snake_case'),
  name: z.string().min(1),
  description: z.string().default(''),
  kind: criterionKindSchema,
  /** Points contributed when the criterion passes. Ignored for hard_filter. */
  weight: z.number().min(0).max(100).default(10),
  evaluator: evaluatorSchema,
  evidenceRequirement: z
    .object({
      /** Independent sources required for a verdict to stand. */
      minSources: z.number().int().min(1).default(1),
      maxAgeDays: z.number().int().min(1).optional(),
    })
    .default({ minSources: 1 }),
});
export type Criterion = z.infer<typeof criterionSchema>;

export const personaSchema = z.object({
  titles: z.array(z.string().min(1)).min(1),
  seniority: z.array(z.string()).default([]),
  functions: z.array(z.string()).default([]),
  maxPerCompany: z.number().int().min(1).max(10).default(3),
});
export type Persona = z.infer<typeof personaSchema>;

export const budgetSchema = z.object({
  maxCompanies: z.number().int().min(1).max(500).default(50),
  maxDocuments: z.number().int().min(1).max(5000).default(600),
  maxPeoplePerCompany: z.number().int().min(1).max(20).default(3),
  maxModelCalls: z.number().int().min(0).max(2000).default(200),
  maxRuntimeMs: z.number().int().min(1000).max(6 * 60 * 60 * 1000).default(30 * 60 * 1000),
  maxSearchDepth: z.number().int().min(1).max(5).default(2),
  maxFetchesPerCompany: z.number().int().min(1).max(60).default(12),
});
export type Budget = z.infer<typeof budgetSchema>;

export const evidencePolicySchema = z.object({
  /** Baseline independent-source requirement for any criterion that does not state its own. */
  minSourcesPerCriterion: z.number().int().min(1).default(1),
  /**
   * ARCHITECTURE.md §15: a disqualifying criterion requires two independent sources, so a single
   * weak source can never silently drop a lead. Enforced programmatically in the scorer.
   */
  disqualifierMinSources: z.number().int().min(2).default(2),
  maxEvidenceAgeDays: z.number().int().min(1).default(540),
  /** Fraction of rubric weight that must be evaluable for a lead to be scored rather than held. */
  minCoverage: z.number().min(0).max(1).default(0.5),
});
export type EvidencePolicy = z.infer<typeof evidencePolicySchema>;

export const leadSpecSchema = z.object({
  version: z.literal(LEADSPEC_VERSION),
  name: z.string().min(1).max(160),
  /** Verbatim user request. Kept so a spec can always be traced back to what was asked. */
  sourceRequest: z.string().min(1),
  geography: z.object({
    countries: z.array(z.string().length(2)).min(1),
    regions: z.array(z.string()).default([]),
  }),
  company: z.object({
    descriptors: z.array(z.string()).default([]),
    employeeRange: z
      .object({ min: z.number().int().min(0).optional(), max: z.number().int().min(1).optional() })
      .optional(),
    industries: z.array(z.string()).default([]),
    excludeDomains: z.array(z.string()).default([]),
  }),
  signals: z.array(z.string()).default([]),
  personas: personaSchema,
  discovery: z.object({
    queries: z.array(z.string().min(2)).min(1),
    /** Connector ids to use. Validated against the registry — unknown or Tier D ids are refused. */
    sources: z.array(z.string().min(1)).min(1),
    maxCompanies: z.number().int().min(1).max(500).default(50),
  }),
  rubric: z.object({
    criteria: z.array(criterionSchema).min(1),
    /** Normalized 0-100 score at or above which a lead is considered qualified. */
    passThreshold: z.number().min(0).max(100).default(50),
  }),
  evidencePolicy: evidencePolicySchema.default({}),
  budget: budgetSchema.default({}),
});
export type LeadSpec = z.infer<typeof leadSpecSchema>;

/** Structural checks that Zod's type system cannot express. */
export function validateLeadSpecSemantics(spec: LeadSpec): string[] {
  const problems: string[] = [];

  const ids = new Set<string>();
  for (const c of spec.rubric.criteria) {
    if (ids.has(c.id)) problems.push(`duplicate criterion id "${c.id}"`);
    ids.add(c.id);
  }

  const range = spec.company.employeeRange;
  if (range?.min !== undefined && range.max !== undefined && range.min > range.max) {
    problems.push(`employeeRange.min (${range.min}) exceeds employeeRange.max (${range.max})`);
  }

  for (const c of spec.rubric.criteria) {
    if (c.evaluator.type === 'numeric_range' && c.evaluator.min === undefined && c.evaluator.max === undefined) {
      problems.push(`criterion "${c.id}": numeric_range needs at least one of min/max`);
    }
    if (c.kind === 'disqualifier' && c.evidenceRequirement.minSources < spec.evidencePolicy.disqualifierMinSources) {
      problems.push(
        `criterion "${c.id}": disqualifier requires at least ${spec.evidencePolicy.disqualifierMinSources} independent sources ` +
          `(declared ${c.evidenceRequirement.minSources})`,
      );
    }
  }

  const scoring = spec.rubric.criteria.filter((c) => c.kind === 'weighted' || c.kind === 'bonus');
  if (scoring.length === 0) problems.push('rubric needs at least one weighted or bonus criterion to produce a score');
  if (scoring.reduce((sum, c) => sum + c.weight, 0) <= 0) problems.push('rubric total weight must be greater than zero');

  if (spec.discovery.maxCompanies > spec.budget.maxCompanies) {
    problems.push(
      `discovery.maxCompanies (${spec.discovery.maxCompanies}) exceeds budget.maxCompanies (${spec.budget.maxCompanies})`,
    );
  }
  return problems;
}

/** Parse untrusted input into a LeadSpec, applying both schema and semantic validation. */
export function parseLeadSpec(input: unknown): { ok: true; spec: LeadSpec } | { ok: false; problems: string[] } {
  const parsed = leadSpecSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, problems: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
  }
  const problems = validateLeadSpecSemantics(parsed.data);
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, spec: parsed.data };
}

/** Total weight available from scoring criteria — the denominator for coverage and score. */
export function totalScoringWeight(spec: LeadSpec): number {
  return spec.rubric.criteria
    .filter((c) => c.kind === 'weighted' || c.kind === 'bonus')
    .reduce((sum, c) => sum + c.weight, 0);
}
