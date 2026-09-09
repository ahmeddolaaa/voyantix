# VOYANTIX — MASTER ROADMAP

> **Single source of truth for the whole project lifecycle.**
> Before starting any phase in a future session: read this file, read the
> current phase section, verify the actual repo state, then execute ONLY
> the next approved step. Return here when a milestone completes.
>
> This file is evidence-based. Every phase, entity, and rule below comes
> from the approved/frozen architecture, the handoff, or the actual code —
> not from general software or maritime reasoning.

---

## HOW TO READ THIS FILE

- **Status legend:** ✅ COMPLETE · ⬅️ NEXT · ⏳ FUTURE · ⚠️ PARTIAL · 🛑 BLOCKED BY WITHHELD RULE
- **Source legend:** OFFICIAL (named in the approved sequence/architecture) · INFERRED (architecture-implied, labelled as such)
- A phase is **COMPLETE only when**: code exists AND persistence works AND authorization works AND tenant scope works AND tests pass on real PostgreSQL AND runtime behaviour is verified in the browser AND the workflow is actually usable. A rendering page is NOT proof a workflow works.

---

## CURRENT STATE

- **Repo:** `github.com/ahmeddolaaa/voyantix` — local branch `main` tracks `origin/rebuild`. Push form: `git push origin main:rebuild`.
- **Work folder:** `/workspaces/voyantix/voyantix` (nested). Runs in GitHub Codespaces.
- **Latest commit:** `13bdfbc` (Event Types placeholder cleanup).
- **Stack:** Next.js 16.3.3 · React 19.2.8 · Drizzle ORM · PostgreSQL. Turbopack (`next dev`).
- **DB:** `postgresql://voyantix:voyantix@127.0.0.1:5432/voyantix_dev` (default in code; no real `.env`). Migrations applied: `0000_platform_baseline`, `0001_sticky_cloak`.
- **Schema files:** `db/schema/platform.ts` (Phase 1), `db/schema/master-data.ts` (Phase 2).
- **Login:** `admin@demo.test` / `voyantix`.

### Completed
- **Phase 1 ✅** — Auth, Membership, Session, Roles, Tenancy, Authorization. 23 tests (Phase 1) + full suite green (69 tests total as of Event Types).
- **Phase 2 ✅** — Master Data complete. Schema (8 tables, composite FKs, CHECK constraints), shared foundations (forms, ui, DataTable, TimezoneCombobox), and every admin screen: Ports · Facilities · Vessels · Cargo · Stoppage Reasons · Holiday Calendars · **Event Types** (the final Phase 2 screen — action + 12 tests + UI, browser-verified).

### Currently next
- **Phase 3 — Commercial layer.** First concrete step: schema for `LaytimeRuleSet` + `LaytimeRuleSetVersion` only (because `ContractLaytimeTerm.ruleSetVersionId` references them). No actions, no UI until schema + migrate are done.

### Verification ladder (never conflate these)
`implemented` → `typechecked (tsc --noEmit)` → `tested (vitest on PostgreSQL)` → `browser/runtime verified`. Phase 2 reached the top rung. Nothing in Phase 3+ is verified yet.

### Monitored / deferred issues
- **Next.js #668 "Router action dispatched before initialization"** — intermittent, not currently reproducing; not fixed, just not present. Diagnose live if it returns.
- **Deferred (Phase 2 residue):** when an org-creation flow is built (part of a later admin/onboarding scope), it MUST call `seedProtectedEventTypes(org.id)` inside the creation transaction, or new orgs ship without the 8 protected event types and the engine cannot resolve. The function is idempotent and ready; nothing calls it except `scripts/bootstrap.ts` today.
- **`tsconfig.tsbuildinfo`** — build cache, keeps appearing as modified; never commit it (belongs in `.gitignore`, unverified).

---

## PHASE STRUCTURE OVERVIEW (OFFICIAL — from the approved Implementation Sequence)

| Phase | Name | Status | Blocked by |
|---|---|---|---|
| 1 | Platform — Auth/Tenancy/Authorization | ✅ COMPLETE | — |
| 2 | Master Data + Company Config + admin screens | ✅ COMPLETE | — |
| 3 | Commercial — Contract, Terms, RuleSets, Pools, resolver | ⬅️ NEXT | — |
| 4 | Voyage + PortCall restructure + CargoPlan re-parent + backfill | ⏳ FUTURE | — |
| 5 | Operational — Event, Stoppage, ShiftPerformance re-parent | ⏳ FUTURE | — |
| 6 | Laytime Engine rebuild | ⏳ FUTURE | 🛑 B1–B5, B8 |
| 7 | Calculation + Statement persistence + StatementScopeResult | ⏳ FUTURE | 🛑 B7 |
| 8 | Professional UX | ⏳ FUTURE | — |
| 9 | Reporting | ⏳ FUTURE | 🛑 B6, B9 |
| 10 | Full validation + commercial readiness review | ⏳ FUTURE | — |

**Phases 1–5 and 7–8 are structurally unblocked.** Only specific rules inside Phase 6 (and reporting columns in Phase 9) are gated, each isolated so surrounding work proceeds. Phase 10 is the final phase.

---

# PHASES — FULL DETAIL

## Phase 1 — Platform · ✅ COMPLETE · OFFICIAL
**Purpose:** tenancy, identity, authorization boundary that every other layer lives inside.
**Components:** Organization, User (global identity, NOT org-scoped), Membership, Session (sole authority for tenant scope), fixed Roles (`admin`/`commercial`/`operations`/`viewer`).
**Schema:** `db/schema/platform.ts`. **Migration:** `0000_platform_baseline`.
**Evidence of completion:** 23 auth/tenancy/authz tests on real PostgreSQL; login works.
**Frozen:** roles are a fixed set (not a configurable RBAC matrix); `organizationId` never accepted from client for authorization.

## Phase 2 — Master Data · ✅ COMPLETE · OFFICIAL
**Purpose:** the reference records contracts and voyages are built from.
**Components/screens:** Ports · Facilities (child of Port; replaces old "Factory") · Vessels (optional, never a prerequisite) · Cargo · Stoppage Reasons (`isWeatherRelated`, no `defaultCountability`) · Holiday Calendars + Holidays · Event Types (`OperationalEventType` with `systemSemantic`).
**Schema:** `db/schema/master-data.ts` (8 tables, composite FKs blocking cross-tenant at the DB, CHECK constraints). **Migration:** `0001_sticky_cloak`.
**Evidence of completion:** every screen built + browser-verified; Event Types has action + 12 tests; full suite 69 green.
**Frozen:** the 8 engine semantics (`NOR_TENDERED`, `NOR_ACCEPTED`, `BERTHED`, `OPS_COMMENCED`, `OPS_COMPLETED`, `DEPARTED`, `WEATHER_START`, `WEATHER_END`); protected event-type rows (label-only edit, never deactivate/delete, code/semantic immutable); master data with lifecycle uses active/inactive, never hard delete.

## Phase 3 — Commercial layer · ⬅️ NEXT · OFFICIAL
**Purpose:** capture the commercial agreement — what laytime is allowed, at what rates, under which reusable rule semantics — independent of any actual voyage.
**Depends on:** Phase 2 (Port, Cargo for term scope; nothing else). Does NOT need Voyage/PortCall (those are Phase 4, after this).
**Entities (frozen fields):**
- `Contract` — fixture header: reference, counterparty, date. *Not versioned.*
- `ContractLaytimeTerm` — commercial values: scope (`function`, `portId?`, `cargoId?`), `allowance`, `allowanceUnit`, `demurrageRate`, `despatchRate`, `despatchBasis`, `turnTimeHours?`, `turnTimeTrigger?`, `commencementRule`, `ruleSetVersionId`, `poolId?`. *Versioned (see Frozen Decisions).*
- `LaytimeRuleSet` — reusable semantics container: named header only.
- `LaytimeRuleSetVersion` — `excludedWeekdays[]`, `excludeHolidays`, `eiuApplies`, `weatherApplies`, `workingDayStart/End`, `holidayCalendarId?`. *Immutable once any term references it.*
- `LaytimePool` — reversible allowance pool: `totalAllowance`, `allowanceUnit`, `settlementPolicy`. *Versioned.*
- `ContractStoppageRule` — `stoppageReasonId` → `AlwaysExcluded` / `NeverExcluded` / `CountsAgainstOwner`. *Lives with the term.*
- **applicability resolver** — selects the applicable term: exactly one match → use it; several but one strictly more specific → use it; otherwise raise `TermAmbiguityException` and calculate nothing. No numeric weights, no silent tie-break.
**Implementation order (inside the phase):** RuleSet + RuleSetVersion → Contract → ContractLaytimeTerm (+ ContractStoppageRule) → LaytimePool → applicability resolver. Each: schema → migrate → actions + tests → UI (UI may follow the Phase 8 UX pass, but CRUD screens follow the Phase 2 pattern).
**Required tests:** tenant-scoped list/create/update; versioning creates a new version rather than mutating a referenced one; resolver returns the single match, picks the strictly-more-specific one, and raises `TermAmbiguityException` on a true tie.
**Must NOT include:** any calculation/engine logic; commencement/turn-time/weekday SEMANTICS (those are withheld B-rules, Phase 6); Voyage/PortCall; statement persistence. Phase 3 stores the user's CHOICES as columns; it never executes a rule.
**Exit criteria:** all commercial entities exist, are tenant-scoped, versioning works, resolver behaves per the three cases, tests green on PostgreSQL, CRUD usable in browser.
**Next dependency:** Phase 4 consumes `contractId` / resolved `contractLaytimeTermId` on PortCall.

## Phase 4 — Voyage + PortCall · ⏳ FUTURE · OFFICIAL
**Purpose:** the operational spine — a voyage visiting one or more port calls, each anchored in real local time.
**Entities:** `Voyage` (`voyageReference` unique per org, `vesselName` text required, `vesselId?`, `contractId?`, `status`) — loses `portId`/`arrivalTime`/`norTender`/`norAcceptance`/`sailingTime` (all become port-call facts). `VoyagePortCall` (`voyageId`, `portId`, `facilityId?`, `function` LOAD/DISCHARGE, `sequence`, `status`, **`effectiveTimezone`**, `contractLaytimeTermId?`). `CargoPlan` re-parented to `portCallId`.
**Depends on:** Phase 3 (contract/term to resolve onto a port call), Phase 2 (ports/facilities).
**Includes backfill** of any existing voyages to the PortCall model.
**Must NOT include:** operational events/stoppages (Phase 5); any calculation.
**Exit criteria:** voyage + multi-port-call model persists, effectiveTimezone captured per call, backfill safe, tests green.

## Phase 5 — Operational · ⏳ FUTURE · OFFICIAL
**Purpose:** record what actually happened at each port call.
**Entities:** `OperationalEvent` (point-in-time; `portCallId`, `eventTypeId`, `occurredAt`, `recordedAt`, `recordedByUserId`, `supersededByEventId?`; append-only, corrections supersede). `Stoppage` (time span; overlap + one-open rules). `ShiftPerformance` (throughput; `shiftDate` NOT NULL; **never affects countability**).
**Depends on:** Phase 4 (everything hangs off `portCallId`), Phase 2 (event types, stoppage reasons).
**Must NOT include:** any calculation; ShiftPerformance must never feed countability.
**Exit criteria:** events/stoppages/shifts persist against port calls with their integrity rules, tests green.

## Phase 6 — Laytime Engine rebuild · ⏳ FUTURE · OFFICIAL · 🛑 B1–B5, B8
**Purpose:** the composable calculation engine — a pure function, no DB access, producing a *balance* (not an amount).
**Model:** composable axes, never `switch(termLabel)`. Pipeline: resolve scope → determine commencement (🛑B1) → apply turn time (🛑B2) → candidate window → partition (weekday/holiday/stoppage/weather/allowance/midnight boundaries, LOCAL time) → classify → apply EIU → accumulate per port call → pool (reversible) → saved/exceeded. **Engine stops at the balance; no rates.**
**Depends on:** Phases 3–5 (terms, port calls, events).
**Blocked by (withheld — do NOT invent):** B1 commencement, B2 turn time, B3 WWD weather, B4 holiday precedence, B5 SHEX weekday convention, B8 term applicability tie-break. Each isolated to its pipeline step; engine must REFUSE to calculate rather than assume a default.
**Pre-req risk gate:** validate the composable rule model against 2–3 real charterparties before building this phase.
**Must NOT include:** rates/settlement (Phase 7); persistence beyond the pure function's output contract.

## Phase 7 — Calculation + Statement persistence · ⏳ FUTURE · OFFICIAL · 🛑 B7
**Purpose:** run the engine, persist the truth, produce the settlement amount and the statement.
**Entities:** `LaytimeCalculation` (one run + `resolvedRulesJson` snapshot + `engineVersion`). `LaytimeInterval` (**the single source of calculation truth**) + `LaytimeIntervalStoppageLink`. `LaytimeStatement` (voyage-level lifecycle). `StatementScopeResult` (per port call AND per pool). `LaytimeAdjustment` (table exists, workflow not implemented). **No `TimeSheetEntry` table** — the time sheet is a query over `LaytimeInterval`.
**Settlement:** separate layer turns balance → amount (🛑B7 pooled settlement rate selection; non-pooled is fully defined).
**Frozen behaviours:** canonical statement (0 → empty, 1 → canonical, >1 → integrity exception, never pick one); one active draft (0 → create, 1 → update, >1 → log & write nothing); recalculation deletes existing intervals and rewrites inside one transaction; historical reproducibility via the three layers.
**Must NOT include:** reporting (Phase 9).

## Phase 8 — Professional UX · ⏳ FUTURE · OFFICIAL
**Purpose:** raise the interface from functional to commercial-grade (dense dashboard, SOF-style timeline, document-like statement, real loading/error/empty states, multi-column forms with grouping).
**Depends on:** the underlying data/workflows of Phases 3–7 existing.
**Note:** do not build future-phase UI early just because a table exists.

## Phase 9 — Reporting · ⏳ FUTURE · OFFICIAL · 🛑 B6, B9
**Purpose:** reports built on persisted engine output only — no fabricated figures.
**Blocked by (withheld):** B6 reversible attribution (for reporting), B9 Achieved Rate formula (one report column).
**Depends on:** Phase 7 (persisted calculation truth).

## Phase 10 — Full validation + commercial readiness · ⏳ FUTURE · OFFICIAL
**Purpose:** the final gate — end-to-end validation, integrity/concurrency tests, and a commercial-readiness review (permissions depth, onboarding, real reports) before production.
**This is the final defined phase.**

---

# FROZEN DECISIONS — DO NOT REOPEN WITHOUT EVIDENCE

Each is approved/final. To change one, record in the Decision Log what evidence forced it, what changed, and which earlier decision it supersedes.

| # | Decision | Source | Phases | Implemented? |
|---|---|---|---|---|
| F1 | Multi-tenant; `User` is global identity, access via `Membership`; `Session` is the sole authority for tenant scope; `organizationId` never trusted from client | Architecture / platform.ts | All | ✅ |
| F2 | Fixed role set (`admin`/`commercial`/`operations`/`viewer`), not a configurable RBAC matrix | Architecture | All | ✅ |
| F3 | Cross-tenant or missing resource → `NOT_FOUND`, never `FORBIDDEN` (no existence leak); `FORBIDDEN` only for a real permission gap inside the caller's own org | result.ts | All | ✅ |
| F4 | Shared `ActionResult<T>` + `mapDatabaseError` (SQLSTATE + constraint names, never message text); unexpected failures throw | result.ts | All | ✅ |
| F5 | Composite tenant FKs enforce isolation at the PostgreSQL layer, not app code alone | master-data.ts | 2+ | ✅ |
| F6 | Facility replaces "Factory" — the product must not encode one customer's industry | Architecture | 2 | ✅ |
| F7 | Vessel is optional, never a prerequisite for a voyage | Architecture | 2/4 | ✅ (master) |
| F8 | The 8 engine semantics are fixed; only they can affect the engine. Custom event types carry no semantic | Architecture / master-data.ts | 2/6 | ✅ |
| F9 | Protected event-type rows: label-only edit; code/semantic immutable; never deactivate/delete; enforced by DB CHECK + action payload | master-data.ts / event-types.ts | 2 | ✅ |
| F10 | Master data with a lifecycle uses active/inactive; no hard delete (exception: line-items like holidays) | Architecture | 2 | ✅ |
| F11 | StoppageReason has NO `defaultCountability`; countability comes only from `ContractStoppageRule` at calc time | Architecture | 2/3 | ✅ |
| F12 | Contract (header) vs ContractLaytimeTerm (commercial values) are separate; a RuleSet holds only reusable semantics | Architecture | 3 | ⏳ |
| F13 | `LaytimeRuleSetVersion` is immutable once referenced; editing creates a new version | Architecture §F | 3 | ⏳ |
| F14 | `ContractLaytimeTerm` is versioned; editing a term on a contract with a finalized statement creates a new term version | Architecture §F | 3/7 | ⏳ |
| F15 | Applicability resolver: 1 match → use; several with one strictly-more-specific → use it; else `TermAmbiguityException`, calculate nothing. No weights, no silent tie-break | Architecture | 3/6 | ⏳ |
| F16 | Reversible pooling and settlement are separate: engine produces a balance, a settlement layer produces an amount (step 10/11 split) | Architecture | 6/7 | ⏳ |
| F17 | Laytime engine is composable axes, never `switch(termLabel)`; a pure function with no DB access | Architecture | 6 | ⏳ |
| F18 | Calculation resolves against `PortCall.effectiveTimezone`; all weekday/holiday boundaries in LOCAL time | Architecture | 4/6 | ⏳ (tz captured P4) |
| F19 | `LaytimeInterval` is the single source of calculation truth. There is NO `TimeSheetEntry` table — the time sheet is a query over intervals | Architecture | 7 | ⏳ |
| F20 | Historical reproducibility = three layers: immutable RuleSetVersion + versioned ContractLaytimeTerm + `resolvedRulesJson` snapshot | Architecture / README | 3/6/7 | ⏳ |
| F21 | Canonical statement: 0 → empty, 1 → canonical, >1 → integrity exception (never pick one). Never arbitrary selection (no limit(1)/most-recent/first) | README / Architecture | 7 | ⏳ |
| F22 | One active draft: 0 → create, 1 → update, >1 → log & write nothing. Draft lookup filters to Draft so a finalized statement is never overwritten | README | 7 | ⏳ |
| F23 | Recalculation deletes existing intervals and rewrites inside one transaction (no partial/mixed data) | README | 7 | ⏳ |
| F24 | ShiftPerformance never affects laytime countability | Architecture | 5/6 | ⏳ |
| F25 | Migrations are versioned SQL (no `drizzle-kit push` as the source of truth); PostgreSQL only for integration/concurrency/integrity tests | Architecture | All | ✅ |
| F26 | Tenant-isolation tests use two real orgs with real data through the real repository path — never fake IDs | Architecture | All | ✅ |
| F27 | Visual identity tokens in `app/globals.css` are frozen: brass = primary action, teal = positive/active, rust = negative/delete. Fraunces headings, IBM Plex Sans UI, IBM Plex Mono figures | Handoff §7 | 8 | ✅ (tokens) |

---

# WITHHELD BUSINESS RULES — B1–B9 (NEVER INVENT)

The identifiers and their target phase are known; their **semantics are deliberately withheld** and must be asked for when the phase is reached. Build the structure that stores the user's choice; never encode the rule's meaning from maritime knowledge, intuition, or prior assumptions. If a needed rule is undefined at runtime, the engine must REFUSE to calculate rather than assume a default.

| # | Rule (identity only) | Belongs to | Data structure that must exist first |
|---|---|---|---|
| B1 | Commencement basis | Phase 6 | `ContractLaytimeTerm.commencementRule` + operational events |
| B2 | Turn time trigger/semantics | Phase 6 | `turnTimeHours?` / `turnTimeTrigger?` on term |
| B3 | WWD weather determination | Phase 6 | `weatherApplies` on RuleSetVersion; weather events |
| B4 | Holiday precedence (port calendar vs contract list) | Phase 6 | HolidayCalendar + RuleSetVersion.holidayCalendarId |
| B5 | SHEX weekday convention | Phase 6 | `excludedWeekdays[]` on RuleSetVersion (data, not hardcoded) |
| B6 | Reversible attribution (for reporting) | Phase 9 | LaytimePool + StatementScopeResult |
| B7 | Pooled settlement rate selection | Phase 7 | LaytimePool.settlementPolicy; term rates |
| B8 | Term applicability tie-break (null cargo = all, or incomplete?) | Phase 6 | applicability resolver + term scope |
| B9 | Achieved Rate formula | Phase 9 | ShiftPerformance throughput; one report column |

**Note:** the resolver STRUCTURE (F15) is defined and belongs to Phase 3; only B8's tie-break *policy* is withheld to Phase 6.

---

# DEPENDENCY CHAIN (whole product)
Key hard dependencies: term versioning + resolvedRulesJson (F13/F14/F20) must exist before any finalized statement is trustworthy; PortCall.effectiveTimezone (F18) must exist before the engine partitions time; LaytimeInterval (F19) must exist before statements or reports.

---

# ANTI-DRIFT RULES

1. Never invent business rules. 2. Never invent B1–B9. 3. Never reopen a frozen decision without concrete evidence (log it). 4. Never promote INFERRED architecture into OFFICIAL requirements silently. 5. Never mark planned work as complete. 6. Never pull later-phase work into the current phase without explicit justification. 7. Never claim runtime correctness from typecheck alone — browser/PostgreSQL verification is required. 8. Never ask the product owner a question already answered in authoritative material. 9. Record genuine unknowns instead of silently deciding them. 10. Update this roadmap after material decisions or milestone completion. 11. Maintain this as the ONLY roadmap file. 12. Preserve historical decisions rather than rewriting them.

---

# OPEN / UNKNOWN ITEMS

Cross-checked against handoff, architecture, frozen decisions, prior implementation, and current code.

- **Phase 3:** None identified from authoritative material. Structure and fields are fully frozen.
- **Phases 4–5:** None identified. Entities and fields are specified.
- **Phase 6:** Withheld semantics B1–B5, B8 (identity known, meaning withheld to this phase). Not "open questions" — deliberately deferred with a place to receive the answer.
- **Phase 7:** Withheld semantic B7 (pooled settlement). Non-pooled settlement is fully defined.
- **Phase 9:** Withheld B6, B9.
- **Product-wide genuine unknown:** whether fixed roles suffice for an enterprise buyer (Risk #6) — deliberately deferred, revisitable without redesign; not blocking.

---

# DECISION LOG

| Date | Decision | Source | Phase(s) | Status | Impact |
|---|---|---|---|---|---|
| 2026-08 | Abandon Power Apps; rebuild as standalone multi-tenant web app on PostgreSQL | Prior sessions | All | frozen | Full ground-up rebuild |
| 2026-09-07 | Adopt the 10-phase Implementation Sequence as the mandated order | Approved architecture | All | frozen | This roadmap's backbone |
| 2026-09 | Phase 1 complete (auth/tenancy/authz, 23 tests) | Session | 1 | frozen | Boundary for all later work |
| 2026-09 | Phase 2 complete incl. Event Types (`13bdfbc`) | This session | 2 | frozen | Master data ready for Phase 3 |
| 2026-09 | Phase 3 = Commercial layer confirmed as the official next phase | Implementation Sequence | 3 | frozen | Next work item |

---

# ROADMAP MAINTENANCE POLICY

After every meaningful milestone: update CURRENT STATE, update phase status, record new decisions in the Decision Log, record newly discovered dependencies, close resolved open questions, preserve completed history, and confirm the next step still matches this file. Before starting a new phase in any future session: (1) read this file, (2) read the current phase section, (3) verify the actual repo state, (4) execute ONLY the next approved step, (5) return here when the milestone completes. This file answers "where are we, where are we going, why, what is decided, what is not, and what happens next" — so no session needs to ask.