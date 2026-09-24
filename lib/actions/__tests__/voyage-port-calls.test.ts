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
  ports,
  facilities,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import {
  listVoyagePortCalls,
  createVoyagePortCall,
  updateVoyagePortCall,
  setVoyagePortCallStatus,
  setPortCallLaytimeEnd,
} from "../voyage-port-calls";

const stamp = Date.now();

let orgA: string;
let orgB: string;
let adminToken: string;
let viewerToken: string;
let orgBToken: string;

let voyageA: string;
let voyageB: string;
let portAlex: string;
let portJebelAli: string;
let portNoTz: string;
let portOrgB: string;
let facilityA: string;
let facilityOrgB: string;

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

beforeAll(async () => {
  const [a] = await db
    .insert(organizations)
    .values({ name: "PC Test A", slug: `pc-a-${stamp}` })
    .returning();
  const [b] = await db
    .insert(organizations)
    .values({ name: "PC Test B", slug: `pc-b-${stamp}` })
    .returning();
  orgA = a.id;
  orgB = b.id;

  adminToken = await makeUserWithSession(`admin-${stamp}@pca.test`, orgA, "admin");
  viewerToken = await makeUserWithSession(`viewer-${stamp}@pca.test`, orgA, "viewer");
  orgBToken = await makeUserWithSession(`admin-${stamp}@pcb.test`, orgB, "admin");

  // Two ports in different zones, to prove the snapshot is per port call.
  const [p1] = await db
    .insert(ports)
    .values({
      organizationId: orgA,
      name: `Alexandria ${stamp}`,
      country: "EG",
      defaultTimezone: "Africa/Cairo",
    })
    .returning({ id: ports.id });
  portAlex = p1.id;

  const [p2] = await db
    .insert(ports)
    .values({
      organizationId: orgA,
      name: `Jebel Ali ${stamp}`,
      country: "AE",
      defaultTimezone: "Asia/Dubai",
    })
    .returning({ id: ports.id });
  portJebelAli = p2.id;

  // A port whose timezone is blank, to exercise the "UTC" fallback (F28).
  const [p3] = await db
    .insert(ports)
    .values({
      organizationId: orgA,
      name: `No Timezone ${stamp}`,
      country: "XX",
      defaultTimezone: "   ",
    })
    .returning({ id: ports.id });
  portNoTz = p3.id;

  const [p4] = await db
    .insert(ports)
    .values({
      organizationId: orgB,
      name: `Other Org Port ${stamp}`,
      country: "TR",
      defaultTimezone: "Europe/Istanbul",
    })
    .returning({ id: ports.id });
  portOrgB = p4.id;

  const [f1] = await db
    .insert(facilities)
    .values({ organizationId: orgA, portId: portAlex, name: `Berth 1 ${stamp}` })
    .returning({ id: facilities.id });
  facilityA = f1.id;

  const [f2] = await db
    .insert(facilities)
    .values({ organizationId: orgB, portId: portOrgB, name: `Berth B ${stamp}` })
    .returning({ id: facilities.id });
  facilityOrgB = f2.id;

  const [v1] = await db
    .insert(voyages)
    .values({
      organizationId: orgA,
      voyageReference: `PCV-${stamp}`,
      vesselName: "Port Call Vessel",
    })
    .returning({ id: voyages.id });
  voyageA = v1.id;

  const [v2] = await db
    .insert(voyages)
    .values({
      organizationId: orgB,
      voyageReference: `PCVB-${stamp}`,
      vesselName: "Other Org Vessel",
    })
    .returning({ id: voyages.id });
  voyageB = v2.id;
});

afterAll(async () => {
  await db.delete(organizations).where(eq(organizations.id, orgA));
  await db.delete(organizations).where(eq(organizations.id, orgB));
});

describe("effectiveTimezone snapshot (F28)", () => {
  it("1. snapshots the port's own timezone at creation", async () => {
    currentToken = adminToken;
    const r = await createVoyagePortCall(voyageA, {
      portId: portAlex,
      function: "LOAD",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.effectiveTimezone).toBe("Africa/Cairo");
  });

  it("2. two port calls on one voyage can carry different zones", async () => {
    currentToken = adminToken;
    const r = await createVoyagePortCall(voyageA, {
      portId: portJebelAli,
      function: "DISCHARGE",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.effectiveTimezone).toBe("Asia/Dubai");
  });

  it("3. falls back to UTC when the port carries no timezone", async () => {
    currentToken = adminToken;
    const r = await createVoyagePortCall(voyageA, {
      portId: portNoTz,
      function: "LOAD",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.effectiveTimezone).toBe("UTC");
  });

  it("4. the snapshot does NOT move when the port's timezone is later corrected", async () => {
    currentToken = adminToken;
    const created = await createVoyagePortCall(voyageA, {
      portId: portAlex,
      function: "LOAD",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // An administrator corrects the port afterwards.
    await db
      .update(ports)
      .set({ defaultTimezone: "Europe/Athens" })
      .where(eq(ports.id, portAlex));

    const [row] = await db
      .select({ tz: voyagePortCalls.effectiveTimezone })
      .from(voyagePortCalls)
      .where(eq(voyagePortCalls.id, created.data.id));
    expect(row.tz).toBe("Africa/Cairo");

    // Restore so later tests see the original value.
    await db
      .update(ports)
      .set({ defaultTimezone: "Africa/Cairo" })
      .where(eq(ports.id, portAlex));
  });
});

describe("sequence (PO10)", () => {
  it("5. the first port call on a fresh voyage starts at 1", async () => {
    currentToken = adminToken;
    const [fresh] = await db
      .insert(voyages)
      .values({
        organizationId: orgA,
        voyageReference: `SEQ-${stamp}`,
        vesselName: "Sequence Vessel",
      })
      .returning({ id: voyages.id });

    const r = await createVoyagePortCall(fresh.id, {
      portId: portAlex,
      function: "LOAD",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.sequence).toBe(1);
  });

  it("6. appends incrementally without being told a number", async () => {
    currentToken = adminToken;
    const [fresh] = await db
      .insert(voyages)
      .values({
        organizationId: orgA,
        voyageReference: `SEQ2-${stamp}`,
        vesselName: "Sequence Vessel 2",
      })
      .returning({ id: voyages.id });

    const first = await createVoyagePortCall(fresh.id, {
      portId: portAlex,
      function: "LOAD",
    });
    const second = await createVoyagePortCall(fresh.id, {
      portId: portJebelAli,
      function: "DISCHARGE",
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.data.sequence).toBe(first.data.sequence + 1);
  });

  it("7. an explicit sequence is honoured, and gaps are allowed", async () => {
    currentToken = adminToken;
    const [fresh] = await db
      .insert(voyages)
      .values({
        organizationId: orgA,
        voyageReference: `SEQ3-${stamp}`,
        vesselName: "Sequence Vessel 3",
      })
      .returning({ id: voyages.id });

    const r = await createVoyagePortCall(fresh.id, {
      portId: portAlex,
      function: "LOAD",
      sequence: 5,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.sequence).toBe(5);

    // Appending after a gap continues from the highest value, not from 2.
    const next = await createVoyagePortCall(fresh.id, {
      portId: portJebelAli,
      function: "DISCHARGE",
    });
    expect(next.ok).toBe(true);
    if (next.ok) expect(next.data.sequence).toBe(6);
  });

  it("8. a duplicate sequence within one voyage is rejected", async () => {
    currentToken = adminToken;
    const [fresh] = await db
      .insert(voyages)
      .values({
        organizationId: orgA,
        voyageReference: `SEQ4-${stamp}`,
        vesselName: "Sequence Vessel 4",
      })
      .returning({ id: voyages.id });

    const first = await createVoyagePortCall(fresh.id, {
      portId: portAlex,
      function: "LOAD",
      sequence: 1,
    });
    expect(first.ok).toBe(true);

    const clash = await createVoyagePortCall(fresh.id, {
      portId: portJebelAli,
      function: "DISCHARGE",
      sequence: 1,
    });
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.code).toBe("CONFLICT");
  });

  it("9. the same sequence number is fine on a DIFFERENT voyage", async () => {
    currentToken = adminToken;
    const [other] = await db
      .insert(voyages)
      .values({
        organizationId: orgA,
        voyageReference: `SEQ5-${stamp}`,
        vesselName: "Sequence Vessel 5",
      })
      .returning({ id: voyages.id });

    const r = await createVoyagePortCall(other.id, {
      portId: portAlex,
      function: "LOAD",
      sequence: 1,
    });
    expect(r.ok).toBe(true);
  });

  it("10. rejects a sequence below 1 or non-integer", async () => {
    currentToken = adminToken;
    const zero = await createVoyagePortCall(voyageA, {
      portId: portAlex,
      function: "LOAD",
      sequence: 0,
    });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.code).toBe("VALIDATION_ERROR");

    const fraction = await createVoyagePortCall(voyageA, {
      portId: portAlex,
      function: "LOAD",
      sequence: 1.5,
    });
    expect(fraction.ok).toBe(false);
    if (!fraction.ok) expect(fraction.code).toBe("VALIDATION_ERROR");
  });
});

describe("tenant isolation", () => {
  it("11. listing another org's voyage returns NOT_FOUND", async () => {
    currentToken = orgBToken;
    const r = await listVoyagePortCalls(voyageA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("12. creating against another org's voyage returns NOT_FOUND", async () => {
    currentToken = orgBToken;
    const r = await createVoyagePortCall(voyageA, {
      portId: portOrgB,
      function: "LOAD",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("13. a port from another org is rejected", async () => {
    currentToken = adminToken;
    const r = await createVoyagePortCall(voyageA, {
      portId: portOrgB,
      function: "LOAD",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("14. a facility from another org is rejected", async () => {
    currentToken = adminToken;
    const r = await createVoyagePortCall(voyageA, {
      portId: portAlex,
      facilityId: facilityOrgB,
      function: "LOAD",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("15. a facility from the same org is accepted", async () => {
    currentToken = adminToken;
    const r = await createVoyagePortCall(voyageA, {
      portId: portAlex,
      facilityId: facilityA,
      function: "LOAD",
    });
    expect(r.ok).toBe(true);
  });
});

describe("listVoyagePortCalls", () => {
  it("16. returns this voyage's calls in sequence order", async () => {
    currentToken = adminToken;
    const r = await listVoyagePortCalls(voyageA);
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const sequences = r.data.map((x) => x.sequence);
    expect(sequences).toEqual([...sequences].sort((a, b) => a - b));
    expect(r.data.every((x) => x.voyageId === voyageA)).toBe(true);
  });

  it("17. contractLaytimeTermId is null until explicitly resolved (PO11)", async () => {
    currentToken = adminToken;
    const r = await listVoyagePortCalls(voyageA);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.every((x) => x.contractLaytimeTermId === null)).toBe(true);
    }
  });
});

describe("updateVoyagePortCall", () => {
  it("18. updates port and function in place", async () => {
    currentToken = adminToken;
    const created = await createVoyagePortCall(voyageA, {
      portId: portAlex,
      function: "LOAD",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const r = await updateVoyagePortCall(created.data.id, {
      portId: portJebelAli,
      function: "DISCHARGE",
    });
    expect(r.ok).toBe(true);

    const [row] = await db
      .select({
        portId: voyagePortCalls.portId,
        function: voyagePortCalls.function,
      })
      .from(voyagePortCalls)
      .where(eq(voyagePortCalls.id, created.data.id));
    expect(row.portId).toBe(portJebelAli);
    expect(row.function).toBe("DISCHARGE");
  });

  it("19. changing the port does NOT recompute the timezone snapshot", async () => {
    currentToken = adminToken;
    const created = await createVoyagePortCall(voyageA, {
      portId: portAlex,
      function: "LOAD",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.data.effectiveTimezone).toBe("Africa/Cairo");

    await updateVoyagePortCall(created.data.id, {
      portId: portJebelAli,
      function: "LOAD",
    });

    const [row] = await db
      .select({ tz: voyagePortCalls.effectiveTimezone })
      .from(voyagePortCalls)
      .where(eq(voyagePortCalls.id, created.data.id));
    expect(row.tz).toBe("Africa/Cairo");
  });

  it("20. cross-tenant update returns NOT_FOUND", async () => {
    currentToken = adminToken;
    const created = await createVoyagePortCall(voyageA, {
      portId: portAlex,
      function: "LOAD",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    currentToken = orgBToken;
    const r = await updateVoyagePortCall(created.data.id, {
      portId: portOrgB,
      function: "LOAD",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });
});

describe("setVoyagePortCallStatus", () => {
  it("21. moves through all three states; same-status is a no-op", async () => {
    currentToken = adminToken;
    const created = await createVoyagePortCall(voyageA, {
      portId: portAlex,
      function: "LOAD",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const id = created.data.id;

    const completed = await setVoyagePortCallStatus(id, "COMPLETED");
    expect(completed.ok).toBe(true);
    if (completed.ok) expect(completed.data.changed).toBe(true);

    const again = await setVoyagePortCallStatus(id, "COMPLETED");
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.data.changed).toBe(false);

    const cancelled = await setVoyagePortCallStatus(id, "CANCELLED");
    expect(cancelled.ok).toBe(true);
    if (cancelled.ok) expect(cancelled.data.changed).toBe(true);
  });

  it("22. cross-tenant setStatus returns NOT_FOUND", async () => {
    currentToken = adminToken;
    const created = await createVoyagePortCall(voyageA, {
      portId: portAlex,
      function: "LOAD",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    currentToken = orgBToken;
    const r = await setVoyagePortCallStatus(created.data.id, "CANCELLED");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });
});

describe("cascade and authorization", () => {
  it("23. deleting a voyage removes its port calls", async () => {
    currentToken = adminToken;
    const [doomed] = await db
      .insert(voyages)
      .values({
        organizationId: orgA,
        voyageReference: `DOOM-${stamp}`,
        vesselName: "Doomed Vessel",
      })
      .returning({ id: voyages.id });

    const created = await createVoyagePortCall(doomed.id, {
      portId: portAlex,
      function: "LOAD",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await db.delete(voyages).where(eq(voyages.id, doomed.id));

    const remaining = await db
      .select({ id: voyagePortCalls.id })
      .from(voyagePortCalls)
      .where(eq(voyagePortCalls.id, created.data.id));
    expect(remaining.length).toBe(0);
  });

  it("24. a user without masterdata.write is rejected with FORBIDDEN", async () => {
    currentToken = viewerToken;
    const r = await createVoyagePortCall(voyageA, {
      portId: portAlex,
      function: "LOAD",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FORBIDDEN");
  });
});

describe("setPortCallLaytimeEnd (per-vessel laytime end)", () => {
  async function newCall(): Promise<string> {
    currentToken = adminToken;
    const r = await createVoyagePortCall(voyageA, { portId: portAlex, function: "LOAD" });
    if (!r.ok) throw new Error(r.message);
    return r.data.id;
  }

  it("25. sets, lists and clears the override", async () => {
    const id = await newCall();
    const r = await setPortCallLaytimeEnd(id, "DOCUMENTS_ON_BOARD");
    expect(r.ok && r.data.laytimeEndOverride).toBe("DOCUMENTS_ON_BOARD");
    const list = await listVoyagePortCalls(voyageA);
    expect(list.ok && list.data.find((c) => c.id === id)?.laytimeEndOverride).toBe("DOCUMENTS_ON_BOARD");
    const cleared = await setPortCallLaytimeEnd(id, null);
    expect(cleared.ok && cleared.data.laytimeEndOverride).toBeNull();
  });

  it("26. rejects an unknown end event", async () => {
    const id = await newCall();
    const r = await setPortCallLaytimeEnd(id, "SAILED");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("VALIDATION_ERROR");
  });

  it("27. a viewer cannot change it; another org gets NOT_FOUND", async () => {
    const id = await newCall();
    currentToken = viewerToken;
    const v = await setPortCallLaytimeEnd(id, "LASHING_COMPLETED");
    expect(!v.ok && v.code).toBe("FORBIDDEN");
    currentToken = orgBToken;
    const x = await setPortCallLaytimeEnd(id, "LASHING_COMPLETED");
    expect(!x.ok && x.code).toBe("NOT_FOUND");
  });
});
