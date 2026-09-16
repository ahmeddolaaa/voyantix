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
