/**
 * APPLICABILITY RESOLVER — pure domain logic (Phase 3).
 *
 * Given an applicability context and a set of candidate ContractLaytimeTerms,
 * pick the single term that applies, per the approved rule:
 *
 *   0 applicable      -> null   (the caller decides what "none" means)
 *   1 applicable      -> that term
 *   >1 applicable     -> the unique strictly-more-specific term if one exists,
 *                        otherwise throw TermAmbiguityException.
 *
 * This function is pure: no database, no session/auth, no status inspection,
 * no mutation, no side effects. The caller obtains the candidates and decides
 * which participate (including any active/inactive filtering — the resolver
 * never looks at status).
 *
 * Specificity has exactly two axes: portId and cargoId. `function` is a
 * required match, not a nullable specificity axis. No numeric weights, no
 * alphabetical/id/date tie-breaks — genuine ambiguity is a data problem the
 * customer must resolve, and the resolver says so by throwing.
 */

export type ApplicabilityContext = {
  function: "LOAD" | "DISCHARGE";
  portId: string | null;
  cargoId: string | null;
};

/**
 * The minimal shape the resolver needs. Any ContractLaytimeTerm row satisfies
 * it structurally, so callers pass their rows directly.
 */
export type ApplicableTerm = {
  function: "LOAD" | "DISCHARGE";
  portId: string | null;
  cargoId: string | null;
};

/** Thrown when several terms apply and none is strictly more specific than
 *  all the others. Applicability ambiguity only. */
export class TermAmbiguityException extends Error {
  readonly candidateCount: number;
  constructor(candidateCount: number) {
    super(
      `Ambiguous laytime term: ${candidateCount} terms apply and none is strictly more specific than the rest.`
    );
    this.name = "TermAmbiguityException";
    this.candidateCount = candidateCount;
  }
}

/** A candidate matches the context on all three axes. function must equal;
 *  a null port/cargo on the term is a wildcard that matches anything. */
function matches<T extends ApplicableTerm>(
  term: T,
  ctx: ApplicabilityContext
): boolean {
  if (term.function !== ctx.function) return false;
  if (term.portId !== null && term.portId !== ctx.portId) return false;
  if (term.cargoId !== null && term.cargoId !== ctx.cargoId) return false;
  return true;
}

/** On one axis, a is "at least as specific as" b when a is not a wildcard
 *  wherever b is not — i.e. b being concrete implies a is concrete. Since
 *  both already match the same context, "concrete" values are equal, so this
 *  reduces to: a is at least as specific as b iff (b === null) || (a !== null). */
function atLeastAsSpecificOnAxis(a: string | null, b: string | null): boolean {
  return b === null || a !== null;
}

function strictlyMoreSpecificOnAxis(a: string | null, b: string | null): boolean {
  // a is concrete where b is a wildcard.
  return a !== null && b === null;
}

/** True when x is strictly more specific than y across the two axes:
 *  at least as specific on both, and strictly more specific on at least one. */
function strictlyMoreSpecific<T extends ApplicableTerm>(x: T, y: T): boolean {
  const atLeast =
    atLeastAsSpecificOnAxis(x.portId, y.portId) &&
    atLeastAsSpecificOnAxis(x.cargoId, y.cargoId);
  if (!atLeast) return false;
  const strictlyOnOne =
    strictlyMoreSpecificOnAxis(x.portId, y.portId) ||
    strictlyMoreSpecificOnAxis(x.cargoId, y.cargoId);
  return strictlyOnOne;
}

/**
 * Resolves the applicable term for a context.
 *
 * @returns the single applicable term, or null when none apply.
 * @throws TermAmbiguityException when multiple apply with no unique dominator.
 */
export function resolveApplicableTerm<T extends ApplicableTerm>(
  context: ApplicabilityContext,
  candidates: readonly T[]
): T | null {
  const applicable = candidates.filter((t) => matches(t, context));

  if (applicable.length === 0) return null;
  if (applicable.length === 1) return applicable[0];

  // More than one applies: find terms that dominate every other applicable
  // term (strictly more specific than all of them). There must be exactly one.
  const dominators = applicable.filter((x) =>
    applicable.every((y) => x === y || strictlyMoreSpecific(x, y))
  );

  if (dominators.length === 1) return dominators[0];

  throw new TermAmbiguityException(applicable.length);
}