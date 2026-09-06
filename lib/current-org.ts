import { db } from "@/db/client";
import { organizations } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * NOTE: the schema is fully multi-tenant (every table carries
 * organizationId — see rebuild spec Section 7). Real authentication and
 * organization switching is explicitly out of scope for this pass
 * (spec Section 8 — non-goals). This helper stands in for "the logged-in
 * user's organization" with a single fixed dev organization so every
 * screen and service already threads organizationId through correctly,
 * ready to be wired to real auth later without touching business logic.
 */

const DEFAULT_ORG_NAME = "EZDK Steel";

export async function getDefaultOrganizationId(): Promise<string> {
  const existing = await db
    .select()
    .from(organizations)
    .where(eq(organizations.name, DEFAULT_ORG_NAME));

  if (existing.length > 0) return existing[0].id;

  const id = crypto.randomUUID();
  await db.insert(organizations).values({ id, name: DEFAULT_ORG_NAME });
  return id;
}
