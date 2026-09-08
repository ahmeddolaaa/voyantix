"use server";

import { db } from "@/db/client";
import { stoppageReasons } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { authorized, recordAudit } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail, withDatabaseErrors } from "./result";

/**
 * STOPPAGE REASON MASTER DATA - why operations paused.
 * Deliberately neutral: a name and a weather flag, nothing more.
 * No defaultCountability - whether a stoppage counts against laytime is
 * decided by a ContractStoppageRule at calculation time, never here.
 * Name is unique within the organization, normalized for case and whitespace.
 */

export type StoppageReasonRow = {
  id: string;
  name: string;
  isWeatherRelated: boolean;
  status: "active" | "inactive";
};

async function stoppageReasonAction<T>(
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

export type StoppageReasonInput = {
  name: string;
  isWeatherRelated?: boolean;
};

function validateStoppageReasonInput(
  input: StoppageReasonInput
): ActionResult<{ name: string; isWeatherRelated: boolean }> {
  const name = (input.name ?? "").trim();
  if (name === "") {
    return fail("VALIDATION_ERROR", "Stoppage reason name is required.");
  }
  if (name.length > 120) {
    return fail("VALIDATION_ERROR", "Stoppage reason name must be 120 characters or fewer.");
  }
  const isWeatherRelated = input.isWeatherRelated === true;
  return ok({ name, isWeatherRelated });
}

export async function listStoppageReasons(
  options: { includeInactive?: boolean } = {}
): Promise<ActionResult<StoppageReasonRow[]>> {
  return stoppageReasonAction<StoppageReasonRow[]>("masterdata.read", async (ctx) => {
    const scope = options.includeInactive
      ? eq(stoppageReasons.organizationId, ctx.organizationId)
      : and(
          eq(stoppageReasons.organizationId, ctx.organizationId),
          eq(stoppageReasons.status, "active")
        );

    const rows = await db
      .select({
        id: stoppageReasons.id,
        name: stoppageReasons.name,
        isWeatherRelated: stoppageReasons.isWeatherRelated,
        status: stoppageReasons.status,
      })
      .from(stoppageReasons)
      .where(scope)
      .orderBy(asc(stoppageReasons.name));

    return ok(rows as StoppageReasonRow[]);
  });
}

export async function createStoppageReason(
  input: StoppageReasonInput
): Promise<ActionResult<{ id: string }>> {
  return stoppageReasonAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validateStoppageReasonInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    return withDatabaseErrors<{ id: string }>(async () => {
      const [created] = await db
        .insert(stoppageReasons)
        .values({
          organizationId: ctx.organizationId,
          name: v.name,
          isWeatherRelated: v.isWeatherRelated,
        })
        .returning({ id: stoppageReasons.id });

      await recordAudit(ctx, {
        entityType: "StoppageReason",
        entityId: created.id,
        action: "create",
        after: v,
      });

      return ok({ id: created.id });
    });
  });
}

export async function updateStoppageReason(
  id: string,
  input: StoppageReasonInput
): Promise<ActionResult<{ id: string }>> {
  return stoppageReasonAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validateStoppageReasonInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    return withDatabaseErrors<{ id: string }>(async () => {
      const existing = await db
        .select({ name: stoppageReasons.name, isWeatherRelated: stoppageReasons.isWeatherRelated })
        .from(stoppageReasons)
        .where(
          and(eq(stoppageReasons.id, id), eq(stoppageReasons.organizationId, ctx.organizationId))
        );

      if (existing.length === 0) {
        return fail<{ id: string }>("NOT_FOUND", "Stoppage reason not found.");
      }

      const [updated] = await db
        .update(stoppageReasons)
        .set({ name: v.name, isWeatherRelated: v.isWeatherRelated, updatedAt: new Date() })
        .where(
          and(eq(stoppageReasons.id, id), eq(stoppageReasons.organizationId, ctx.organizationId))
        )
        .returning({ id: stoppageReasons.id });

      if (!updated) {
        return fail<{ id: string }>("NOT_FOUND", "Stoppage reason not found.");
      }

      await recordAudit(ctx, {
        entityType: "StoppageReason",
        entityId: id,
        action: "update",
        before: existing[0],
        after: v,
      });

      return ok({ id: updated.id });
    });
  });
}

export async function setStoppageReasonStatus(
  id: string,
  status: "active" | "inactive"
): Promise<ActionResult<{ id: string; status: "active" | "inactive"; changed: boolean }>> {
  type Out = { id: string; status: "active" | "inactive"; changed: boolean };

  return stoppageReasonAction<Out>("masterdata.write", async (ctx) => {
    if (status !== "active" && status !== "inactive") {
      return fail<Out>("VALIDATION_ERROR", "Status must be active or inactive.");
    }

    return withDatabaseErrors<Out>(async () => {
      const existing = await db
        .select({ status: stoppageReasons.status })
        .from(stoppageReasons)
        .where(
          and(eq(stoppageReasons.id, id), eq(stoppageReasons.organizationId, ctx.organizationId))
        );

      if (existing.length === 0) {
        return fail<Out>("NOT_FOUND", "Stoppage reason not found.");
      }

      const current = existing[0].status;
      if (current === status) {
        return ok({ id, status, changed: false });
      }

      await db
        .update(stoppageReasons)
        .set({ status, updatedAt: new Date() })
        .where(
          and(eq(stoppageReasons.id, id), eq(stoppageReasons.organizationId, ctx.organizationId))
        );

      await recordAudit(ctx, {
        entityType: "StoppageReason",
        entityId: id,
        action: status === "active" ? "activate" : "deactivate",
        before: { status: current },
        after: { status },
      });

      return ok({ id, status, changed: true });
    });
  });
}