#!/usr/bin/env node
/**
 * ADR-0001 enforcement: LeadMoor shares no code with MOOR.
 * Fails the build on any import/require that resolves to a MOOR package or path,
 * and on any MOOR-shaped dependency in a package.json.
 *
 * "leadmoor" is this product's own name and is explicitly not a match.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const SKIP_DIRS = new Set(['node_modules', '.git', '.next', 'dist', 'coverage', '.pglite', 'var']);
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/;

// Import specifiers that would couple us to MOOR. `leadmoor` is ours; `@leadmoor/*` is ours.
const IMPORT_RE = /(?:^|[^\w@/-])(?:from\s+|import\s*\(|require\s*\(\s*)['"]([^'"]+)['"]/g;
const MOOR_SPECIFIER = /(^|[/@])moor([/-]|$)|^@moor\b|(^|[^a-z])moor-(core|db|ui|shared|client|sdk)/i;

const violations = [];

function isMoorSpecifier(spec) {
  const s = spec.toLowerCase();
  if (s.includes('leadmoor')) return false; // our own name
  return MOOR_SPECIFIER.test(s);
}

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) { walk(full); continue; }

    const rel = relative(ROOT, full);
    if (rel.split(sep)[0] === 'docs') continue; // prose discusses MOOR by design

    if (entry === 'package.json') {
      const pkg = JSON.parse(readFileSync(full, 'utf8'));
      for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
        for (const dep of Object.keys(pkg[field] ?? {})) {
          if (isMoorSpecifier(dep)) violations.push(`${rel}: ${field} declares MOOR package "${dep}"`);
        }
      }
      continue;
    }

    if (!CODE_EXT.test(entry)) continue;
    const src = readFileSync(full, 'utf8');
    for (const m of src.matchAll(IMPORT_RE)) {
      const spec = m[1];
      if (isMoorSpecifier(spec)) {
        const line = src.slice(0, m.index).split('\n').length;
        violations.push(`${rel}:${line}: imports MOOR module "${spec}"`);
      }
    }
  }
}

walk(ROOT);

if (violations.length > 0) {
  console.error('ADR-0001 violation — LeadMoor must not depend on MOOR:\n');
  for (const v of violations) console.error('  ' + v);
  console.error(`\n${violations.length} violation(s).`);
  process.exit(1);
}
console.log('ADR-0001 OK — no MOOR imports or dependencies found.');
