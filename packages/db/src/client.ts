import { sql } from 'drizzle-orm';
import { drizzle as drizzlePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';
import { DDL } from './ddl.js';
import { schema } from './schema.js';

export type Db = NodePgDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  driver: 'postgres' | 'pglite';
  /** Applies the DDL. Idempotent — safe to call on every boot. */
  migrate(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Split DDL into statements. The text contains no dollar-quoted bodies or semicolons inside
 * literals, so a simple split is correct here and avoids pulling in a SQL parser.
 */
function statements(source: string): string[] {
  return source
    .split(/;\s*$/m)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter((s) => s.length > 0);
}

/**
 * Open a database.
 *
 * `DATABASE_URL` chooses the driver:
 *   postgres://… | postgresql://…  → node-postgres (production and local Postgres)
 *   unset | pglite://<path> | pglite://memory → embedded PGlite (zero-config dev, and tests)
 *
 * Both run real PostgreSQL, so the schema and queries are identical either way.
 */
export function openDb(url = process.env.DATABASE_URL): DbHandle {
  const target = url?.trim() ?? '';

  if (target.startsWith('postgres://') || target.startsWith('postgresql://')) {
    const pool = new pg.Pool({ connectionString: target, max: 8 });
    const db = drizzlePg(pool, { schema }) as Db;
    return {
      db,
      driver: 'postgres',
      async migrate() {
        for (const stmt of statements(DDL)) await db.execute(sql.raw(stmt));
      },
      async close() {
        await pool.end();
      },
    };
  }

  const dataDir = target.startsWith('pglite://') ? target.slice('pglite://'.length) : '';
  const client = new PGlite(dataDir && dataDir !== 'memory' ? dataDir : undefined);
  const db = drizzlePglite(client, { schema }) as unknown as Db;
  return {
    db,
    driver: 'pglite',
    async migrate() {
      for (const stmt of statements(DDL)) await db.execute(sql.raw(stmt));
    },
    async close() {
      await client.close();
    },
  };
}

/** Table names declared in schema.ts — used by the DDL drift test. */
export function declaredTableNames(): string[] {
  return Object.values(schema).map((t) => {
    const sym = Object.getOwnPropertySymbols(t).find((s) => String(s).includes('Name'));
    return sym ? String((t as unknown as Record<symbol, unknown>)[sym]) : '';
  });
}

export { DDL as ddlSource, statements as ddlStatements };
