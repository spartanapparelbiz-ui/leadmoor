import { z } from 'zod';

/** Durable run lifecycle. A run is a saga, not a request — ARCHITECTURE.md §11. */
export const runStatusSchema = z.enum([
  'draft',
  'awaiting_approval',
  'queued',
  'running',
  'partial',
  'completed',
  'failed',
  'cancelled',
  'budget_exhausted',
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

export const stageStatusSchema = z.enum([
  'pending',
  'queued',
  'running',
  'completed',
  'failed',
  'partial',
  'skipped',
  'insufficient_evidence',
  'blocked',
]);
export type StageStatus = z.infer<typeof stageStatusSchema>;

/** Pipeline stages, ARCHITECTURE.md §3. Ordinal order is execution order. */
export const RUN_STAGES = [
  'source_planning',
  'discovery',
  'company_resolution',
  'company_enrichment',
  'hard_filter_gate',
  'people_discovery',
  'people_resolution',
  'scoring',
  'evidence_assembly',
] as const;
export type RunStage = (typeof RUN_STAGES)[number];
export const runStageSchema = z.enum(RUN_STAGES);

export const STAGE_LABELS: Record<RunStage, string> = {
  source_planning: 'Planning sources',
  discovery: 'Discovering companies',
  company_resolution: 'Resolving duplicates',
  company_enrichment: 'Enriching companies',
  hard_filter_gate: 'Applying hard filters',
  people_discovery: 'Finding decision makers',
  people_resolution: 'Verifying roles and contacts',
  scoring: 'Scoring leads',
  evidence_assembly: 'Assembling dossiers',
};

/** Live counters checked against the spec budget. A run stops cleanly when one is reached. */
export interface BudgetUsage {
  companies: number;
  documents: number;
  modelCalls: number;
  fetches: number;
  startedAtMs: number;
}

export const leadStatusSchema = z.enum([
  'qualified',
  'unqualified',
  'held_insufficient_evidence',
  'disqualified',
  'suppressed',
]);
export type LeadStatus = z.infer<typeof leadStatusSchema>;

export const emailStatusSchema = z.enum(['verified', 'unverified', 'unavailable']);
export type EmailStatus = z.infer<typeof emailStatusSchema>;
