import { describe, it, expect, beforeAll } from "vitest";
import { db } from "@/db/client";
import {
  organizations, users, voyages, laytimeStatements,
} from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";

/**
 * DB-LEVEL INTEGRITY — proves the statement lifecycle invariants are enforced
 * by PostgreSQL itself (partial unique indexes + the finalize-stamp CHECK),
 * not only by the action layer. A direct insert that bypasses the actions must
 * still be rejected.
 */

const stamp = Date.now();
let orgA: string;
let userId: string;
let voyageId: string;

beforeAll(async () => {
  const [a] = await db.insert(organizations).values({ name: "SI A", slug: `si-a-${stamp}` }).returning();
  orgA = a.id;
  const [u] = await db.insert(users).values({
    email: `si-${stamp}@x`, passwordHash: await hashPassword("x"), name: "si",
  }).returning();
  userId = u.id;
  const [v] = await db.insert(voyages).values({
    organizationId: orgA, voyageReference: `SIV-${stamp}`, vesselName: "MV Integrity",
  }).returning({ id: voyages.id });
  voyageId = v.id;
});

describe("one active draft per voyage", () => {
  it("rejects a second draft at the database level", async () => {
    await db.insert(laytimeStatements).values({
      organizationId: orgA, voyageId, status: "draft", createdByUserId: userId,
    });
    await expect(
      db.insert(laytimeStatements).values({
        organizationId: orgA, voyageId, status: "draft", createdByUserId: userId,
      })
    ).rejects.toThrow();
  });
});

describe("canonical finalized statement", () => {
  it("rejects a second finalized statement at the database level", async () => {
    const [v] = await db.insert(voyages).values({
      organizationId: orgA, voyageReference: `SIV2-${stamp}`, vesselName: "MV Canon",
    }).returning({ id: voyages.id });
    const now = new Date();
    await db.insert(laytimeStatements).values({
      organizationId: orgA, voyageId: v.id, status: "finalized",
      finalizedAt: now, finalizedByUserId: userId, createdByUserId: userId,
    });
    await expect(
      db.insert(laytimeStatements).values({
        organizationId: orgA, voyageId: v.id, status: "finalized",
        finalizedAt: now, finalizedByUserId: userId, createdByUserId: userId,
      })
    ).rejects.toThrow();
  });
});

describe("finalize stamp check", () => {
  it("rejects a finalized statement with no finalization stamp", async () => {
    const [v] = await db.insert(voyages).values({
      organizationId: orgA, voyageReference: `SIV3-${stamp}`, vesselName: "MV Stamp",
    }).returning({ id: voyages.id });
    await expect(
      db.insert(laytimeStatements).values({
        organizationId: orgA, voyageId: v.id, status: "finalized", createdByUserId: userId,
      })
    ).rejects.toThrow();
  });

  it("rejects a draft carrying a finalization stamp", async () => {
    const [v] = await db.insert(voyages).values({
      organizationId: orgA, voyageReference: `SIV4-${stamp}`, vesselName: "MV Stamp2",
    }).returning({ id: voyages.id });
    await expect(
      db.insert(laytimeStatements).values({
        organizationId: orgA, voyageId: v.id, status: "draft",
        finalizedAt: new Date(), finalizedByUserId: userId, createdByUserId: userId,
      })
    ).rejects.toThrow();
  });
});
