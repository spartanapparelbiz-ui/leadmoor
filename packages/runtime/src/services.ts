import { createLogger, type Logger } from '@leadmoor/core';
import { AuditLog, openDb, type Db, type DbHandle } from '@leadmoor/db';
import { EvidenceStore, FsBlobStore, MemoryBlobStore, ProvenanceValidator, type BlobStore } from '@leadmoor/evidence';
import { ClaimEngine } from '@leadmoor/claims';
import {
  PolicyEngine,
  SourceRegistry,
  createRunHostAllowlist,
  type RunHostAllowlist,
} from '@leadmoor/policy';
import {
  BraveSearchProvider,
  CompanySiteEvidence,
  DEFAULT_USER_AGENT,
  ExaSearchProvider,
  GitHubDiscovery,
  HttpFetcher,
  PublishedEmailProvider,
  SearchProviderRegistry,
  SecEdgarDiscovery,
  UnavailableEmailProvider,
  WebSearchDiscovery,
  type DiscoveryConnector,
  type EmailEnrichmentProvider,
} from '@leadmoor/connectors';
import { EvidenceJudge, createLLMClient, type LLMClient } from '@leadmoor/llm';
import { BudgetGovernor } from './budget.js';

/**
 * Service container.
 *
 * Composition happens once, here, so every call site receives the same policy-gated fetcher and
 * the same validator. There is no way to obtain an ungated HTTP client from application code.
 */

export interface ServiceOptions {
  databaseUrl?: string;
  evidenceDir?: string;
  env?: NodeJS.ProcessEnv;
  logger?: Logger;
  /** Test seam. Defaults to global fetch. */
  transport?: typeof globalThis.fetch;
  /** Test seam for robots.txt. */
  robotsFetcher?: (origin: string) => Promise<string | null>;
  blobStore?: BlobStore;
}

export interface RunServices {
  budget: BudgetGovernor;
  runHosts: RunHostAllowlist;
  policy: PolicyEngine;
  fetcher: HttpFetcher;
  discovery: DiscoveryConnector[];
  siteEvidence: CompanySiteEvidence;
  email: EmailEnrichmentProvider;
  judge: EvidenceJudge | null;
}

export class Services {
  readonly db: Db;
  readonly handle: DbHandle;
  readonly sources: SourceRegistry;
  readonly audit: AuditLog;
  readonly evidence: EvidenceStore;
  readonly validator: ProvenanceValidator;
  readonly claims: ClaimEngine;
  readonly llm: LLMClient;
  readonly logger: Logger;
  readonly blobs: BlobStore;
  private readonly env: NodeJS.ProcessEnv;
  private readonly options: ServiceOptions;

  constructor(options: ServiceOptions = {}) {
    this.options = options;
    this.env = options.env ?? process.env;
    this.logger = options.logger ?? createLogger({ app: 'leadmoor' });

    this.handle = openDb(options.databaseUrl ?? this.env.DATABASE_URL);
    this.db = this.handle.db;

    this.sources = new SourceRegistry();
    this.audit = new AuditLog(this.db);
    this.blobs =
      options.blobStore ??
      (options.evidenceDir || this.env.EVIDENCE_DIR
        ? new FsBlobStore((options.evidenceDir ?? this.env.EVIDENCE_DIR) as string)
        : new MemoryBlobStore());

    this.evidence = new EvidenceStore(this.db, this.blobs);
    this.validator = new ProvenanceValidator(this.evidence, {
      fieldClassPermitted: (sourceId, fieldClass) => {
        // The post-extract gate, wired directly into claim validation.
        const decision = this.policyFor(createRunHostAllowlist()).checkExtract(sourceId, fieldClass);
        return decision.allowed;
      },
    });
    this.claims = new ClaimEngine(this.db, this.validator, this.evidence, this.sources, this.audit);
    this.llm = createLLMClient(this.env);
  }

  async migrate(): Promise<void> {
    await this.handle.migrate();
  }

  async close(): Promise<void> {
    await this.handle.close();
  }

  private policyFor(runHosts: RunHostAllowlist): PolicyEngine {
    return new PolicyEngine(this.sources.asMap(), {
      userAgent: DEFAULT_USER_AGENT,
      runHosts,
      robotsFetcher: this.options.robotsFetcher ?? defaultRobotsFetcher(this.options.transport),
      allowOnRobotsError: false,
    });
  }

  /** Builds the per-run service set, including the budget governor and run-scoped host allowlist. */
  forRun(args: { budget: BudgetGovernor; runHosts?: RunHostAllowlist }): RunServices {
    const runHosts = args.runHosts ?? createRunHostAllowlist();
    const policy = this.policyFor(runHosts);

    const fetcher = new HttpFetcher(this.db, policy, this.evidence, this.audit, {
      logger: this.logger,
      transport: this.options.transport,
      onBeforeFetch: () => !args.budget.isExhausted(),
    });

    const searchRegistry = new SearchProviderRegistry([
      new BraveSearchProvider(fetcher, this.env),
      new ExaSearchProvider(fetcher, this.env),
    ]);

    const siteEvidence = new CompanySiteEvidence(fetcher, this.evidence);

    const email: EmailEnrichmentProvider =
      this.env.EMAIL_ENRICHMENT_PROVIDER === 'none'
        ? new UnavailableEmailProvider()
        : new PublishedEmailProvider(async (runId, companyId) => {
            const all = await this.evidence.listForRun(runId);
            return all.filter((d) => (d.metadata as { companyId?: string }).companyId === companyId);
          });

    return {
      budget: args.budget,
      runHosts,
      policy,
      fetcher,
      discovery: [
        new SecEdgarDiscovery(fetcher),
        new GitHubDiscovery(fetcher, this.env),
        new WebSearchDiscovery(searchRegistry),
      ],
      siteEvidence,
      email,
      judge: this.llm.isConfigured() ? new EvidenceJudge(this.llm, this.validator) : null,
    };
  }

  /** Everything the UI needs to tell the user what is and is not configured. */
  providerStatus(): {
    llm: { configured: boolean; reason: string | null };
    missingCredentials: Array<{ source: string; envVar: string }>;
    credentialFreeSources: string[];
  } {
    return {
      llm: { configured: this.llm.isConfigured(), reason: this.llm.unavailableReason() },
      missingCredentials: this.sources.missingCredentials(this.env),
      credentialFreeSources: this.sources.credentialFree().map((s) => s.id),
    };
  }
}

/** Reads robots.txt with a short timeout. A transport failure returns null, which fails closed. */
function defaultRobotsFetcher(transport?: typeof globalThis.fetch) {
  const doFetch = transport ?? globalThis.fetch;
  return async (origin: string): Promise<string | null> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await doFetch(`${origin}/robots.txt`, {
        signal: controller.signal,
        headers: { 'User-Agent': DEFAULT_USER_AGENT },
        redirect: 'follow',
      });
      // No robots.txt published means no restrictions, which is permission.
      if (response.status === 404 || response.status === 410) return '';
      if (!response.ok) return '';
      return await response.text();
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };
}
