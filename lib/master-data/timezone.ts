/**
 * TIMEZONE RESOLUTION — the highest-risk primitive in the product.
 * ---------------------------------------------------------------------------
 * Day-based contractual rules (SHEX, FHEX, holidays, midnight boundaries)
 * are evaluated in LOCAL civil time at the port. A timezone stored wrong,
 * or stored in two different spellings, makes every weekend boundary wrong
 * by hours and every statement commercially unusable.
 *
 * Three deliberate decisions:
 *
 * 1. Validation asks the RUNTIME whether it can resolve the identifier —
 *    it does not check membership of Intl.supportedValuesOf("timeZone").
 *    That list omits identifiers that are valid and in common use:
 *    "UTC" and "Asia/Kolkata" are both absent from it, while the list
 *    carries the older "Asia/Calcutta" instead. Treating the list as a
 *    whitelist would reject valid ports.
 *
 * 2. We store the runtime-CANONICAL form, never the user's raw casing.
 *    The runtime resolves "africa/cairo" to "Africa/Cairo"; storing both
 *    spellings would produce two records for one port and defeat the
 *    normalized uniqueness constraints in the master-data schema.
 *
 * 3. Fixed UTC offsets are rejected outright — see UTC_OFFSET_PATTERN.
 *
 * Intl.supportedValuesOf("timeZone") is used ONLY to populate the
 * searchable suggestion list in the admin UI. It is a convenience, never
 * the authority.
 * ---------------------------------------------------------------------------
 */

export class InvalidTimezoneError extends Error {
  constructor(readonly value: string) {
    super(`Not a valid IANA timezone identifier: ${JSON.stringify(value)}`);
    this.name = "InvalidTimezoneError";
  }
}

/**
 * The runtime accepts fixed UTC offsets ("+02:00", "-0530") as timeZone
 * values and echoes them straight back. They must never be stored: an
 * offset has no DST rule, so a port stored as "+02:00" would evaluate
 * every summer day boundary an hour out, silently, for the life of the
 * record. Only region-based IANA identifiers carry the transition data
 * the engine needs.
 */
const UTC_OFFSET_PATTERN = /^[+\-\u2212]\d{1,2}(:?\d{2})?$/;

/**
 * Returns the canonical IANA identifier for `input`, or null if the
 * runtime cannot resolve it. Trims surrounding whitespace first.
 */
export function resolveTimezone(input: string): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed === "") return null;
  if (UTC_OFFSET_PATTERN.test(trimmed)) return null;

  // Intl accepts some non-timezone strings in other option positions, so
  // resolve explicitly and read back what the runtime settled on.
  let resolved: string;
  try {
    resolved = new Intl.DateTimeFormat("en-US", {
      timeZone: trimmed,
    }).resolvedOptions().timeZone;
  } catch {
    return null;
  }

  // A runtime that echoes the input back unchanged without validating it
  // would let junk through; require a non-empty resolved value.
  if (!resolved) return null;
  // Belt and braces: some ICU versions normalize offsets into a different
  // shape than the input, so re-check the resolved value too.
  if (UTC_OFFSET_PATTERN.test(resolved)) return null;
  return resolved;
}

export function isValidTimezone(input: string): boolean {
  return resolveTimezone(input) !== null;
}

/** Throws InvalidTimezoneError rather than returning null. For server actions. */
export function requireTimezone(input: string): string {
  const resolved = resolveTimezone(input);
  if (resolved === null) throw new InvalidTimezoneError(input);
  return resolved;
}

/**
 * Suggestion list for the admin combobox. NOT a validation whitelist —
 * see the file header. "UTC" is prepended because the runtime supports it
 * and company configuration defaults to it, yet it is absent from the
 * runtime's own list.
 */
export function timezoneSuggestions(): string[] {
  const supported =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [];
  const set = new Set<string>(["UTC", ...supported]);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
