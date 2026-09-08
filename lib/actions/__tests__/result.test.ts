import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import { mapDatabaseError, withDatabaseErrors, ok } from "../result";

const URL =
  process.env.DATABASE_URL ??
  "postgresql://voyantix:voyantix@127.0.0.1:5432/voyantix_dev";

const ORG_A = "aaaa0000-0000-4000-8000-00000000000a";
const ORG_B = "bbbb0000-0000-4000-8000-00000000000b";
const PORT_B = "cccc0000-0000-4000-8000-00000000000c";

async function sql(text: string) {
  const c = new Client(URL);
  await c.connect();
  try {
    return await c.query(text);
  } finally {
    await c.end();
  }
}

/** Runs a statement that is EXPECTED to fail, and returns the raw error. */
async function pgError(text: string): Promise<unknown> {
  const c = new Client(URL);
  await c.connect();
  try {
    await c.query(text);
    throw new Error("expected the query to fail, but it succeeded");
  } catch (e) {
    return e;
  } finally {
    await c.end();
  }
}

beforeAll(async () => {
  await sql(`
    INSERT INTO organizations (id, name, slug) VALUES
      ('${ORG_A}', 'Result Test A', 'result-test-a'),
      ('${ORG_B}', 'Result Test B', 'result-test-b');
    INSERT INTO cargoes (organization_id, name)
      VALUES ('${ORG_A}', 'Result Test Cargo');
    INSERT INTO ports (id, organization_id, name, country, default_timezone)
      VALUES ('${PORT_B}', '${ORG_B}', 'Result Test Port B', 'UAE', 'Asia/Dubai');
  `);
});

afterAll(async () => {
  // Cascades remove every row created above.
  await sql(
    `DELETE FROM organizations WHERE id IN ('${ORG_A}', '${ORG_B}');`
  );
});

describe("mapDatabaseError with real PostgreSQL errors", () => {
  it("maps a duplicate normalized name to DUPLICATE_NAME", async () => {
    const e = await pgError(
      `INSERT INTO cargoes (organization_id, name) VALUES ('${ORG_A}', '  RESULT test CARGO  ')`
    );
    const r = mapDatabaseError(e);
    expect(r).not.toBeNull();
    expect(r!.ok).toBe(false);
    if (!r!.ok) expect(r!.code).toBe("DUPLICATE_NAME");
  });

  it("maps a cross-tenant composite FK to NOT_FOUND, never FORBIDDEN", async () => {
    const e = await pgError(
      `INSERT INTO facilities (organization_id, port_id, name) VALUES ('${ORG_A}', '${PORT_B}', 'Probe')`
    );
    const r = mapDatabaseError(e);
    expect(r).not.toBeNull();
    if (!r!.ok) {
      expect(r!.code).toBe("NOT_FOUND");
      expect(r!.code).not.toBe("FORBIDDEN");
    }
  });

  it("maps a known CHECK violation to INVALID_STATE", async () => {
    const e = await pgError(
      `INSERT INTO operational_event_types (organization_id, code, label, system_semantic, is_protected)
       VALUES ('${ORG_A}', 'probe_code', 'Probe', 'MADE_UP_SEMANTIC', true)`
    );
    const r = mapDatabaseError(e);
    expect(r).not.toBeNull();
    if (!r!.ok) expect(r!.code).toBe("INVALID_STATE");
  });

  it("returns null for an invalid enum value so the caller rethrows", async () => {
    const e = await pgError(
      `INSERT INTO vessels (organization_id, name, status) VALUES ('${ORG_A}', 'V', 'deleted')`
    );
    expect(mapDatabaseError(e)).toBeNull();
  });

  it("returns null for a NOT NULL violation so the caller rethrows", async () => {
    const e = await pgError(
      `INSERT INTO ports (organization_id, name, country) VALUES ('${ORG_A}', 'No TZ', 'Egypt')`
    );
    expect(mapDatabaseError(e)).toBeNull();
  });
});

describe("mapDatabaseError is a whitelist, not a catch-all", () => {
  it("returns null for a mappable code with an unregistered constraint", () => {
    expect(
      mapDatabaseError({ code: "23505", constraint: "some_future_idx" })
    ).toBeNull();
  });

  it("returns null when the constraint name is absent", () => {
    expect(mapDatabaseError({ code: "23505" })).toBeNull();
  });

  it("returns null for unrelated errors", () => {
    expect(mapDatabaseError(new Error("boom"))).toBeNull();
    expect(mapDatabaseError({ code: "ECONNREFUSED" })).toBeNull();
    expect(mapDatabaseError(null)).toBeNull();
    expect(mapDatabaseError("a string")).toBeNull();
    expect(mapDatabaseError(undefined)).toBeNull();
  });

  it("never reads message text", () => {
    // Message and detail look exactly like a duplicate-name violation, but
    // the constraint is unregistered, so this must still be rethrown.
    expect(
      mapDatabaseError({
        code: "23505",
        constraint: "unregistered_idx",
        message: "duplicate key value violates unique constraint",
        detail: "Key (name)=(x) already exists.",
      })
    ).toBeNull();
  });
});

describe("withDatabaseErrors", () => {
  it("passes a successful result through untouched", async () => {
    const r = await withDatabaseErrors(async () => ok({ id: "1" }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data).toEqual({ id: "1" });
  });

  it("converts a known violation into a result", async () => {
    const e = await pgError(
      `INSERT INTO cargoes (organization_id, name) VALUES ('${ORG_A}', 'Result Test Cargo')`
    );
    const r = await withDatabaseErrors(async () => {
      throw e;
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("DUPLICATE_NAME");
  });

  it("rethrows an infrastructure failure", async () => {
    await expect(
      withDatabaseErrors(async () => {
        throw new Error("connection terminated unexpectedly");
      })
    ).rejects.toThrow("connection terminated unexpectedly");
  });

  it("rethrows an unregistered constraint rather than hiding it", async () => {
    await expect(
      withDatabaseErrors(async () => {
        throw { code: "23505", constraint: "unregistered_idx" };
      })
    ).rejects.toBeDefined();
  });
});

/**
 * REGRESSION — the gap that let a broken mapper pass its own tests.
 *
 * Everything above throws errors from a raw pg Client. The actions do not:
 * they go through Drizzle, which wraps the driver error in a
 * DrizzleQueryError and moves the PostgreSQL code and constraint onto
 * `cause`. A mapper that reads only the top level finds nothing there,
 * returns null, and a duplicate name reaches the administrator as an
 * unhandled exception — which is exactly what happened in the running app
 * while these tests were green.
 */
describe("mapDatabaseError with errors thrown through Drizzle", () => {
  it("maps a duplicate name raised by a real Drizzle insert", async () => {
    const { db } = await import("@/db/client");
    const { cargoes } = await import("@/db/schema");

    let thrown: unknown = null;
    try {
      await db
        .insert(cargoes)
        .values({ organizationId: ORG_A, name: "Result Test Cargo" });
    } catch (e) {
      thrown = e;
    }

    expect(thrown).not.toBeNull();
    // The shape that broke the mapper: nothing useful at the top level.
    expect((thrown as { code?: string }).code).toBeUndefined();

    const r = mapDatabaseError(thrown);
    expect(r).not.toBeNull();
    if (!r!.ok) expect(r!.code).toBe("DUPLICATE_NAME");
  });

  it("still refuses an unregistered constraint nested on cause", () => {
    expect(
      mapDatabaseError({ cause: { code: "23505", constraint: "unregistered_idx" } })
    ).toBeNull();
  });

  it("does not hang on a deep or empty cause chain", () => {
    expect(
      mapDatabaseError({ cause: { cause: { cause: { cause: { cause: {} } } } } })
    ).toBeNull();
  });
});
