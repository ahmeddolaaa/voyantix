import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

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
  organizations,
  users,
  memberships,
  voyages,
  voyagePortCalls,
  operationalEvents,
  operationalEventTypes,
  shiftPerformances,
  ports,
  cargoes,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import * as eventActions from "../operational-events";
import * as shiftActions from "../shift-performances";
import { createVoyagePortCall } from "../voyage-port-calls";

const stamp = Date.now();

let orgA: string;
let orgB: string;
let adminToken: string;
let viewerToken: string;
let orgBToken: string;

let portAlex: string;
let typeBerthed: string;
let typeCustom: string;
let typeOrgB: string;
let cargoA: string;
let cargoOrgB: string;
let voyageA: string;
let portCallOrgB: string;

const T = (hhmm: string) => `2026-03-15T${hhmm}:00.000Z`;

async function makeUserWithSession(
  email: string,
  organizationId: string,
  role: "admin" | "viewer"
): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({
      email,
      passwordHash: await hashPassword("correct-horse-battery"),
      name: email,
    })
    .returning();
  await db.insert(memberships).values({ userId: u.id, organizationId, role });
  return createSession(u.id, organizationId);
}

async function freshPortCall(): Promise<string> {
  const r = await createVoyagePortCall(voyageA, {
    portId: portAlex,
    function: "LOAD",
  });
  if (!r.ok) throw new Error("port call setup failed: " + r.message);
  return r.data.id;
}

beforeAll(async () => {
  const [a] = await db
    .insert(organizations)
    .values({ name: "OE Test A", slug: `oe-a-${stamp}` })
    .returning();
  const [b] = await db
    .insert(organizations)
    .values({ name: "OE Test B", slug: `oe-b-${stamp}` })
    .returning();
  orgA = a.id;
  orgB = b.id;

  adminToken = await makeUserWithSession(`admin-${stamp}@oea.test`, orgA, "admin");
  viewerToken = await makeUserWithSession(`viewer-${stamp}@oea.test`, orgA, "viewer");
  orgBToken = await makeUserWithSession(`admin-${stamp}@oeb.test`, orgB, "admin");

  const [p] = await db
    .insert(ports)
    .values({
      organizationId: orgA,
      name: `Alexandria ${stamp}`,
      country: "EG",
      defaultTimezone: "Africa/Cairo",
    })
    .returning({ id: ports.id });
  portAlex = p.id;

  // A protected type carrying an engine semantic, and a custom one carrying
  // none — the F8 distinction.
  const [t1] = await db
    .insert(operationalEventTypes)
    .values({
      organizationId: orgA,
      code: `BERTHED-${stamp}`,
      label: "Berthed",
      systemSemantic: "BERTHED",
      isProtected: true,
    })
    .returning({ id: operationalEventTypes.id });
  typeBerthed = t1.id;

  const [t2] = await db
    .insert(operationalEventTypes)
    .values({
      organizationId: orgA,
      code: `PILOT-${stamp}`,
      label: "Pilot on board",
    })
    .returning({ id: operationalEventTypes.id });
  typeCustom = t2.id;

  const [t3] = await db
    .insert(operationalEventTypes)
    .values({
      organizationId: orgB,
      code: `OTHER-${stamp}`,
      label: "Other org type",
    })
    .returning({ id: operationalEventTypes.id });
  typeOrgB = t3.id;

  const [c1] = await db
    .insert(cargoes)
    .values({ organizationId: orgA, name: `Billets ${stamp}` })
    .returning({ id: cargoes.id });
  cargoA = c1.id;

  const [c2] = await db
    .insert(cargoes)
    .values({ organizationId: orgB, name: `Other Cargo ${stamp}` })
    .returning({ id: cargoes.id });
  cargoOrgB = c2.id;

  const [v] = await db
    .insert(voyages)
    .values({
      organizationId: orgA,
      voyageReference: `OEV-${stamp}`,
      vesselName: "Event Vessel",
    })
    .returning({ id: voyages.id });
  voyageA = v.id;

  const [pB] = await db
    .insert(ports)
    .values({
      organizationId: orgB,
      name: `Other Port ${stamp}`,
      country: "TR",
      defaultTimezone: "Europe/Istanbul",
    })
    .returning({ id: ports.id });
  const [vB] = await db
    .insert(voyages)
    .values({
      organizationId: orgB,
      voyageReference: `OEVB-${stamp}`,
      vesselName: "Other Vessel",
    })
    .returning({ id: voyages.id });
  const [pcB] = await db
    .insert(voyagePortCalls)
    .values({
      organizationId: orgB,
      voyageId: vB.id,
      portId: pB.id,
      function: "LOAD",
      sequence: 1,
      effectiveTimezone: "Europe/Istanbul",
    })
    .returning({ id: voyagePortCalls.id });
  portCallOrgB = pcB.id;
});

afterAll(async () => {
  await db.delete(organizations).where(eq(organizations.id, orgA));
  await db.delete(organizations).where(eq(organizations.id, orgB));
});

describe("OperationalEvent — recording", () => {
  it("1. records an event with separate occurredAt and recordedAt", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();
    const r = await eventActions.recordOperationalEvent(pc, {
      eventTypeId: typeBerthed,
      occurredAt: T("03:00"),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const [row] = await db
      .select({
        occurredAt: operationalEvents.occurredAt,
        recordedAt: operationalEvents.recordedAt,
        supersededByEventId: operationalEvents.supersededByEventId,
      })
      .from(operationalEvents)
      .where(eq(operationalEvents.id, r.data.id));

    expect(row.occurredAt.toISOString()).toBe(T("03:00"));
    // recordedAt is "now", deliberately not the same thing.
    expect(row.recordedAt.getTime()).toBeGreaterThan(row.occurredAt.getTime());
    expect(row.supersededByEventId).toBeNull();
  });

  it("2. there is no update or delete action — append-only", () => {
    const names = Object.keys(eventActions);
    expect(names).not.toContain("updateOperationalEvent");
    expect(names).not.toContain("deleteOperationalEvent");
    expect(names).toContain("recordOperationalEvent");
    expect(names).toContain("correctOperationalEvent");
  });

  it("3. an invalid occurredAt is rejected", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();
    const r = await eventActions.recordOperationalEvent(pc, {
      eventTypeId: typeBerthed,
      occurredAt: "yesterday-ish",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("VALIDATION_ERROR");
  });
});

describe("OperationalEvent — correction preserves history", () => {
  it("4. the original row survives a correction, unchanged", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();

    const original = await eventActions.recordOperationalEvent(pc, {
      eventTypeId: typeBerthed,
      occurredAt: T("03:00"),
    });
    expect(original.ok).toBe(true);
    if (!original.ok) return;

    const correction = await eventActions.correctOperationalEvent(
      original.data.id,
      { eventTypeId: typeBerthed, occurredAt: T("04:30") }
    );
    expect(correction.ok).toBe(true);
    if (!correction.ok) return;

    const [old] = await db
      .select({
        occurredAt: operationalEvents.occurredAt,
        eventTypeId: operationalEvents.eventTypeId,
        supersededByEventId: operationalEvents.supersededByEventId,
      })
      .from(operationalEvents)
      .where(eq(operationalEvents.id, original.data.id));

    // Its own facts are untouched; only the pointer was added.
    expect(old.occurredAt.toISOString()).toBe(T("03:00"));
    expect(old.eventTypeId).toBe(typeBerthed);
    expect(old.supersededByEventId).toBe(correction.data.id);

    const [fresh] = await db
      .select({ occurredAt: operationalEvents.occurredAt })
      .from(operationalEvents)
      .where(eq(operationalEvents.id, correction.data.id));
    expect(fresh.occurredAt.toISOString()).toBe(T("04:30"));
  });

  it("5. a correction can change the event type as well as the time", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();

    const original = await eventActions.recordOperationalEvent(pc, {
      eventTypeId: typeCustom,
      occurredAt: T("03:00"),
    });
    expect(original.ok).toBe(true);
    if (!original.ok) return;

    const correction = await eventActions.correctOperationalEvent(
      original.data.id,
      { eventTypeId: typeBerthed, occurredAt: T("03:00") }
    );
    expect(correction.ok).toBe(true);
    if (!correction.ok) return;

    const [fresh] = await db
      .select({ eventTypeId: operationalEvents.eventTypeId })
      .from(operationalEvents)
      .where(eq(operationalEvents.id, correction.data.id));
    expect(fresh.eventTypeId).toBe(typeBerthed);
  });

  it("6. an already-corrected event cannot be corrected again", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();

    const original = await eventActions.recordOperationalEvent(pc, {
      eventTypeId: typeBerthed,
      occurredAt: T("03:00"),
    });
    expect(original.ok).toBe(true);
    if (!original.ok) return;

    const first = await eventActions.correctOperationalEvent(original.data.id, {
      eventTypeId: typeBerthed,
      occurredAt: T("04:00"),
    });
    expect(first.ok).toBe(true);

    const second = await eventActions.correctOperationalEvent(original.data.id, {
      eventTypeId: typeBerthed,
      occurredAt: T("05:00"),
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("INVALID_STATE");
  });

  it("7. the replacement itself can be corrected — a chain, not a tree", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();

    const v1 = await eventActions.recordOperationalEvent(pc, {
      eventTypeId: typeBerthed,
      occurredAt: T("03:00"),
    });
    expect(v1.ok).toBe(true);
    if (!v1.ok) return;

    const v2 = await eventActions.correctOperationalEvent(v1.data.id, {
      eventTypeId: typeBerthed,
      occurredAt: T("04:00"),
    });
    expect(v2.ok).toBe(true);
    if (!v2.ok) return;

    const v3 = await eventActions.correctOperationalEvent(v2.data.id, {
      eventTypeId: typeBerthed,
      occurredAt: T("05:00"),
    });
    expect(v3.ok).toBe(true);
  });

  it("8. correction is auditable", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();

    const original = await eventActions.recordOperationalEvent(pc, {
      eventTypeId: typeBerthed,
      occurredAt: T("03:00"),
    });
    expect(original.ok).toBe(true);
    if (!original.ok) return;

    await eventActions.correctOperationalEvent(original.data.id, {
      eventTypeId: typeBerthed,
      occurredAt: T("04:00"),
    });

    const { auditLog } = await import("@/db/schema");
    const entries = await db
      .select({ action: auditLog.action, entityId: auditLog.entityId })
      .from(auditLog)
      .where(eq(auditLog.entityId, original.data.id));

    expect(entries.some((e) => e.action === "supersede")).toBe(true);
  });

  it("9. currentOnly hides superseded events; the default shows them", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();

    const original = await eventActions.recordOperationalEvent(pc, {
      eventTypeId: typeBerthed,
      occurredAt: T("03:00"),
    });
    expect(original.ok).toBe(true);
    if (!original.ok) return;

    await eventActions.correctOperationalEvent(original.data.id, {
      eventTypeId: typeBerthed,
      occurredAt: T("04:00"),
    });

    const all = await eventActions.listOperationalEvents(pc);
    expect(all.ok).toBe(true);
    if (all.ok) expect(all.data.length).toBe(2);

    const current = await eventActions.listOperationalEvents(pc, {
      currentOnly: true,
    });
    expect(current.ok).toBe(true);
    if (current.ok) {
      expect(current.data.length).toBe(1);
      expect(current.data[0].occurredAt.toISOString()).toBe(T("04:00"));
    }
  });
});

describe("OperationalEvent — semantics stay with the type (F8)", () => {
  it("10. the event row carries no semantic of its own", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();
    const r = await eventActions.recordOperationalEvent(pc, {
      eventTypeId: typeCustom,
      occurredAt: T("03:00"),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const [row] = await db
      .select()
      .from(operationalEvents)
      .where(eq(operationalEvents.id, r.data.id));

    // Whether this event means anything to the engine is a property of its
    // TYPE, resolved in Phase 6 — never a column copied onto the event.
    expect(Object.keys(row)).not.toContain("systemSemantic");

    const [type] = await db
      .select({ systemSemantic: operationalEventTypes.systemSemantic })
      .from(operationalEventTypes)
      .where(eq(operationalEventTypes.id, typeCustom));
    expect(type.systemSemantic).toBeNull();
  });
});

describe("OperationalEvent — tenant isolation", () => {
  it("11. a port call from another org returns NOT_FOUND", async () => {
    currentToken = adminToken;
    const r = await eventActions.recordOperationalEvent(portCallOrgB, {
      eventTypeId: typeBerthed,
      occurredAt: T("03:00"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("12. an event type from another org is refused", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();
    const r = await eventActions.recordOperationalEvent(pc, {
      eventTypeId: typeOrgB,
      occurredAt: T("03:00"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("13. a viewer cannot record an event", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();

    currentToken = viewerToken;
    const r = await eventActions.recordOperationalEvent(pc, {
      eventTypeId: typeBerthed,
      occurredAt: T("03:00"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FORBIDDEN");
  });
});

describe("ShiftPerformance", () => {
  it("14. records throughput for a shift", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();
    const r = await shiftActions.createShiftPerformance(pc, {
      cargoId: cargoA,
      shiftDate: "2026-03-15",
      crane: "Crane 2",
      operationType: "Discharge",
      quantityMt: "1850.5",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const [row] = await db
      .select({
        quantityMt: shiftPerformances.quantityMt,
        shiftDate: shiftPerformances.shiftDate,
        crane: shiftPerformances.crane,
      })
      .from(shiftPerformances)
      .where(eq(shiftPerformances.id, r.data.id));
    expect(row.quantityMt).toBe("1850.5");
    expect(row.shiftDate).toBe("2026-03-15");
    expect(row.crane).toBe("Crane 2");
  });

  it("15. F24 — nothing here carries countability", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();
    const r = await shiftActions.createShiftPerformance(pc, {
      cargoId: cargoA,
      shiftDate: "2026-03-15",
      quantityMt: "100",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const [row] = await db
      .select()
      .from(shiftPerformances)
      .where(eq(shiftPerformances.id, r.data.id));

    const forbidden = [
      "countable",
      "counts",
      "countability",
      "exclusionReason",
      "commencement",
      "laytimeState",
      "systemSemantic",
    ];
    for (const key of Object.keys(row)) {
      expect(forbidden).not.toContain(key);
    }
  });

  it("16. several shifts on one day are allowed — no unique constraint", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();

    const a = await shiftActions.createShiftPerformance(pc, {
      cargoId: cargoA,
      shiftDate: "2026-03-15",
      crane: "Crane 1",
      quantityMt: "500",
    });
    const b = await shiftActions.createShiftPerformance(pc, {
      cargoId: cargoA,
      shiftDate: "2026-03-15",
      crane: "Crane 2",
      quantityMt: "600",
    });
    expect(a.ok && b.ok).toBe(true);
  });

  it("17. rejects a bad quantity or date", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();

    const badQty = await shiftActions.createShiftPerformance(pc, {
      cargoId: cargoA,
      shiftDate: "2026-03-15",
      quantityMt: "a lot",
    });
    expect(badQty.ok).toBe(false);
    if (!badQty.ok) expect(badQty.code).toBe("VALIDATION_ERROR");

    const badDate = await shiftActions.createShiftPerformance(pc, {
      cargoId: cargoA,
      shiftDate: "15/03/2026",
      quantityMt: "100",
    });
    expect(badDate.ok).toBe(false);
    if (!badDate.ok) expect(badDate.code).toBe("VALIDATION_ERROR");
  });

  it("18. a cargo from another org is refused", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();
    const r = await shiftActions.createShiftPerformance(pc, {
      cargoId: cargoOrgB,
      shiftDate: "2026-03-15",
      quantityMt: "100",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("19. updates and deletes follow the usual conventions", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();
    const created = await shiftActions.createShiftPerformance(pc, {
      cargoId: cargoA,
      shiftDate: "2026-03-15",
      quantityMt: "100",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const updated = await shiftActions.updateShiftPerformance(created.data.id, {
      cargoId: cargoA,
      shiftDate: "2026-03-16",
      quantityMt: "250",
    });
    expect(updated.ok).toBe(true);

    const [row] = await db
      .select({ quantityMt: shiftPerformances.quantityMt })
      .from(shiftPerformances)
      .where(eq(shiftPerformances.id, created.data.id));
    expect(row.quantityMt).toBe("250");

    const deleted = await shiftActions.deleteShiftPerformance(created.data.id);
    expect(deleted.ok).toBe(true);
  });

  it("20. cross-tenant list returns NOT_FOUND, and a viewer cannot write", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();

    currentToken = orgBToken;
    const list = await shiftActions.listShiftPerformances(pc);
    expect(list.ok).toBe(false);
    if (!list.ok) expect(list.code).toBe("NOT_FOUND");

    currentToken = viewerToken;
    const write = await shiftActions.createShiftPerformance(pc, {
      cargoId: cargoA,
      shiftDate: "2026-03-15",
      quantityMt: "100",
    });
    expect(write.ok).toBe(false);
    if (!write.ok) expect(write.code).toBe("FORBIDDEN");
  });
});
