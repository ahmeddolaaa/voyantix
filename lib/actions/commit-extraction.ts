"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db/client";
import {
  operationalEventTypes,
  operationalEvents,
  stoppageReasons,
  stoppages as stoppagesTable,
  contractStoppageRules,
  voyagePortCalls,
} from "@/db/schema";
import { authorized } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { instantFromLocal } from "@/lib/laytime/timezone";
import {
  ENGINE_SEMANTIC,
  INFO_EVENT_TYPE,
  STOPPAGE_CATEGORY_LABEL,
  type LaytimeEventType,
  type StoppageCategory,
} from "@/lib/ingestion/schema";
import { createStoppageReason } from "./stoppage-reasons";
import { createEventType } from "./event-types";
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
  /** Stoppage reasons that did not exist and were created from the SOF category. */
  createdReasons: string[];
  /** Reasons of committed stoppages that the port call's term has no rule for
   *  yet — the calculation will ask for them (count or not). */
  reasonsWithoutRule: string[];
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

/** Best-effort match of an extracted stoppage to one of the org's reasons:
 *  the category's own name first, then words from the SOF text. */
function matchReason(
  reasons: { id: string; name: string }[],
  category: StoppageCategory,
  text: string
): string | null {
  const label = STOPPAGE_CATEGORY_LABEL[category].toLowerCase();
  const exact = reasons.find((r) => r.name.trim().toLowerCase() === label);
  if (exact) return exact.id;
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
          voyageId: voyagePortCalls.voyageId,
          termId: voyagePortCalls.contractLaytimeTermId,
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
          code: operationalEventTypes.code,
        })
        .from(operationalEventTypes)
        .where(eq(operationalEventTypes.organizationId, ctx.organizationId));
      const typeBySemantic = new Map<string, string>();
      const typeByCode = new Map<string, string>();
      for (const t of types) {
        if (t.sem) typeBySemantic.set(t.sem, t.id);
        typeByCode.set(t.code.trim().toLowerCase(), t.id);
      }

      const reasons = await db
        .select({ id: stoppageReasons.id, name: stoppageReasons.name })
        .from(stoppageReasons)
        .where(eq(stoppageReasons.organizationId, ctx.organizationId));

      // Events already live on this port call. Committing a SOF again (e.g.
      // after new event types became recordable) must only ADD what is
      // missing: a second live event of the same type would make the
      // calculation refuse as ambiguous, so an existing one is kept.
      const live = await db
        .select({ typeId: operationalEvents.eventTypeId, at: operationalEvents.occurredAt })
        .from(operationalEvents)
        .where(
          and(
            eq(operationalEvents.portCallId, portCallId),
            eq(operationalEvents.organizationId, ctx.organizationId),
            isNull(operationalEvents.supersededByEventId)
          )
        );
      const liveByType = new Map<string, Date>();
      for (const l of live) liveByType.set(l.typeId, l.at);

      const liveStoppages = await db
        .select({ reasonId: stoppagesTable.reasonId, start: stoppagesTable.startTime, end: stoppagesTable.endTime })
        .from(stoppagesTable)
        .where(
          and(
            eq(stoppagesTable.portCallId, portCallId),
            eq(stoppagesTable.organizationId, ctx.organizationId)
          )
        );
      const stoppageKey = (reasonId: string, start: string, end: string | null) =>
        `${reasonId}|${new Date(start).toISOString()}|${end ? new Date(end).toISOString() : ""}`;
      const existingStoppages = new Set(
        liveStoppages.map((x) => stoppageKey(x.reasonId, x.start.toISOString(), x.end ? x.end.toISOString() : null))
      );

      const skipped: string[] = [];
      let committedEvents = 0;
      let committedStoppages = 0;

      for (const e of payload.events) {
        const sem = ENGINE_SEMANTIC[e.type];
        let eventTypeId: string | undefined;
        if (sem) {
          eventTypeId = typeBySemantic.get(sem);
          if (!eventTypeId) {
            skipped.push(`No event type configured for ${sem}.`);
            continue;
          }
        } else {
          // Record-only event (e.g. vessel arrived): an ordinary custom type,
          // created the first time — it never affects the calculation (F8).
          const info = INFO_EVENT_TYPE[e.type];
          if (!info) {
            skipped.push(`Event "${e.type}" has no engine semantic yet.`);
            continue;
          }
          eventTypeId = typeByCode.get(info.code);
          if (!eventTypeId) {
            const created = await createEventType({ code: info.code, label: info.label });
            if (!created.ok) {
              skipped.push(`Event "${info.label}": could not create its event type — ${created.message}`);
              continue;
            }
            eventTypeId = created.data.id;
            typeByCode.set(info.code, eventTypeId);
          }
        }
        const occurredAt = toIso(e.occurredLocal, tz);
        if (!occurredAt) {
          skipped.push(`Event "${e.type}" has an unreadable time.`);
          continue;
        }
        const existing = liveByType.get(eventTypeId);
        if (existing) {
          if (existing.toISOString() !== occurredAt) {
            skipped.push(
              `Event "${e.type}" is already recorded at a different time — kept the recorded one (use Correct to change it).`
            );
          }
          // Same time: already recorded, nothing to do.
          continue;
        }
        const r = await recordOperationalEvent(portCallId, {
          eventTypeId,
          occurredAt,
        });
        if (r.ok) {
          committedEvents++;
          liveByType.set(eventTypeId, new Date(occurredAt));
        } else skipped.push(`Event "${e.type}": ${r.message}`);
      }

      const createdReasons: string[] = [];
      const usedReasonIds = new Set<string>();
      for (const s of payload.stoppages) {
        let reasonId = matchReason(reasons, s.reasonCategory, s.reasonText);
        if (!reasonId) {
          // The analyst confirmed the category in review: create the reason
          // under that neutral name. Whether it counts stays a CONTRACT rule.
          const name = STOPPAGE_CATEGORY_LABEL[s.reasonCategory];
          const created = await createStoppageReason({ name, isWeatherRelated: s.reasonCategory === "WEATHER" });
          if (!created.ok) {
            skipped.push(`Stoppage "${s.reasonText}": could not create the reason "${name}" — ${created.message}`);
            continue;
          }
          reasonId = created.data.id;
          reasons.push({ id: reasonId, name });
          createdReasons.push(name);
        }
        const startTime = toIso(s.startLocal, tz);
        if (!startTime) {
          skipped.push(`Stoppage "${s.reasonText}" has an unreadable start.`);
          continue;
        }
        const endTime = s.endLocal ? toIso(s.endLocal, tz) : null;
        // Identical stoppage already recorded (a repeat commit): nothing to add.
        if (existingStoppages.has(stoppageKey(reasonId, startTime, endTime))) continue;
        const r = await createStoppage(portCallId, {
          reasonId,
          startTime,
          endTime,
          notes: s.reasonText,
        });
        if (r.ok) {
          committedStoppages++;
          usedReasonIds.add(reasonId);
        } else skipped.push(`Stoppage "${s.reasonText}": ${r.message}`);
      }
      // Identical stoppages already on the port call also need a rule.
      for (const x of liveStoppages) usedReasonIds.add(x.reasonId);

      let reasonsWithoutRule: string[] = [];
      if (pc.termId && usedReasonIds.size > 0) {
        const ruled = await db
          .select({ id: contractStoppageRules.stoppageReasonId })
          .from(contractStoppageRules)
          .where(
            and(
              eq(contractStoppageRules.termId, pc.termId),
              eq(contractStoppageRules.organizationId, ctx.organizationId)
            )
          );
        const ruledIds = new Set(ruled.map((r) => r.id));
        reasonsWithoutRule = [...usedReasonIds]
          .filter((id) => !ruledIds.has(id))
          .map((id) => reasons.find((r) => r.id === id)?.name ?? id);
      }

      // The voyage page (also when reached with the browser's Back button)
      // must show the newly recorded events, not a cached copy.
      try {
        revalidatePath(`/admin/voyages/${pc.voyageId}`);
      } catch {
        // Outside a Next.js request (tests, scripts) there is no cache to purge.
      }

      return ok<CommitSummary>({
        committedEvents,
        committedStoppages,
        createdReasons,
        reasonsWithoutRule,
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
