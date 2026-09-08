"use server";

import { db } from "@/db/client";
import { cargoes } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { authorized, recordAudit } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail, withDatabaseErrors } from "./result";

/**
 * CARGO MASTER DATA — the commodities carried.
 * ---------------------------------------------------------------------------
 * Deliberately kept small. A cargo here is a name and, where it matters
 * commercially, a grade. There is no commodity classification tree: nothing
 * in the laytime engine or the contract layer reads one, and inventing a
 * taxonomy would impose one customer's way of grouping cargo on everyone.
 *
 * Name is unique within the organization, normalized for case and
 * surrounding whitespace, so "Iron Ore Fines" cannot be entered twice in
 * different spellings and split a customer's reporting.
 * ---------------------------------------------------------------------------
 */

export type CargoRow = {
  id: string;
  name: string;
  grade: string | null;
  status: "active" | "inactive";
};

async function cargoAction<T>(
  permission: Parameters<typeof authorized>[0],
  fn: Parameters<typeof authorized<ActionResult<T>>>[1]
): Promise<ActionResult<T>> {
  try {
    return await authorized<ActionResult<T>>(permission, fn);
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return fail<T>(
        "FORBIDDEN",
        "You do not have permission to perform this action."
      );
    }
    throw e;
  }
}

function optionalText(v: string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export type CargoInput = {
  name: string;
  grade?: string | null;
};

function validateCargoInput(
  input: CargoInput
): ActionResult<{ name: string; grade: string | null }> {
  const name = (input.name ?? "").trim();
  if (name === "") {
    return fail("VALIDATION_ERROR", "Cargo name is required.");
  }
  if (name.length > 120) {
    return fail("VALIDATION_ERROR", "Cargo name must be 120 characters or fewer.");
  }

  const grade = optionalText(input.grade);
  if (grade !== null && grade.length > 120) {
    return fail("VALIDATION_ERROR", "Grade must be 120 characters or fewer.");
  }

  return ok({ name, grade });
}

export async function listCargoes(
  options: { includeInactive?: boolean } = {}
): Promise<ActionResult<CargoRow[]>> {
  return cargoAction<CargoRow[]>("masterdata.read", async (ctx) => {
    const scope = options.includeInactive
      ? eq(cargoes.organizationId, ctx.organizationId)
      : and(
          eq(cargoes.organizationId, ctx.organizationId),
          eq(cargoes.status, "active")
        );

    const rows = await db
      .select({
        id: cargoes.id,
        name: cargoes.name,
        grade: cargoes.grade,
        status: cargoes.status,
      })
      .from(cargoes)
      .where(scope)
      .orderBy(asc(cargoes.name));

    return ok(rows as CargoRow[]);
  });
}

export async function createCargo(
  input: CargoInput
): Promise<ActionResult<{ id: string }>> {
  return cargoAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validateCargoInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    return withDatabaseErrors<{ id: string }>(async () => {
      const [created] = await db
        .insert(cargoes)
        .values({
          organizationId: ctx.organizationId,
          name: v.name,
          grade: v.grade,
        })
        .returning({ id: cargoes.id });

      await recordAudit(ctx, {
        entityType: "Cargo",
        entityId: created.id,
        action: "create",
        after: v,
      });

      return ok({ id: created.id });
    });
  });
}

export async function updateCargo(
  id: string,
  input: CargoInput
): Promise<ActionResult<{ id: string }>> {
  return cargoAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validateCargoInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    return withDatabaseErrors<{ id: string }>(async () => {
      const existing = await db
        .select({ name: cargoes.name, grade: cargoes.grade })
        .from(cargoes)
        .where(
          and(eq(cargoes.id, id), eq(cargoes.organizationId, ctx.organizationId))
        );

      if (existing.length === 0) {
        return fail<{ id: string }>("NOT_FOUND", "Cargo not found.");
      }

      const [updated] = await db
        .update(cargoes)
        .set({ name: v.name, grade: v.grade, updatedAt: new Date() })
        .where(
          and(eq(cargoes.id, id), eq(cargoes.organizationId, ctx.organizationId))
        )
        .returning({ id: cargoes.id });

      if (!updated) {
        return fail<{ id: string }>("NOT_FOUND", "Cargo not found.");
      }

      await recordAudit(ctx, {
        entityType: "Cargo",
        entityId: id,
        action: "update",
        before: existing[0],
        after: v,
      });

      return ok({ id: updated.id });
    });
  });
}

export async function setCargoStatus(
  id: string,
  status: "active" | "inactive"
): Promise<
  ActionResult<{ id: string; status: "active" | "inactive"; changed: boolean }>
> {
  type Out = { id: string; status: "active" | "inactive"; changed: boolean };

  return cargoAction<Out>("masterdata.write", async (ctx) => {
    if (status !== "active" && status !== "inactive") {
      return fail<Out>("VALIDATION_ERROR", "Status must be active or inactive.");
    }

    return withDatabaseErrors<Out>(async () => {
      const existing = await db
        .select({ status: cargoes.status })
        .from(cargoes)
        .where(
          and(eq(cargoes.id, id), eq(cargoes.organizationId, ctx.organizationId))
        );

      if (existing.length === 0) {
        return fail<Out>("NOT_FOUND", "Cargo not found.");
      }

      const current = existing[0].status;
      if (current === status) {
        return ok({ id, status, changed: false });
      }

      await db
        .update(cargoes)
        .set({ status, updatedAt: new Date() })
        .where(
          and(eq(cargoes.id, id), eq(cargoes.organizationId, ctx.organizationId))
        );

      await recordAudit(ctx, {
        entityType: "Cargo",
        entityId: id,
        action: status === "active" ? "activate" : "deactivate",
        before: { status: current },
        after: { status },
      });

      return ok({ id, status, changed: true });
    });
  });
}
