"use server";

import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  operationalEventTypes,
  stoppageReasons,
  voyagePortCalls,
} from "@/db/schema";
import { authorized } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { instantFromLocal } from "@/lib/laytime/timezone";
import {
  ENGINE_SEMANTIC,
  type LaytimeEventType,
  type StoppageCategory,
} from "@/lib/ingestion/schema";
import { recordOperationalEvent } from "./operational-events";
import { createStoppage } from "./stoppages";
import { type ActionResult, ok, fail } from "./result";

/**
 * Commit a reviewed extraction to a port call.
 *
 * Turns the analyst-confirmed events and stoppages into real operational
 * records via the same actions the manual entry uses — so nothing here bypasses
 * validation, overlap checks, or the audit log. Only events whose type maps to
 * an engine semantic the org has an event type for are recordable; stoppages
 * need a matching org reason. Anything unmappable is reported in `skipped`, not
 * silently dropped and never guessed.
 *
 * Local wall-clock times from the document are interpreted in the port call's
 * own timezone (F18) and stored as absolute instants.
 */

export type CommitEvent = {
  type: LaytimeEventType;
  /** Local wall-clock, e.g. "2026-06-23T00:01". */
  occurredLocal: string;
};

export type CommitStoppage = {
  reasonCategory: StoppageCategory;
  reasonText: string;
  startLocal: string;
  endLocal: string | null;
};

export type CommitPayload = {
  events: CommitEvent[];
  stoppages: CommitStoppage[];
};

export type CommitSummary = {
  committedEvents: number;
  committedStoppages: number;
  /** Human-readable lines for everything that could not be committed. */
  skipped: string[];
};

function toIso(local: string, timeZone: string): string | null {
  const [d, t] = local.split("T");
  if (!d) return null;
  const [year, month, day] = d.split("-").map(Number);
  const [hour, minute] = (t ?? "00:00").split(":").map(Number);
  if ([year, month, day, hour, minute].some((n) => Number.isNaN(n))) return null;
  return instantFromLocal(
    { year, month, day, hour, minute, second: 0 },
    timeZone
  ).toISOString();
}

/** Best-effort match of an extracted stoppage to one of the org's reasons. */
function matchReason(
  reasons: { id: string; name: string }[],
  category: StoppageCategory,
  text: string
): string | null {
  const hay = `${text} ${category}`.toLowerCase();
  const catWords = category.toLowerCase().split("_");
  for (const r of reasons) {
    const n = r.name.toLowerCase();
    if (hay.includes(n)) return r.id;
    if (catWords.every((w) => n.includes(w))) return r.id;
  }
  return null;
}

export async function commitExtraction(
  portCallId: string,
  payload: CommitPayload
): Promise<ActionResult<CommitSummary>> {
  try {
    return await authorized("masterdata.write", async (ctx) => {
      const [pc] = await db
        .select({
          tz: voyagePortCalls.effectiveTimezone,
        })
        .from(voyagePortCalls)
        .where(
          and(
            eq(voyagePortCalls.id, portCallId),
            eq(voyagePortCalls.organizationId, ctx.organizationId)
          )
        );
      if (!pc) return fail<CommitSummary>("NOT_FOUND", "Port call not found.");
      const tz = pc.tz;

      const types = await db
        .select({
          id: operationalEventTypes.id,
          sem: operationalEventTypes.systemSemantic,
        })
        .from(operationalEventTypes)
        .where(eq(operationalEventTypes.organizationId, ctx.organizationId));
      const typeBySemantic = new Map<string, string>();
      for (const t of types) if (t.sem) typeBySemantic.set(t.sem, t.id);

      const reasons = await db
        .select({ id: stoppageReasons.id, name: stoppageReasons.name })
        .from(stoppageReasons)
        .where(eq(stoppageReasons.organizationId, ctx.organizationId));

      const skipped: string[] = [];
      let committedEvents = 0;
      let committedStoppages = 0;

      for (const e of payload.events) {
        const sem = ENGINE_SEMANTIC[e.type];
        if (!sem) {
          skipped.push(`Event "${e.type}" has no engine semantic yet.`);
          continue;
        }
        const eventTypeId = typeBySemantic.get(sem);
        if (!eventTypeId) {
          skipped.push(`No event type configured for ${sem}.`);
          continue;
        }
        const occurredAt = toIso(e.occurredLocal, tz);
        if (!occurredAt) {
          skipped.push(`Event "${e.type}" has an unreadable time.`);
          continue;
        }
        const r = await recordOperationalEvent(portCallId, {
          eventTypeId,
          occurredAt,
        });
        if (r.ok) committedEvents++;
        else skipped.push(`Event "${e.type}": ${r.message}`);
      }

      for (const s of payload.stoppages) {
        const reasonId = matchReason(reasons, s.reasonCategory, s.reasonText);
        if (!reasonId) {
          skipped.push(`No stoppage reason matches "${s.reasonText}".`);
          continue;
        }
        const startTime = toIso(s.startLocal, tz);
        if (!startTime) {
          skipped.push(`Stoppage "${s.reasonText}" has an unreadable start.`);
          continue;
        }
        const endTime = s.endLocal ? toIso(s.endLocal, tz) : null;
        const r = await createStoppage(portCallId, {
          reasonId,
          startTime,
          endTime,
          notes: s.reasonText,
        });
        if (r.ok) committedStoppages++;
        else skipped.push(`Stoppage "${s.reasonText}": ${r.message}`);
      }

      return ok<CommitSummary>({
        committedEvents,
        committedStoppages,
        skipped,
      });
    });
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return fail<CommitSummary>("FORBIDDEN", "Not allowed.");
    }
    throw e;
  }
}
