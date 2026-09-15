"use server";

import { db } from "@/db/client";
import {
  operationalEvents,
  voyagePortCalls,
  operationalEventTypes,
} from "@/db/schema";
import { and, asc, eq, isNull } from "drizzle-orm";
import { authorized, recordAudit } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail, withDatabaseErrors } from "./result";

/**
 * OPERATIONAL EVENT — append-only (Phase 5).
 *
 * There is deliberately NO update and NO delete here. A recorded event is
 * something a person asserted at a point in time, and a laytime statement
 * may later rest on it; quietly rewriting it would destroy the answer to
 * "what did we know, and when". So a correction is a SECOND event, and the
 * first one is marked as superseded by it. Both rows survive.
 *
 * That leaves exactly one mutation in this file: setting supersededByEventId
 * on the original, which correctContractEvent does inside the same
 * transaction that inserts the replacement. Nothing else touches an
 * existing row — occurredAt, eventTypeId, recordedAt and recordedByUserId
 * of a recorded event are never changed.
 *
 * Engine relevance comes only from OperationalEventType.systemSemantic
 * (F8). An event whose type carries no semantic is informational: it shows
 * on the timeline and moves no clock. Nothing in this file decides that —
 * it is a property of the type, resolved in Phase 6.
 */

export type OperationalEventRow = {
  id: string;
  portCallId: string;
  eventTypeId: string;
  occurredAt: Date;
  recordedAt: Date;
  recordedByUserId: string;
  supersededByEventId: string | null;
};

async function eventAction<T>(
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

export type OperationalEventInput = {
  eventTypeId: string;
  /** ISO 8601 string — when the event actually happened. */
  occurredAt: string;
};

function validateEventInput(
  input: OperationalEventInput
): ActionResult<{ eventTypeId: string; occurredAt: Date }> {
  const eventTypeId = (input.eventTypeId ?? "").trim();
  if (eventTypeId === "") {
    return fail("VALIDATION_ERROR", "An event type is required.");
  }

  const raw = (input.occurredAt ?? "").trim();
  if (raw === "") {
    return fail("VALIDATION_ERROR", "The time the event occurred is required.");
  }
  const occurredAt = new Date(raw);
  if (Number.isNaN(occurredAt.getTime())) {
    return fail("VALIDATION_ERROR", "That is not a valid date and time.");
  }

  return ok({ eventTypeId, occurredAt });
}

async function portCallInOrg(
  portCallId: string,
  organizationId: string
): Promise<boolean> {
  const rows = await db
    .select({ id: voyagePortCalls.id })
    .from(voyagePortCalls)
    .where(
      and(
        eq(voyagePortCalls.id, portCallId),
        eq(voyagePortCalls.organizationId, organizationId)
      )
    );
  return rows.length > 0;
}

const eventColumns = {
  id: operationalEvents.id,
  portCallId: operationalEvents.portCallId,
  eventTypeId: operationalEvents.eventTypeId,
  occurredAt: operationalEvents.occurredAt,
  recordedAt: operationalEvents.recordedAt,
  recordedByUserId: operationalEvents.recordedByUserId,
  supersededByEventId: operationalEvents.supersededByEventId,
};

/**
 * Lists events for a port call.
 *
 * By default superseded rows are included, because the whole point of
 * keeping them is that the history stays visible. Pass
 * `{ currentOnly: true }` for the view the engine will take: the events
 * that still stand.
 */
export async function listOperationalEvents(
  portCallId: string,
  options: { currentOnly?: boolean } = {}
): Promise<ActionResult<OperationalEventRow[]>> {
  return eventAction<OperationalEventRow[]>("masterdata.read", async (ctx) => {
    if (!(await portCallInOrg(portCallId, ctx.organizationId))) {
      return fail<OperationalEventRow[]>("NOT_FOUND", "Port call not found.");
    }

    const base = and(
      eq(operationalEvents.portCallId, portCallId),
      eq(operationalEvents.organizationId, ctx.organizationId)
    );

    const rows = await db
      .select(eventColumns)
      .from(operationalEvents)
      .where(
        options.currentOnly
          ? and(base, isNull(operationalEvents.supersededByEventId))
          : base
      )
      .orderBy(asc(operationalEvents.occurredAt), asc(operationalEvents.recordedAt));

    return ok(rows as OperationalEventRow[]);
  });
}

export async function recordOperationalEvent(
  portCallId: string,
  input: OperationalEventInput
): Promise<ActionResult<{ id: string }>> {
  return eventAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validateEventInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    if (!(await portCallInOrg(portCallId, ctx.organizationId))) {
      return fail<{ id: string }>("NOT_FOUND", "Port call not found.");
    }

    return withDatabaseErrors<{ id: string }>(async () => {
      const [created] = await db
        .insert(operationalEvents)
        .values({
          organizationId: ctx.organizationId,
          portCallId,
          eventTypeId: v.eventTypeId,
          occurredAt: v.occurredAt,
          recordedByUserId: ctx.userId,
        })
        .returning({ id: operationalEvents.id });

      await recordAudit(ctx, {
        entityType: "OperationalEvent",
        entityId: created.id,
        action: "record",
        after: { portCallId, ...v },
      });

      return ok({ id: created.id });
    });
  });
}

/**
 * Corrects a recorded event by replacing it.
 *
 * The original is left exactly as it was and gains a pointer to its
 * replacement; the replacement is an ordinary new event on the same port
 * call. Both happen in one transaction, so the history can never show an
 * orphaned correction or an original marked as superseded by nothing.
 *
 * An event that has already been corrected cannot be corrected again —
 * correct the current one instead, or the chain becomes a tree and "which
 * version stands" stops having one answer. The unique index on
 * supersededByEventId enforces the same thing at the database.
 */
export async function correctOperationalEvent(
  originalEventId: string,
  input: OperationalEventInput
): Promise<ActionResult<{ id: string; supersededEventId: string }>> {
  type Out = { id: string; supersededEventId: string };

  return eventAction<Out>("masterdata.write", async (ctx) => {
    const validated = validateEventInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    return withDatabaseErrors<Out>(async () => {
      return db.transaction(async (tx) => {
        const [original] = await tx
          .select({
            portCallId: operationalEvents.portCallId,
            eventTypeId: operationalEvents.eventTypeId,
            occurredAt: operationalEvents.occurredAt,
            supersededByEventId: operationalEvents.supersededByEventId,
          })
          .from(operationalEvents)
          .where(
            and(
              eq(operationalEvents.id, originalEventId),
              eq(operationalEvents.organizationId, ctx.organizationId)
            )
          );

        if (!original) {
          return fail<Out>("NOT_FOUND", "Event not found.");
        }

        if (original.supersededByEventId !== null) {
          return fail<Out>(
            "INVALID_STATE",
            "That event has already been corrected. Correct the replacement instead."
          );
        }

        const [replacement] = await tx
          .insert(operationalEvents)
          .values({
            organizationId: ctx.organizationId,
            portCallId: original.portCallId,
            eventTypeId: v.eventTypeId,
            occurredAt: v.occurredAt,
            recordedByUserId: ctx.userId,
          })
          .returning({ id: operationalEvents.id });

        await tx
          .update(operationalEvents)
          .set({ supersededByEventId: replacement.id })
          .where(
            and(
              eq(operationalEvents.id, originalEventId),
              eq(operationalEvents.organizationId, ctx.organizationId)
            )
          );

        await recordAudit(ctx, {
          entityType: "OperationalEvent",
          entityId: originalEventId,
          action: "supersede",
          before: {
            eventTypeId: original.eventTypeId,
            occurredAt: original.occurredAt,
          },
          after: {
            supersededByEventId: replacement.id,
            eventTypeId: v.eventTypeId,
            occurredAt: v.occurredAt,
          },
        });

        return ok<Out>({
          id: replacement.id,
          supersededEventId: originalEventId,
        });
      });
    });
  });
}
