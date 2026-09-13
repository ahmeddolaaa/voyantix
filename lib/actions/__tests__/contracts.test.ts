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
import { organizations, users, memberships, contracts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import {
  listContracts,
  createContract,
  updateContract,
  setContractStatus,
} from "../contracts";

const stamp = Date.now();

let orgA: string;
let orgB: string;
let adminToken: string;
let viewerToken: string;
let orgBToken: string;

let contractA: string;

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
    .values({ name: "CT Test A", slug: `ct-a-${stamp}` })
    .returning();
  const [b] = await db
    .insert(organizations)
    .values({ name: "CT Test B", slug: `ct-b-${stamp}` })
    .returning();
  orgA = a.id;
  orgB = b.id;

  adminToken = await makeUserWithSession(`admin-${stamp}@a.test`, orgA, "admin");
  viewerToken = await makeUserWithSession(`viewer-${stamp}@a.test`, orgA, "viewer");
  orgBToken = await makeUserWithSession(`admin-${stamp}@b.test`, orgB, "admin");

  const [c] = await db
    .insert(contracts)
    .values({
      organizationId: orgA,
      reference: `BASE-${stamp}`,
      counterparty: "Base Counterparty",
    })
    .returning({ id: contracts.id });
  contractA = c.id;
});

afterAll(async () => {
  await db.delete(organizations).where(eq(organizations.id, orgA));
  await db.delete(organizations).where(eq(organizations.id, orgB));
});

describe("listContracts", () => {
  it("1. is tenant-scoped: org A sees its own contracts, org B does not", async () => {
    currentToken = adminToken;
    const a = await listContracts({ includeInactive: true });
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.data.map((r) => r.id)).toContain(contractA);

    currentToken = orgBToken;
    const b = await listContracts({ includeInactive: true });
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.data.map((r) => r.id)).not.toContain(contractA);
  });
});

describe("createContract", () => {
  it("2. create succeeds and stores contractDate when provided", async () => {
    currentToken = adminToken;
    const r = await createContract({
      reference: `NEW-${stamp}`,
      counterparty: "Acme Traders",
      contractDate: "2026-03-15",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const [row] = await db
      .select({
        counterparty: contracts.counterparty,
        contractDate: contracts.contractDate,
        status: contracts.status,
      })
      .from(contracts)
      .where(eq(contracts.id, r.data.id));
    expect(row.counterparty).toBe("Acme Traders");
    expect(row.contractDate).toBe("2026-03-15");
    expect(row.status).toBe("active");
  });

  it("3. requires reference and counterparty", async () => {
    currentToken = adminToken;
    const noRef = await createContract({ reference: "  ", counterparty: "X" });
    expect(noRef.ok).toBe(false);
    if (!noRef.ok) expect(noRef.code).toBe("VALIDATION_ERROR");

    const noCp = await createContract({ reference: `R-${stamp}-x`, counterparty: "" });
    expect(noCp.ok).toBe(false);
    if (!noCp.ok) expect(noCp.code).toBe("VALIDATION_ERROR");
  });

  it("4. duplicate reference (case/space-insensitive) maps to DUPLICATE_CODE", async () => {
    currentToken = adminToken;
    const ref = `DUP-${stamp}`;
    const first = await createContract({ reference: ref, counterparty: "A" });
    expect(first.ok).toBe(true);
    const second = await createContract({
      reference: `  ${ref.toLowerCase()}  `,
      counterparty: "B",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("DUPLICATE_CODE");
  });
});

describe("updateContract", () => {
  it("5. update works on a same-tenant row", async () => {
    currentToken = adminToken;
    const created = await createContract({
      reference: `EDIT-${stamp}`,
      counterparty: "Before Co",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const r = await updateContract(created.data.id, {
      reference: `EDITED-${stamp}`,
      counterparty: "After Co",
    });
    expect(r.ok).toBe(true);

    const [row] = await db
      .select({ reference: contracts.reference, counterparty: contracts.counterparty })
      .from(contracts)
      .where(eq(contracts.id, created.data.id));
    expect(row.reference).toBe(`EDITED-${stamp}`);
    expect(row.counterparty).toBe("After Co");
  });

  it("6. cross-tenant update returns NOT_FOUND", async () => {
    currentToken = orgBToken;
    const r = await updateContract(contractA, {
      reference: "CROSS",
      counterparty: "X",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });
});

describe("setContractStatus", () => {
  it("7. toggles both directions; same-status is a no-op with changed:false", async () => {
    currentToken = adminToken;

    const off = await setContractStatus(contractA, "inactive");
    expect(off.ok).toBe(true);
    if (off.ok) expect(off.data.changed).toBe(true);

    const again = await setContractStatus(contractA, "inactive");
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.data.changed).toBe(false);

    const on = await setContractStatus(contractA, "active");
    expect(on.ok).toBe(true);
    if (on.ok) expect(on.data.changed).toBe(true);
  });

  it("8. cross-tenant setStatus returns NOT_FOUND", async () => {
    currentToken = orgBToken;
    const r = await setContractStatus(contractA, "inactive");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });
});

describe("authorization", () => {
  it("9. a user without masterdata.write is rejected with FORBIDDEN", async () => {
    currentToken = viewerToken;
    const r = await createContract({
      reference: `DENIED-${stamp}`,
      counterparty: "X",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FORBIDDEN");
  });
});