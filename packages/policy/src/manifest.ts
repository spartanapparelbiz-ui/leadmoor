import { z } from 'zod';
import { PolicyViolationError } from '@leadmoor/core';
import {
  accessModeSchema,
  assertNotTierD,
  assertPermittedAccessMode,
  fieldClassSchema,
  permittedTierSchema,
  type AccessMode,
  type FieldClass,
  type PermittedTier,
} from '@leadmoor/core';

/**
 * SourceManifest — ARCHITECTURE.md §2.3. Every connector declares its legal posture here, and
 * the policy engine evaluates that declaration at three gates rather than trusting the connector.
 */
export const rateLimitSchema = z.object({
  requests: z.number().int().min(1),
  perMs: z.number().int().min(1),
  /** Minimum spacing between requests, applied on top of the bucket. */
  minIntervalMs: z.number().int().min(0).default(0),
});
export type RateLimit = z.infer<typeof rateLimitSchema>;

export const sourceManifestSchema = z.object({
  id: z.string().regex(/^[a-z0-9_.]+$/),
  name: z.string().min(1),
  tier: permittedTierSchema,
  accessMode: accessModeSchema,
  /** Plain-language basis this source is permitted under. Recorded on every claim it produces. */
  legalBasis: z.string().min(1),
  jurisdiction: z.array(z.string()).min(1),
  /** Hosts this source may contact. The fetcher refuses any URL outside this list. */
  hosts: z.array(z.string().min(1)),
  /**
   * How `hosts` is interpreted.
   *
   * `declared`   — the static list above is the whole allowlist (API sources).
   * `run_scoped` — the allowlist is the set of company domains this run legitimately discovered.
   *                First-party website fetching needs arbitrary hosts, but "arbitrary" must not
   *                mean "any host on the internet": a run may only fetch the site of a company it
   *                actually found through a registry or search result, never a URL from elsewhere.
   */
  hostScope: z.enum(['declared', 'run_scoped']).default('declared'),
  permittedFieldClasses: z.array(fieldClassSchema).min(1),
  robots: z.enum(['must_respect', 'not_applicable']),
  rateLimit: rateLimitSchema,
  retentionDays: z.number().int().min(1),
  redistribution: z.object({
    /** Whether rows sourced here may leave the system in an export at all. */
    export: z.boolean(),
    /** Field classes that may be exported. Empty means "all permitted classes". */
    exportableFieldClasses: z.array(fieldClassSchema).default([]),
    attribution: z.string().nullable().default(null),
  }),
  /** Env var holding this source's credential, when it needs one. */
  requiresCredential: z.string().nullable().default(null),
  /** Survivorship weight — open registries outrank scraped pages. */
  trustTier: z.number().int().min(1).max(10),
  documentation: z.string().url().nullable().default(null),
});
export type SourceManifest = z.infer<typeof sourceManifestSchema>;

/**
 * The only way to construct a manifest.
 *
 * Runs the Tier D and access-mode guards, so a source describing an excluded practice throws at
 * module load rather than failing somewhere in the pipeline. There is no bypass: the registry
 * accepts nothing that did not come through here.
 */
export function defineSource(input: unknown): SourceManifest {
  // The tier and access-mode guards run *before* schema parsing. Zod would otherwise reject a
  // Tier D manifest with a generic enum error, losing the explanation of why it is refused.
  const raw = (input ?? {}) as { id?: unknown; tier?: unknown; accessMode?: unknown };
  const label = typeof raw.id === 'string' ? `source "${raw.id}"` : 'source manifest';
  assertNotTierD(raw.tier, label);
  assertPermittedAccessMode(raw.accessMode, label);

  const shape = sourceManifestSchema.safeParse(input);
  if (!shape.success) {
    const where = shape.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid source manifest: ${where}`);
  }
  const manifest = shape.data;

  // Data minimization is not negotiable per-source.
  if (manifest.permittedFieldClasses.includes('personal_direct_contact')) {
    throw new PolicyViolationError(
      `Invalid source manifest for "${manifest.id}": personal_direct_contact is prohibited product-wide and cannot be permitted by a source.`,
    );
  }
  return manifest;
}

export type { PermittedTier, AccessMode, FieldClass };
