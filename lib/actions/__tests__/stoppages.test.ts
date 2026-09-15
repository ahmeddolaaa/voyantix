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
  stoppages,
  ports,
  stoppageReasons,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import {
  listStoppages,
  createStoppage,
  updateStoppage,
  deleteStoppage,
} from "../stoppages";
import { createVoyagePortCall } from "../voyage-port-calls";

const stamp = Date.now();

let orgA: string;
let orgB: string;
let adminToken: string;
let viewerToken: string;
let orgBToken: string;

let portAlex: string;
let reasonRain: string;
let reasonOrgB: string;
let voyageA: string;
let portCallOrgB: string;

// A day of fixed instants, so no test depends on "now".
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

/** A fresh port call, so each test starts with no stoppages of its own. */
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
    .values({ name: "ST Test A", slug: `st-a-${stamp}` })
    .returning();
  const [b] = await db
    .insert(organizations)
    .values({ name: "ST Test B", slug: `st-b-${stamp}` })
    .returning();
  orgA = a.id;
  orgB = b.id;

  adminToken = await makeUserWithSession(`admin-${stamp}@sta.test`, orgA, "admin");
  viewerToken = await makeUserWithSession(`viewer-${stamp}@sta.test`, orgA, "viewer");
  orgBToken = await makeUserWithSession(`admin-${stamp}@stb.test`, orgB, "admin");

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

  const [r1] = await db
    .insert(stoppageReasons)
    .values({ organizationId: orgA, name: `Rain ${stamp}` })
    .returning({ id: stoppageReasons.id });
  reasonRain = r1.id;

  const [r2] = await db
    .insert(stoppageReasons)
    .values({ organizationId: orgB, name: `Other Reason ${stamp}` })
    .returning({ id: stoppageReasons.id });
  reasonOrgB = r2.id;

  const [v] = await db
    .insert(voyages)
    .values({
      organizationId: orgA,
      voyageReference: `STV-${stamp}`,
      vesselName: "Stoppage Vessel",
    })
    .returning({ id: voyages.id });
  voyageA = v.id;

  // Org B needs its own port call for the cross-tenant tests.
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
      voyageReference: `STVB-${stamp}`,
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

describe("interval validation", () => {
  it("1. endTime before startTime is rejected", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();
    const r = await createStoppage(pc, {
      reasonId: reasonRain,
      startTime: T("10:00"),
      endTime: T("09:00"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("VALIDATION_ERROR");
  });

  it("2. PO13 — a zero-length stoppage is rejected", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();
    const r = await createStoppage(pc, {
      reasonId: reasonRain,
      startTime: T("10:00"),
      endTime: T("10:00"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("VALIDATION_ERROR");
  });

  it("3. the database CHECK rejects a zero-length row too", async () => {
    // Proves the rule is not merely application-level.
    await expect(
      db.insert(stoppages).values({
        organizationId: orgA,
        portCallId: await freshPortCall().catch(() => ""),
        reasonId: reasonRain,
        startTime: new Date(T("10:00")),
        endTime: new Date(T("10:00")),
        recordedByUserId: (
          await db.select({ id: users.id }).from(users).limit(1)
        )[0].id,
      })
    ).rejects.toThrow();
  });

  it("4. an invalid date string is rejected", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();
    const r = await createStoppage(pc, {
      reasonId: reasonRain,
      startTime: "not a date",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("VALIDATION_ERROR");
  });
});

describe("overlap semantics — [start, end)", () => {
  it("5. ADJACENT intervals are allowed (10-11 then 11-12)", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();

    const first = await createStoppage(pc, {
      reasonId: reasonRain,
      startTime: T("10:00"),
      endTime: T("11:00"),
    });
    expect(first.ok).toBe(true);

    const second = await createStoppage(pc, {
      reasonId: reasonRain,
      startTime: T("11:00"),
      endTime: T("12:00"),
    });
    expect(second.ok).toBe(true);
  });

  it("6. a genuine overlap is rejected", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();

    await createStoppage(pc, {
      reasonId: reasonRain,
      startTime: T("10:00"),
      endTime: T("12:00"),
    });

    const clash = await createStoppage(pc, {
      reasonId: reasonRain,
      startTime: T("11:00"),
      endTime: T("13:00"),
    });
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.code).toBe("CONFLICT");
  });

  it("7. an interval fully inside another is rejected", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();

    await createStoppage(pc, {
      reasonId: reasonRain,
      startTime: T("10:00"),
      endTime: T("14:00"),
    });

    const inside = await createStoppage(pc, {
      reasonId: reasonRain,
      startTime: T("11:00"),
      endTime: T("12:00"),
    });
    expect(inside.ok).toBe(false);
    if (!inside.ok) expect(inside.code).toBe("CONFLICT");
  });

  it("8. stoppages on DIFFERENT port calls never conflict", async () => {
    currentToken = adminToken;
    const pcOne = await freshPortCall();
    const pcTwo = await freshPortCall();

    const a = await createStoppage(pcOne, {
      reasonId: reasonRain,
      startTime: T("10:00"),
      endTime: T("12:00"),
    });
    const b = await createStoppage(pcTwo, {
      reasonId: reasonRain,
      startTime: T("10:00"),
      endTime: T("12:00"),
    });
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
  });
});

describe("open stoppages", () => {
  it("9. an open stoppage is accepted", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();
    const r = await createStoppage(pc, {
      reasonId: reasonRain,
      startTime: T("14:00"),
    });
    expect(r.ok).toBe(true);
  });

  it("10. a SECOND open stoppage on the same port call is rejected", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();

    const first = await createStoppage(pc, {
      reasonId: reasonRain,
      startTime: T("14:00"),
    });
    expect(first.ok).toBe(true);

    const second = await createStoppage(pc, {
      reasonId: reasonRain,
      startTime: T("20:00"),
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("CONFLICT");
  });

  it("11. an open stoppage blocks any LATER interval", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();

    await createStoppage(pc, { reasonId: reasonRain, startTime: T("14:00") });

    const later = await createStoppage(pc, {
      reasonId: reasonRain,
      startTime: T("15:00"),
      endTime: T("16:00"),
    });
    expect(later.ok).toBe(false);
    if (!later.ok) expect(later.code).toBe("CONFLICT");
  });

  it("12. an EARLIER interval before an open stoppage is still allowed", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();

    await createStoppage(pc, { reasonId: reasonRain, startTime: T("14:00") });

    const earlier = await createStoppage(pc, {
      reasonId: reasonRain,
      startTime: T("09:00"),
      endTime: T("10:00"),
    });
    expect(earlier.ok).toBe(true);
  });

  it("13. closing an open stoppage frees the port call for another", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();

    const open = await createStoppage(pc, {
      reasonId: reasonRain,
      startTime: T("14:00"),
    });
    expect(open.ok).toBe(true);
    if (!open.ok) return;

    const closed = await updateStoppage(open.data.id, {
      reasonId: reasonRain,
      startTime: T("14:00"),
      endTime: T("15:00"),
    });
    expect(closed.ok).toBe(true);

    const next = await createStoppage(pc, {
      reasonId: reasonRain,
      startTime: T("16:00"),
    });
    expect(next.ok).toBe(true);
  });
});

describe("the EXCLUDE constraint is the real authority", () => {
  it("14. concurrent overlapping inserts — only one survives", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();

    // Fired together, so both pre-checks can read an empty table before
    // either writes. Only the database constraint can separate them.
    const results = await Promise.allSettled([
      createStoppage(pc, {
        reasonId: reasonRain,
        startTime: T("10:00"),
        endTime: T("12:00"),
      }),
      createStoppage(pc, {
        reasonId: reasonRain,
        startTime: T("11:00"),
        endTime: T("13:00"),
      }),
    ]);

    const succeeded = results.filter(
      (r) => r.status === "fulfilled" && r.value.ok
    ).length;
    expect(succeeded).toBe(1);

    const rows = await db
      .select({ id: stoppages.id })
      .from(stoppages)
      .where(eq(stoppages.portCallId, pc));
    expect(rows.length).toBe(1);
  });

  it("15. a raw overlapping insert is refused by the database", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();
    const [u] = await db.select({ id: users.id }).from(users).limit(1);

    await db.insert(stoppages).values({
      organizationId: orgA,
      portCallId: pc,
      reasonId: reasonRain,
      startTime: new Date(T("10:00")),
      endTime: new Date(T("12:00")),
      recordedByUserId: u.id,
    });

    // Bypasses every application check.
    await expect(
      db.insert(stoppages).values({
        organizationId: orgA,
        portCallId: pc,
        reasonId: reasonRain,
        startTime: new Date(T("11:00")),
        endTime: new Date(T("13:00")),
        recordedByUserId: u.id,
      })
    ).rejects.toThrow();
  });
});

describe("update", () => {
  it("16. an update cannot create an overlap", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();

    await createStoppage(pc, {
      reasonId: reasonRain,
      startTime: T("10:00"),
      endTime: T("11:00"),
    });
    const second = await createStoppage(pc, {
      reasonId: reasonRain,
      startTime: T("12:00"),
      endTime: T("13:00"),
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;

    const clash = await updateStoppage(second.data.id, {
      reasonId: reasonRain,
      startTime: T("10:30"),
      endTime: T("13:00"),
    });
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.code).toBe("CONFLICT");
  });

  it("17. a stoppage does not conflict with itself when updated", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();

    const created = await createStoppage(pc, {
      reasonId: reasonRain,
      startTime: T("10:00"),
      endTime: T("11:00"),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const r = await updateStoppage(created.data.id, {
      reasonId: reasonRain,
      startTime: T("10:00"),
      endTime: T("11:30"),
      notes: "extended",
    });
    expect(r.ok).toBe(true);
  });
});

describe("tenant isolation and authorization", () => {
  it("18. a port call from another org returns NOT_FOUND", async () => {
    currentToken = adminToken;
    const r = await createStoppage(portCallOrgB, {
      reasonId: reasonRain,
      startTime: T("10:00"),
      endTime: T("11:00"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("19. a reason from another org is refused", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();
    const r = await createStoppage(pc, {
      reasonId: reasonOrgB,
      startTime: T("10:00"),
      endTime: T("11:00"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("20. cross-tenant list returns NOT_FOUND", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();

    currentToken = orgBToken;
    const r = await listStoppages(pc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("21. a viewer cannot record a stoppage", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();

    currentToken = viewerToken;
    const r = await createStoppage(pc, {
      reasonId: reasonRain,
      startTime: T("10:00"),
      endTime: T("11:00"),
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FORBIDDEN");
  });
});

describe("list and delete", () => {
  it("22. lists a port call's stoppages in start order", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();

    await createStoppage(pc, {
      reasonId: reasonRain,
      startTime: T("14:00"),
      endTime: T("15:00"),
    });
    await createStoppage(pc, {
      reasonId: reasonRain,
      startTime: T("10:00"),
      endTime: T("11:00"),
    });

    const r = await listStoppages(pc);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const times = r.data.map((s) => s.startTime.getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it("23. deletes a stoppage", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();
    const created = await createStoppage(pc, {
      reasonId: reasonRain,
      startTime: T("10:00"),
      endTime: T("11:00"),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const r = await deleteStoppage(created.data.id);
    expect(r.ok).toBe(true);

    const remaining = await db
      .select({ id: stoppages.id })
      .from(stoppages)
      .where(eq(stoppages.id, created.data.id));
    expect(remaining.length).toBe(0);
  });

  it("24. deleting a port call removes its stoppages", async () => {
    currentToken = adminToken;
    const pc = await freshPortCall();
    const created = await createStoppage(pc, {
      reasonId: reasonRain,
      startTime: T("10:00"),
      endTime: T("11:00"),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await db.delete(voyagePortCalls).where(eq(voyagePortCalls.id, pc));

    const remaining = await db
      .select({ id: stoppages.id })
      .from(stoppages)
      .where(eq(stoppages.id, created.data.id));
    expect(remaining.length).toBe(0);
  });
});
