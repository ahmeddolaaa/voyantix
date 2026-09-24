/**
 * TIME-SHEET COMMENTS — the "Comments" column of a laytime statement, written
 * the way laytime sheets word it (evidence: MY FELLAS loading calculation:
 * "Time to count - laytime started", "Time to count – vessel is on demurrage").
 * Pure; derived only from an interval's persisted facts. Display text only —
 * it never decides anything.
 */

export type SheetCommentInput = {
  /** Engine reason codes recorded on the interval. */
  reasons: readonly string[];
  /** COUNTED | EXCLUDED (coarse view of countedFraction). */
  treatment: string;
  countedFraction: number;
  /** Stoppage reason names overlapping this interval, if any. */
  stoppageNames?: readonly string[];
  /** True for the first interval of the window. */
  isFirst?: boolean;
};

const CAUSE_TEXT: Record<string, string> = {
  EXCLUDED_WEEKDAY: "excepted day",
  HOLIDAY: "holiday",
};

function causeOf(input: SheetCommentInput): string | null {
  if (input.reasons.includes("STOPPAGE_EXCLUDED")) {
    const names = (input.stoppageNames ?? []).filter(Boolean);
    return names.length > 0 ? names.join(" / ") : "stoppage";
  }
  for (const r of input.reasons) if (CAUSE_TEXT[r]) return CAUSE_TEXT[r];
  return null;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function sheetComment(input: SheetCommentInput): string {
  const r = input.reasons;
  const cause = causeOf(input);
  const onDemurrage = r.includes("ON_DEMURRAGE");

  if (input.countedFraction > 0 && input.countedFraction < 1) {
    return `Time to count ${Math.round(input.countedFraction * 100)}%${cause ? ` – ${cause}` : ""}`;
  }

  if (input.treatment === "COUNTED") {
    if (onDemurrage) {
      return cause
        ? `Time to count – ${cause}, vessel is on demurrage`
        : "Time to count – vessel is on demurrage";
    }
    if (r.includes("COUNTED_WHILE_EXCLUDED_USED")) {
      return `Time to count – ${cause ?? "excepted day"} worked (used)`;
    }
    return input.isFirst ? "Time to count – laytime started" : "Time to count";
  }

  // Not counted.
  if (r.includes("EXCEPTED_ON_DEMURRAGE")) {
    return `Not to count – ${cause ?? "excepted"} (still excepted on demurrage)`;
  }
  if (r.includes("EXCLUDED_NOT_USED")) {
    return `Not to count – ${cause ?? "excepted day"}, not worked`;
  }
  return cause ? `Not to count – ${cap(cause)}` : "Not to count";
}
