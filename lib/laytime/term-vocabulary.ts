/**
 * TERM VOCABULARY — the bounded values a contract laytime term may carry, with
 * their user-facing labels. One source of truth for the term form (dropdowns)
 * and the server validation, so the UI can only offer what the engine
 * understands and the server rejects anything else instead of letting the
 * engine refuse later.
 *
 * Pure data; safe to import from client components.
 */

/** Events laytime (or turn time) can start from. Engine semantics. */
export const COMMENCEMENT_EVENTS = [
  { value: "NOR_TENDERED", label: "NOR tendered" },
  { value: "NOR_ACCEPTED", label: "NOR accepted" },
  { value: "BERTHED", label: "Vessel berthed" },
  { value: "OPS_COMMENCED", label: "Operations commenced" },
] as const;

/** How the commencement event maps to the instant counting starts. */
export const COMMENCEMENT_TIME_RULES = [
  { value: "AT_EVENT", label: "At the event time" },
  {
    value: "MORNING_NOR_1400",
    label: "If before 12:00 → starts 14:00 same day",
  },
] as const;

export const ALLOWANCE_UNITS = [
  { value: "days", label: "Days" },
  { value: "hours", label: "Hours" },
] as const;

export const DESPATCH_BASES = [
  { value: "WTS", label: "Working time saved (WTS)" },
  { value: "ATS", label: "All time saved (ATS)" },
] as const;

type Opt = readonly { value: string; label: string }[];

export function isOneOf(options: Opt, value: string | null | undefined): boolean {
  return value != null && options.some((o) => o.value === value);
}

export function labelOf(options: Opt, value: string | null | undefined): string | null {
  if (value == null) return null;
  return options.find((o) => o.value === value)?.label ?? null;
}
