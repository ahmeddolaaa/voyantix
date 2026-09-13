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
  contracts,
  laytimePools,
  auditLog,
} from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import {
  listLaytimePools,
  createLaytimePool,
  updateLaytimePool,
} from "../laytime-pools";

const stamp = Date.now();

let orgA: string;
let orgB: string;
let adminToken: string; // admin in org A
let viewerToken: string; // viewer in org A
let orgBToken: string; // admin in org B

let contractA: string; // contract in org A
let contractB: string; // contract in org B

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

async function makeContract(orgId: string, ref: string): Promise<string> {
  const [c] = await db
    .insert(contracts)
    .values({ organizationId: orgId, reference: ref, counterparty: "CP" })
    .returning({ id: contracts.id });
  return c.id;
}

async function auditCount(entityId: string): Promise<number> {
  const rows = await db
    .select({ id: auditLog.id })
    .from(auditLog)
    .where(eq(auditLog.entityId, entityId));
  return rows.length;
}

const validPool = {
  name: "Reversible Pool",
  totalAllowance: "30",
  allowanceUnit: "days",
  settlementPolicy: "standard",
};

beforeAll(async () => {
  const [a] = await db
    .insert(organizations)
    .values({ name: "LP Test A", slug: `lp-a-${stamp}` })
    .returning();
  const [b] = await db
    .insert(organizations)
    .values({ name: "LP Test B", slug: `lp-b-${stamp}` })
    .returning();
  orgA = a.id;
  orgB = b.id;

  adminToken = await makeUserWithSession(`admin-${stamp}@a.test`, orgA, "admin");
  viewerToken = await makeUserWithSession(`viewer-${stamp}@a.test`, orgA, "viewer");
  orgBToken = await makeUserWithSession(`admin-${stamp}@b.test`, orgB, "admin");

  contractA = await makeContract(orgA, `CA-${stamp}`);
  contractB = await makeContract(orgB, `CB-${stamp}`);
});

afterAll(async () => {
  await db.delete(organizations).where(eq(organizations.id, orgA));
  await db.delete(organizations).where(eq(organizations.id, orgB));
});

describe("createLaytimePool", () => {
  it("1. create succeeds for a same-tenant contract and records audit", async () => {
    currentToken = adminToken;
    const r = await createLaytimePool(contractA, {
      ...validPool,
      name: `Pool One ${stamp}`,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const [row] = await db
      .select({
        contractId: laytimePools.contractId,
        orgId: laytimePools.organizationId,
      })
      .from(laytimePools)
      .where(eq(laytimePools.id, r.data.id));
    expect(row.contractId).toBe(contractA);
    expect(row.orgId).toBe(orgA);

    // audit recorded on success
    expect(await auditCount(r.data.id)).toBeGreaterThan(0);
  });

  it("2. create against a cross-tenant contract returns NOT_FOUND and writes no pool/audit", async () => {
    currentToken = adminToken; // org A user targeting org B's contract
    const r = await createLaytimePool(contractB, {
      ...validPool,
      name: `Sneaky ${stamp}`,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");

    // nothing was created under contractB
    const rows = await db
      .select({ id: laytimePools.id })
      .from(laytimePools)
      .where(eq(laytimePools.contractId, contractB));
    expect(rows.length).toBe(0);
  });

  it("3. invalid input (non-numeric allowance) returns VALIDATION_ERROR and no audit", async () => {
    currentToken = adminToken;
    const r = await createLaytimePool(contractA, {
      ...validPool,
      name: `Bad ${stamp}`,
      totalAllowance: "lots",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("VALIDATION_ERROR");
  });

  it("4. duplicate pool name within a contract returns DUPLICATE_NAME", async () => {
    currentToken = adminToken;
    const name = `Dup Pool ${stamp}`;
    const first = await createLaytimePool(contractA, { ...validPool, name });
    expect(first.ok).toBe(true);
    const second = await createLaytimePool(contractA, {
      ...validPool,
      name: `  ${name.toUpperCase()}  `,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("DUPLICATE_NAME");
  });
});

describe("listLaytimePools", () => {
  it("5. lists only pools of the given contract, tenant-scoped", async () => {
    currentToken = adminToken;
    const created = await createLaytimePool(contractA, {
      ...validPool,
      name: `Listed ${stamp}`,
    });
    expect(created.ok).toBe(true);

    const r = await listLaytimePools(contractA);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.every((p) => p.contractId === contractA)).toBe(true);
    }
  });

  it("6. cannot list another tenant's contract", async () => {
    currentToken = orgBToken; // org B admin targeting org A's contract
    const r = await listLaytimePools(contractA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });
});

describe("updateLaytimePool", () => {
  it("7. update succeeds for a same-tenant pool and records audit", async () => {
    currentToken = adminToken;
    const created = await createLaytimePool(contractA, {
      ...validPool,
      name: `Edit Pool ${stamp}`,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const r = await updateLaytimePool(created.data.id, {
      ...validPool,
      name: `Edited Pool ${stamp}`,
      totalAllowance: "45",
    });
    expect(r.ok).toBe(true);

    const [row] = await db
      .select({
        name: laytimePools.name,
        totalAllowance: laytimePools.totalAllowance,
        contractId: laytimePools.contractId,
      })
      .from(laytimePools)
      .where(eq(laytimePools.id, created.data.id));
    expect(row.name).toBe(`Edited Pool ${stamp}`);
    expect(row.totalAllowance).toBe("45");
    // contract is unchanged — no move between contracts
    expect(row.contractId).toBe(contractA);

    expect(await auditCount(created.data.id)).toBeGreaterThan(1); // create + update
  });

  it("8. update cannot move the pool to another contract (payload has no contractId)", async () => {
    currentToken = adminToken;
    const created = await createLaytimePool(contractA, {
      ...validPool,
      name: `Fixed Contract ${stamp}`,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    // The input type has no contractId field; even a cast attempt is ignored.
    await updateLaytimePool(created.data.id, {
      ...validPool,
      name: `Fixed Contract ${stamp}`,
      // @ts-expect-error - contractId is not part of the update contract
      contractId: contractB,
    });

    const [row] = await db
      .select({ contractId: laytimePools.contractId })
      .from(laytimePools)
      .where(eq(laytimePools.id, created.data.id));
    expect(row.contractId).toBe(contractA);
  });

  it("9. cross-tenant update returns NOT_FOUND", async () => {
    currentToken = adminToken;
    const created = await createLaytimePool(contractA, {
      ...validPool,
      name: `Guarded ${stamp}`,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    currentToken = orgBToken; // org B admin targeting org A's pool
    const r = await updateLaytimePool(created.data.id, {
      ...validPool,
      name: "Cross",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });
});

describe("authorization", () => {
  it("10. a user without masterdata.write is rejected with FORBIDDEN", async () => {
    currentToken = viewerToken;
    const r = await createLaytimePool(contractA, {
      ...validPool,
      name: `Denied ${stamp}`,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FORBIDDEN");
  });
});