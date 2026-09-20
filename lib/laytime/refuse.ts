/**
 * CALCULATION REFUSAL — the engine refuses rather than guesses (Phase 6).
 *
 * A core principle of the laytime engine: when a required commercial semantic
 * is undefined, missing, or ambiguous, the engine must REFUSE to calculate
 * rather than assume a default (the withheld-rules discipline B1–B8). Any
 * pipeline stage that reaches such a point throws CalculationRefused.
 *
 * This is deliberately an exception, not an ActionResult: the pure engine is
 * a total function over WELL-DEFINED inputs, and a refusal is an
 * exceptional, caller-visible stop — not one of several ordinary results the
 * arithmetic returns. `code` is a stable machine identifier the caller/UI can
 * branch on; `message` is human-facing and may be reworded freely.
 */
export class CalculationRefused extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "CalculationRefused";
    this.code = code;
  }
}
