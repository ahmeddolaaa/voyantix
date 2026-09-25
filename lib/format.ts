/**
 * SHARED INSTANT FORMATTING
 * ---------------------------------------------------------------------------
 * A stored timestamp is an absolute instant (UTC in the database). How it
 * READS to a user depends entirely on which timezone you render it in, and
 * for laytime that timezone is never the viewer's — it is the port call's
 * own local time, the same clock the Statement of Facts is written in and
 * the same one the engine classifies against (F18).
 *
 * WHY BOTH locale AND timeZone ARE REQUIRED
 *
 * Server-side rendering runs in the container's environment; the browser
 * runs in the viewer's. If either the locale or the timezone is left to the
 * runtime default, the two can format the same instant differently, and
 * React tears the tree down with a hydration mismatch. Pinning both makes
 * the output a pure function of (instant, timeZone) — identical on server
 * and client.
 *
 * timeZone is a REQUIRED argument on purpose: there is no safe default. A
 * caller that does not know the port call's timezone must not be silently
 * given the viewer's.
 */

/** Fixed, deterministic locale for all operational time display. */
const DISPLAY_LOCALE = "en-GB";

/**
 * Formats an absolute instant for display in an explicit IANA timezone.
 *
 * @param date     the absolute instant
 * @param timeZone an IANA timezone id, e.g. "Africa/Cairo" — required
 * @returns e.g. "15 Sep 2026, 08:00"
 */
export function formatInstant(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(DISPLAY_LOCALE, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(date);
}

/**
 * Formats a duration in seconds as laytime days/hours/minutes, e.g.
 * "2d 03h 15m". Laytime is quoted in running days (24h), so days are the
 * natural top unit. Negative durations (an exceeded balance) keep their sign.
 */
export function formatDurationSeconds(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? "-" : "";
  let s = Math.abs(Math.round(totalSeconds));
  const days = Math.floor(s / 86400);
  s -= days * 86400;
  const hours = Math.floor(s / 3600);
  s -= hours * 3600;
  const minutes = Math.floor(s / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  if (days > 0) return `${sign}${days}d ${pad(hours)}h ${pad(minutes)}m`;
  if (hours > 0) return `${sign}${hours}h ${pad(minutes)}m`;
  return `${sign}${minutes}m`;
}

/**
 * The balance (allowed − used) as laytime sheets DISPLAY it: allowed is shown
 * cut to the whole minute, and the balance is that shown figure minus used.
 * Evidence: MY FELLAS 4d 21h 15m − 1d 00h 25m = 3d 20h 50m (exact 49m 50s);
 * test_2 4d 07h 26m − 20h = 3d 11h 26m (exact 26m 50s). DISPLAY ONLY — the
 * settlement amount always uses the exact seconds.
 */
export function sheetBalanceSeconds(allowedSeconds: number, usedSeconds: number): number {
  return Math.floor(allowedSeconds / 60) * 60 - usedSeconds;
}

/**
 * Formats a settlement amount. Currency is carried by the term's rate and is
 * not stored, so no symbol is shown — grouping only, to two decimals when
 * fractional.
 */
export function formatAmount(value: number): string {
  const hasFraction = Math.abs(value % 1) > 1e-9;
  return value.toLocaleString("en-GB", {
    minimumFractionDigits: hasFraction ? 2 : 0,
    maximumFractionDigits: 2,
  });
}
