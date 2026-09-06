import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://voyantix:voyantix@127.0.0.1:5432/voyantix_dev";

export const pool = new Pool({ connectionString });
export const db = drizzle(pool, { schema });
