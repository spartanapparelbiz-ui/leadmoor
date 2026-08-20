import type { LeadSpec } from '@leadmoor/core';
import type { LLMClient } from './client.js';
import { SPEC_COMPILER_SYSTEM, buildLeadSpec, specDraftSchema, type SpecDraft } from './spec-draft.js';

/**
 * Request compilation — pipeline stage 1.
 *
 * Two compilers produce the same `SpecDraft` shape, and both hand it to the same deterministic
 * rubric builder:
 *
 *   ModelSpecCompiler      uses Claude. Better at reading intent from loose prose.
 *   HeuristicSpecCompiler  pure pattern matching over the user's own words. No model, no network.
 *
 * The heuristic path is a *parser*, not a substitute for intelligence: it only restructures what
 * the user typed. It never invents a company, a person, or a fact, and the UI labels which
 * compiler produced a spec so nobody mistakes a keyword draft for a considered one.
 */

export type CompilerOrigin = 'model' | 'heuristic';

export interface CompileResult {
  ok: boolean;
  origin: CompilerOrigin;
  spec: LeadSpec | null;
  draft: SpecDraft | null;
  problems: string[];
  /** Set when the model was unavailable and the heuristic compiler ran instead. */
  notice: string | null;
}

export class ModelSpecCompiler {
  constructor(private readonly llm: LLMClient) {}

  async compile(request: string): Promise<CompileResult> {
    const draft = await this.llm.structured({
      tier: 'compile',
      systemPrefix: SPEC_COMPILER_SYSTEM,
      user: `Compile this lead request:\n\n${request}`,
      schema: specDraftSchema,
      toolName: 'emit_search_intent',
      toolDescription: 'Record the structured search intent contained in the user request.',
      maxTokens: 3000,
    });

    const built = buildLeadSpec(draft, request);
    return built.ok
      ? { ok: true, origin: 'model', spec: built.spec, draft, problems: [], notice: null }
      : { ok: false, origin: 'model', spec: null, draft, problems: built.problems, notice: null };
  }
}

/** Signal vocabulary the heuristic compiler recognises, with the literal terms each implies. */
const SIGNAL_VOCABULARY: Array<{ id: string; label: string; match: RegExp; terms: string[]; weight: number }> = [
  {
    id: 'security_hiring',
    label: 'Hiring for security',
    match: /\b(hiring|recruit\w*|open roles?|job)\b[^.]{0,40}\b(security|appsec|infosec|devsecops)\b|\bsecurity engineer\b/i,
    terms: ['security engineer', 'application security', 'security engineering', 'appsec', 'infosec', 'devsecops', 'product security'],
    weight: 22,
  },
  {
    id: 'compliance_signal',
    label: 'Compliance program',
    match: /\b(soc ?2|iso ?27001|hipaa|pci|fedramp|gdpr|compliance|audit)\b/i,
    terms: ['SOC 2', 'SOC2', 'ISO 27001', 'HIPAA', 'PCI DSS', 'FedRAMP', 'trust center', 'security compliance', 'penetration test'],
    weight: 18,
  },
  {
    id: 'cloud_infrastructure',
    label: 'Cloud infrastructure',
    match: /\b(kubernetes|k8s|aws|gcp|azure|terraform|docker|cloud native|microservices)\b/i,
    terms: ['Kubernetes', 'Terraform', 'AWS', 'Amazon Web Services', 'Google Cloud', 'Azure', 'Docker', 'microservices'],
    weight: 14,
  },
  {
    id: 'engineering_hiring',
    label: 'Engineering hiring',
    match: /\b(hiring|recruit\w*|open roles?)\b[^.]{0,40}\b(engineer|developer|backend|platform|infrastructure)\b/i,
    terms: ['backend engineer', 'platform engineer', 'infrastructure engineer', 'software engineer', 'we are hiring', 'open positions'],
    weight: 14,
  },
  {
    id: 'ai_adoption',
    label: 'AI adoption',
    match: /\b(ai|artificial intelligence|machine learning|ml|llm|genai)\b/i,
    terms: ['artificial intelligence', 'machine learning', 'large language model', 'LLM', 'AI-powered', 'generative AI'],
    weight: 12,
  },
  {
    id: 'funding_growth',
    label: 'Recent funding or growth',
    match: /\b(series [a-e]|funding|raised|venture|growth|scaling)\b/i,
    terms: ['Series A', 'Series B', 'Series C', 'raised', 'funding round', 'led the round'],
    weight: 10,
  },
];

const TITLE_VOCABULARY: Array<{ match: RegExp; titles: string[] }> = [
  { match: /\bctos?\b|chief technology officer/i, titles: ['CTO', 'Chief Technology Officer'] },
  { match: /\bcisos?\b|chief information security officer/i, titles: ['CISO', 'Chief Information Security Officer'] },
  { match: /\bvp\b[^.]{0,20}\bengineering\b|vp engineering/i, titles: ['VP Engineering', 'VP of Engineering'] },
  { match: /\bvp\b[^.]{0,20}\bsecurity\b/i, titles: ['VP Security', 'VP of Security'] },
  { match: /head of engineering/i, titles: ['Head of Engineering'] },
  { match: /head of security/i, titles: ['Head of Security'] },
  { match: /head of platform|platform engineering/i, titles: ['Head of Platform', 'Platform Engineering Lead'] },
  { match: /devsecops/i, titles: ['DevSecOps Lead'] },
  { match: /\bfounders?\b|technical founder/i, titles: ['Founder', 'Co-Founder'] },
  { match: /\bceos?\b/i, titles: ['CEO', 'Chief Executive Officer'] },
];

const COUNTRY_VOCABULARY: Array<{ match: RegExp; code: string }> = [
  { match: /\b(us|u\.s\.|usa|united states|american?)\b/i, code: 'US' },
  { match: /\b(uk|united kingdom|british|england)\b/i, code: 'GB' },
  { match: /\b(canada|canadian)\b/i, code: 'CA' },
  { match: /\b(germany|german)\b/i, code: 'DE' },
  { match: /\b(netherlands|dutch)\b/i, code: 'NL' },
];

export class HeuristicSpecCompiler {
  compile(request: string): CompileResult {
    const draft = this.draftFrom(request);
    const built = buildLeadSpec(draft, request);
    const notice =
      'Drafted without a language model by matching keywords in your request. ' +
      'Review it carefully and edit anything it missed.';

    return built.ok
      ? { ok: true, origin: 'heuristic', spec: built.spec, draft, problems: [], notice }
      : { ok: false, origin: 'heuristic', spec: null, draft, problems: built.problems, notice };
  }

  private draftFrom(request: string): SpecDraft {
    const text = request.trim();

    const countries = COUNTRY_VOCABULARY.filter((c) => c.match.test(text)).map((c) => c.code);
    const range = parseEmployeeRange(text);
    const leadCount = parseLeadCount(text);

    const signals = SIGNAL_VOCABULARY.filter((s) => s.match.test(text)).map((s) => ({
      id: s.id,
      label: s.label,
      terms: s.terms,
      weight: s.weight,
      required: false,
    }));

    const titles = [...new Set(TITLE_VOCABULARY.filter((t) => t.match.test(text)).flatMap((t) => t.titles))];

    const descriptors: string[] = [];
    if (/\bb2b\b/i.test(text)) descriptors.push('B2B');
    if (/\bsaas\b/i.test(text)) descriptors.push('SaaS');
    if (/\bfintech\b/i.test(text)) descriptors.push('Fintech');
    if (/\bhealthcare|healthtech\b/i.test(text)) descriptors.push('Healthcare');

    return {
      name: summarize(text),
      countries: countries.length > 0 ? countries : ['US'],
      companyDescriptors: descriptors,
      industries: descriptors,
      employeeMin: range.min,
      employeeMax: range.max,
      signals,
      personaTitles: titles.length > 0 ? titles : ['CTO', 'VP Engineering', 'Head of Engineering'],
      leadCount,
      excludeDomains: [],
      searchQueries: buildQueries(descriptors, signals.map((s) => s.label), countries),
    };
  }
}

/**
 * Picks the model compiler when a key is configured and falls back to the heuristic one otherwise,
 * always reporting which ran. A model failure is surfaced, not swallowed.
 */
export async function compileRequest(request: string, llm: LLMClient): Promise<CompileResult> {
  const heuristic = new HeuristicSpecCompiler();
  if (!llm.isConfigured()) {
    const result = heuristic.compile(request);
    return { ...result, notice: `${llm.unavailableReason()} ${result.notice ?? ''}`.trim() };
  }

  try {
    return await new ModelSpecCompiler(llm).compile(request);
  } catch (error) {
    const result = heuristic.compile(request);
    return {
      ...result,
      notice: `Model compilation failed (${(error as Error).message}). ${result.notice ?? ''}`.trim(),
    };
  }
}

function parseEmployeeRange(text: string): { min: number | null; max: number | null } {
  const between = /(\d[\d,]*)\s*(?:-|–|—|to)\s*(\d[\d,]*)\s*(?:employees|people|staff|headcount|person|fte)/i.exec(text);
  if (between?.[1] && between[2]) return { min: num(between[1]), max: num(between[2]) };

  const plain = /(\d[\d,]*)\s*(?:-|–|—|to)\s*(\d[\d,]*)/.exec(text);
  if (plain?.[1] && plain[2] && /employee|people|staff|headcount|size/i.test(text)) {
    return { min: num(plain[1]), max: num(plain[2]) };
  }

  const under = /(?:under|fewer than|less than|below|up to)\s*(\d[\d,]*)\s*(?:employees|people|staff)/i.exec(text);
  if (under?.[1]) return { min: null, max: num(under[1]) };

  const over = /(?:over|more than|at least|above)\s*(\d[\d,]*)\s*(?:employees|people|staff)/i.exec(text);
  if (over?.[1]) return { min: num(over[1]), max: null };

  return { min: null, max: null };
}

function parseLeadCount(text: string): number {
  const m = /\b(?:find|get|give me|show me|need|want)\s+(?:me\s+)?(\d{1,4})\b/i.exec(text) ?? /^\s*(\d{1,4})\b/.exec(text);
  const n = m?.[1] ? Number(m[1]) : 25;
  return Number.isFinite(n) ? Math.min(500, Math.max(1, n)) : 25;
}

function buildQueries(descriptors: string[], signalLabels: string[], countries: string[]): string[] {
  const base = descriptors.length > 0 ? descriptors.join(' ') : 'B2B software';
  const geo = countries.includes('US') ? 'United States' : (countries[0] ?? '');
  const queries = new Set<string>();

  queries.add(`${base} company ${geo}`.trim());
  for (const label of signalLabels.slice(0, 4)) {
    queries.add(`${base} ${label.toLowerCase()} ${geo}`.trim());
  }
  queries.add(`${base} careers security engineer`.trim());
  queries.add(`${base} trust center SOC 2`.trim());

  return [...queries].filter((q) => q.length >= 3).slice(0, 8);
}

function summarize(text: string): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length <= 70 ? oneLine : `${oneLine.slice(0, 67)}...`;
}

function num(s: string): number {
  return Number(s.replace(/,/g, ''));
}
