# VOYANTIX — Product Horizon Register

Living companion to `VOYANTIX_ROADMAP.md`. The roadmap tracks the **build
sequence**; this register tracks the **product horizon** — capabilities a real,
sellable commercial product needs, discovered ahead of time, classified, and
dependency-mapped, so we neither forget them nor implement them prematurely.

## Operating model (Product Architect + Domain Architect)

Two parallel lanes:
- **Lane A — current implementation:** continue authorized, sufficiently
  defined work.
- **Lane B — product horizon:** continuously ask "for a real paying customer,
  what is still missing?" — then record, classify, dependency-map, schedule.
  Lane B does **not** auto-expand current scope.

Every item is exactly one category (never mixed):
- **A — Contract/Domain semantic** ("what does this clause mean?") — validated
  from real charterparty evidence, never invented.
- **B — Product capability** ("what should VOYANTIX provide?") — identifiable now.
- **C — Customer configuration** ("what value for this customer/contract?").
- **D — Implementation detail** ("how the software implements a decided capability").

Priority tiers (roadmap classification, not a score): **Core Foundation ·
Commercial Beta · Production/Enterprise · Post-Launch · Optional/Niche.**

The bounded semantic model stays **frozen**: Template → bounded typed config →
immutable `LaytimeRuleSetVersion` → deterministic pipeline. No generic rule
engine, DSL, scripting, or numeric rule priority. Ownership (`ContractLaytimeTerm`
/ `LaytimeRuleSetVersion` / `ContractStoppageRule`) is authoritative and is not
reshuffled without a real contradiction.

Distinction discipline, always: capability ≠ semantics ≠ configuration ≠
implementation. A blocked calculation on an undefined semantic is acceptable; a
missing product capability is not the same thing and must still be identified.

---

## ⚠️ Architecture-Now Watchlist

Items where **deferring the architectural consideration would cause rework or
structural damage**, so they should influence decisions now — even though their
full behaviour/semantics can be settled later.

### AN-1 · Fractional / partial-interval counting (E4) — ✅ REPRESENTATION RESOLVED (2026-09-21)
- **Category:** B (representation — DONE) + A (when/why a fraction < 1 applies — still withheld).
- **Resolution:** `ClassifiedInterval.countedFraction` (0..1) is now the
  authoritative counted contribution; `treatment` is its coarse view;
  accumulation sums `elapsed × countedFraction`; persisted as
  `laytime_intervals.counted_fraction` (migration 0014); the time-sheet UI is
  fraction-aware. Behaviour is identical today (fractions are 0 or 1). NO
  trigger/percentage/precedence invented — those stay Category A (withheld).
- **Finding (historical):** the roadmap pre-flagged (2026-09-16) that an interval
  must carry a counting **fraction (0..1), not a binary flag**, settled
  **before** the classification step — but the engine had shipped **binary**
  (`classify.ts`, `laytime_intervals.treatment`). Now closed.
- **Why it matters:** real charterparties count some periods at a reduced rate
  (e.g. half-rate weather/shifting time, "time to count as 50%"). The binary
  model cannot express this. Retrofitting later reworks the engine core
  (`classify`, `eiu`, `accumulate`, the `ClassifiedInterval` contract), the
  persisted interval schema, the calculation service mapping, the time-sheet UI
  and the statement.
- **Semantics-free fix available now:** model the interval's contribution as a
  `countedFraction ∈ [0,1]` (today only 1.0 = counted, 0.0 = excluded), with
  accumulation summing `elapsedSeconds × countedFraction`. Behaviourally
  identical today; structurally ready for partial counting. This invents **no**
  trigger, percentage, or precedence — those stay withheld (A) until evidence.
- **Blocks current work?** Nothing is mid-flight, so not blocking — but it
  should be settled before more engine-dependent work is built on the binary
  assumption. **Recommend doing the representation change next.**
- **Target:** Phase 8/9 boundary (engine representation hardening).

### AN-2 · Cumulative-state treatment ("once on demurrage, always on demurrage")
- **STATUS 2026-09-23: CLOSED** — implemented as `lib/laytime/demurrage-state.ts` (post-EIU stage, per-term flag `once_on_demurrage`, per-stoppage-reason exceptions `excluded_on_demurrage`), evidenced by MY FELLAS loading/discharge and MV YUFIX; golden test reproduces MY FELLAS loading exactly. Notes below are the original finding.
- **Category:** B (a cumulative re-treatment stage) + A (the rule itself — withheld).
- **Finding:** the pipeline classifies each interval **independently** of
  cumulative position, then sums. OODAOD and similar rules make an interval's
  treatment depend on whether the **allowance is already exhausted** at that
  point — a sequential/stateful dependency the current stateless pipeline does
  not express.
- **Semantics-free reservation:** a post-classification stage that may re-treat
  intervals after the exhaustion point, gated by a config flag defaulting off
  (identical behaviour today). The when/how is contract semantics (withheld).
- **Blocks current work?** No. Smaller and more isolable than AN-1 (an added
  stage, not a changed contract), so lower deferral risk — but flagged so the
  accumulation model is not assumed permanently order-independent.
- **Target:** Phase 9, or when a reference CP requires it.

### AN-3 · Currency capture + currency-aware aggregation
- **Category:** C (the value) + B (the capability) + D (grouping).
- **Finding:** rates carry currency **implicitly**; there is no currency field.
  Cross-voyage aggregation (dashboard "Net claim (book)", future reports) silently
  assumes a single currency and is latently wrong for a multi-currency book.
- **Fix:** capture currency (on the contract, inherited by terms); aggregate
  **grouped by currency**; never sum across currencies. Mild architectural
  impact (a field + display + grouping).
- **Blocks current work?** No — but should land **before** the reporting layer
  (Phase 9) is built on aggregation.
- **Target:** Phase 9 pre-req (or alongside AN-1).

### AN-4 · Document / evidence provenance on operational facts
- **Category:** B.
- **Finding:** operational events/stoppages are captured manually with a
  recorder + timestamp, but have **no link to a source document** (SOF, NOR,
  timesheet). SOF ingestion (below) and defensible claims need provenance.
- **Assessment:** mostly **additive** (a `documents` table + optional source
  link on facts; the append-only/supersession event model already helps), so
  low deferral risk — but keep the event model provenance-open and do not add
  constraints that would block a later source link.
- **Blocks current work?** No. **Target:** Phase 9/Beta (with SOF ingestion).

---

## Register

### Core Foundation — the fundamental product promise
| Capability | Cat | Why / primary user | Status | Deps | Blocks now | Target |
|---|---|---|---|---|---|---|
| Fractional interval counting (AN-1) | B(done)+A | real CPs count periods at a fraction · analyst | ✅ representation done; semantic withheld | — | no | done 2026-09-21 |
| Cumulative-state treatment / OODAOD (AN-2) | B+A | common CP rule · analyst | ✅ built 2026-09-23 | post-EIU stage | no | done |
| Currency capture + aggregation (AN-3) | C+B | correct money across a book · commercial | missing | contract/term field | no | Ph9 pre-req |
| SOF / document ingestion → reviewable timeline | B | capture facts fast & defensibly · operator/analyst | not built | doc model, review UI | no | Beta |
| Evidence attachment + provenance (AN-4) | B | defensible claims · analyst | not built | doc model | no | Ph9/Beta |
| Claim lifecycle (submitted/agreed/disputed/settled) | B | a claim is more than draft/finalized · commercial | draft/finalized only | statement model (additive) | no | Ph9 |
| Time-bar tracking + alerts | B (period C/A) | missing a time-bar loses the claim · commercial | not built | claim lifecycle + completion event | no | Ph9/Beta |
| Analyst review / maker-checker before finalize | B | trusted numbers · reviewer | perms exist, no flow | statement lifecycle | no | Ph9 |

### Commercial Beta — credible trials / first paying customers
| Capability | Cat | Why | Status | Target |
|---|---|---|---|---|
| Self-serve org onboarding + user invitations | B | can't hand-seed customers | admin-created only | Beta |
| Auth lifecycle: password reset, email verification | B | table stakes | not built | Beta |
| Transactional email (invites/resets/notifications) | B/D | required by the above | not built | Beta |
| Excel / PDF export (statements, time-sheets) | B | brokers live in Excel/PDF | statement print only | Beta |
| Supported / Review / Unsupported status in UI | B | professional handling of refusals | refusal shown raw | Beta |
| Deployment: managed hosting + managed Postgres + backups + secrets | D | it only runs locally now | not deployed | Beta |
| Error monitoring + logging + basic observability | D | can't run blind | none | Beta |

### Production / Enterprise
| Capability | Cat | Why | Status | Target |
|---|---|---|---|---|
| Billing / subscription / entitlements | B | it's a paid SaaS | none | Prod |
| Rate limiting + security hardening + session policy | D | abuse/security | minimal | Prod |
| Performance: remove N+1 (portfolio), pagination, indexing | D | scale | N+1 present | Prod |
| Data retention / export / deletion (compliance) | B/D | enterprise/legal | none | Prod |
| Audit-log surfacing / review UI | B | recordAudit exists, not surfaced | backend only | Prod |
| SSO / enterprise identity | B | larger buyers | none | Prod (opt early) |

### Post-Launch
| Capability | Cat | Why | Status | Target |
|---|---|---|---|---|
| Reporting suite (exposure, stoppage analysis, claim pipeline, mgmt) | B | value beyond one claim | Reports stub | Ph9 (⚠ B6/B9 withheld) |
| Comments / notes / collaboration on calcs & claims | B | team workflow | none | Post |
| Public / partner API | B | integrations | action layer is a clean seam | Post |
| Integrations: accounting / ERP / TMS / document systems | B | enterprise fit | none | Post |
| Bulk operations, global search / filter | B | large books | none | Post |

### Optional / Niche
| Capability | Cat | Why | Target |
|---|---|---|---|
| Multi-language UI (Arabic / RTL) | B | regional buyers | Opt |
| Mobile-optimized operational entry | B | quayside capture | Opt |
| External vessel/port master-data enrichment | B | data quality | Opt |

---

## Domain-semantic backlog (Category A — validate from real CP evidence, never invent)
These stay as engine **refusals** until a real charterparty defines them:
commencement (B1) · turn time (B2) · WWD weather counting (Q9/B3) · holiday
precedence (B4) · SHEX weekday convention (B5) · term applicability tie-break
(B8) · despatch basis (ATS vs WTS) · allowance units beyond hours/days ·
CountsAgainstOwner balance effect · pooled settlement rate selection (B7) ·
reversible attribution (B6) · Achieved Rate formula (B9) · the fraction
trigger/precedence behind AN-1 · the OODAOD rule behind AN-2.

Refusal is the correct behaviour for these. They are **not** product-capability
gaps — the capabilities to *hold* and *apply* them are largely built; only their
meaning is withheld.

---

## Maintenance
- Update this file when a capability is discovered, reclassified, or delivered.
- At each major phase boundary, emit a concise **Product Horizon Check** (new
  capabilities, new dependencies, anything affecting current architecture,
  anything genuinely blocking the next step) — not the whole backlog.
- Market/competitor observations are evidence of customer expectation, not a
  mandate to copy; record them as observations, decide separately.
