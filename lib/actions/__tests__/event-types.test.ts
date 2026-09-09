import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

// The only part of the auth chain that cannot run under vitest is the
// cookie read inside getTenantContext. We replace requireTenantContext
// (the function authorized() actually imports and calls) with one that
// resolves a real session token through the REAL resolveTenantContext,
// so every other layer - requirePermission, the tenant query, the
// action logic - runs exactly as in production. "Who is signed in" is
// controlled by setting currentToken to a real session id.
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
  operationalEventTypes,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import {
  listEventTypes,
  createEventType,
  updateEventType,
  setEventTypeStatus,
} from "../event-types";

const stamp = Date.now();

let orgA: string;
let orgB: string;
let adminToken: string; // admin in org A
let viewerToken: string; // viewer in org A (masterdata.read only)
let orgBToken: string; // admin in org B

// A protected row and an ordinary row, both in org A, captured in beforeAll.
let protectedId: string;
let ordinaryId: string;

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
  await db
    .insert(memberships)
    .values({ userId: u.id, organizationId, role });
    return createSession(u.id, organizationId);
}

beforeAll(async () => {
  const [a] = await db
    .insert(organizations)
    .values({ name: "ET Test A", slug: `et-a-${stamp}` })
    .returning();
  const [b] = await db
    .insert(organizations)
    .values({ name: "ET Test B", slug: `et-b-${stamp}` })
    .returning();
  orgA = a.id;
  orgB = b.id;

  adminToken = await makeUserWithSession(`admin-${stamp}@a.test`, orgA, "admin");
  viewerToken = await makeUserWithSession(`viewer-${stamp}@a.test`, orgA, "viewer");
  orgBToken = await makeUserWithSession(`admin-${stamp}@b.test`, orgB, "admin");

  // The eight protected rows are seeded per organization by the
  // organization lifecycle in production; here we seed org A and org B
  // directly so the protected-row tests have real rows to act on.
  const { seedProtectedEventTypes } = await import(
    "@/lib/master-data/seed-event-types"
  );
  await seedProtectedEventTypes(orgA);
  await seedProtectedEventTypes(orgB);

  const [prot] = await db
    .select({ id: operationalEventTypes.id })
    .from(operationalEventTypes)
    .where(
      and(
        eq(operationalEventTypes.organizationId, orgA),
        eq(operationalEventTypes.isProtected, true),
        eq(operationalEventTypes.systemSemantic, "NOR_TENDERED")
      )
    );
  protectedId = prot.id;

  // One ordinary row in org A to exercise the ordinary paths.
  const [ord] = await db
    .insert(operationalEventTypes)
    .values({
      organizationId: orgA,
      code: `custom_shift_${stamp}`,
      label: "Custom Shift Change",
      systemSemantic: null,
      isProtected: false,
      displayOrder: 1000,
      status: "active",
    })
    .returning({ id: operationalEventTypes.id });
  ordinaryId = ord.id;
});

afterAll(async () => {
  // Cascades remove memberships, sessions, and event types.
  await db
    .delete(organizations)
    .where(eq(organizations.id, orgA));
  await db
    .delete(organizations)
    .where(eq(organizations.id, orgB));
});

describe("listEventTypes", () => {
  it("1. is tenant-scoped: org A sees its own rows, never org B's", async () => {
    currentToken = adminToken;
    const r = await listEventTypes({ includeInactive: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Every returned row belongs to org A: the ordinary row we made is
    // present, and org B's ordinary row (if any) is not. We assert on the
    // ordinary row id we control plus the eight protected semantics.
    const ids = r.data.map((row) => row.id);
    expect(ids).toContain(ordinaryId);
    const semantics = r.data
      .filter((row) => row.isProtected)
      .map((row) => row.systemSemantic);
    expect(semantics).toContain("NOR_TENDERED");
    expect(semantics.length).toBe(8);
  });
});

describe("createEventType", () => {
  it("2. creates an ordinary row with systemSemantic null and isProtected false", async () => {
    currentToken = adminToken;
    const r = await createEventType({
      code: `anchor_wait_${stamp}`,
      label: "Anchorage Waiting",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const [row] = await db
      .select({
        systemSemantic: operationalEventTypes.systemSemantic,
        isProtected: operationalEventTypes.isProtected,
        status: operationalEventTypes.status,
      })
      .from(operationalEventTypes)
      .where(eq(operationalEventTypes.id, r.data.id));
    expect(row.systemSemantic).toBeNull();
    expect(row.isProtected).toBe(false);
    expect(row.status).toBe("active");
  });

  it("3. cannot create a protected/system-semantic row (input contract has no such field)", async () => {
    currentToken = adminToken;
    // The input type exposes only code and label. Even passing extra keys
    // must not produce a protected or semantic-carrying row.
    const r = await createEventType({
      code: `sneaky_${stamp}`,
      label: "Sneaky",
      // @ts-expect-error - proving the contract rejects these at the type level
      systemSemantic: "NOR_TENDERED",
          isProtected: true,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [row] = await db
      .select({
        systemSemantic: operationalEventTypes.systemSemantic,
        isProtected: operationalEventTypes.isProtected,
      })
      .from(operationalEventTypes)
      .where(eq(operationalEventTypes.id, r.data.id));
    expect(row.systemSemantic).toBeNull();
    expect(row.isProtected).toBe(false);
  });

  it("4. duplicate code returns DUPLICATE_CODE", async () => {
    currentToken = adminToken;
    const code = `dup_${stamp}`;
    const first = await createEventType({ code, label: "First" });
    expect(first.ok).toBe(true);
    const second = await createEventType({ code, label: "Second" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("DUPLICATE_CODE");
  });
});

describe("updateEventType", () => {
  it("5. ordinary update can change code and label", async () => {
    currentToken = adminToken;
    const created = await createEventType({
      code: `edit_me_${stamp}`,
      label: "Before",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const r = await updateEventType(created.data.id, {
      code: `edited_${stamp}`,
      label: "After",
    });
    expect(r.ok).toBe(true);

    const [row] = await db
      .select({
        code: operationalEventTypes.code,
        label: operationalEventTypes.label,
      })
      .from(operationalEventTypes)
      .where(eq(operationalEventTypes.id, created.data.id));
    expect(row.code).toBe(`edited_${stamp}`);
    expect(row.label).toBe("After");
  });

  it("6. protected update can change label only", async () => {
    currentToken = adminToken;
    const r = await updateEventType(protectedId, {
      code: "hacked_code",
      label: "Notice of Readiness Tendered",
    });
    expect(r.ok).toBe(true);

    const [row] = await db
      .select({
        code: operationalEventTypes.code,
        label: operationalEventTypes.label,
        systemSemantic: operationalEventTypes.systemSemantic,
      })
      .from(operationalEventTypes)
      .where(eq(operationalEventTypes.id, protectedId));
    expect(row.label).toBe("Notice of Readiness Tendered");
    expect(row.code).toBe("nor_tendered"); // unchanged
    expect(row.systemSemantic).toBe("NOR_TENDERED"); // unchanged
  });

  it("7. protected code cannot be changed through the update action", async () => {
    // Covered by the assertion in test 6 (code stays nor_tendered), but
    // asserted explicitly here against a fresh read for clarity.
    currentToken = adminToken;
    await updateEventType(protectedId, {
      code: "another_attempt",
      label: "Renamed Again",
    });
    const [row] = await db
      .select({ code: operationalEventTypes.code })
      .from(operationalEventTypes)
      .where(eq(operationalEventTypes.id, protectedId));
    expect(row.code).toBe("nor_tendered");
  });

  it("8. protected systemSemantic cannot be changed", async () => {
    currentToken = adminToken;
    await updateEventType(protectedId, {
      code: "x",
      label: "Renamed",
    });
    const [row] = await db
      .select({ systemSemantic: operationalEventTypes.systemSemantic })
      .from(operationalEventTypes)
      .where(eq(operationalEventTypes.id, protectedId));
    expect(row.systemSemantic).toBe("NOR_TENDERED");
  });
});

describe("setEventTypeStatus", () => {
  it("9. protected status cannot be changed to inactive (INVALID_STATE)", async () => {
    currentToken = adminToken;
    const r = await setEventTypeStatus(protectedId, "inactive");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_STATE");

    const [row] = await db
      .select({ status: operationalEventTypes.status })
      .from(operationalEventTypes)
      .where(eq(operationalEventTypes.id, protectedId));
    expect(row.status).toBe("active"); // untouched
  });

  it("10. ordinary setStatus works both directions", async () => {
    currentToken = adminToken;

    const off = await setEventTypeStatus(ordinaryId, "inactive");
    expect(off.ok).toBe(true);
    if (off.ok) expect(off.data.changed).toBe(true);

    const [row1] = await db
      .select({ status: operationalEventTypes.status })
      .from(operationalEventTypes)
      .where(eq(operationalEventTypes.id, ordinaryId));
    expect(row1.status).toBe("inactive");

    const on = await setEventTypeStatus(ordinaryId, "active");
    expect(on.ok).toBe(true);
    if (on.ok) expect(on.data.changed).toBe(true);

    const [row2] = await db
      .select({ status: operationalEventTypes.status })
      .from(operationalEventTypes)
      .where(eq(operationalEventTypes.id, ordinaryId));
    expect(row2.status).toBe("active");

    // Same-state call is a no-op with changed:false and no audit.
    const again = await setEventTypeStatus(ordinaryId, "active");
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.data.changed).toBe(false);
  });
});

describe("cross-tenant and authorization", () => {
  it("11. cross-tenant update and setStatus return NOT_FOUND", async () => {
    // orgBToken acts as admin of org B, targeting org A's rows.
    currentToken = orgBToken;

    const upd = await updateEventType(ordinaryId, {
      code: "cross",
      label: "Cross Tenant",
    });
    expect(upd.ok).toBe(false);
    if (!upd.ok) expect(upd.code).toBe("NOT_FOUND");

    const stat = await setEventTypeStatus(ordinaryId, "inactive");
    expect(stat.ok).toBe(false);
    if (!stat.ok) expect(stat.code).toBe("NOT_FOUND");
  });

  it("12. a user without masterdata.write is rejected with FORBIDDEN", async () => {
    currentToken = viewerToken;
    const r = await createEventType({
      code: `denied_${stamp}`,
      label: "Denied",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FORBIDDEN");
  });
});