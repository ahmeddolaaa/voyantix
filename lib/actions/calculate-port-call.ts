"use server";

import { authorized } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail } from "./result";
import { loadPortCallCalcData } from "./_calc-loader";
import { computePortCall } from "@/lib/laytime/service/compute";
import { CalculationRefused } from "@/lib/laytime/refuse";
import type { ClassifiedInterval } from "@/lib/laytime/classify";

/**
 * CALCULATE PORT CALL — the Phase 7 read-only bridge from stored records to a
 * balance. It LOADS a port call's data and runs the pure engine; it does not
 * persist (that is recalculatePortCall). A `statement.recalculate` capability
 * — a viewer can read a stored statement but cannot run the engine.
 *
 * A REFUSAL is a first-class, expected RESULT, not an error: the engine
 * refuses rather than guessing when a required event, rule or unit is
 * undefined. So a refusal is returned under `ok: true` as
 * `{ status: "refused", code, reason }`, carrying the engine's refusal code.
 * `ok: false` is reserved for access/tenancy (NOT_FOUND, FORBIDDEN).
 */

export type CalculatedTimesheetInterval = {
  start: Date;
  end: Date;
  treatment: ClassifiedInterval["treatment"];
  countedFraction: number;
  reasons: string[];
};

export type CalculationSuccess = {
  status: "calculated";
  window: { start: Date; end: Date };
  commencementAt: Date;
  turnTime: { start: Date; end: Date } | null;
  allowedSeconds: number;
  usedSeconds: number;
  balanceSeconds: number;
  outcome: "SAVED" | "EXCEEDED" | "EXACT";
  intervals: CalculatedTimesheetInterval[];
};

export type CalculationRefusal = {
  status: "refused";
  /** The engine's structured refusal code (e.g. WINDOW_END_EVENT_MISSING). */
  code: string;
  reason: string;
};

export type CalculationOutcome = CalculationSuccess | CalculationRefusal;

export async function calculatePortCall(
  portCallId: string
): Promise<ActionResult<CalculationOutcome>> {
  try {
    return await authorized<ActionResult<CalculationOutcome>>(
      "statement.recalculate",
      async (ctx) => {
        const loaded = await loadPortCallCalcData(ctx, portCallId);
        if (loaded.kind === "notfound") {
          return fail<CalculationOutcome>("NOT_FOUND", "Port call not found.");
        }
        if (loaded.kind === "no_term") {
          return ok<CalculationOutcome>({
            status: "refused",
            code: "PORT_CALL_TERM_UNRESOLVED",
            reason:
              "Cannot calculate: this port call has no laytime term resolved. Resolve or set a term before calculating.",
          });
        }

        try {
          const c = computePortCall(loaded.data);
          return ok<CalculationOutcome>({
            status: "calculated",
            window: c.window,
            commencementAt: c.commencementAt,
            turnTime: c.turnTime
              ? { start: c.turnTime.interval.start, end: c.turnTime.interval.end }
              : null,
            allowedSeconds: c.allowedSeconds,
            usedSeconds: c.balance.usedSeconds,
            balanceSeconds: c.balance.balanceSeconds,
            outcome: c.balance.outcome,
            intervals: c.intervals.map((i) => ({
              start: i.start,
              end: i.end,
              treatment: i.treatment,
              countedFraction: i.countedFraction,
              reasons: i.reasons,
            })),
          });
        } catch (e) {
          if (e instanceof CalculationRefused) {
            return ok<CalculationOutcome>({
              status: "refused",
              code: e.code,
              reason: e.message,
            });
          }
          throw e;
        }
      }
    );
  } catch (e) {
    if (e instanceof ForbiddenError) {
      return fail<CalculationOutcome>(
        "FORBIDDEN",
        "You do not have permission to perform this action."
      );
    }
    throw e;
  }
}
