import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://voyantix:voyantix@127.0.0.1:5432/voyantix_dev";

async function main() {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: "./db/migrations" });
  console.log("Migrations applied:", connectionString.split("/").pop());
  await pool.end();
}
main().catch((e) => { console.error(e); process.exit(1); });
