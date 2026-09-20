/**
 * ENGINE VERSION — stamped onto every persisted LaytimeCalculation so a
 * historical result can always be traced to the engine that produced it
 * (F20, third reproducibility layer alongside the immutable rule-set version
 * and the versioned term). Bump this when the engine's calculation behaviour
 * changes in a way that could move a balance.
 */
export const ENGINE_VERSION = "1.0.0";
