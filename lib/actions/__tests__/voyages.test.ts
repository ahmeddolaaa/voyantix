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
  vessels,
  companyConfigurations,
} from "@/db/schema";
import { eq } from "drizzle-orm";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import {
  listVoyages,
  getVoyage,
  createVoyage,
  updateVoyage,
  setVoyageStatus,
} from "../voyages";

const stamp = Date.now();

let orgA: string;
let orgB: string;
let adminToken: string;
let viewerToken: string;
let orgBToken: string;

let voyageA: string;
let vesselA: string;
let vesselB: string;

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
    .values({ name: "VY Test A", slug: `vy-a-${stamp}` })
    .returning();
  const [b] = await db
    .insert(organizations)
    .values({ name: "VY Test B", slug: `vy-b-${stamp}` })
    .returning();
  orgA = a.id;
  orgB = b.id;

  // Org A gets a company configuration so reference generation can run.
  // Org B deliberately gets none, to prove the INVALID_STATE path.
  await db.insert(companyConfigurations).values({
    organizationId: orgA,
    voyageReferencePattern: `T${stamp % 10000}-{YY}{SEQ:4}`,
  });

  adminToken = await makeUserWithSession(`admin-${stamp}@a.test`, orgA, "admin");
  viewerToken = await makeUserWithSession(`viewer-${stamp}@a.test`, orgA, "viewer");
  orgBToken = await makeUserWithSession(`admin-${stamp}@b.test`, orgB, "admin");

  const [vA] = await db
    .insert(vessels)
    .values({ organizationId: orgA, name: `Vessel A ${stamp}` })
    .returning({ id: vessels.id });
  vesselA = vA.id;

  const [vB] = await db
    .insert(vessels)
    .values({ organizationId: orgB, name: `Vessel B ${stamp}` })
    .returning({ id: vessels.id });
  vesselB = vB.id;

  const [v] = await db
    .insert(voyages)
    .values({
      organizationId: orgA,
      voyageReference: `BASE-${stamp}`,
      vesselName: "Base Vessel",
    })
    .returning({ id: voyages.id });
  voyageA = v.id;
});

afterAll(async () => {
  await db.delete(organizations).where(eq(organizations.id, orgA));
  await db.delete(organizations).where(eq(organizations.id, orgB));
});

describe("listVoyages", () => {
  it("1. is tenant-scoped: org A sees its own voyages, org B does not", async () => {
    currentToken = adminToken;
    const a = await listVoyages();
    expect(a.ok).toBe(true);
    if (a.ok) expect(a.data.map((r) => r.id)).toContain(voyageA);

    currentToken = orgBToken;
    const b = await listVoyages();
    expect(b.ok).toBe(true);
    if (b.ok) expect(b.data.map((r) => r.id)).not.toContain(voyageA);
  });
});

describe("getVoyage", () => {
  it("2. cross-tenant get returns NOT_FOUND", async () => {
    currentToken = orgBToken;
    const r = await getVoyage(voyageA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });
});

describe("createVoyage — reference generation", () => {
  it("3. generates a reference from the company pattern when none is supplied", async () => {
    currentToken = adminToken;
    const r = await createVoyage({ vesselName: "Generated Vessel" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    const year = String(new Date().getUTCFullYear()).slice(-2);
    // Pattern is T{stamp}-{YY}{SEQ:4}; sequence is zero-padded to 4 digits.
    expect(r.data.voyageReference).toMatch(
      new RegExp(`^T${stamp % 10000}-${year}\\d{4}$`)
    );
  });

  it("4. allocates sequential references, not the same one twice", async () => {
    currentToken = adminToken;
    const first = await createVoyage({ vesselName: "Seq One" });
    const second = await createVoyage({ vesselName: "Seq Two" });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(first.data.voyageReference).not.toBe(second.data.voyageReference);

    const seqOf = (ref: string) => Number(ref.slice(-4));
    expect(seqOf(second.data.voyageReference)).toBe(
      seqOf(first.data.voyageReference) + 1
    );
  });

  it("5. concurrent creates never collide on the same reference", async () => {
    currentToken = adminToken;
    const results = await Promise.all([
      createVoyage({ vesselName: "Race 1" }),
      createVoyage({ vesselName: "Race 2" }),
      createVoyage({ vesselName: "Race 3" }),
      createVoyage({ vesselName: "Race 4" }),
    ]);

    for (const r of results) expect(r.ok).toBe(true);
    const refs = results.flatMap((r) => (r.ok ? [r.data.voyageReference] : []));
    expect(new Set(refs).size).toBe(refs.length);
  });

  it("6. a manual override is used verbatim and consumes no sequence", async () => {
    currentToken = adminToken;
    const manual = `MANUAL-${stamp}`;
    const r = await createVoyage({
      voyageReference: manual,
      vesselName: "Override Vessel",
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.voyageReference).toBe(manual);
  });

  it("7. an org with no company configuration cannot auto-generate", async () => {
    currentToken = orgBToken;
    const r = await createVoyage({ vesselName: "No Config Vessel" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("INVALID_STATE");
  });

  it("8. that same org can still create with a manual reference", async () => {
    currentToken = orgBToken;
    const r = await createVoyage({
      voyageReference: `B-MANUAL-${stamp}`,
      vesselName: "No Config Vessel",
    });
    expect(r.ok).toBe(true);
  });
});

describe("createVoyage — validation and integrity", () => {
  it("9. requires a vessel name", async () => {
    currentToken = adminToken;
    const r = await createVoyage({ vesselName: "   " });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("VALIDATION_ERROR");
  });

  it("10. duplicate reference (case/space-insensitive) maps to DUPLICATE_CODE", async () => {
    currentToken = adminToken;
    const ref = `DUP-${stamp}`;
    const first = await createVoyage({ voyageReference: ref, vesselName: "A" });
    expect(first.ok).toBe(true);

    const second = await createVoyage({
      voyageReference: `  ${ref.toLowerCase()}  `,
      vesselName: "B",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("DUPLICATE_CODE");
  });

  it("11. accepts an optional vessel link from the same org", async () => {
    currentToken = adminToken;
    const r = await createVoyage({
      vesselName: "Linked Vessel",
      vesselId: vesselA,
    });
    expect(r.ok).toBe(true);
  });

  it("12. rejects a vessel belonging to another org with NOT_FOUND", async () => {
    currentToken = adminToken;
    const r = await createVoyage({
      vesselName: "Cross Tenant Vessel",
      vesselId: vesselB,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });
});

describe("updateVoyage", () => {
  it("13. updates a same-tenant row", async () => {
    currentToken = adminToken;
    const created = await createVoyage({
      voyageReference: `EDIT-${stamp}`,
      vesselName: "Before Vessel",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    const r = await updateVoyage(created.data.id, {
      voyageReference: `EDITED-${stamp}`,
      vesselName: "After Vessel",
    });
    expect(r.ok).toBe(true);

    const [row] = await db
      .select({
        voyageReference: voyages.voyageReference,
        vesselName: voyages.vesselName,
      })
      .from(voyages)
      .where(eq(voyages.id, created.data.id));
    expect(row.voyageReference).toBe(`EDITED-${stamp}`);
    expect(row.vesselName).toBe("After Vessel");
  });

  it("14. cross-tenant update returns NOT_FOUND", async () => {
    currentToken = orgBToken;
    const r = await updateVoyage(voyageA, {
      voyageReference: "CROSS",
      vesselName: "X",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });
});

describe("setVoyageStatus", () => {
  it("15. moves through all three states; same-status is a no-op", async () => {
    currentToken = adminToken;

    const completed = await setVoyageStatus(voyageA, "COMPLETED");
    expect(completed.ok).toBe(true);
    if (completed.ok) expect(completed.data.changed).toBe(true);

    const again = await setVoyageStatus(voyageA, "COMPLETED");
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.data.changed).toBe(false);

    const cancelled = await setVoyageStatus(voyageA, "CANCELLED");
    expect(cancelled.ok).toBe(true);
    if (cancelled.ok) expect(cancelled.data.changed).toBe(true);

    const back = await setVoyageStatus(voyageA, "ACTIVE");
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.data.changed).toBe(true);
  });

  it("16. cross-tenant setStatus returns NOT_FOUND", async () => {
    currentToken = orgBToken;
    const r = await setVoyageStatus(voyageA, "CANCELLED");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("NOT_FOUND");
  });
});

describe("authorization", () => {
  it("17. a user without masterdata.write is rejected with FORBIDDEN", async () => {
    currentToken = viewerToken;
    const r = await createVoyage({ vesselName: "Denied Vessel" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("FORBIDDEN");
  });
});