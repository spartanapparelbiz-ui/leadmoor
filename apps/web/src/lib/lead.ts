/**
 * The lead shape, and the two pure helpers that describe it.
 *
 * Kept out of the loader module so the results table — a client component — can import them
 * without dragging the database and its `server-only` guard into the browser bundle.
 */

export type Confidence = 'high' | 'medium' | 'low';

export interface Reason {
  text: string;
  /** true when a criterion passed; false when it could not be established. */
  met: boolean;
  points: number;
}

export interface Lead {
  id: string;
  runId: string;
  companyId: string;
  personId: string | null;

  company: string;
  website: string | null;
  industry: string | null;
  employees: string | null;
  location: string | null;

  person: string | null;
  role: string | null;

  email: string | null;
  emailStatus: 'verified' | 'unverified' | 'unavailable';

  score: number;
  scoreShown: boolean;
  confidence: Confidence;
  coverage: number;
  status: string;
  heldReason: string | null;

  reasons: Reason[];
  whyShort: string;
  sources: string[];
  evidenceCount: number;
  foundLabel: string;
}

const SOURCE_NAMES: Record<string, string> = {
  company_web: 'Company site',
  github_public: 'GitHub',
  sec_edgar: 'SEC EDGAR',
  gleif: 'GLEIF',
  brave_search: 'Brave',
  exa_search: 'Exa',
};

export function sourceName(id: string): string {
  return SOURCE_NAMES[id] ?? id.replace(/_/g, ' ');
}

/**
 * Confidence, from the evidence rather than from the score.
 *
 * A lead can score highly on very little: a 90 derived from a third of the rubric is not the same
 * claim as a 90 derived from all of it, and two independent sources are not the same as one. This
 * keeps those apart so the table can show both numbers side by side.
 */
export function confidenceOf(coverage: number, sourceCount: number, scored: boolean): Confidence {
  if (!scored) return 'low';
  if (coverage >= 0.8 && sourceCount >= 2) return 'high';
  if (coverage >= 0.55) return 'medium';
  return 'low';
}
