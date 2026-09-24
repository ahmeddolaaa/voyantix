/**
 * SOF ingestion — Gemini vision extraction (request building + response
 * validation). Pure except `callGemini`, which does the HTTP call.
 *
 * The model returns a CANDIDATE extraction in the SofExtraction contract; this
 * module never trusts it: every item is validated against the contract, bad
 * items are dropped with a note in `conflicts`, and nothing reaches the engine
 * until an analyst reviews and commits it (ExtractionReview).
 */

import type {
  SofExtraction,
  ExtractedEvent,
  ExtractedStoppage,
  LaytimeEventType,
  StoppageCategory,
  DocumentKind,
  Operation,
} from "./schema";

export const EVENT_TYPES: LaytimeEventType[] = [
  "ARRIVED",
  "NOR_TENDERED",
  "NOR_ACCEPTED",
  "NOR_RETENDERED",
  "BERTHED",
  "OPERATION_COMMENCED",
  "OPERATION_COMPLETED",
  "LASHING_COMPLETED",
  "DOCUMENTS_SIGNED",
  "DEPARTED",
];
export const STOPPAGE_CATEGORIES: StoppageCategory[] = [
  "LABOUR_BREAK",
  "MEAL_BREAK",
  "RELIGIOUS",
  "WEATHER",
  "PORT_CLOSURE",
  "AWAITING_BERTH",
  "AWAITING_INSTRUCTIONS",
  "SHIFTING",
  "NO_GANG",
  "BREAKDOWN",
  "OTHER",
];
const KINDS: DocumentKind[] = ["SOF", "NOR", "LAYTIME_CALC", "PORT_CLEARANCE", "OTHER"];

/** Accepted upload types and the size cap (inline request limit with headroom). */
export const ACCEPTED_MIME = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

const LOCAL_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const nullable = (type: string) => ({ type: [type, "null"] });

/** JSON Schema handed to the model (responseJsonSchema). */
export const SOF_JSON_SCHEMA = {
  type: "object",
  properties: {
    document: {
      type: "object",
      properties: {
        kind: { type: "string", enum: KINDS },
        vesselName: nullable("string"),
        imo: nullable("string"),
        port: nullable("string"),
        terminal: nullable("string"),
        operation: { type: ["string", "null"], enum: ["LOAD", "DISCHARGE", null] },
        cargoDescription: nullable("string"),
        cargoQuantityMt: nullable("number"),
        charterPartyDate: nullable("string"),
        agent: nullable("string"),
        localTimeZone: nullable("string"),
      },
      required: ["kind"],
    },
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: EVENT_TYPES },
          occurredLocal: { type: "string", description: "YYYY-MM-DDTHH:MM, port local time" },
          sourceSnippet: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["type", "occurredLocal", "sourceSnippet", "confidence"],
      },
    },
    stoppages: {
      type: "array",
      items: {
        type: "object",
        properties: {
          startLocal: { type: "string" },
          endLocal: nullable("string"),
          reasonText: { type: "string" },
          reasonCategory: { type: "string", enum: STOPPAGE_CATEGORIES },
          sourceSnippet: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["startLocal", "reasonText", "reasonCategory", "sourceSnippet", "confidence"],
      },
    },
    rawRemarks: { type: "array", items: { type: "string" } },
    conflicts: { type: "array", items: { type: "string" } },
  },
  required: ["document", "events", "stoppages", "rawRemarks", "conflicts"],
} as const;

export function buildPrompt(hint: { operation?: Operation | null; timeZone?: string | null } = {}): string {
  return [
    "You read maritime port documents (Statement of Facts, Notice of Readiness, laytime calculations, port clearances) for a laytime analyst.",
    "Return ONLY JSON matching the given schema. Extract; never invent. If a value is not in the document, use null or leave it out.",
    "",
    "EVENTS — only these types, each at most once unless the document truly repeats it:",
    "ARRIVED (EOSP / arrived roads or anchorage), NOR_TENDERED, NOR_ACCEPTED, NOR_RETENDERED, BERTHED (all fast / made fast alongside),",
    "OPERATION_COMMENCED (loading or discharging commenced), OPERATION_COMPLETED (loading or discharging completed), LASHING_COMPLETED,",
    "DOCUMENTS_SIGNED (documents on board / cargo documents signed), DEPARTED (sailed / COSP).",
    "Anything else (pilot, tugs, free pratique, hatches, draft survey, gangs, weather notes) goes verbatim into rawRemarks — not into events.",
    "",
    "STOPPAGES — interruptions of loading/discharging with a start and (if stated) an end: rain/weather, breaks, prayer, shifting, breakdown, no gang, port closure, awaiting berth/instructions.",
    "reasonText is the document's own wording; reasonCategory is the closest category (OTHER when none fits).",
    "",
    "TIMES — every time as port LOCAL wall-clock in the format YYYY-MM-DDTHH:MM (24h, no seconds, no zone). Resolve dates from the document's date columns; a row that only gives a time belongs to the date of its row/section.",
    "sourceSnippet — copy the exact text the value was read from (the row), for the analyst to check.",
    "confidence — 0..1; lower it when handwriting, stamps or layout make the reading uncertain.",
    "conflicts — list any contradiction you notice (two times for one event, dates out of order, totals that disagree).",
    "document.localTimeZone — the IANA zone of the port if you are sure (e.g. Africa/Cairo), else null.",
    hint.operation ? `The analyst expects a ${hint.operation === "LOAD" ? "loading" : "discharging"} operation.` : "",
    hint.timeZone ? `The port's time zone is ${hint.timeZone}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Pull the model's text out of a generateContent response. */
export function responseText(json: unknown): string | null {
  const c = (json as { candidates?: { content?: { parts?: { text?: string }[] } }[] })?.candidates?.[0];
  const parts = c?.content?.parts ?? [];
  const text = parts.map((p) => p.text ?? "").join("");
  return text.trim() ? text : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function conf(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
}
/** Accept "YYYY-MM-DDTHH:MM", tolerating seconds or a space separator. */
function localDt(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const m = s.replace(" ", "T").match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
  return m && LOCAL_DT.test(m[1]) ? m[1] : null;
}

/**
 * Validate a model reply against the SofExtraction contract. Invalid items are
 * dropped and reported in `conflicts`, so the analyst sees what was not read.
 */
export function normalizeExtraction(raw: unknown, model: string, extractedAt: string): SofExtraction {
  const r = (raw ?? {}) as Record<string, unknown>;
  const d = (r.document ?? {}) as Record<string, unknown>;
  const conflicts: string[] = Array.isArray(r.conflicts) ? r.conflicts.map(str).filter((x): x is string => !!x) : [];

  const kind = KINDS.includes(d.kind as DocumentKind) ? (d.kind as DocumentKind) : "OTHER";
  const op = d.operation === "LOAD" || d.operation === "DISCHARGE" ? (d.operation as Operation) : null;
  const qty = typeof d.cargoQuantityMt === "number" && Number.isFinite(d.cargoQuantityMt) ? d.cargoQuantityMt : null;
  const cpDate = str(d.charterPartyDate);

  const events: ExtractedEvent[] = [];
  for (const e of Array.isArray(r.events) ? r.events : []) {
    const x = e as Record<string, unknown>;
    const type = x.type as LaytimeEventType;
    const at = localDt(x.occurredLocal);
    if (!EVENT_TYPES.includes(type) || !at) {
      conflicts.push(`Skipped an event that could not be read (${String(x.type ?? "?")} at ${String(x.occurredLocal ?? "?")}).`);
      continue;
    }
    events.push({ type, occurredLocal: at, sourceSnippet: str(x.sourceSnippet) ?? "", confidence: conf(x.confidence) });
  }
  events.sort((a, b) => a.occurredLocal.localeCompare(b.occurredLocal));

  const stoppages: ExtractedStoppage[] = [];
  for (const s of Array.isArray(r.stoppages) ? r.stoppages : []) {
    const x = s as Record<string, unknown>;
    const start = localDt(x.startLocal);
    const end = x.endLocal === null || x.endLocal === undefined ? null : localDt(x.endLocal);
    if (!start || (x.endLocal != null && !end)) {
      conflicts.push(`Skipped a stoppage that could not be read (${String(x.reasonText ?? "?")}).`);
      continue;
    }
    if (end && end <= start) {
      conflicts.push(`Skipped a stoppage whose end is not after its start (${String(x.reasonText ?? "?")} ${start} → ${end}).`);
      continue;
    }
    const cat = STOPPAGE_CATEGORIES.includes(x.reasonCategory as StoppageCategory)
      ? (x.reasonCategory as StoppageCategory)
      : "OTHER";
    stoppages.push({
      startLocal: start,
      endLocal: end,
      reasonText: str(x.reasonText) ?? "Stoppage",
      reasonCategory: cat,
      sourceSnippet: str(x.sourceSnippet) ?? "",
      confidence: conf(x.confidence),
    });
  }
  stoppages.sort((a, b) => a.startLocal.localeCompare(b.startLocal));

  return {
    document: {
      kind,
      vesselName: str(d.vesselName),
      imo: str(d.imo),
      port: str(d.port),
      terminal: str(d.terminal),
      operation: op,
      cargoDescription: str(d.cargoDescription),
      cargoQuantityMt: qty,
      charterPartyDate: cpDate && /^\d{4}-\d{2}-\d{2}$/.test(cpDate) ? cpDate : null,
      agent: str(d.agent),
      localTimeZone: str(d.localTimeZone),
    },
    events,
    stoppages,
    rawRemarks: Array.isArray(r.rawRemarks) ? r.rawRemarks.map(str).filter((x): x is string => !!x) : [],
    conflicts,
    extractionModel: model,
    extractedAt,
  };
}

export type GeminiCall = {
  apiKey: string;
  model: string;
  mimeType: string;
  base64: string;
  prompt: string;
  /** false = send without responseJsonSchema (fallback when the API rejects it). */
  withSchema: boolean;
  signal?: AbortSignal;
};

/** One generateContent request. Returns the raw HTTP status and JSON body. */
export async function callGemini(c: GeminiCall): Promise<{ status: number; body: unknown }> {
  // GEMINI_BASE_URL only exists so a local stand-in can be used in testing.
  const base = process.env.GEMINI_BASE_URL ?? "https://generativelanguage.googleapis.com";
  const url = `${base}/v1beta/models/${encodeURIComponent(c.model)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": c.apiKey },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ inlineData: { mimeType: c.mimeType, data: c.base64 } }, { text: c.prompt }],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        ...(c.withSchema ? { responseJsonSchema: SOF_JSON_SCHEMA } : {}),
      },
    }),
    signal: c.signal,
  });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  return { status: res.status, body };
}
