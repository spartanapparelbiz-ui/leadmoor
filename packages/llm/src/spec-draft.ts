import { z } from 'zod';
import {
  LEADSPEC_VERSION,
  budgetSchema,
  parseLeadSpec,
  type Criterion,
  type LeadSpec,
} from '@leadmoor/core';

/**
 * The model compiles a request into a *draft of intent*, not a finished rubric.
 *
 * Keeping the model's output small and declarative — "these are the signals, this is the size
 * band, these are the titles" — and building the executable rubric deterministically from it means
 * the model never chooses an evaluator, a weight formula, or an evidence threshold. It states what
 * the user asked for; this file decides how that gets measured.
 */

export const signalDraftSchema = z.object({
  id: z.string().describe('lower_snake_case identifier, e.g. security_hiring'),
  label: z.string().describe('short human-readable name, e.g. "Security hiring"'),
  terms: z
    .array(z.string())
    .describe('literal phrases that would appear on a page if this signal were true, e.g. "security engineer"'),
  weight: z.number().describe('relative importance from 1 to 30'),
  required: z.boolean().describe('true only if the user said a company without this is not a lead at all'),
});

export const specDraftSchema = z.object({
  name: z.string().describe('short title for this search'),
  countries: z.array(z.string()).describe('ISO 3166-1 alpha-2 country codes, e.g. ["US"]'),
  companyDescriptors: z.array(z.string()).describe('e.g. ["B2B SaaS"]'),
  industries: z.array(z.string()),
  employeeMin: z.number().nullable(),
  employeeMax: z.number().nullable(),
  signals: z.array(signalDraftSchema),
  personaTitles: z.array(z.string()).describe('job titles of the decision makers wanted, most preferred first'),
  leadCount: z.number().describe('how many leads the user asked for'),
  excludeDomains: z.array(z.string()),
  searchQueries: z
    .array(z.string())
    .describe('4 to 8 literal search queries that would surface these companies on the open web'),
});
export type SpecDraft = z.infer<typeof specDraftSchema>;

export const SPEC_COMPILER_SYSTEM = `You compile a natural-language B2B lead request into a structured search intent.

You are NOT finding companies. You are NOT allowed to name any specific company, person, or fact.
You only restate what the user asked for, in structured form.

Rules:
- Never invent a company, person, product, or statistic.
- "terms" must be literal phrases that would plausibly appear verbatim on a public web page if the
  signal were true. Prefer short, concrete phrases over abstract ones.
- Mark a signal "required" only when the user clearly means a company lacking it is not a lead.
- searchQueries must be plain search strings a person could paste into a search engine.
- If the user did not state something (a size band, a country), leave it null or empty rather than
  choosing a plausible-sounding value.`;

/**
 * Deterministically expands a draft into an executable LeadSpec.
 *
 * Every evaluator, weight, and evidence threshold is chosen here, in code, identically for every
 * request. Two identical drafts always produce byte-identical rubrics, which is what makes runs
 * reproducible.
 */
export function buildLeadSpec(
  draft: SpecDraft,
  sourceRequest: string,
  options: { sources?: string[]; maxCompanies?: number } = {},
): { ok: true; spec: LeadSpec } | { ok: false; problems: string[] } {
  const criteria: Criterion[] = [];

  const min = draft.employeeMin ?? undefined;
  const max = draft.employeeMax ?? undefined;
  if (min !== undefined || max !== undefined) {
    criteria.push({
      id: 'employee_count',
      name: 'Company size',
      description: `Headcount between ${min ?? 'any'} and ${max ?? 'any'}`,
      kind: 'weighted',
      weight: 16,
      evaluator: { type: 'numeric_range', field: 'company.employeeCount', min, max },
      evidenceRequirement: { minSources: 1 },
    });
  }

  if (draft.countries.length > 0) {
    criteria.push({
      id: 'geography',
      name: 'Geography',
      description: `Located in ${draft.countries.join(', ')}`,
      kind: 'weighted',
      weight: 10,
      evaluator: {
        type: 'structured_predicate',
        field: 'company.location',
        op: 'includes',
        value: expandCountryTerms(draft.countries),
      },
      evidenceRequirement: { minSources: 1 },
    });
  }

  for (const signal of draft.signals) {
    const id = toSnake(signal.id);
    if (criteria.some((c) => c.id === id)) continue;
    criteria.push({
      id,
      name: signal.label,
      description: `Evidence of: ${signal.label}`,
      kind: signal.required ? 'hard_filter' : 'weighted',
      weight: clamp(Math.round(signal.weight), 1, 30),
      evaluator: {
        type: 'evidence_keyword',
        anyOf: signal.terms.filter((t) => t.trim().length >= 2).slice(0, 12),
        allOf: [],
        fieldClass: 'company_signal',
        minMatches: 1,
        documentRoles: [],
      },
      evidenceRequirement: { minSources: 1 },
    });
  }

  // A named decision maker is part of what the user asked for, so it is scored like any criterion.
  criteria.push({
    id: 'decision_maker_identified',
    name: 'Technical decision maker identified',
    description: `A person matching ${draft.personaTitles.slice(0, 3).join(' / ')} was found with role evidence`,
    kind: 'weighted',
    weight: 14,
    evaluator: { type: 'structured_predicate', field: 'person.role', op: 'exists' },
    evidenceRequirement: { minSources: 1 },
  });

  const maxCompanies = clamp(options.maxCompanies ?? Math.max(draft.leadCount * 2, 20), 1, 500);

  const candidate = {
    version: LEADSPEC_VERSION,
    name: draft.name || 'Lead search',
    sourceRequest,
    geography: { countries: draft.countries.length > 0 ? draft.countries : ['US'], regions: [] },
    company: {
      descriptors: draft.companyDescriptors,
      ...(min !== undefined || max !== undefined ? { employeeRange: { min, max } } : {}),
      industries: draft.industries,
      excludeDomains: draft.excludeDomains,
    },
    signals: draft.signals.map((s) => s.label),
    personas: {
      titles: draft.personaTitles.length > 0 ? draft.personaTitles : ['CTO', 'VP Engineering'],
      seniority: [],
      functions: [],
      maxPerCompany: 3,
    },
    discovery: {
      queries: draft.searchQueries.filter((q) => q.trim().length >= 2).slice(0, 8),
      sources: options.sources ?? ['sec_edgar', 'github_public', 'company_web'],
      maxCompanies,
    },
    rubric: { criteria, passThreshold: 50 },
    evidencePolicy: {
      minSourcesPerCriterion: 1,
      disqualifierMinSources: 2,
      maxEvidenceAgeDays: 540,
      minCoverage: 0.5,
    },
    budget: budgetSchema.parse({ maxCompanies, maxDocuments: Math.min(1200, maxCompanies * 12) }),
  };

  return parseLeadSpec(candidate);
}

function expandCountryTerms(codes: string[]): string[] {
  const map: Record<string, string[]> = {
    US: ['United States', 'USA', 'U.S.', 'US', 'America', 'CA', 'NY', 'TX', 'WA', 'MA', 'CO', 'IL'],
    GB: ['United Kingdom', 'UK', 'England', 'London', 'Scotland'],
    CA: ['Canada', 'Ontario', 'Toronto', 'Vancouver', 'British Columbia'],
    DE: ['Germany', 'Deutschland', 'Berlin', 'Munich'],
    NL: ['Netherlands', 'Amsterdam', 'Holland'],
  };
  const out: string[] = [];
  for (const code of codes) out.push(...(map[code.toUpperCase()] ?? [code]));
  return [...new Set(out)];
}

function toSnake(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'signal';
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));
}
