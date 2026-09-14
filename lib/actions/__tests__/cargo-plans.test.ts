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
  cargoPlans,
  ports,
  cargoes,
  contracts,
  contractLaytimeTerms,
  laytimeRuleSets,
  laytimeRuleSetVersions,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import {
  listCargoPlans,
  createCargoPlan,
  updateCargoPlan,
  deleteCargoPlan,
} from "../cargo-plans";
import {
  createVoyagePortCall,
  resolveContractLaytimeTerm,
  overrideContractLaytimeTerm,
} from "../voyage-port-calls";

const stamp = Date.now();

let orgA: string;
let orgB: string;
let adminToken: string;
let viewerToken: string;
let orgBToken: string;

let portAlex: string;
let cargoBillets: string;
let cargoScrap: string;
let cargoOrgB: string;
let contractA: string;
let versionId: string;

/** A voyage WITH a contract, and one without, so PO11 scope can be tested. */
let voyageWithContract: string;
let voyageNoContract: string;

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

async function makePortCall(voyageId: string, fn: "LOAD" | "DISCHARGE" = "LOAD") {
  const r = await createVoyagePortCall(voyageId, { portId: portAlex, function: fn });
  if (!r.ok) throw new Error("port call setup failed: " + r.message);
  return r.data.id;
}

async function makeTerm(opts: {
  portId: string | null;
  cargoId: string | null;
  fn?: "LOAD" | "DISCHARGE";
  contractId?: string;
}) {
  const [t] = await db
    .insert(contractLaytimeTerms)
    .values({
      organizationId: orgA,
      contractId: opts.contractId ?? contractA,
      function: opts.fn ?? "LOAD",
      portId: opts.portId,
      cargoId: opts.cargoId,
      allowance: "5",
      allowanceUnit: "days",
      demurrageRate: "18500",
      commencementRule: "NOR_ACCEPTED",
      ruleSetVersionId: versionId,
    })
    .returning({ id: contractLaytimeTerms.id });
  return t.id;
}

/**
 * A voyage on its OWN contract.
 *
 * Term resolution searches the whole contract, so tests that create terms
 * must not share one: a term left behind by an earlier test would become a
 * candidate here and change the outcome. Giving each test its own contract
 * removes the coupling without any cleanup — and cleanup would be awkward
 * anyway, since a resolved term is pinned by voyage_port_calls_term_org_fk.
 */
async function makeIsolatedVoyage() {
  const [ct] = await db
    .insert(contracts)
    .values({
      organizationId: orgA,
      reference: `ISO-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
      counterparty: "Isolated Counterparty",
    })
    .returning({ id: contracts.id });

  const [v] = await db
    .insert(voyages)
    .values({
      organizationId: orgA,
      voyageReference: `ISOV-${stamp}-${Math.random().toString(36).slice(2, 8)}`,
      vesselName: "Isolated Vessel",
      contractId: ct.id,
    })
    .returning({ id: voyages.id });

  return { voyageId: v.id, contractId: ct.id };
}


beforeAll(async () => {
  const [a] = await db
    .insert(organizations)
    .values({ name: "CP Test A", slug: `cp-a-${stamp}` })
    .returning();
  const [b] = await db
    .insert(organizations)
    .values({ name: "CP Test B", slug: `cp-b-${stamp}` })
    .returning();
  orgA = a.id;
  orgB = b.id;

  adminToken = await makeUserWithSession(`admin-${stamp}@cpa.test`, orgA, "admin");
  viewerToken = await makeUserWithSession(`viewer-${stamp}@cpa.test`, orgA, "viewer");
  orgBToken = await makeUserWithSession(`admin-${stamp}@cpb.test`, orgB, "admin");

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

  const [c1] = await db
    .insert(cargoes)
    .values({ organizationId: orgA, name: `Billets ${stamp}` })
    .returning({ id: cargoes.id });
  cargoBillets = c1.id;

  const [c2] = await db
    .insert(cargoes)
    .values({ organizationId: orgA, name: `Scrap ${stamp}` })
    .returning({ id: cargoes.id });
  cargoScrap = c2.id;

  const [c3] = await db
    .insert(cargoes)
    .values({ organizationId: orgB, name: `Other Cargo ${stamp}` })
    .returning({ id: cargoes.id });
  cargoOrgB = c3.id;

  const [rs] = await db
    .insert(laytimeRuleSets)
    .values({ organizationId: orgA, name: `WWD SHINC ${stamp}` })
    .returning({ id: laytimeRuleSets.id });

  const [ver] = await db
    .insert(laytimeRuleSetVersions)
    .values({ organizationId: orgA, ruleSetId: rs.id, versionNumber: 1 })
    .returning({ id: laytimeRuleSetVersions.id });
  versionId = ver.id;

  const [ct] = await db
    .insert(contracts)
    .values({
      organizationId: orgA,
      reference: `CP-${stamp}`,
      counterparty: "Acme Chartering",
    })
    .returning({ id: contracts.id });
  contractA = ct.id;

  const [v1] = await db
    .insert(voyages)
    .values({
      organizationId: orgA,
      voyageReference: `CPV-${stamp}`,
      vesselName: "Contracted Vessel",
      contractId: contractA,
    })
    .returning({ id: voyages.id });
  voyageWithContract = v1.id;

  const [v2] = await db
    .insert(voyages)
    .values({
      organizationId: orgA,
      voyageReference: `CPVN-${stamp}`,
      vesselName: "Uncontracted Vessel",
    })
    .returning({ id: voyages.id });
  voyageNoContract = v2.id;
});

afterAll(async () => {
  await db.delete(organizations).where(eq(organizations.id, orgA));
  await db.delete(organizations).where(eq(organizations.id, orgB));
});

describe("cargo plan CRUD", () => {
  it("1. creates a plan and stores the quantity exactly", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(voyageWithContract);
    const r = await createCargoPlan(pc, {
      cargoId: cargoBillets,
      plannedQuantityMt: "12500.75",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const [row] = await db
      .select({
        planned: cargoPlans.plannedQuantityMt,
        actual: cargoPlans.actualQuantityMt,
      })
      .from(cargoPlans)
      .where(eq(cargoPlans.id, r.data.id));
    expect(row.planned).toBe("12500.75");
    expect(row.actual).toBeNull();
  });

  it("2. a port call may carry several cargo plans", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(voyageWithContract);
    const first = await createCargoPlan(pc, {
      cargoId: cargoBillets,
      plannedQuantityMt: "1000",
    });
    const second = await createCargoPlan(pc, {
      cargoId: cargoScrap,
      plannedQuantityMt: "2000",
    });
    expect(first.ok && second.ok).toBe(true);

    const list = await listCargoPlans(pc);
    expect(list.ok).toBe(true);
    if (list.ok) expect(list.data.length).toBe(2);
  });

  it("3. the same cargo twice on one port call is rejected", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(voyageWithContract);
    const first = await createCargoPlan(pc, {
      cargoId: cargoBillets,
      plannedQuantityMt: "1000",
    });
    expect(first.ok).toBe(true);

    const dup = await createCargoPlan(pc, {
      cargoId: cargoBillets,
      plannedQuantityMt: "500",
    });
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.code).toBe("CONFLICT");
  });

  it("4. rejects a non-numeric or negative quantity", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(voyageWithContract);

    const bad = await createCargoPlan(pc, {
      cargoId: cargoBillets,
      plannedQuantityMt: "lots",
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.code).toBe("VALIDATION_ERROR");

    const negative = await createCargoPlan(pc, {
      cargoId: cargoBillets,
      plannedQuantityMt: "-5",
    });
    expect(negative.ok).toBe(false);
    if (!negative.ok) expect(negative.code).toBe("VALIDATION_ERROR");
  });

  it("5. rejects a cargo from another organization", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(voyageWithContract);
    const r = await createCargoPlan(pc, {
      cargoId: cargoOrgB,
      plannedQuantityMt: "100",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("6. updates quantities, including recording the actual", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(voyageWithContract);
    const created = await createCargoPlan(pc, {
      cargoId: cargoBillets,
      plannedQuantityMt: "1000",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const r = await updateCargoPlan(created.data.id, {
      cargoId: cargoBillets,
      plannedQuantityMt: "1000",
      actualQuantityMt: "987.5",
    });
    expect(r.ok).toBe(true);

    const [row] = await db
      .select({ actual: cargoPlans.actualQuantityMt })
      .from(cargoPlans)
      .where(eq(cargoPlans.id, created.data.id));
    expect(row.actual).toBe("987.5");
  });

  it("7. deletes a plan outright", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(voyageWithContract);
    const created = await createCargoPlan(pc, {
      cargoId: cargoBillets,
      plannedQuantityMt: "1000",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const r = await deleteCargoPlan(created.data.id);
    expect(r.ok).toBe(true);

    const remaining = await db
      .select({ id: cargoPlans.id })
      .from(cargoPlans)
      .where(eq(cargoPlans.id, created.data.id));
    expect(remaining.length).toBe(0);
  });

  it("8. deleting a port call removes its cargo plans", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(voyageWithContract);
    const created = await createCargoPlan(pc, {
      cargoId: cargoBillets,
      plannedQuantityMt: "1000",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await db.delete(voyagePortCalls).where(eq(voyagePortCalls.id, pc));

    const remaining = await db
      .select({ id: cargoPlans.id })
      .from(cargoPlans)
      .where(eq(cargoPlans.id, created.data.id));
    expect(remaining.length).toBe(0);
  });

  it("9. cross-tenant list returns NOT_FOUND", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(voyageWithContract);

    currentToken = orgBToken;
    const r = await listCargoPlans(pc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("10. a viewer cannot create a plan", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(voyageWithContract);

    currentToken = viewerToken;
    const r = await createCargoPlan(pc, {
      cargoId: cargoBillets,
      plannedQuantityMt: "100",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FORBIDDEN");
  });
});

describe("PO11 — term resolution", () => {
  it("11. a voyage with no contract reports CONTRACT_REQUIRED", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(voyageNoContract);
    await createCargoPlan(pc, {
      cargoId: cargoBillets,
      plannedQuantityMt: "1000",
    });

    const r = await resolveContractLaytimeTerm(pc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CONTRACT_REQUIRED");
  });

  it("12. no cargo plan reports INSUFFICIENT_CARGO_CONTEXT, not a zero match", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(voyageWithContract);

    const r = await resolveContractLaytimeTerm(pc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INSUFFICIENT_CARGO_CONTEXT");
  });

  it("13. several cargo plans report MULTIPLE_CARGO_CONTEXTS and change nothing", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(voyageWithContract);
    await createCargoPlan(pc, {
      cargoId: cargoBillets,
      plannedQuantityMt: "1000",
    });
    await createCargoPlan(pc, {
      cargoId: cargoScrap,
      plannedQuantityMt: "2000",
    });

    const r = await resolveContractLaytimeTerm(pc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("MULTIPLE_CARGO_CONTEXTS");

    const [row] = await db
      .select({ termId: voyagePortCalls.contractLaytimeTermId })
      .from(voyagePortCalls)
      .where(eq(voyagePortCalls.id, pc));
    expect(row.termId).toBeNull();
  });

  it("14. exactly one matching term is resolved and persisted", async () => {
    currentToken = adminToken;
    const iso = await makeIsolatedVoyage();
    const termId = await makeTerm({
      portId: portAlex,
      cargoId: cargoBillets,
      contractId: iso.contractId,
    });

    const pc = await makePortCall(iso.voyageId);
    await createCargoPlan(pc, {
      cargoId: cargoBillets,
      plannedQuantityMt: "1000",
    });

    const r = await resolveContractLaytimeTerm(pc);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.contractLaytimeTermId).toBe(termId);

    const [row] = await db
      .select({ termId: voyagePortCalls.contractLaytimeTermId })
      .from(voyagePortCalls)
      .where(eq(voyagePortCalls.id, pc));
    expect(row.termId).toBe(termId);

  });

  it("15. zero matching terms succeeds with a null term — NOT an error", async () => {
    currentToken = adminToken;
    // A term that cannot match: wrong function.
    const iso = await makeIsolatedVoyage();
    await makeTerm({
      portId: portAlex,
      cargoId: cargoBillets,
      fn: "DISCHARGE",
      contractId: iso.contractId,
    });

    const pc = await makePortCall(iso.voyageId, "LOAD");
    await createCargoPlan(pc, {
      cargoId: cargoBillets,
      plannedQuantityMt: "1000",
    });

    const r = await resolveContractLaytimeTerm(pc);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.contractLaytimeTermId).toBeNull();

  });

  it("16. a strictly more specific term wins over a general one", async () => {
    currentToken = adminToken;
    const iso = await makeIsolatedVoyage();
    await makeTerm({ portId: null, cargoId: null, contractId: iso.contractId });
    const specific = await makeTerm({
      portId: portAlex,
      cargoId: cargoBillets,
      contractId: iso.contractId,
    });

    const pc = await makePortCall(iso.voyageId);
    await createCargoPlan(pc, {
      cargoId: cargoBillets,
      plannedQuantityMt: "1000",
    });

    const r = await resolveContractLaytimeTerm(pc);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.contractLaytimeTermId).toBe(specific);

  });

  it("17. a true tie reports AMBIGUOUS_TERM and leaves the stored value alone", async () => {
    currentToken = adminToken;
    // Two terms, neither more specific than the other: one scoped by port,
    // the other by cargo.
    const iso = await makeIsolatedVoyage();
    await makeTerm({ portId: portAlex, cargoId: null, contractId: iso.contractId });
    await makeTerm({ portId: null, cargoId: cargoBillets, contractId: iso.contractId });

    const pc = await makePortCall(iso.voyageId);
    await createCargoPlan(pc, {
      cargoId: cargoBillets,
      plannedQuantityMt: "1000",
    });

    const r = await resolveContractLaytimeTerm(pc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("AMBIGUOUS_TERM");

    const [row] = await db
      .select({ termId: voyagePortCalls.contractLaytimeTermId })
      .from(voyagePortCalls)
      .where(eq(voyagePortCalls.id, pc));
    expect(row.termId).toBeNull();

  });

  it("18. resolution does NOT re-run when the cargo later changes", async () => {
    currentToken = adminToken;
    const iso = await makeIsolatedVoyage();
    const termId = await makeTerm({
      portId: portAlex,
      cargoId: cargoBillets,
      contractId: iso.contractId,
    });

    const pc = await makePortCall(iso.voyageId);
    const plan = await createCargoPlan(pc, {
      cargoId: cargoBillets,
      plannedQuantityMt: "1000",
    });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;

    const resolved = await resolveContractLaytimeTerm(pc);
    expect(resolved.ok).toBe(true);

    // Change the cargo. The stored term must NOT follow.
    await updateCargoPlan(plan.data.id, {
      cargoId: cargoScrap,
      plannedQuantityMt: "1000",
    });

    const [row] = await db
      .select({ termId: voyagePortCalls.contractLaytimeTermId })
      .from(voyagePortCalls)
      .where(eq(voyagePortCalls.id, pc));
    expect(row.termId).toBe(termId);

  });

  it("19. cross-tenant resolve returns NOT_FOUND", async () => {
    currentToken = adminToken;
    const pc = await makePortCall(voyageWithContract);

    currentToken = orgBToken;
    const r = await resolveContractLaytimeTerm(pc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });
});

describe("PO11 — manual override", () => {
  it("20. sets a term by hand without consulting the resolver", async () => {
    currentToken = adminToken;
    // Deliberately ambiguous: the resolver would refuse, the override works.
    const iso = await makeIsolatedVoyage();
    const byPort = await makeTerm({
      portId: portAlex,
      cargoId: null,
      contractId: iso.contractId,
    });
    await makeTerm({ portId: null, cargoId: cargoBillets, contractId: iso.contractId });

    const pc = await makePortCall(iso.voyageId);
    await createCargoPlan(pc, {
      cargoId: cargoBillets,
      plannedQuantityMt: "1000",
    });

    const refused = await resolveContractLaytimeTerm(pc);
    expect(refused.ok).toBe(false);

    const forced = await overrideContractLaytimeTerm(pc, byPort);
    expect(forced.ok).toBe(true);
    if (forced.ok) expect(forced.data.contractLaytimeTermId).toBe(byPort);

  });

  it("21. passing null clears the term", async () => {
    currentToken = adminToken;
    const iso = await makeIsolatedVoyage();
    const termId = await makeTerm({
      portId: portAlex,
      cargoId: cargoBillets,
      contractId: iso.contractId,
    });
    const pc = await makePortCall(iso.voyageId);

    const set = await overrideContractLaytimeTerm(pc, termId);
    expect(set.ok).toBe(true);

    const cleared = await overrideContractLaytimeTerm(pc, null);
    expect(cleared.ok).toBe(true);
    if (cleared.ok) expect(cleared.data.contractLaytimeTermId).toBeNull();

  });

  it("22. a term from a different contract is refused", async () => {
    currentToken = adminToken;
    const [otherContract] = await db
      .insert(contracts)
      .values({
        organizationId: orgA,
        reference: `OTHER-${stamp}`,
        counterparty: "Other Party",
      })
      .returning({ id: contracts.id });

    const [foreignTerm] = await db
      .insert(contractLaytimeTerms)
      .values({
        organizationId: orgA,
        contractId: otherContract.id,
        function: "LOAD",
        portId: null,
        cargoId: null,
        allowance: "5",
        allowanceUnit: "days",
        demurrageRate: "18500",
        commencementRule: "NOR_ACCEPTED",
        ruleSetVersionId: versionId,
      })
      .returning({ id: contractLaytimeTerms.id });

    const pc = await makePortCall(voyageWithContract);
    const r = await overrideContractLaytimeTerm(pc, foreignTerm.id);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });

  it("23. overriding on a voyage with no contract is refused", async () => {
    currentToken = adminToken;
    const termId = await makeTerm({ portId: portAlex, cargoId: cargoBillets });
    const pc = await makePortCall(voyageNoContract);

    const r = await overrideContractLaytimeTerm(pc, termId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("CONTRACT_REQUIRED");

  });

  it("24. a viewer cannot override", async () => {
    currentToken = adminToken;
    const iso = await makeIsolatedVoyage();
    const termId = await makeTerm({
      portId: portAlex,
      cargoId: cargoBillets,
      contractId: iso.contractId,
    });
    const pc = await makePortCall(iso.voyageId);

    currentToken = viewerToken;
    const r = await overrideContractLaytimeTerm(pc, termId);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FORBIDDEN");

    currentToken = adminToken;
  });
});
