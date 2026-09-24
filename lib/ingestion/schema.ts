/**
 * SOF ingestion — extraction contract.
 *
 * This is the typed shape a vision model returns for one uploaded document
 * (a Statement of Facts, a Notice of Readiness, a port clearance, etc.). It is
 * a CANDIDATE extraction: every item is a proposal an analyst reviews against
 * the source before any of it becomes a real operational record feeding the
 * deterministic laytime engine. Nothing here is trusted until confirmed.
 *
 * The taxonomy is deliberately narrow — only the events that move the laytime
 * clock or are material to a claim/audit are captured as structured events.
 * Everything else (pilot on/off, opening hatches, holds inspection, free
 * pratique, dunnage) stays in `rawRemarks` as verbatim source text, never
 * invented into a calculation event.
 */

/** What kind of document was uploaded. */
export type DocumentKind =
  | "SOF" // Statement of Facts (any agency format)
  | "NOR" // Notice of Readiness letter
  | "LAYTIME_CALC" // a laytime calculation (own or counterparty)
  | "PORT_CLEARANCE" // authority departure/clearance certificate
  | "OTHER";

export type Operation = "LOAD" | "DISCHARGE";

/**
 * The material laytime events. `engineSemantic` is the protected semantic the
 * deterministic engine already understands, or null where the event is a
 * milestone the engine does not yet consume (a laytime-boundary candidate or a
 * pure record). Null does NOT mean "drop it" — it means the engine wiring for
 * that boundary is still to be added from real evidence, never guessed.
 */
export type LaytimeEventType =
  | "ARRIVED" // EOSP / arrived at roads or anchorage
  | "NOR_TENDERED"
  | "NOR_ACCEPTED"
  | "NOR_RETENDERED"
  | "BERTHED" // all fast / all lines made fast alongside
  | "OPERATION_COMMENCED" // loading/discharging commenced
  | "OPERATION_COMPLETED" // loading/discharging completed
  | "LASHING_COMPLETED" // usual laytime end for a load
  | "DOCUMENTS_SIGNED" // alternate laytime end
  | "DEPARTED"; // sailed / COSP — record only

/** Map from an extracted event to the engine's protected semantic (or null). */
export const ENGINE_SEMANTIC: Record<LaytimeEventType, string | null> = {
  ARRIVED: null,
  NOR_TENDERED: "NOR_TENDERED",
  NOR_ACCEPTED: "NOR_ACCEPTED",
  NOR_RETENDERED: null, // to be wired when the re-tender rule is defined
  BERTHED: "BERTHED",
  OPERATION_COMMENCED: "OPS_COMMENCED",
  OPERATION_COMPLETED: "OPS_COMPLETED",
  LASHING_COMPLETED: "LASHING_COMPLETED", // laytime end (usual for a load)
  DOCUMENTS_SIGNED: "DOCUMENTS_ON_BOARD", // laytime end when documents are late
  DEPARTED: "DEPARTED",
};

/**
 * The three events any of which a term may nominate as the end of laytime.
 * Which one applies is a per-term configuration the analyst confirms — most
 * often LASHING_COMPLETED for a load, sometimes DOCUMENTS_SIGNED, sometimes the
 * bare OPERATION_COMPLETED.
 */
export const LAYTIME_END_CANDIDATES = [
  "OPERATION_COMPLETED",
  "LASHING_COMPLETED",
  "DOCUMENTS_SIGNED",
] as const;

/** Normalized interruption reason. `reasonText` keeps the verbatim wording. */
export type StoppageCategory =
  | "LABOUR_BREAK" // labours break time
  | "MEAL_BREAK"
  | "RELIGIOUS" // Friday prayer
  | "WEATHER"
  | "PORT_CLOSURE" // authority / navy navigational closure
  | "AWAITING_BERTH" // port congestion
  | "AWAITING_INSTRUCTIONS" // owners instruction / freight not received
  | "SHIFTING"
  | "NO_GANG"
  | "BREAKDOWN"
  | "OTHER";

/** A single extracted event. Times are local wall-clock in the port's zone. */
export interface ExtractedEvent {
  type: LaytimeEventType;
  /** Local datetime, minute precision, no zone suffix: "2026-06-23T00:01". */
  occurredLocal: string;
  /** Verbatim text the value was read from — the evidence for review. */
  sourceSnippet: string;
  /** 0..1 model confidence; low values are flagged for closer review. */
  confidence: number;
}

/** A single extracted interruption (start/end + reason). */
export interface ExtractedStoppage {
  startLocal: string;
  /** null when the source records a start but no end (open interruption). */
  endLocal: string | null;
  /** Verbatim reason wording from the document. */
  reasonText: string;
  reasonCategory: StoppageCategory;
  sourceSnippet: string;
  confidence: number;
}

/** Header/metadata read off the document. Any field may be null if absent. */
export interface ExtractedDocumentMeta {
  kind: DocumentKind;
  vesselName: string | null;
  imo: string | null;
  port: string | null;
  terminal: string | null;
  operation: Operation | null;
  cargoDescription: string | null;
  cargoQuantityMt: number | null;
  /** Charter party date as ISO "2026-06-11" when stated. */
  charterPartyDate: string | null;
  agent: string | null;
  /** IANA zone inferred from the port (e.g. "Africa/Cairo"); null if unsure. */
  localTimeZone: string | null;
}

/** The full extraction envelope for one document. */
export interface SofExtraction {
  document: ExtractedDocumentMeta;
  events: ExtractedEvent[];
  stoppages: ExtractedStoppage[];
  /**
   * Verbatim narrative lines kept for the analyst but NOT turned into events —
   * e.g. "Fridays and Saturdays are official weekends in Egypt", gang/crane
   * counts, standard remarks. Some carry semantics (weekend convention) the
   * analyst maps to config; none are auto-applied.
   */
  rawRemarks: string[];
  /**
   * Discrepancies the extractor noticed and surfaced for review — self
   * conflicts (two times for one event) or, when cross-checking documents,
   * mismatches between them (e.g. NOR 21:00 on the letter vs 21:25 on the SOF).
   */
  conflicts: string[];
  /** Provenance for audit. */
  extractionModel: string;
  extractedAt: string;
}
