"use server";

import { db } from "@/db/client";
import { stoppages, voyagePortCalls } from "@/db/schema";
import { and, asc, eq, ne } from "drizzle-orm";
import { authorized, recordAudit } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail, withDatabaseErrors } from "./result";

/**
 * STOPPAGE — a period during which work stopped at a port call (Phase 5).
 *
 * Interval semantics, carried over unchanged: [startTime, endTime). Two
 * stoppages that merely touch (one ends at 11:00, the next starts at 11:00)
 * do not overlap — that is a shift handover, not a data error. A null
 * endTime means the stoppage is still running and is treated as unbounded,
 * which is also why only one of them can be open at a time: two unbounded
 * intervals always overlap.
 *
 * PO13: a stoppage must END AFTER it starts. A zero-length stoppage means
 * nothing commercially, and PostgreSQL treats an empty range as overlapping
 * nothing — such a row would evade the EXCLUDE constraint entirely and
 * could even sit inside another stoppage. A CHECK constraint blocks it at
 * the database; this layer reports it in plainer words.
 *
 * WHERE INTEGRITY ACTUALLY LIVES: `stoppages_no_overlap`, an EXCLUDE
 * constraint created in migration 0008. The overlap check below runs first
 * so the user gets a message naming the problem, but it is NOT the
 * authority — two concurrent writes could both pass it, and the constraint
 * is what stops the second one. That failure maps to CONFLICT through
 * CONSTRAINT_MAP rather than surfacing as a crash.
 */

export type StoppageRow = {
  id: string;
  portCallId: string;
  reasonId: string;
  startTime: Date;
  endTime: Date | null;
  notes: string | null;
  recordedByUserId: string;
};

async function stoppageAction<T>(
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

export type StoppageInput = {
  reasonId: string;
  /** ISO 8601 string. */
  startTime: string;
  /** ISO 8601 string, or null/omitted for a stoppage that is still running. */
  endTime?: string | null;
  notes?: string | null;
};

type ValidatedStoppage = {
  reasonId: string;
  startTime: Date;
  endTime: Date | null;
  notes: string | null;
};

function trimOrNull(v: string | null | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}

function parseInstant(value: string): Date | null {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function validateStoppageInput(
  input: StoppageInput
): ActionResult<ValidatedStoppage> {
  const reasonId = (input.reasonId ?? "").trim();
  if (reasonId === "") {
    return fail("VALIDATION_ERROR", "A stoppage reason is required.");
  }

  const rawStart = (input.startTime ?? "").trim();
  if (rawStart === "") {
    return fail("VALIDATION_ERROR", "A start time is required.");
  }
  const startTime = parseInstant(rawStart);
  if (startTime === null) {
    return fail("VALIDATION_ERROR", "The start time is not a valid date and time.");
  }

  const rawEnd = trimOrNull(input.endTime);
  let endTime: Date | null = null;
  if (rawEnd !== null) {
    endTime = parseInstant(rawEnd);
    if (endTime === null) {
      return fail("VALIDATION_ERROR", "The end time is not a valid date and time.");
    }
    // PO13 — strictly after, not merely "not before".
    if (endTime.getTime() <= startTime.getTime()) {
      return fail("VALIDATION_ERROR", "A stoppage must end after it starts.");
    }
  }

  return { ok: true, data: { reasonId, startTime, endTime, notes: trimOrNull(input.notes) } };
}

/** Confirms the port call exists inside the caller's organization. */
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

/**
 * Finds a stoppage on the same port call whose interval overlaps the
 * candidate one.
 *
 * The comparison is the historical half-open test:
 *
 *   newStart < existingEnd   AND   newEnd > existingStart
 *
 * with a null end on either side standing for "unbounded above". Touching
 * boundaries fall out as non-overlapping, which is the intended behaviour.
 *
 * `excludeId` keeps an update from colliding with the row being updated.
 */
async function findOverlapping(
  portCallId: string,
  organizationId: string,
  startTime: Date,
  endTime: Date | null,
  excludeId?: string
): Promise<StoppageRow | null> {
  const base = and(
    eq(stoppages.portCallId, portCallId),
    eq(stoppages.organizationId, organizationId)
  );

  const rows = await db
    .select({
      id: stoppages.id,
      portCallId: stoppages.portCallId,
      reasonId: stoppages.reasonId,
      startTime: stoppages.startTime,
      endTime: stoppages.endTime,
      notes: stoppages.notes,
      recordedByUserId: stoppages.recordedByUserId,
    })
    .from(stoppages)
    .where(excludeId ? and(base, ne(stoppages.id, excludeId)) : base);

  const newStart = startTime.getTime();
  const newEnd = endTime === null ? Infinity : endTime.getTime();

  for (const r of rows) {
    const existingStart = r.startTime.getTime();
    const existingEnd = r.endTime === null ? Infinity : r.endTime.getTime();
    if (newStart < existingEnd && newEnd > existingStart) {
      return r as StoppageRow;
    }
  }
  return null;
}

function overlapMessage(clash: StoppageRow): string {
  return clash.endTime === null
    ? "There is already an open stoppage on this port call. Close it before recording another."
    : "This stoppage overlaps an existing one on the same port call.";
}

export async function listStoppages(
  portCallId: string
): Promise<ActionResult<StoppageRow[]>> {
  return stoppageAction<StoppageRow[]>("masterdata.read", async (ctx) => {
    if (!(await portCallInOrg(portCallId, ctx.organizationId))) {
      return fail<StoppageRow[]>("NOT_FOUND", "Port call not found.");
    }

    const rows = await db
      .select({
        id: stoppages.id,
        portCallId: stoppages.portCallId,
        reasonId: stoppages.reasonId,
        startTime: stoppages.startTime,
        endTime: stoppages.endTime,
        notes: stoppages.notes,
        recordedByUserId: stoppages.recordedByUserId,
      })
      .from(stoppages)
      .where(
        and(
          eq(stoppages.portCallId, portCallId),
          eq(stoppages.organizationId, ctx.organizationId)
        )
      )
      .orderBy(asc(stoppages.startTime));

    return ok(rows as StoppageRow[]);
  });
}

export async function createStoppage(
  portCallId: string,
  input: StoppageInput
): Promise<ActionResult<{ id: string }>> {
  return stoppageAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validateStoppageInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    if (!(await portCallInOrg(portCallId, ctx.organizationId))) {
      return fail<{ id: string }>("NOT_FOUND", "Port call not found.");
    }

    return withDatabaseErrors<{ id: string }>(async () => {
      return db.transaction(async (tx) => {
        const clash = await findOverlapping(
          portCallId,
          ctx.organizationId,
          v.startTime,
          v.endTime
        );
        if (clash) {
          return fail<{ id: string }>("CONFLICT", overlapMessage(clash));
        }

        const [created] = await tx
          .insert(stoppages)
          .values({
            organizationId: ctx.organizationId,
            portCallId,
            reasonId: v.reasonId,
            startTime: v.startTime,
            endTime: v.endTime,
            notes: v.notes,
            recordedByUserId: ctx.userId,
          })
          .returning({ id: stoppages.id });

        await recordAudit(ctx, {
          entityType: "Stoppage",
          entityId: created.id,
          action: "create",
          after: { portCallId, ...v },
        });

        return ok({ id: created.id });
      });
    });
  });
}

/**
 * Edits a stoppage in place.
 *
 * Unlike OperationalEvent, a stoppage is a correctable record rather than
 * an append-only fact: an operator closing a stoppage they opened an hour
 * ago is editing one event, not asserting a second one. The audit log keeps
 * the before/after either way.
 */
export async function updateStoppage(
  stoppageId: string,
  input: StoppageInput
): Promise<ActionResult<{ id: string }>> {
  return stoppageAction<{ id: string }>("masterdata.write", async (ctx) => {
    const validated = validateStoppageInput(input);
    if (!validated.ok) return validated;
    const v = validated.data;

    return withDatabaseErrors<{ id: string }>(async () => {
      return db.transaction(async (tx) => {
        const existing = await tx
          .select({
            portCallId: stoppages.portCallId,
            reasonId: stoppages.reasonId,
            startTime: stoppages.startTime,
            endTime: stoppages.endTime,
            notes: stoppages.notes,
          })
          .from(stoppages)
          .where(
            and(
              eq(stoppages.id, stoppageId),
              eq(stoppages.organizationId, ctx.organizationId)
            )
          );

        if (existing.length === 0) {
          return fail<{ id: string }>("NOT_FOUND", "Stoppage not found.");
        }

        const clash = await findOverlapping(
          existing[0].portCallId,
          ctx.organizationId,
          v.startTime,
          v.endTime,
          stoppageId
        );
        if (clash) {
          return fail<{ id: string }>("CONFLICT", overlapMessage(clash));
        }

        const [updated] = await tx
          .update(stoppages)
          .set({
            reasonId: v.reasonId,
            startTime: v.startTime,
            endTime: v.endTime,
            notes: v.notes,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(stoppages.id, stoppageId),
              eq(stoppages.organizationId, ctx.organizationId)
            )
          )
          .returning({ id: stoppages.id });

        if (!updated) {
          return fail<{ id: string }>("NOT_FOUND", "Stoppage not found.");
        }

        await recordAudit(ctx, {
          entityType: "Stoppage",
          entityId: stoppageId,
          action: "update",
          before: existing[0],
          after: v,
        });

        return ok({ id: updated.id });
      });
    });
  });
}

export async function deleteStoppage(
  stoppageId: string
): Promise<ActionResult<{ id: string }>> {
  return stoppageAction<{ id: string }>("masterdata.write", async (ctx) => {
    return withDatabaseErrors<{ id: string }>(async () => {
      const existing = await db
        .select({
          portCallId: stoppages.portCallId,
          reasonId: stoppages.reasonId,
          startTime: stoppages.startTime,
          endTime: stoppages.endTime,
        })
        .from(stoppages)
        .where(
          and(
            eq(stoppages.id, stoppageId),
            eq(stoppages.organizationId, ctx.organizationId)
          )
        );

      if (existing.length === 0) {
        return fail<{ id: string }>("NOT_FOUND", "Stoppage not found.");
      }

      await db
        .delete(stoppages)
        .where(
          and(
            eq(stoppages.id, stoppageId),
            eq(stoppages.organizationId, ctx.organizationId)
          )
        );

      await recordAudit(ctx, {
        entityType: "Stoppage",
        entityId: stoppageId,
        action: "delete",
        before: existing[0],
      });

      return ok({ id: stoppageId });
    });
  });
}
