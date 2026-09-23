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
  laytimeRuleSets,
  laytimeRuleSetVersions,
  laytimePools,
  contractLaytimeTerms,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import {
  listContractLaytimeTerms,
  createContractLaytimeTerm,
  updateContractLaytimeTerm,
  setContractLaytimeTermStatus,
} from "../contract-laytime-terms";

const stamp = Date.now();

let orgA: string;
let orgB: string;
let adminToken: string;
let viewerToken: string;
let orgBToken: string;

let contractA: string;
let contractA2: string; // a second contract in org A, owns its own pool
let contractB: string;
let versionA: string; // a rule set version in org A
let poolA: string; // a pool on contractA
let poolA2: string; // a pool on contractA2 (wrong contract for contractA terms)

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

async function makeVersion(orgId: string, ruleSetName: string): Promise<string> {
  const [rs] = await db
    .insert(laytimeRuleSets)
    .values({ organizationId: orgId, name: ruleSetName })
    .returning({ id: laytimeRuleSets.id });
  const [v] = await db
    .insert(laytimeRuleSetVersions)
    .values({ organizationId: orgId, ruleSetId: rs.id, versionNumber: 1 })
    .returning({ id: laytimeRuleSetVersions.id });
  return v.id;
}

async function makePool(
  orgId: string,
  contractId: string,
  name: string
): Promise<string> {
  const [p] = await db
    .insert(laytimePools)
    .values({
      organizationId: orgId,
      contractId,
      name,
      totalAllowance: "30",
      allowanceUnit: "days",
      settlementPolicy: "standard",
    })
    .returning({ id: laytimePools.id });
  return p.id;
}

function validTerm(overrides: Record<string, unknown> = {}) {
  return {
    function: "LOAD" as const,
    allowance: "10",
    allowanceUnit: "days",
    demurrageRate: "5000",
    commencementRule: "NOR_ACCEPTED",
    ruleSetVersionId: versionA,
    ...overrides,
  };
}

beforeAll(async () => {
  const [a] = await db
    .insert(organizations)
    .values({ name: "CLT Test A", slug: `clt-a-${stamp}` })
    .returning();
  const [b] = await db
    .insert(organizations)
    .values({ name: "CLT Test B", slug: `clt-b-${stamp}` })
    .returning();
  orgA = a.id;
  orgB = b.id;

  adminToken = await makeUserWithSession(`admin-${stamp}@a.test`, orgA, "admin");
  viewerToken = await makeUserWithSession(`viewer-${stamp}@a.test`, orgA, "viewer");
  orgBToken = await makeUserWithSession(`admin-${stamp}@b.test`, orgB, "admin");

  contractA = await makeContract(orgA, `CA-${stamp}`);
  contractA2 = await makeContract(orgA, `CA2-${stamp}`);
  contractB = await makeContract(orgB, `CB-${stamp}`);
  versionA = await makeVersion(orgA, `RS A ${stamp}`);
  poolA = await makePool(orgA, contractA, `Pool A ${stamp}`);
  poolA2 = await makePool(orgA, contractA2, `Pool A2 ${stamp}`);
});

afterAll(async () => {
  await db.delete(organizations).where(eq(organizations.id, orgA));
  await db.delete(organizations).where(eq(organizations.id, orgB));
});

describe("createContractLaytimeTerm", () => {
  it("1. create succeeds for a same-tenant contract with valid fields", async () => {
    currentToken = adminToken;
    const r = await createContractLaytimeTerm(contractA, validTerm());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [row] = await db
      .select({
        contractId: contractLaytimeTerms.contractId,
        fn: contractLaytimeTerms.function,
        status: contractLaytimeTerms.status,
      })
      .from(contractLaytimeTerms)
      .where(eq(contractLaytimeTerms.id, r.data.id));
    expect(row.contractId).toBe(contractA);
    expect(row.fn).toBe("LOAD");
    expect(row.status).toBe("active");
  });

  it("2. rejects a non-numeric allowance with VALIDATION_ERROR", async () => {
    currentToken = adminToken;
    const r = await createContractLaytimeTerm(
      contractA,
      validTerm({ allowance: "loads" })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("VALIDATION_ERROR");
  });

  it("3. create against a cross-tenant contract returns NOT_FOUND", async () => {
    currentToken = adminToken; // org A user, org B contract
    const r = await createContractLaytimeTerm(contractB, validTerm());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("4. a pool from a DIFFERENT contract is rejected with NOT_FOUND", async () => {
    currentToken = adminToken;
    // poolA2 belongs to contractA2, not contractA.
    const r = await createContractLaytimeTerm(
      contractA,
      validTerm({ poolId: poolA2 })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("5. a pool from the SAME contract is accepted", async () => {
    currentToken = adminToken;
    const r = await createContractLaytimeTerm(
      contractA,
      validTerm({ poolId: poolA })
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      const [row] = await db
        .select({ poolId: contractLaytimeTerms.poolId })
        .from(contractLaytimeTerms)
        .where(eq(contractLaytimeTerms.id, r.data.id));
      expect(row.poolId).toBe(poolA);
    }
  });
});

describe("createContractLaytimeTerm — bounded vocabulary", () => {
  const bad = async (over: Record<string, unknown>) => {
    currentToken = adminToken;
    const r = await createContractLaytimeTerm(contractA, validTerm(over));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("VALIDATION_ERROR");
  };

  it("rejects a commencement event the engine does not know", () =>
    bad({ commencementRule: "on_nor_accepted" }));
  it("rejects an allowance unit other than days/hours", () =>
    bad({ allowanceUnit: "weather working days" }));
  it("rejects a turn time with no recognised trigger", () =>
    bad({ turnTimeHours: "6", turnTimeTrigger: "whenever" }));
  it("rejects the 14:00 rule combined with turn time", () =>
    bad({ commencementTimeRule: "MORNING_NOR_1400", turnTimeHours: "6", turnTimeTrigger: "NOR_TENDERED" }));
  it("rejects an unknown despatch basis", () => bad({ despatchBasis: "whatever" }));

  it("accepts NOR tendered + the 14:00 rule and stores it", async () => {
    currentToken = adminToken;
    const r = await createContractLaytimeTerm(
      contractA,
      validTerm({ commencementRule: "NOR_TENDERED", commencementTimeRule: "MORNING_NOR_1400", despatchBasis: "WTS" })
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [row] = await db
      .select({ c: contractLaytimeTerms.commencementTimeRule, t: contractLaytimeTerms.turnTimeTrigger })
      .from(contractLaytimeTerms)
      .where(eq(contractLaytimeTerms.id, r.data.id));
    expect(row.c).toBe("MORNING_NOR_1400");
    expect(row.t).toBeNull();
  });
});

describe("listContractLaytimeTerms", () => {
  it("6. lists a contract's terms, tenant-scoped", async () => {
    currentToken = adminToken;
    const r = await listContractLaytimeTerms(contractA, { includeInactive: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.every((t) => t.contractId === contractA)).toBe(true);

    currentToken = orgBToken;
    const cross = await listContractLaytimeTerms(contractA);
    expect(cross.ok).toBe(false);
    if (!cross.ok) expect(cross.code).toBe("NOT_FOUND");
  });
});

describe("updateContractLaytimeTerm", () => {
  it("7. update in place keeps the contract fixed", async () => {
    currentToken = adminToken;
    const created = await createContractLaytimeTerm(contractA, validTerm());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const r = await updateContractLaytimeTerm(
      created.data.id,
      validTerm({ function: "DISCHARGE", allowance: "12" })
    );
    expect(r.ok).toBe(true);

    const [row] = await db
      .select({
        fn: contractLaytimeTerms.function,
        allowance: contractLaytimeTerms.allowance,
        contractId: contractLaytimeTerms.contractId,
      })
      .from(contractLaytimeTerms)
      .where(eq(contractLaytimeTerms.id, created.data.id));
    expect(row.fn).toBe("DISCHARGE");
    expect(row.allowance).toBe("12");
    expect(row.contractId).toBe(contractA); // unchanged
  });

  it("8. update rejects a pool from another contract", async () => {
    currentToken = adminToken;
    const created = await createContractLaytimeTerm(contractA, validTerm());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const r = await updateContractLaytimeTerm(
      created.data.id,
      validTerm({ poolId: poolA2 })
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("9. cross-tenant update returns NOT_FOUND", async () => {
    currentToken = adminToken;
    const created = await createContractLaytimeTerm(contractA, validTerm());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    currentToken = orgBToken;
    const r = await updateContractLaytimeTerm(created.data.id, validTerm());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });
});

describe("setContractLaytimeTermStatus", () => {
  it("10. toggles status; same-status is a no-op", async () => {
    currentToken = adminToken;
    const created = await createContractLaytimeTerm(contractA, validTerm());
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const off = await setContractLaytimeTermStatus(created.data.id, "inactive");
    expect(off.ok && off.data.changed).toBe(true);
    const again = await setContractLaytimeTermStatus(created.data.id, "inactive");
    expect(again.ok && again.data.changed).toBe(false);
  });
});

describe("authorization", () => {
  it("11. a user without masterdata.write is rejected with FORBIDDEN", async () => {
    currentToken = viewerToken;
    const r = await createContractLaytimeTerm(contractA, validTerm());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FORBIDDEN");
  });
});