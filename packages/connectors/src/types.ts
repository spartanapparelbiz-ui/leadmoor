import type {
  ClaimInput,
  DocumentRole,
  EvidenceRecord,
  FetchStatus,
  LeadSpec,
} from '@leadmoor/core';

/** Ports from ARCHITECTURE.md §10. Adding a source is an adapter, never a pipeline change. */

export interface FetchOutcome {
  status: FetchStatus;
  evidence: EvidenceRecord | null;
  httpStatus: number | null;
  /** Populated for every non-ok status so the UI can show a real reason, not an empty result. */
  reason: string | null;
  url: string;
  sourceId: string;
}

export interface Fetcher {
  fetch(args: {
    sourceId: string;
    url: string;
    documentRole: DocumentRole;
    runId: string | null;
    headers?: Record<string, string>;
    /** JSON body for API sources that require POST. */
    json?: unknown;
  }): Promise<FetchOutcome>;
}

/** A discovered company before resolution. Carries only what a source actually observed. */
export interface CandidateCompany {
  name: string;
  domain: string | null;
  country: string | null;
  sourceId: string;
  /** Identifiers the source vouched for: cik, lei, github_org, domain. */
  identifiers: Array<{ kind: string; value: string; strength: 'strong' | 'medium' | 'weak' }>;
  /** Evidence backing the company's existence and identity. */
  evidenceIds: string[];
  /** Claims the source can support directly, already carrying spans. */
  claims: Omit<ClaimInput, 'subjectId' | 'runId'>[];
  discoveryQuery: string | null;
}

export type ConnectorAvailability =
  | { available: true }
  | { available: false; reason: 'not_configured'; envVar: string; message: string }
  | { available: false; reason: 'unreachable'; host: string; message: string };

export interface DiscoveryConnector {
  readonly id: string;
  readonly sourceId: string;
  /** Reports honestly whether this connector can run right now. Never guesses. */
  availability(): Promise<ConnectorAvailability>;
  discover(args: {
    spec: LeadSpec;
    runId: string;
    limit: number;
    onCandidate: (c: CandidateCompany) => Promise<void>;
  }): Promise<DiscoveryReport>;
}

export interface DiscoveryReport {
  connectorId: string;
  attempted: number;
  found: number;
  status: 'completed' | 'partial' | 'failed' | 'not_configured' | 'unreachable';
  message: string | null;
  /** Real fetch failures, surfaced rather than swallowed. */
  failures: Array<{ url: string; status: FetchStatus; reason: string | null }>;
}

export interface EvidenceConnector {
  readonly id: string;
  readonly sourceId: string;
  availability(): Promise<ConnectorAvailability>;
  collect(args: {
    runId: string;
    companyId: string;
    domain: string | null;
    companyName: string;
    maxDocuments: number;
  }): Promise<{ evidence: EvidenceRecord[]; failures: FetchOutcome[] }>;
}

/** A person observed in a document, with the span proving the name and the span proving the role. */
export interface PersonObservation {
  fullName: string;
  role: string | null;
  profileUrl: string | null;
  githubLogin: string | null;
  nameEvidence: { evidenceId: string; quote: string };
  roleEvidence: { evidenceId: string; quote: string } | null;
  sourceId: string;
  confidence: number;
}

export interface EmailResolution {
  status: 'verified' | 'unverified' | 'unavailable';
  email: string | null;
  sourceId: string | null;
  /** The evidence that contains this literal address. Required for any non-unavailable status. */
  evidenceId: string | null;
  quote: string | null;
  reason: string;
}

export interface EmailEnrichmentProvider {
  readonly id: string;
  availability(): Promise<ConnectorAvailability>;
  resolve(args: {
    runId: string;
    personId: string;
    fullName: string;
    companyDomain: string | null;
    companyId?: string;
  }): Promise<EmailResolution>;
}
