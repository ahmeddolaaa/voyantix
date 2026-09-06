import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import path from "path";
import * as schema from "./schema";

const dbPath = path.join(process.cwd(), "voyantix.db");

export const sqlite = createClient({ url: `file:${dbPath}` });

export const db = drizzle(sqlite, { schema });
