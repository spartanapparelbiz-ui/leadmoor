import { normalizeCompanyName, nameTokens, registrableDomain } from './normalize.js';

/**
 * Company entity resolution — ARCHITECTURE.md §6.
 *
 * "Merging two genuinely different companies is worse than leaving a duplicate", so matching is
 * conservative: a strong identifier match merges, a high name+domain similarity merges, and
 * anything in the uncertainty band is left as a separate record flagged for review rather than
 * auto-merged. Every merge is expressed as a reversible link, never a destructive overwrite.
 */

export interface ResolvableEntity {
  id: string;
  name: string;
  domain: string | null;
  country: string | null;
  identifiers: Array<{ kind: string; value: string; strength: 'strong' | 'medium' | 'weak' }>;
}

export interface MatchDecision {
  candidateId: string;
  canonicalId: string;
  score: number;
  method: string;
  decision: 'merge' | 'review' | 'distinct';
}

export const MERGE_THRESHOLD = 0.9;
export const REVIEW_THRESHOLD = 0.72;

/** Blocking keys. Two entities are only compared when they share at least one. */
export function blockingKeys(entity: ResolvableEntity): string[] {
  const keys: string[] = [];
  const domain = registrableDomain(entity.domain);
  if (domain) keys.push(`d:${domain}`);
  for (const id of entity.identifiers) {
    if (id.strength === 'strong') keys.push(`i:${id.kind}:${id.value.toLowerCase()}`);
  }
  for (const token of nameTokens(entity.name)) keys.push(`n:${token}`);
  return keys;
}

/** Similarity in [0,1]. Strong identifiers short-circuit to 1. */
export function similarity(a: ResolvableEntity, b: ResolvableEntity): { score: number; method: string } {
  for (const idA of a.identifiers) {
    if (idA.strength !== 'strong') continue;
    for (const idB of b.identifiers) {
      if (idB.strength === 'strong' && idA.kind === idB.kind && idA.value.toLowerCase() === idB.value.toLowerCase()) {
        return { score: 1, method: `strong_identifier:${idA.kind}` };
      }
    }
  }

  const domainA = registrableDomain(a.domain);
  const domainB = registrableDomain(b.domain);
  if (domainA && domainB) {
    if (domainA === domainB) return { score: 0.97, method: 'registrable_domain' };
    // Different verified domains is positive evidence they are different companies.
    return { score: Math.min(0.5, nameSimilarity(a.name, b.name)), method: 'distinct_domains' };
  }

  const nameScore = nameSimilarity(a.name, b.name);
  if (nameScore >= 0.995 && (domainA ?? domainB)) return { score: 0.93, method: 'exact_name_one_domain' };
  return { score: nameScore * 0.9, method: 'name_only' };
}

/** Token Jaccard with an exact-string bonus. Deterministic and explainable. */
export function nameSimilarity(a: string, b: string): number {
  const normA = normalizeCompanyName(a);
  const normB = normalizeCompanyName(b);
  if (normA.length === 0 || normB.length === 0) return 0;
  if (normA === normB) return 1;

  const setA = new Set(normA.split(' ').filter(Boolean));
  const setB = new Set(normB.split(' ').filter(Boolean));
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Cluster candidates into canonical entities. The first entity in a cluster is canonical; later
 * merges attach to it as links so the decision can be undone.
 */
export function resolve(entities: ResolvableEntity[]): {
  canonical: ResolvableEntity[];
  decisions: MatchDecision[];
} {
  const canonical: ResolvableEntity[] = [];
  const decisions: MatchDecision[] = [];
  const index = new Map<string, number[]>();

  for (const entity of entities) {
    const keys = blockingKeys(entity);
    const seen = new Set<number>();
    for (const key of keys) for (const idx of index.get(key) ?? []) seen.add(idx);

    let best: { idx: number; score: number; method: string } | null = null;
    for (const idx of seen) {
      const other = canonical[idx];
      if (!other) continue;
      const { score, method } = similarity(entity, other);
      if (!best || score > best.score) best = { idx, score, method };
    }

    if (best && best.score >= MERGE_THRESHOLD) {
      const target = canonical[best.idx];
      if (target) {
        decisions.push({
          candidateId: entity.id,
          canonicalId: target.id,
          score: best.score,
          method: best.method,
          decision: 'merge',
        });
        // Merging enriches the survivor's identity without discarding anything.
        if (!target.domain && entity.domain) target.domain = entity.domain;
        if (!target.country && entity.country) target.country = entity.country;
        for (const id of entity.identifiers) {
          if (!target.identifiers.some((x) => x.kind === id.kind && x.value === id.value)) {
            target.identifiers.push(id);
          }
        }
        continue;
      }
    }

    if (best && best.score >= REVIEW_THRESHOLD) {
      const target = canonical[best.idx];
      if (target) {
        // Uncertain: keep both, flag the pair. Never auto-merge inside the band.
        decisions.push({
          candidateId: entity.id,
          canonicalId: target.id,
          score: best.score,
          method: best.method,
          decision: 'review',
        });
      }
    }

    const position = canonical.length;
    canonical.push({ ...entity, identifiers: [...entity.identifiers] });
    for (const key of keys) {
      const list = index.get(key);
      if (list) list.push(position);
      else index.set(key, [position]);
    }
  }

  return { canonical, decisions };
}
