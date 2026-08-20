import { assertNotTierD } from '@leadmoor/core';
import type { SourceManifest } from './manifest.js';
import { M0_SOURCES } from './sources.js';

/**
 * SourceRegistry — the only way the pipeline learns a source exists.
 *
 * Registration re-runs the Tier D guard, so even a manifest constructed outside `defineSource`
 * (deserialized config, a test helper, a future plugin loader) cannot enter the system.
 */
export class SourceRegistry {
  private readonly map = new Map<string, SourceManifest>();

  constructor(manifests: readonly SourceManifest[] = M0_SOURCES) {
    for (const m of manifests) this.register(m);
  }

  register(manifest: SourceManifest): void {
    assertNotTierD(manifest.tier, `registry registration of "${manifest.id}"`);
    if (this.map.has(manifest.id)) throw new Error(`duplicate source id "${manifest.id}"`);
    this.map.set(manifest.id, manifest);
  }

  get(id: string): SourceManifest | undefined {
    return this.map.get(id);
  }

  require(id: string): SourceManifest {
    const m = this.map.get(id);
    if (!m) throw new Error(`unknown source "${id}"`);
    return m;
  }

  has(id: string): boolean {
    return this.map.has(id);
  }

  all(): SourceManifest[] {
    return [...this.map.values()];
  }

  /** Sources usable without any credential — what works out of the box. */
  credentialFree(): SourceManifest[] {
    return this.all().filter((m) => m.requiresCredential === null);
  }

  /** Which configured credentials are missing from the environment. */
  missingCredentials(env: NodeJS.ProcessEnv = process.env): Array<{ source: string; envVar: string }> {
    return this.all()
      .filter((m) => m.requiresCredential !== null && !env[m.requiresCredential])
      .map((m) => ({ source: m.id, envVar: m.requiresCredential as string }));
  }

  asMap(): ReadonlyMap<string, SourceManifest> {
    return this.map;
  }
}
