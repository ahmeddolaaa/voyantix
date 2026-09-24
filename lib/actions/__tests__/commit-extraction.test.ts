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
  operationalEvents, operationalEventTypes, stoppageReasons, stoppages,
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

  it("creates a missing stoppage reason from the SOF category, once", async () => {
    const payload = {
      events: [],
      stoppages: [
        { reasonCategory: "PORT_CLOSURE" as const, reasonText: "Port closed by navy", startLocal: "2026-06-25T20:00", endLocal: "2026-06-26T01:00" },
        { reasonCategory: "LABOUR_BREAK" as const, reasonText: "Loading suspended – labours break time", startLocal: "2026-06-26T03:00", endLocal: "2026-06-26T09:10" },
        // inside the port closure → rejected by the no-overlap rule (PO13), reported
        { reasonCategory: "LABOUR_BREAK" as const, reasonText: "Loading suspended – labours break time", startLocal: "2026-06-25T21:55", endLocal: "2026-06-25T23:20" },
      ],
    };
    const r = await commitExtraction(portCallId, payload);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.committedStoppages).toBe(2);
    expect(r.data.createdReasons.sort()).toEqual(["Labour break", "Port closure"]);
    expect(r.data.skipped.length).toBe(1);

    const again = await commitExtraction(portCallId, payload);
    expect(again.ok && again.data.createdReasons).toEqual([]);
    expect(again.ok && again.data.committedStoppages).toBe(0);

    const names = await db.select({ n: stoppageReasons.name }).from(stoppageReasons).where(eq(stoppageReasons.organizationId, orgId));
    expect(names.map((x) => x.n).sort()).toEqual(["Labour break", "Port closure"]);
    const rows = await db.select().from(stoppages).where(eq(stoppages.portCallId, portCallId));
    expect(rows).toHaveLength(2);
  });

  it("records 'vessel arrived' as a record-only event (custom type, no engine semantic)", async () => {
    const r = await commitExtraction(portCallId, {
      events: [{ type: "ARRIVED", occurredLocal: "2026-06-21T21:25" }],
      stoppages: [],
    });
    expect(r.ok && r.data.committedEvents).toBe(1);
    const [t] = await db
      .select({ label: operationalEventTypes.label, sem: operationalEventTypes.systemSemantic, prot: operationalEventTypes.isProtected })
      .from(operationalEventTypes)
      .where(and(eq(operationalEventTypes.organizationId, orgId), eq(operationalEventTypes.code, "arrived")));
    expect(t).toEqual({ label: "Vessel arrived", sem: null, prot: false });
    // A second commit neither duplicates the event nor the type.
    const again = await commitExtraction(portCallId, {
      events: [{ type: "ARRIVED", occurredLocal: "2026-06-21T21:25" }],
      stoppages: [],
    });
    expect(again.ok && again.data.committedEvents).toBe(0);
  });
});
