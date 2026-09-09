"use server";

import { db } from "@/db/client";
import { operationalEventTypes } from "@/db/schema";
import { and, asc, eq } from "drizzle-orm";
import { authorized, recordAudit } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail, withDatabaseErrors } from "./result";

/**
 * OPERATIONAL EVENT TYPE MASTER DATA - the vocabulary of port-call events.
 *
 * Two kinds of row live in this table:
 *
 *   PROTECTED rows (isProtected = true) are product infrastructure. Each
 *   carries a systemSemantic the laytime engine resolves against. They are
 *   seeded per organization and may never be created, deleted, deactivated,
 *   or have their code/systemSemantic changed. Only their label is editable
 *   (a company may call "NOR Accepted" something else).
 *
 *   ORDINARY rows (isProtected = false) are customer-defined. They never
 *   carry a semantic, and support the usual create / edit / activate cycle.
 *
 * This action layer NEVER constructs a protected field in a write payload.
 * The create contract has no semantic/protected inputs at all, and update
 * branches on isProtected to decide which columns it is even allowed to
 * touch. The database CHECK constraints are the backstop, not the only
 * line of defense.
 */

const ALLOWED_STATUSES = ["active", "inactive"] as const;

export type EventTypeRow = {
  id: string;
  code: string;
  label: string;
  systemSemantic: string | null;
  isProtected: boolean;
  displayOrder: number;
  status: "active" | "inactive";
};

async function eventTypeAction<T>(
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

export type EventTypeInput = {
  code: string;
  label: string;
};

function validateEventTypeInput(
  input: EventTypeInput
): ActionResult<{ code: string; label: string }> {
  const code = (input.code ?? "").trim();
  if (code === "") {
    return fail("VALIDATION_ERROR", "Event type code is required.");
  }
  if (code.length > 60) {
    return fail("VALIDATION_ERROR", "Event type code must be 60 characters or fewer.");
  }

  const label = (input.label ?? "").trim();
  if (label === "") {
    return fail("VALIDATION_ERROR", "Event type label is required.");
  }
  if (label.length > 120) {
    return fail("VALIDATION_ERROR", "Event type label must be 120 characters or fewer.");
  }

  return ok({ code, label });
}

/**
 * When editing a protected row, only the label is validated and written.
 * The code is immutable, so we neither require nor read it here.
 */
function validateProtectedLabel(
  input: EventTypeInput
): ActionResult<{ label: string }> {
  const label = (input.label ?? "").trim();
  if (label === "") {
    return fail("VALIDATION_ERROR", "Event type label is required.");
  }
  if (label.length > 120) {
    return fail("VALIDATION_ERROR", "Event type label must be 120 characters or fewer.");
  }
  return ok({ label });
}

export async function listEventTypes(
  options: { includeInactive?: boolean } = {}
): Promise<ActionResult<EventTypeRow[]>> {
  return eventTypeAction<EventTypeRow[]>("masterdata.read", async (ctx) => {
    const scope = options.includeInactive
      ? eq(operationalEventTypes.organizationId, ctx.organizationId)
      : and(
          eq(operationalEventTypes.organizationId, ctx.organizationId),
          eq(operationalEventTypes.status, "active")
        );

    const rows = await db
      .select({
        id: operationalEventTypes.id,
        code: operationalEventTypes.code,
        label: operationalEventTypes.label,
        systemSemantic: operationalEventTypes.systemSemantic,
        isProtected: operationalEventTypes.isProtected,
        displayOrder: operationalEventTypes.displayOrder,
        status: operationalEventTypes.status,
      })
      .from(operationalEventTypes)
      .where(scope)
      .orderBy(
        asc(operationalEventTypes.displayOrder),
        asc(operationalEventTypes.code)
      );

    return ok(rows as EventTypeRow[]);
  });
}

/**
 * Creates an ORDINARY event type only. There is no path here to a protected
 * row: isProtected is forced false and systemSemantic null, and the input
 * contract carries neither field. displayOrder defaults after the protected
 * band so custom rows sort beneath the system ones.
 */
export async function createEventType(
  input: EventTypeInput
): Promise<ActionResult<{ id: string }>> {
  return eventTypeAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validateEventTypeInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    return withDatabaseErrors<{ id: string }>(async () => {
      const [created] = await db
        .insert(operationalEventTypes)
        .values({
          organizationId: ctx.organizationId,
          code: v.code,
          label: v.label,
          systemSemantic: null,
          isProtected: false,
          displayOrder: 1000,
          status: "active",
        })
        .returning({ id: operationalEventTypes.id });

      await recordAudit(ctx, {
        entityType: "OperationalEventType",
        entityId: created.id,
        action: "create",
        after: { code: v.code, label: v.label },
      });

      return ok({ id: created.id });
    });
  });
}

/**
 * Updates an event type. The columns touched depend on the row:
 *
 *   protected -> label only. code and systemSemantic are never placed in
 *                the payload, so they cannot change through this action.
 *   ordinary  -> code and label.
 *
 * The protection is structural: we build a different SET clause per branch
 * rather than accepting a full payload and filtering it.
 */
export async function updateEventType(
  id: string,
  input: EventTypeInput
): Promise<ActionResult<{ id: string }>> {
  return eventTypeAction<{ id: string }>("masterdata.write", async (ctx) => {
    return withDatabaseErrors<{ id: string }>(async () => {
      const existing = await db
        .select({
          code: operationalEventTypes.code,
          label: operationalEventTypes.label,
          isProtected: operationalEventTypes.isProtected,
        })
        .from(operationalEventTypes)
        .where(
          and(
            eq(operationalEventTypes.id, id),
            eq(operationalEventTypes.organizationId, ctx.organizationId)
          )
        );

      if (existing.length === 0) {
        return fail<{ id: string }>("NOT_FOUND", "Event type not found.");
      }

      const row = existing[0];

      if (row.isProtected) {
        const validated = validateProtectedLabel(input);
        if (!validated.ok) return validated;
        const label = validated.data.label;

        const [updated] = await db
          .update(operationalEventTypes)
          .set({ label, updatedAt: new Date() })
          .where(
            and(
              eq(operationalEventTypes.id, id),
              eq(operationalEventTypes.organizationId, ctx.organizationId)
            )
          )
          .returning({ id: operationalEventTypes.id });

        if (!updated) {
          return fail<{ id: string }>("NOT_FOUND", "Event type not found.");
        }

        await recordAudit(ctx, {
          entityType: "OperationalEventType",
          entityId: id,
          action: "update",
          before: { label: row.label },
          after: { label },
        });

        return ok({ id: updated.id });
      }

      const validated = validateEventTypeInput(input);
      if (!validated.ok) return validated;
      const v = validated.data;

      const [updated] = await db
        .update(operationalEventTypes)
        .set({ code: v.code, label: v.label, updatedAt: new Date() })
        .where(
          and(
            eq(operationalEventTypes.id, id),
            eq(operationalEventTypes.organizationId, ctx.organizationId)
          )
        )
        .returning({ id: operationalEventTypes.id });

      if (!updated) {
        return fail<{ id: string }>("NOT_FOUND", "Event type not found.");
      }

      await recordAudit(ctx, {
        entityType: "OperationalEventType",
        entityId: id,
        action: "update",
        before: { code: row.code, label: row.label },
        after: { code: v.code, label: v.label },
      });

      return ok({ id: updated.id });
    });
  });
}

/**
 * Activates or deactivates an ORDINARY event type. Protected rows are
 * refused with INVALID_STATE before any write - the engine needs all eight
 * semantics available at all times. The database CHECK enforces the same
 * rule, but we never let the attempt reach it.
 */
export async function setEventTypeStatus(
  id: string,
  status: "active" | "inactive"
): Promise<ActionResult<{ id: string; status: "active" | "inactive"; changed: boolean }>> {
  type Out = { id: string; status: "active" | "inactive"; changed: boolean };

  return eventTypeAction<Out>("masterdata.write", async (ctx) => {
    if (!ALLOWED_STATUSES.includes(status)) {
      return fail<Out>("VALIDATION_ERROR", "Status must be active or inactive.");
    }

    return withDatabaseErrors<Out>(async () => {
      const existing = await db
        .select({
          status: operationalEventTypes.status,
          isProtected: operationalEventTypes.isProtected,
        })
        .from(operationalEventTypes)
        .where(
          and(
            eq(operationalEventTypes.id, id),
            eq(operationalEventTypes.organizationId, ctx.organizationId)
          )
        );

      if (existing.length === 0) {
        return fail<Out>("NOT_FOUND", "Event type not found.");
      }

      if (existing[0].isProtected) {
        return fail<Out>(
          "INVALID_STATE",
          "System event types cannot be deactivated."
        );
      }

      const current = existing[0].status;
      if (current === status) {
        return ok({ id, status, changed: false });
      }

      await db
        .update(operationalEventTypes)
        .set({ status, updatedAt: new Date() })
        .where(
          and(
            eq(operationalEventTypes.id, id),
            eq(operationalEventTypes.organizationId, ctx.organizationId)
          )
        );

      await recordAudit(ctx, {
        entityType: "OperationalEventType",
        entityId: id,
        action: status === "active" ? "activate" : "deactivate",
        before: { status: current },
        after: { status },
      });

      return ok({ id, status, changed: true });
    });
  });
}