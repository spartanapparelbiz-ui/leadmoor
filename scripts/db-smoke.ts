import { openDb } from '@leadmoor/db';

const url = process.argv[2];
const h = openDb(url);
await h.migrate();
const r = (await h.db.execute(
  "select table_name from information_schema.tables where table_schema='public' order by table_name",
)) as unknown as { rows?: Array<{ table_name: string }> } | Array<{ table_name: string }>;
const rows = Array.isArray(r) ? r : (r.rows ?? []);
console.log(`${h.driver}: ${rows.length} tables`);
await h.close();
