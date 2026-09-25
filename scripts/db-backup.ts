/**
 * Full data backup to a JSON file — every table in the public schema, row
 * for row, plus the migration ledger. Uses the app's own Postgres driver, so
 * it works wherever the app can connect (no pg_dump version to match).
 *
 *   DATABASE_URL=... npx tsx scripts/db-backup.ts [out.json]
 *
 * Read-only: it never writes to the database.
 */

import { writeFileSync } from "fs";
import { pool } from "../db/client";

async function main() {
  const out = process.argv[2] ?? `voyantix-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  const host = new URL(process.env.DATABASE_URL ?? "postgres://unknown").host;

  const tables = await pool.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`
  );

  const dump: Record<string, unknown[]> = {};
  for (const { table_name } of tables.rows) {
    const r = await pool.query(`select * from "public"."${table_name}"`);
    dump[table_name] = r.rows;
  }
  try {
    const m = await pool.query(`select * from drizzle.__drizzle_migrations order by id`);
    dump["drizzle.__drizzle_migrations"] = m.rows;
  } catch {
    // no migration ledger — nothing to add
  }

  writeFileSync(out, JSON.stringify({ takenAt: new Date().toISOString(), host, tables: dump }, null, 1));
  console.log(`Backup of ${host} written to ${out}`);
  for (const [t, rows] of Object.entries(dump)) console.log(`  ${t.padEnd(34)} ${rows.length}`);
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
