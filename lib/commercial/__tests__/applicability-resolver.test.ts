import { describe, it, expect } from "vitest";
import {
  resolveApplicableTerm,
  TermAmbiguityException,
  type ApplicabilityContext,
  type ApplicableTerm,
} from "../applicability-resolver";

// Tiny helpers to make the intent of each term obvious.
const ALEX = "port-alexandria";
const DAMIETTA = "port-damietta";
const STEEL = "cargo-steel";
const GRAIN = "cargo-grain";

function term(
  fn: "LOAD" | "DISCHARGE",
  portId: string | null,
  cargoId: string | null
): ApplicableTerm & { tag: string } {
  return { function: fn, portId, cargoId, tag: `${fn}/${portId}/${cargoId}` };
}

const loadAtAlex: ApplicabilityContext = {
  function: "LOAD",
  portId: ALEX,
  cargoId: STEEL,
};

describe("resolveApplicableTerm — matching", () => {
  it("returns null when no term matches", () => {
    const terms = [term("DISCHARGE", null, null)];
    expect(resolveApplicableTerm(loadAtAlex, terms)).toBeNull();
  });

  it("returns null on an empty candidate list", () => {
    expect(resolveApplicableTerm(loadAtAlex, [])).toBeNull();
  });

  it("returns the single matching term", () => {
    const only = term("LOAD", null, null);
    expect(resolveApplicableTerm(loadAtAlex, [only])).toBe(only);
  });

  it("a function mismatch does not match", () => {
    const terms = [term("DISCHARGE", ALEX, STEEL)];
    expect(resolveApplicableTerm(loadAtAlex, terms)).toBeNull();
  });

  it("null port and null cargo act as wildcards that match", () => {
    const wildcard = term("LOAD", null, null);
    expect(resolveApplicableTerm(loadAtAlex, [wildcard])).toBe(wildcard);
  });

  it("a concrete port that differs from the context does not match", () => {
    const terms = [term("LOAD", DAMIETTA, null)];
    expect(resolveApplicableTerm(loadAtAlex, terms)).toBeNull();
  });

  it("a concrete cargo that differs from the context does not match", () => {
    const terms = [term("LOAD", null, GRAIN)];
    expect(resolveApplicableTerm(loadAtAlex, terms)).toBeNull();
  });
});

describe("resolveApplicableTerm — specificity", () => {
  it("a port-specific term overrides a fully generic term", () => {
    const generic = term("LOAD", null, null);
    const portSpecific = term("LOAD", ALEX, null);
    expect(resolveApplicableTerm(loadAtAlex, [generic, portSpecific])).toBe(
      portSpecific
    );
  });

  it("a cargo-specific term overrides a fully generic term", () => {
    const generic = term("LOAD", null, null);
    const cargoSpecific = term("LOAD", null, STEEL);
    expect(resolveApplicableTerm(loadAtAlex, [generic, cargoSpecific])).toBe(
      cargoSpecific
    );
  });

  it("the most specific term (both axes) dominates generic and single-axis terms", () => {
    const generic = term("LOAD", null, null);
    const portOnly = term("LOAD", ALEX, null);
    const cargoOnly = term("LOAD", null, STEEL);
    const both = term("LOAD", ALEX, STEEL);
    // both is strictly more specific than every other applicable term.
    expect(
      resolveApplicableTerm(loadAtAlex, [generic, portOnly, cargoOnly, both])
    ).toBe(both);
  });

  it("order does not matter — the dominator is found regardless of position", () => {
    const generic = term("LOAD", null, null);
    const both = term("LOAD", ALEX, STEEL);
    expect(resolveApplicableTerm(loadAtAlex, [both, generic])).toBe(both);
  });
});

describe("resolveApplicableTerm — ambiguity throws", () => {
  it("incomparable port-vs-cargo matches raise TermAmbiguityException", () => {
    const portOnly = term("LOAD", ALEX, null);
    const cargoOnly = term("LOAD", null, STEEL);
    // Neither dominates the other; both apply.
    expect(() =>
      resolveApplicableTerm(loadAtAlex, [portOnly, cargoOnly])
    ).toThrow(TermAmbiguityException);
  });

  it("two equally-specific duplicate matches raise TermAmbiguityException", () => {
    const a = term("LOAD", ALEX, STEEL);
    const b = term("LOAD", ALEX, STEEL);
    expect(() => resolveApplicableTerm(loadAtAlex, [a, b])).toThrow(
      TermAmbiguityException
    );
  });

  it("no single dominator among several matches raises TermAmbiguityException", () => {
    // generic + portOnly + cargoOnly: portOnly and cargoOnly both dominate
    // generic, but neither dominates the other -> two 'partial' winners, no
    // unique dominator.
    const generic = term("LOAD", null, null);
    const portOnly = term("LOAD", ALEX, null);
    const cargoOnly = term("LOAD", null, STEEL);
    expect(() =>
      resolveApplicableTerm(loadAtAlex, [generic, portOnly, cargoOnly])
    ).toThrow(TermAmbiguityException);
  });

  it("the exception carries how many terms were applicable", () => {
    const portOnly = term("LOAD", ALEX, null);
    const cargoOnly = term("LOAD", null, STEEL);
    try {
      resolveApplicableTerm(loadAtAlex, [portOnly, cargoOnly]);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(TermAmbiguityException);
      if (e instanceof TermAmbiguityException) {
        expect(e.candidateCount).toBe(2);
      }
    }
  });
});

describe("resolveApplicableTerm — non-applicable terms are ignored", () => {
  it("terms that do not match are excluded before specificity is considered", () => {
    const applicable = term("LOAD", ALEX, STEEL);
    const wrongPort = term("LOAD", DAMIETTA, STEEL); // does not match
    const wrongFn = term("DISCHARGE", ALEX, STEEL); // does not match
    expect(
      resolveApplicableTerm(loadAtAlex, [applicable, wrongPort, wrongFn])
    ).toBe(applicable);
  });
});