/**
 * TIMEZONE MATH FOR THE LAYTIME ENGINE — pure, deterministic (Phase 6).
 *
 * The engine classifies every interval in the PORT CALL's local time
 * (F18: PortCall.effectiveTimezone). A JavaScript `Date` is an absolute
 * instant; it carries no zone. To ask "which local day is this instant in?"
 * or "when is the next local midnight?" we must project the instant into an
 * IANA zone. No timezone library is present, so this is built on the
 * platform `Intl.DateTimeFormat`, which resolves IANA zones (including DST)
 * from the host's tz database.
 *
 * Everything here is pure: no DB, no mutation, no ambient timezone. The zone
 * is always passed in explicitly; the host's own timezone never leaks in.
 *
 * These helpers are for CALCULATION (numeric wall-clock parts), distinct
 * from lib/format.ts, which is for DISPLAY (formatted strings).
 */

/** The wall-clock components of an instant, as read in a specific zone. */
export type LocalParts = {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
  /** 0 = Sunday … 6 = Saturday, in the given zone. */
  weekday: number;
};

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

/**
 * Reads the wall-clock parts of an absolute instant AS SEEN in `timeZone`.
 *
 * Uses Intl with an en-US, 24-hour, explicit-zone formatter so the parts are
 * deterministic regardless of the host locale or host timezone. `hour: "23"`
 * at hourCycle h23 gives 0-23 (Intl emits "24" for midnight under some
 * settings, which we normalise to 0).
 */
export function getLocalParts(instant: Date, timeZone: string): LocalParts {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  });

  const parts = dtf.formatToParts(instant);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";

  const hour = Number(get("hour"));

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: hour === 24 ? 0 : hour,
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: WEEKDAY_INDEX[get("weekday")] ?? 0,
  };
}

/**
 * Returns the absolute instant of a given wall-clock time in `timeZone`.
 *
 * Inverts getLocalParts: given local Y-M-D H:M:S in a zone, find the UTC
 * instant. Because the UTC offset itself depends on the instant (DST), we
 * solve it: make a first guess treating the parts as if UTC, read what zone
 * offset that guess actually has, then correct. One correction is exact for
 * all real zones except within the ~1h DST-transition gap, so we iterate
 * twice to settle.
 */
export function instantFromLocal(
  parts: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second?: number;
  },
  timeZone: string
): Date {
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second ?? 0
  );

  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const seen = getLocalParts(new Date(guess), timeZone);
    const seenUtc = Date.UTC(
      seen.year,
      seen.month - 1,
      seen.day,
      seen.hour,
      seen.minute,
      seen.second
    );
    // How far the projection drifted from the target tells us the offset.
    const drift = asUtc - seenUtc;
    if (drift === 0) break;
    guess += drift;
  }
  return new Date(guess);
}

/**
 * The instant of local midnight (00:00:00) on the local day that `instant`
 * falls in, in `timeZone`. The start of the current local day.
 */
export function localMidnightOf(instant: Date, timeZone: string): Date {
  const p = getLocalParts(instant, timeZone);
  return instantFromLocal(
    { year: p.year, month: p.month, day: p.day, hour: 0, minute: 0, second: 0 },
    timeZone
  );
}

/**
 * The instant of the NEXT local midnight strictly after `instant`, in
 * `timeZone`. This is the day boundary the partitioner cuts on. DST-safe:
 * a day may be 23 or 25 hours long, and this returns the real next-midnight
 * instant rather than instant + 24h.
 */
export function nextLocalMidnight(instant: Date, timeZone: string): Date {
  const startOfDay = localMidnightOf(instant, timeZone);
  // Step ~26h forward to land firmly inside the next local day (covers the
  // longest DST day), then snap back to that day's midnight.
  const wellInsideNextDay = new Date(startOfDay.getTime() + 26 * 3600 * 1000);
  return localMidnightOf(wellInsideNextDay, timeZone);
}
