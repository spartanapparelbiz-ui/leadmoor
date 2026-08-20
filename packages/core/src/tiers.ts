import { z } from 'zod';
import { PolicyViolationError } from './errors.js';

/**
 * Source tiers, per ARCHITECTURE.md §7.
 *
 * Tier D exists in the architecture as a *named exclusion*. It is deliberately absent from
 * this union, so a Tier D connector is not merely disabled — it cannot be constructed. There
 * is no value of `PermittedTier` that denotes it, and `assertNotTierD` rejects any attempt to
 * smuggle one in through untyped data (config files, JSON, a database row).
 */
export const PERMITTED_TIERS = ['A', 'B', 'C'] as const;
export type PermittedTier = (typeof PERMITTED_TIERS)[number];
export const permittedTierSchema = z.enum(PERMITTED_TIERS);

/** The excluded tier, named only so it can be recognised and refused. */
export const EXCLUDED_TIER = 'D' as const;

/**
 * Access modes. Every member of this union is permitted by construction — there is no
 * `authenticated_scrape`, `headless_browser`, `captcha_solve`, or `credential_replay` mode,
 * so the fetcher has no branch that could perform one.
 */
export const ACCESS_MODES = ['official_api', 'public_http_get'] as const;
export type AccessMode = (typeof ACCESS_MODES)[number];
export const accessModeSchema = z.enum(ACCESS_MODES);

/**
 * Practices that define Tier D. Used to reject configuration that describes one, and to
 * document in code exactly what the product refuses to do.
 */
export const TIER_D_PRACTICES = [
  'logged_in_scraping',
  'authentication_bypass',
  'paywall_bypass',
  'robots_bypass',
  'captcha_solving',
  'anti_bot_evasion',
  'rate_limit_evasion',
  'consumer_data_broker',
  'unknown_provenance_dataset',
  'personal_direct_contact_harvesting',
] as const;
export type TierDPractice = (typeof TIER_D_PRACTICES)[number];

/**
 * Field classes. `personal_direct_contact` (mobile numbers, home addresses) is declared so the
 * post-extract gate can refuse it globally — it is never in any manifest's permitted set.
 */
export const FIELD_CLASSES = [
  'company_identity',
  'company_firmographic',
  'company_technographic',
  'company_signal',
  'person_identity',
  'person_role',
  'person_professional_profile',
  'person_work_email',
  'personal_direct_contact',
] as const;
export type FieldClass = (typeof FIELD_CLASSES)[number];
export const fieldClassSchema = z.enum(FIELD_CLASSES);

/**
 * Data minimization, per ARCHITECTURE.md §8: business-context fields only. These classes are
 * refused at the post-extract gate regardless of what a manifest claims to permit.
 */
export const GLOBALLY_PROHIBITED_FIELD_CLASSES: readonly FieldClass[] = ['personal_direct_contact'];

/**
 * Refuse a tier value that came from untyped data. Throws on 'D' and on anything not permitted.
 * This is the single choke point between external configuration and the connector registry.
 */
export function assertNotTierD(tier: unknown, context: string): asserts tier is PermittedTier {
  if (typeof tier === 'string' && tier.toUpperCase() === EXCLUDED_TIER) {
    throw new PolicyViolationError(
      `Tier D source refused (${context}). Tier D is excluded by policy and has no execution path.`,
      { tier, context },
    );
  }
  if (!PERMITTED_TIERS.includes(tier as PermittedTier)) {
    throw new PolicyViolationError(
      `Unknown source tier "${String(tier)}" refused (${context}). Permitted tiers: ${PERMITTED_TIERS.join(', ')}.`,
      { tier, context },
    );
  }
}

/** Refuse an access mode that describes a Tier D practice or is otherwise unrecognised. */
export function assertPermittedAccessMode(mode: unknown, context: string): asserts mode is AccessMode {
  if (typeof mode === 'string' && (TIER_D_PRACTICES as readonly string[]).includes(mode)) {
    throw new PolicyViolationError(
      `Access mode "${mode}" describes a Tier D practice and is refused (${context}).`,
      { mode, context },
    );
  }
  if (!ACCESS_MODES.includes(mode as AccessMode)) {
    throw new PolicyViolationError(
      `Unknown access mode "${String(mode)}" refused (${context}). Permitted: ${ACCESS_MODES.join(', ')}.`,
      { mode, context },
    );
  }
}
