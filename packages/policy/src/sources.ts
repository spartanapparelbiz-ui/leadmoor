import { defineSource, type SourceManifest } from './manifest.js';

/**
 * The M0 source registry.
 *
 * Tier B (open registries) and Tier C (official search APIs + logged-out first-party fetch) only,
 * per ARCHITECTURE.md §7 and the M0 scope decision in §15. There is no Tier A connector, and
 * there is no Tier D connector — `defineSource` throws on one, so this file cannot declare it.
 */

/* ── Tier B: open registries and government data ──────────────────────── */

export const SEC_EDGAR: SourceManifest = defineSource({
  id: 'sec_edgar',
  name: 'SEC EDGAR',
  tier: 'B',
  accessMode: 'official_api',
  legalBasis: 'US federal public record; EDGAR is published for public use under SEC access terms',
  jurisdiction: ['US'],
  hosts: ['efts.sec.gov', 'data.sec.gov', 'www.sec.gov'],
  permittedFieldClasses: [
    'company_identity',
    'company_firmographic',
    'company_signal',
    'person_identity',
    'person_role',
  ],
  robots: 'not_applicable',
  // SEC asks for no more than 10 requests/second and a descriptive User-Agent with contact info.
  rateLimit: { requests: 8, perMs: 1000, minIntervalMs: 130 },
  retentionDays: 1095,
  redistribution: { export: true, exportableFieldClasses: [], attribution: 'Source: SEC EDGAR' },
  requiresCredential: null,
  trustTier: 9,
  documentation: 'https://www.sec.gov/os/accessing-edgar-data',
});

export const GLEIF: SourceManifest = defineSource({
  id: 'gleif',
  name: 'GLEIF LEI records',
  tier: 'B',
  accessMode: 'official_api',
  legalBasis: 'Published under CC0 1.0 by the Global Legal Entity Identifier Foundation',
  jurisdiction: ['US', 'GB', 'EU'],
  hosts: ['api.gleif.org'],
  permittedFieldClasses: ['company_identity', 'company_firmographic'],
  robots: 'not_applicable',
  rateLimit: { requests: 30, perMs: 60_000, minIntervalMs: 250 },
  retentionDays: 1095,
  redistribution: { export: true, exportableFieldClasses: [], attribution: 'Source: GLEIF (CC0)' },
  requiresCredential: null,
  trustTier: 9,
  documentation: 'https://www.gleif.org/en/lei-data/gleif-api',
});

/* ── Tier C: official search APIs and logged-out first-party fetch ─────── */

export const BRAVE_SEARCH: SourceManifest = defineSource({
  id: 'brave_search',
  name: 'Brave Search API',
  tier: 'C',
  accessMode: 'official_api',
  legalBasis: 'Commercial search API used under its published terms',
  jurisdiction: ['US'],
  hosts: ['api.search.brave.com'],
  // A search index tells us where to look; it is not itself evidence of a company fact.
  permittedFieldClasses: ['company_identity'],
  robots: 'not_applicable',
  rateLimit: { requests: 20, perMs: 60_000, minIntervalMs: 1100 },
  retentionDays: 365,
  redistribution: { export: false, exportableFieldClasses: [], attribution: 'Search: Brave' },
  requiresCredential: 'BRAVE_SEARCH_API_KEY',
  trustTier: 4,
  documentation: 'https://api-dashboard.search.brave.com/app/documentation',
});

export const EXA_SEARCH: SourceManifest = defineSource({
  id: 'exa_search',
  name: 'Exa Search API',
  tier: 'C',
  accessMode: 'official_api',
  legalBasis: 'Commercial search API used under its published terms',
  jurisdiction: ['US'],
  hosts: ['api.exa.ai'],
  permittedFieldClasses: ['company_identity'],
  robots: 'not_applicable',
  rateLimit: { requests: 20, perMs: 60_000, minIntervalMs: 1100 },
  retentionDays: 365,
  redistribution: { export: false, exportableFieldClasses: [], attribution: 'Search: Exa' },
  requiresCredential: 'EXA_API_KEY',
  trustTier: 4,
  documentation: 'https://docs.exa.ai',
});

export const GITHUB_PUBLIC: SourceManifest = defineSource({
  id: 'github_public',
  name: 'GitHub public REST API',
  tier: 'C',
  accessMode: 'official_api',
  legalBasis: 'Official public API, used logged-out or with an ordinary token, within published rate limits',
  jurisdiction: ['US'],
  hosts: ['api.github.com'],
  permittedFieldClasses: [
    'company_identity',
    // An organization's self-declared location and public repo counts are firmographic facts the
    // API supplies directly, so the post-extract gate must permit that class for this source.
    'company_firmographic',
    'company_technographic',
    'company_signal',
    'person_identity',
    'person_role',
    'person_professional_profile',
  ],
  robots: 'not_applicable',
  rateLimit: { requests: 30, perMs: 60_000, minIntervalMs: 400 },
  retentionDays: 365,
  redistribution: { export: true, exportableFieldClasses: [], attribution: 'Source: GitHub public API' },
  requiresCredential: null,
  trustTier: 6,
  documentation: 'https://docs.github.com/en/rest',
});

export const COMPANY_WEB: SourceManifest = defineSource({
  id: 'company_web',
  name: 'Company website (logged-out first-party fetch)',
  tier: 'C',
  accessMode: 'public_http_get',
  legalBasis:
    'Logged-out retrieval of a public page, respecting robots.txt and rate limits, with no ' +
    'authentication, paywall, or anti-bot circumvention',
  jurisdiction: ['US'],
  hosts: [],
  hostScope: 'run_scoped',
  permittedFieldClasses: [
    'company_identity',
    'company_firmographic',
    'company_technographic',
    'company_signal',
    'person_identity',
    'person_role',
    'person_work_email',
  ],
  robots: 'must_respect',
  rateLimit: { requests: 60, perMs: 60_000, minIntervalMs: 700 },
  retentionDays: 365,
  redistribution: { export: true, exportableFieldClasses: [], attribution: null },
  requiresCredential: null,
  trustTier: 5,
  documentation: null,
});

export const M0_SOURCES: readonly SourceManifest[] = [
  SEC_EDGAR,
  GLEIF,
  GITHUB_PUBLIC,
  COMPANY_WEB,
  BRAVE_SEARCH,
  EXA_SEARCH,
];
