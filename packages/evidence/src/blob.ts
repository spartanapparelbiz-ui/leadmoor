import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Content-addressed blob store — ARCHITECTURE.md §4.
 *
 * The raw bytes of every fetch are kept under their sha256 so a score can be re-audited against
 * exactly the document that produced it. `FsBlobStore` is the M0 adapter; an S3/R2 adapter
 * implements the same port without touching anything upstream.
 */
export interface BlobStore {
  put(hash: string, body: string): Promise<void>;
  get(hash: string): Promise<string | null>;
  has(hash: string): Promise<boolean>;
}

/** Shard by the first two hex pairs so directories stay small. */
function pathFor(root: string, hash: string): string {
  return join(root, hash.slice(0, 2), hash.slice(2, 4), `${hash}.txt`);
}

export class FsBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  async put(hash: string, body: string): Promise<void> {
    const p = pathFor(this.root, hash);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body, 'utf8');
  }

  async get(hash: string): Promise<string | null> {
    try {
      return await readFile(pathFor(this.root, hash), 'utf8');
    } catch {
      return null;
    }
  }

  async has(hash: string): Promise<boolean> {
    try {
      await access(pathFor(this.root, hash));
      return true;
    } catch {
      return false;
    }
  }
}

/** In-memory adapter for tests. Same semantics, no disk. */
export class MemoryBlobStore implements BlobStore {
  private readonly map = new Map<string, string>();
  async put(hash: string, body: string): Promise<void> {
    this.map.set(hash, body);
  }
  async get(hash: string): Promise<string | null> {
    return this.map.get(hash) ?? null;
  }
  async has(hash: string): Promise<boolean> {
    return this.map.has(hash);
  }
}
