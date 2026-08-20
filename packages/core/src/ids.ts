import { randomUUID, createHash } from 'node:crypto';

export type Id = string;

export const newId = (): Id => randomUUID();

/** Deterministic sha256 hex of a UTF-8 string. Used for content addressing and suppression keys. */
export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** Stable key for suppression: we store the hash, never the raw identifier. */
export function suppressionKey(kind: 'email' | 'domain' | 'person', value: string): string {
  return `${kind}:${sha256(value.trim().toLowerCase())}`;
}
