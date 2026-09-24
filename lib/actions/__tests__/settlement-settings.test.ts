import { describe, it, expect, beforeAll, vi } from "vitest";

let currentToken: string | undefined;

vi.mock("@/lib/auth/session", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/session")>(
    "@/lib/auth/session"
  );
  return {
    ...actual,
    requireTenantContext: async () => {
      const ctx = await actual.resolveTenantContext(currentToken);
      if (!ctx) throw new actual.UnauthenticatedError();
      return ctx;
    },
  };
});

import { db } from "@/db/client";
import { organizations, users, memberships, companyConfigurations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { getSettlementSettings, updateSettlementDayPrecision } from "../settlement-settings";

const stamp = Date.now();
let orgA: string;
let orgB: string;
let adminA: string;
let viewerA: string;
let adminB: string;

async function makeUser(email: string, org: string, role: "admin" | "viewer") {
  const [u] = await db
    .insert(users)
    .values({ email, passwordHash: await hashPassword("x"), name: email })
    .returning();
  await db.insert(memberships).values({ userId: u.id, organizationId: org, role });
  return createSession(u.id, org);
}

beforeAll(async () => {
  const [a] = await db.insert(organizations).values({ name: "SS A", slug: `ss-a-${stamp}` }).returning();
  const [b] = await db.insert(organizations).values({ name: "SS B", slug: `ss-b-${stamp}` }).returning();
  orgA = a.id;
  orgB = b.id;
  adminA = await makeUser(`ss-admin-a-${stamp}@x`, orgA, "admin");
  viewerA = await makeUser(`ss-viewer-a-${stamp}@x`, orgA, "viewer");
  adminB = await makeUser(`ss-admin-b-${stamp}@x`, orgB, "admin");
});

describe("settlement settings", () => {
  it("defaults to DECIMALS_5 when the org has no configuration row", async () => {
    currentToken = adminA;
    const r = await getSettlementSettings();
    expect(r.ok && r.data.dayPrecision).toBe("DECIMALS_5");
  });

  it("an admin can switch to EXACT (creates the configuration row)", async () => {
    currentToken = adminA;
    const r = await updateSettlementDayPrecision("EXACT");
    expect(r.ok && r.data.dayPrecision).toBe("EXACT");
    const rows = await db.select().from(companyConfigurations).where(eq(companyConfigurations.organizationId, orgA));
    expect(rows).toHaveLength(1);
    expect(rows[0].settlementDayPrecision).toBe("EXACT");
    const g = await getSettlementSettings();
    expect(g.ok && g.data.dayPrecision).toBe("EXACT");
  });

  it("switching back updates the same row", async () => {
    currentToken = adminA;
    await updateSettlementDayPrecision("DECIMALS_5");
    const rows = await db.select().from(companyConfigurations).where(eq(companyConfigurations.organizationId, orgA));
    expect(rows).toHaveLength(1);
    expect(rows[0].settlementDayPrecision).toBe("DECIMALS_5");
  });

  it("rejects an unknown option", async () => {
    currentToken = adminA;
    const r = await updateSettlementDayPrecision("DECIMALS_3");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("VALIDATION_ERROR");
  });

  it("a viewer cannot change it", async () => {
    currentToken = viewerA;
    const r = await updateSettlementDayPrecision("EXACT");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FORBIDDEN");
  });

  it("is per organization", async () => {
    currentToken = adminA;
    await updateSettlementDayPrecision("EXACT");
    currentToken = adminB;
    const r = await getSettlementSettings();
    expect(r.ok && r.data.dayPrecision).toBe("DECIMALS_5");
  });

  it("the database rejects a value outside the vocabulary", async () => {
    await expect(
      db.update(companyConfigurations)
        .set({ settlementDayPrecision: "WHATEVER" })
        .where(eq(companyConfigurations.organizationId, orgA))
    ).rejects.toThrow();
  });
});
