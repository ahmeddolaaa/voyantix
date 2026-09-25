/**
 * Phase 1 bootstrap seed — DEMO/SUPPORT DATA ONLY.
 *
 * This exists so the application can be opened after a fresh install.
 * It is explicitly NOT the mechanism through which a customer operates
 * the product (Phase 2 FINAL §39): from Phase 2 onward, organizations,
 * users and master data are created through the administration UI.
 */

import { db, pool } from "../db/client";
import {
  organizations,
  users,
  memberships,
  companyConfigurations,
} from "../db/schema";
import { hashPassword } from "../lib/auth/password";
import { seedProtectedEventTypes } from "../lib/master-data/seed-event-types";

async function main() {
  const password = process.env.SEED_PASSWORD ?? "voyantix";

  // Only a truly EMPTY database is bootstrapped. Production runs this on every
  // deploy; once any company exists (e.g. the demo seed) it must
  // not add a second company with a well-known login.
  const anyOrg = await db.select({ id: organizations.id }).from(organizations).limit(1);
  if (anyOrg.length > 0) {
    console.log("Database already has an organization — bootstrap skipped.");
    await pool.end();
    return;
  }

  const [org] = await db
    .insert(organizations)
    .values({ name: "Demo Shipping Co.", slug: "demo-shipping" })
    .returning();

  await db.insert(companyConfigurations).values({
    organizationId: org.id,
    defaultTimezone: "UTC",
    voyageReferencePattern: "VOY-{YY}{SEQ:4}",
  });

  const hash = await hashPassword(password);

  const [admin] = await db
    .insert(users)
    .values({
      email: "admin@demo.test",
      passwordHash: hash,
      name: "Demo Administrator",
    })
    .returning();

  const [ops] = await db
    .insert(users)
    .values({
      email: "ops@demo.test",
      passwordHash: hash,
      name: "Demo Operations",
    })
    .returning();

  await db.insert(memberships).values([
    { userId: admin.id, organizationId: org.id, role: "admin" },
    { userId: ops.id, organizationId: org.id, role: "operations" },
  ]);

  const seeded = await seedProtectedEventTypes(org.id);

  console.log("\nBootstrap complete.\n");
  console.log("  Organization : Demo Shipping Co.");
  console.log("  Admin        : admin@demo.test");
  console.log("  Operations   : ops@demo.test");
  console.log(`  Password     : ${password}`);
  console.log(`  Event types  : ${seeded.created} protected semantics seeded`);
  console.log("\nChange these before any real deployment.\n");

  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
