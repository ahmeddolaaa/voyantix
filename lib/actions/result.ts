/**
 * SHARED ACTION RESULT CONTRACT
 * ---------------------------------------------------------------------------
 * Every server action in the product returns an ActionResult. The split is
 * deliberate:
 *
 *   EXPECTED business outcomes  -> { ok: false, code, message }
 *   UNEXPECTED system failures  -> thrown, and allowed to propagate
 *
 * A duplicate port name is a normal thing for an administrator to do; a
 * dropped database connection is not. Collapsing both into one channel
 * would either bury real faults behind a friendly message, or push
 * infrastructure noise into the UI.
 *
 * The UI branches on `code`. `message` is presentation only and may be
 * reworded at any time without touching business logic.
 * ---------------------------------------------------------------------------
 */

export type ActionErrorCode =
  /** A field is missing, malformed, or out of range. */
  | "VALIDATION_ERROR"
  /** Timezone could not be resolved. Separate from VALIDATION_ERROR so the
   *  UI can focus the timezone combobox specifically. */
  | "INVALID_TIMEZONE"
  /** Normalized name already exists within the organization. */
  | "DUPLICATE_NAME"
  /** Normalized code / UNLOCODE / IMO already exists within the organization. */
  | "DUPLICATE_CODE"
  /** Absent from the caller's authorized scope. Also returned for rows that
   *  exist in ANOTHER organization — see the security note below. */
  | "NOT_FOUND"
  /** Concurrent modification, or a known conflicting relationship. */
  | "CONFLICT"
  /** Referenced by other records and therefore not removable. */
  | "IN_USE"
  /** The operation is not legal for the record's current state. */
  | "INVALID_STATE"
  /** Authenticated, but lacking the required permission in the ACTIVE
   *  organization. Never used for cross-tenant rows. */
  | "FORBIDDEN";

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: ActionErrorCode; message: string };

export function ok<T>(data: T): ActionResult<T> {
  return { ok: true, data };
}

export function fail<T = never>(
  code: ActionErrorCode,
  message: string
): ActionResult<T> {
  return { ok: false, code, message };
}

/**
 * SECURITY NOTE — why cross-tenant access returns NOT_FOUND
 *
 * If an administrator of organization A references a holiday calendar
 * belonging to organization B, the composite tenant foreign key rejects it.
 * We report NOT_FOUND, not FORBIDDEN.
 *
 * FORBIDDEN would confirm that the row exists somewhere, which leaks the
 * existence of another customer's data through a probe. NOT_FOUND is the
 * truthful answer within the caller's authorized scope.
 *
 * FORBIDDEN is reserved for a real permission gap inside the caller's OWN
 * organization — a viewer attempting a write, for instance.
 */

/** PostgreSQL error codes we recognize. */
const PG_UNIQUE_VIOLATION = "23505";
const PG_FOREIGN_KEY_VIOLATION = "23503";
const PG_CHECK_VIOLATION = "23514";

/**
 * KNOWN CONSTRAINT MAP — a whitelist, deliberately.
 *
 * A constraint absent from this map is NOT quietly mapped to a generic
 * code. It is rethrown, so that adding a constraint to the schema without
 * deciding what it means to a user surfaces immediately in logs instead of
 * reaching an administrator as a misleading message.
 */
const CONSTRAINT_MAP: Readonly<
  Record<string, { code: ActionErrorCode; message: string }>
> = {
  // --- unique violations: names -------------------------------------------
  ports_org_name_unique_idx: {
    code: "DUPLICATE_NAME",
    message: "A port with this name already exists.",
  },
  facilities_port_name_unique_idx: {
    code: "DUPLICATE_NAME",
    message: "A facility with this name already exists at this port.",
  },
  cargoes_org_name_unique_idx: {
    code: "DUPLICATE_NAME",
    message: "A cargo with this name already exists.",
  },
  stoppage_reasons_org_name_unique_idx: {
    code: "DUPLICATE_NAME",
    message: "A stoppage reason with this name already exists.",
  },
  holiday_calendars_org_name_unique_idx: {
    code: "DUPLICATE_NAME",
    message: "A holiday calendar with this name already exists.",
  },

  // --- unique violations: codes and identifiers ----------------------------
  ports_org_unlocode_unique_idx: {
    code: "DUPLICATE_CODE",
    message: "A port with this UN/LOCODE already exists.",
  },
  facilities_port_code_unique_idx: {
    code: "DUPLICATE_CODE",
    message: "A facility with this code already exists at this port.",
  },
  vessels_org_imo_unique_idx: {
    code: "DUPLICATE_CODE",
    message: "A vessel with this IMO number already exists.",
  },
  operational_event_types_org_code_unique_idx: {
    code: "DUPLICATE_CODE",
    message: "An event type with this code already exists.",
  },
  operational_event_types_org_semantic_unique_idx: {
    code: "CONFLICT",
    message:
      "This system event already exists. Each engine semantic may be defined only once.",
  },
  holidays_calendar_date_unique_idx: {
    code: "DUPLICATE_NAME",
    message: "This calendar already has a holiday on that date.",
  },

  // --- tenant composite foreign keys ---------------------------------------
  // Reaching these means a referenced row belongs to a different
  // organization. Reported as NOT_FOUND per the security note above.
  ports_holiday_calendar_org_fk: {
    code: "NOT_FOUND",
    message: "The selected holiday calendar could not be found.",
  },
  facilities_port_org_fk: {
    code: "NOT_FOUND",
    message: "The selected port could not be found.",
  },

  // --- check constraints ----------------------------------------------------
  operational_event_types_protected_semantic_check: {
    code: "INVALID_STATE",
    message:
      "System event types must carry an engine semantic, and custom event types must not.",
  },
  operational_event_types_protected_active_check: {
    code: "INVALID_STATE",
    message: "System event types cannot be deactivated.",
  },
  operational_event_types_semantic_vocabulary_check: {
    code: "INVALID_STATE",
    message: "That engine semantic is not recognized.",
  },
};

type PostgresError = { code?: unknown; constraint?: unknown };

function readPgError(e: unknown): { code: string; constraint: string } | null {
  // Drizzle wraps the driver error in a DrizzleQueryError and puts the real
  // PostgreSQL error on `cause`, so the fields we need are never at the top
  // level of what an action actually catches. Walk the chain rather than
  // reading one level and silently finding nothing.
  let current: unknown = e;
  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth++) {
    if (typeof current !== "object") return null;
    const { code, constraint } = current as PostgresError;
    if (typeof code === "string") {
      return {
        code,
        constraint: typeof constraint === "string" ? constraint : "",
      };
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * Translates a known database constraint violation into a domain result.
 *
 * Returns null when the error is not a recognized business conflict, in
 * which case the CALLER MUST RETHROW. The mapper never invents a meaning
 * it has not been told, and never inspects the error message text —
 * message wording differs across PostgreSQL versions and locales, so
 * matching on it would be silently fragile.
 */
export function mapDatabaseError<T = never>(e: unknown): ActionResult<T> | null {
  const pg = readPgError(e);
  if (!pg) return null;

  const isMappableCode =
    pg.code === PG_UNIQUE_VIOLATION ||
    pg.code === PG_FOREIGN_KEY_VIOLATION ||
    pg.code === PG_CHECK_VIOLATION;

  if (!isMappableCode) return null;
  if (!pg.constraint) return null;

  const known = CONSTRAINT_MAP[pg.constraint];
  if (!known) return null;

  return fail<T>(known.code, known.message);
}

/**
 * Runs a database operation and converts KNOWN constraint violations into
 * results. Anything else propagates untouched.
 *
 * Every action uses this rather than writing its own try/catch, so the
 * translation lives in exactly one place.
 */
export async function withDatabaseErrors<T>(
  operation: () => Promise<ActionResult<T>>
): Promise<ActionResult<T>> {
  try {
    return await operation();
  } catch (e) {
    const mapped = mapDatabaseError<T>(e);
    if (mapped) return mapped;
    throw e;
  }
}
