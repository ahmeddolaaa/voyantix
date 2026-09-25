# SOF Ingestion — AI-assisted document → laytime facts

The differentiator. Competitors (i-Magellan, Veson) make an analyst hand-key
every event into an "Enter event" table. Voyantix extracts the material facts
from the uploaded document, the analyst confirms them against the source, and
the existing deterministic engine produces the number. Same rigour, without the
input grind.

## Pipeline

1. **Upload** — analyst attaches a document (SOF / NOR / laytime calc / port
   clearance) to a voyage port call. PDF, scan, or image.
2. **Extract** — a vision model returns a `SofExtraction` (see
   `lib/ingestion/schema.ts`): document metadata, material events, stoppages,
   verbatim remarks, and flagged conflicts. Every item carries its source
   snippet and a confidence.
3. **Review** — source on the left, extracted timeline on the right. The
   analyst confirms / edits / rejects each item. This is the trust mechanism:
   nothing is trusted until a human confirms it.
4. **Commit** — confirmed items become real `operational_events` / `stoppages`
   (existing tables, existing semantics) and feed the deterministic engine.
5. **Audit** — every committed fact links back to its source document and
   extraction, so the statement's evidence trail is airtight.

## Extraction engine

A vision LLM (Gemini for the free tier; interchangeable). Reasons:

- The corpus is wildly varied — BIMCO tables, simple event lists, handwriting,
  abbreviations (EOSP/COSP/POB/NTC), French time (`08h00`), a Turkish port
  clearance certificate, and stoppages buried in narrative remarks. A
  coordinate-based OCR parser needs bespoke handling per format; a vision model
  reads them all.
- Effectively free: Gemini free tier is $0 at low volume; even paid, Flash is a
  fraction of a cent per document. Free-tier data may be used for training, so
  real customer documents move to the paid tier (still negligible cost).

## Accuracy

The guarantee is not a perfect model — it is that the **final data is
human-confirmed**. Extraction is a strong first draft. Accuracy is raised by: a
strict typed schema, the domain taxonomy below, few-shot examples from real
documents, per-item confidence, and cross-document validation (e.g. the NOR
letter says 21:00 while the SOF says 21:25 — surfaced as a conflict).

## Taxonomy — material events only

Only events that move the laytime clock or are material to a claim/audit are
captured as structured events, anchored on what the **laytime calculations**
actually consume (not every line of the SOF). Everything else stays as verbatim
`rawRemarks`, never invented into a calculation event — consistent with the
SOF_AI rule of no synthetic rows.

| Event | Engine semantic |
|---|---|
| ARRIVED | — (record) |
| NOR_TENDERED | NOR_TENDERED |
| NOR_ACCEPTED | NOR_ACCEPTED |
| NOR_RETENDERED | — (to wire from evidence) |
| BERTHED | BERTHED |
| OPERATION_COMMENCED | OPS_COMMENCED |
| OPERATION_COMPLETED | OPS_COMPLETED |
| LASHING_COMPLETED | — (laytime-end candidate) |
| DOCUMENTS_SIGNED | — (laytime-end candidate) |
| DEPARTED | DEPARTED |

**Laytime end** is a per-term choice among `OPERATION_COMPLETED` /
`LASHING_COMPLETED` / `DOCUMENTS_SIGNED` — most often lashing completed for a
load, sometimes documents signed. The analyst confirms it per voyage.

**Stoppage categories** (verbatim reason kept in `reasonText`): LABOUR_BREAK,
MEAL_BREAK, RELIGIOUS, WEATHER, PORT_CLOSURE, AWAITING_BERTH,
AWAITING_INSTRUCTIONS, SHIFTING, NO_GANG, BREAKDOWN, OTHER.

## Semantics observed in the corpus (evidence, not invented)

These come straight from the real laytime calculations and are the evidence to
unblock the engine's withheld semantics — the ingestion and the semantic work
converge on the same documents:

- **Commencement:** NOR before 12:00 → laytime starts 14:00 same day (all three
  calcs). `NTC Even If Used` weekend window.
- **Day counting:** SHEX + EIU, but the excluded weekend is port-dependent —
  FSHEX (Fri/Sat) at Alexandria, SSHEX (Sat/Sun) at Casablanca, Fri 17:00 →
  Mon 08:00 at Gemlik. A per-port / per-term configuration.
- **Once on demurrage always on demurrage** — present in every C/P here.
- **Reversible / non-reversible** — explicit (YUFIX: non-reversible).
- **Despatch basis** — Working Time Saved.
- **Per-interval `% count`** — i-Magellan shows a percentage per interval,
  confirming the engine's `countedFraction` (AN-1) is the professional norm.

## Reference

- Contract: `lib/ingestion/schema.ts`
- Proof-of-concept golden extraction (MV MY FELLAS, Alexandria loading):
  `lib/ingestion/fixtures/my-fellas-loading.extraction.json`
