/**
 * EVENT PERIODS — deriving clean time spans from operational events (Phase 6).
 *
 * Weather is recorded as point events: WEATHER_START and WEATHER_END
 * (occurredAt). A weather PERIOD is the span between a start and its matching
 * end. This stage pairs them into clean [start, end) periods so later stages
 * can partition and tag intervals by weather.
 *
 * The pure engine takes no DB: the caller loads the LIVE events (dropping any
 * superseded by a correction, per Phase 5) for the port call, maps each to its
 * system semantic, and injects them here. Stoppages already have explicit
 * spans, so they need no pairing — they are handled where intervals are tagged.
 *
 * Pairing rules (chosen, not withheld — this is mechanical shape, not laytime
 * semantics):
 *   - events are processed in chronological order
 *   - each WEATHER_START opens a period; the next WEATHER_END closes it
 *   - a WEATHER_START still open at the end of the window extends to the
 *     window end (mirrors an open stoppage)
 *   - a WEATHER_END with no open start is inconsistent data -> throw
 *   - a WEATHER_START while one is already open is inconsistent data -> throw
 *
 * Pure: no DB, no mutation, no ambient timezone.
 */

/** A weather point event, already resolved to its semantic and live-filtered. */
export type WeatherEvent = {
  semantic: "WEATHER_START" | "WEATHER_END";
  occurredAt: Date;
};

/** A clean, paired weather span. */
export type WeatherPeriod = {
  start: Date;
  end: Date;
};

/**
 * Pairs weather start/end events into clean periods within [windowStart,
 * windowEnd). A start left open at the end extends to windowEnd.
 *
 * Throws on inconsistent data (an end with no open start, or a start while
 * one is already open) — the engine refuses rather than guessing.
 */
export function deriveWeatherPeriods(
  events: WeatherEvent[],
  windowEnd: Date
): WeatherPeriod[] {
  // Chronological order; do not mutate the caller's array.
  const ordered = [...events].sort(
    (a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()
  );

  const periods: WeatherPeriod[] = [];
  let openStart: Date | null = null;

  for (const ev of ordered) {
    if (ev.semantic === "WEATHER_START") {
      if (openStart !== null) {
        throw new Error(
          "deriveWeatherPeriods: a weather start occurred while another was still open."
        );
      }
      openStart = ev.occurredAt;
    } else {
      // WEATHER_END
      if (openStart === null) {
        throw new Error(
          "deriveWeatherPeriods: a weather end occurred with no open weather start."
        );
      }
      if (ev.occurredAt.getTime() > openStart.getTime()) {
        periods.push({ start: openStart, end: ev.occurredAt });
      }
      // A zero/negative span (end <= start) is dropped as empty.
      openStart = null;
    }
  }

  // A start left open extends to the window end.
  if (openStart !== null && windowEnd.getTime() > openStart.getTime()) {
    periods.push({ start: openStart, end: windowEnd });
  }

  return periods;
}
