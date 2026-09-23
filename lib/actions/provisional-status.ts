"use server";

import { authorized } from "@/lib/auth/authorized";
import { ForbiddenError } from "@/lib/auth/session";
import { type ActionResult, ok, fail } from "./result";
import { loadPortCallCalcData } from "./_calc-loader";
import { computeProvisionalStatus } from "@/lib/laytime/service/compute";
import { CalculationRefused } from "@/lib/laytime/refuse";

/**
 * PROVISIONAL STATUS — a read-only, reference running view of laytime for a
 * port call still in progress. It answers "how much laytime is left, and are we
 * about to go on demurrage?" using PLANNED quantity until actuals exist, and
 * counting up to now (asOf) rather than to OPS_COMPLETED. It is NOT the
 * settlement; the authoritative figure is calculatePortCall once actuals and
 * the completion event exist.
 *
 * Like calculatePortCall, a REFUSAL is a first-class result under ok:true, not
 * an error; ok:false is reserved for access/tenancy (NOT_FOUND, FORBIDDEN).
 */

export type ProvisionalSuccess = {
  status: "provisional";
  window: { start: Date; end: Date };
  asOf: Date;
  allowedSeconds: number;
  usedSeconds: number;
  remainingSeconds: number;
  onDemurrage: boolean;
  /** True = allowance used ACTUAL cargo quantity; false = PLANNED (provisional). */
  quantityIsActual: boolean;
};

export type ProvisionalRefusal = {
  status: "refused";
  code: string;
  reason: string;
};

export type ProvisionalOutcome = ProvisionalSuccess | ProvisionalRefusal;

export async function getProvisionalStatus(
  portCallId: string,
  /** Testing seam only; production reads the server clock. */
  asOf: Date = new Date()
): Promise<ActionResult<ProvisionalOutcome>> {
  try {
    return await authorized<ActionResult<ProvisionalOutcome>>(
      "statement.recalculate",
      async (ctx) => {
        const loaded = await loadPortCallCalcData(ctx, portCallId);
        if (loaded.kind === "notfound") {
          return fail<ProvisionalOutcome>("NOT_FOUND", "Port call not found.");
        }
        if (loaded.kind === "no_term") {
          return ok<ProvisionalOutcome>({
            status: "refused",
            code: "PORT_CALL_TERM_UNRESOLVED",
            reason:
              "No laytime term is resolved for this port call. Resolve or set a term to see a running status.",
          });
        }

        try {
          const s = computeProvisionalStatus(loaded.data, asOf);
          return ok<ProvisionalOutcome>({
            status: "provisional",
            window: s.window,
            asOf: s.asOf,
            allowedSeconds: s.allowedSeconds,
            usedSeconds: s.usedSeconds,
            remainingSeconds: s.remainingSeconds,
            onDemurrage: s.onDemurrage,
            quantityIsActual: s.quantityIsActual,
          });
        } catch (e) {
          if (e instanceof CalculationRefused) {
            return ok<ProvisionalOutcome>({
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
      return fail<ProvisionalOutcome>(
        "FORBIDDEN",
        "You do not have permission to perform this action."
      );
    }
    throw e;
  }
}
