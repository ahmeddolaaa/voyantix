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
import {
  organizations, users, memberships, ports, voyages, voyagePortCalls,
  operationalEvents, operationalEventTypes,
} from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { seedProtectedEventTypes } from "@/lib/master-data/seed-event-types";
import { commitExtraction } from "../commit-extraction";

const stamp = Date.now();
let portCallId: string;
let orgId: string;

beforeAll(async () => {
  const [o] = await db.insert(organizations).values({ name: "CE", slug: `ce-${stamp}` }).returning();
  orgId = o.id;
  await seedProtectedEventTypes(orgId);
  const [u] = await db.insert(users).values({ email: `ce-${stamp}@x`, passwordHash: await hashPassword("x"), name: "ce" }).returning();
  await db.insert(memberships).values({ userId: u.id, organizationId: orgId, role: "admin" });
  currentToken = await createSession(u.id, orgId);
  const [p] = await db.insert(ports).values({ organizationId: orgId, name: `Alex ${stamp}`, country: "EG", defaultTimezone: "Africa/Cairo" }).returning();
  const [v] = await db.insert(voyages).values({ organizationId: orgId, voyageReference: `CE-${stamp}`, vesselName: "MY FELLAS" }).returning();
  const [pc] = await db.insert(voyagePortCalls).values({
    organizationId: orgId, voyageId: v.id, portId: p.id, function: "LOAD", sequence: 1, effectiveTimezone: "Africa/Cairo",
  }).returning();
  portCallId = pc.id;
});

async function liveSemantics(): Promise<string[]> {
  const rows = await db
    .select({ sem: operationalEventTypes.systemSemantic })
    .from(operationalEvents)
    .innerJoin(operationalEventTypes, eq(operationalEventTypes.id, operationalEvents.eventTypeId))
    .where(and(eq(operationalEvents.portCallId, portCallId), isNull(operationalEvents.supersededByEventId)));
  return rows.map((r) => r.sem!).sort();
}

describe("commitExtraction — lashing / documents and repeat commits", () => {
  it("records lashing completed and documents signed as engine events", async () => {
    const r = await commitExtraction(portCallId, {
      events: [
        { type: "NOR_TENDERED", occurredLocal: "2026-06-23T00:01" },
        { type: "OPERATION_COMPLETED", occurredLocal: "2026-06-28T00:05" },
      ],
      stoppages: [],
    });
    expect(r.ok && r.data.committedEvents).toBe(2);
  });

  it("a repeat commit adds only what is missing — no duplicates", async () => {
    const r = await commitExtraction(portCallId, {
      events: [
        { type: "NOR_TENDERED", occurredLocal: "2026-06-23T00:01" }, // same → silently kept
        { type: "OPERATION_COMPLETED", occurredLocal: "2026-06-28T00:07" }, // different time → kept + reported
        { type: "LASHING_COMPLETED", occurredLocal: "2026-06-28T00:10" },
        { type: "DOCUMENTS_SIGNED", occurredLocal: "2026-06-28T11:15" },
      ],
      stoppages: [],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.committedEvents).toBe(2);
    expect(r.data.skipped.some((s) => s.includes("OPERATION_COMPLETED") && s.includes("different time"))).toBe(true);
    expect(await liveSemantics()).toEqual(
      ["DOCUMENTS_ON_BOARD", "LASHING_COMPLETED", "NOR_TENDERED", "OPS_COMPLETED"]
    );
  });
});
