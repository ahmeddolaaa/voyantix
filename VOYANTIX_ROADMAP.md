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

## CURRENT STATE  (updated 2026-09-23 — read this first)

> This section was rewritten on 2026-09-23 at the end of a very long session
> whose early context had been summarised. Everything below was checked
> against the actual repo, not memory. Older state notes are kept further
> down in the DECISION LOG for history.

### Where things live
- **Repo:** `github.com/ahmeddolaaa/voyantix`, branch **`rebuild`** (the only working branch; `main` is an old checkpoint `7abb42a`).
- **Latest commit:** see `git log -1` on `rebuild` (the commit that added this line: amended GENCON 6(c) commencement) — full suite **519 tests green**, typecheck clean.
- **Stack:** Next.js 16.3.3 (Turbopack) · React 19.2.8 · Drizzle ORM · PostgreSQL 16 · Vitest · tsx. Node ≥ 20.
- **Migrations:** `0000`–`0020` (21 files). Latest: `0018` term `commencement_time_rule`, `0019` org `settlement_day_precision` (+ CHECK), `0020` laytime end: event-type vocabulary +2 semantics, term `laytime_end_event`, port call `laytime_end_override` (+ CHECKs, seeds the 2 protected event types for every org).
- **Production:** Railway — `https://voyantix-production.up.railway.app`, managed Postgres, deploys automatically from `origin/rebuild`. The start command (set in the Railway UI, not in the repo) runs `db:migrate`, then `db:bootstrap`, then `next start`. After a deploy, hard-refresh (Ctrl+Shift+R) — the browser cache has shown the old UI before.
- **Login (demo):** `admin@demo.test` / `voyantix` — org "Demo Shipping Co." (slug `demo-shipping`).

### How code reaches production (Adel's workflow — keep it exactly like this)
Claude works in its own sandbox and cannot push. Delivery is a **git bundle**:
1. Claude: `git bundle create voyantix-X.bundle <base>..rebuild` and sends the file.
2. Adel uploads it to **Google Cloud Shell**. The upload lands in the home folder or in `~/voyantix-1/...` depending on the session — locate it with `find ~ -name "voyantix-X.bundle"`.
3. Adel runs, in **`~/voyantix`** (the real repo, on `rebuild`):
   ```
   cd ~/voyantix
   git fetch <path-to-bundle> refs/heads/rebuild
   git merge --ff-only FETCH_HEAD
   git push origin rebuild
   ```
4. Railway redeploys. `~/voyantix-1/voyantix` is an OLD clone on `main` used only as an upload drop folder — never push from it.
- The `<base>` of each bundle must be a commit Adel already has; check with `git log --oneline -1` in `~/voyantix`.

### What the product does today (all browser-verified)
- **Platform/master data/commercial/operational layers (Phases 1–5)** — complete.
- **Laytime engine (`lib/laytime/`)** — pure, deterministic, refuses rather than guessing. Pipeline: commencement (+ time-of-day rule / turn time) → window → partition at local days → tag stoppages/weather → calendar classify → EIU → **once-on-demurrage stage** → accumulate → balance → settlement.
- **Calculation + statement layer (Phase 7)** — persisted calculations with interval time-sheet, statements (draft/finalized), adjustments, F14 term versioning.
- **Professional UI (Phase 8)** — enterprise redesign, portfolio, voyage detail two-column workspace, printable statement, SOF-style timeline.
- **SOF ingestion (differentiator, slices 1–2)** — `docs/SOF_INGESTION.md`. Extraction schema, fully editable review screen, and commit-to-port-call. Currently **fixture-driven** (`lib/ingestion/fixtures/my-fellas-loading.extraction.json`); the vision-LLM call itself is NOT wired yet. Reached from a port call via "Import from SOF".
- **Built 2026-09-23:**
  - **Rate-based allowance** — term `allowanceBasis` FIXED | RATE; RATE = actual cargo MT ÷ rate (MT/day). Refuses if no actual quantity.
  - **Live provisional laytime status** — for ACTIVE port calls: time to demurrage (or time over), used-vs-allowed meter coloured by zone, planned-quantity basis labelled PROVISIONAL. Server recomputes every 30 s; only the port clock ticks client-side. Reference only, never the settlement.
  - **Once on demurrage, always on demurrage (AN-2)** — term flag. After the exact expiry instant, excluded days, holidays and stoppages stop interrupting time. **Exceptions** per stoppage reason ("still excluded on demurrage", e.g. breakdown of vessel). Calendar exceptions cannot be excepted (all references lift them).
  - **Stoppage rules screen** — per contract term ("Stoppage rules" button). Before this, NO UI existed, so any calc meeting an un-seeded stoppage reason was refused.
  - **Bounded term fields** — commencement event, commencement time rule, turn-time trigger, allowance unit, despatch basis are dropdowns from `lib/laytime/term-vocabulary.ts`; the server validates against the same list.
  - **Commencement time rule in UI** — `MORNING_NOR_1400` (label "12:00 rule (14:00 / next WD 08:00)"). Mutually exclusive with turn time.
  - **Amended GENCON 94 clause 6(c) — both branches** — NOR up to AND including 12:00 local → laytime 14:00 same day; NOR after 12:00 → 08:00 local on the **next working day** (first following day that is not an excluded weekday of the rule set and not a holiday of its calendar). Stored value `MORNING_NOR_1400` kept (no migration); the after-noon branch used to be refused, so no earlier result changes. Refuses `COMMENCEMENT_RULE_NEEDS_CALENDAR` / `COMMENCEMENT_NO_WORKING_DAY` rather than guessing. Browser-verified: NOR Thu 25/06 15:30, Friday excluded → counting from Sat 27/06 08:00 (live status and settled calculation both).
  - **Fixes:** term versioning now copies stoppage rules to the new version (they were silently dropped); terms list shows the new version after editing a frozen term.

  - **Laytime end event (2026-09-24)** — laytime ends at a configurable event: Operations completed | Lashing completed | Documents on board. The TERM sets the usual end (form default: Lashing completed for LOAD, Operations completed for DISCHARGE; existing terms kept Operations completed). ONE port call can override it from the voyage page ("Laytime ends at" in the Laytime calculation card; saving recalculates at once; audited; `contract.write`). Missing chosen event → refused (`WINDOW_END_EVENT_MISSING`), never a fallback. The live status stops at the same event. SOF import now records lashing completed / documents signed as engine events. **MY FELLAS loading now reproduced through the app** (documents on board 28/06 11:15): used 4d 21h 15m, 3d 20h 50m over, $13,537.82 (EXACT rounding).
  - **Displayed balance = sheet convention** (`sheetBalanceSeconds`): allowed cut to the minute, minus used (MY FELLAS 3d 20h 50m, test_2 3d 11h 26m). Display only — money uses exact seconds.

### Contract semantics learned from Adel's reference documents
Source files (uploaded 2026-09): MY FELLAS NOR/SOF loading, MY FELLAS laytime calc loading + discharge, MV YUFIX i-Magellan calc, SOF_0001, departure document, and four i-Magellan timesheets (test_1–4). Each rule below is **evidence**, not invention; customer VALUES stay configuration.
- **Rate allowance:** "3000 MT PWWD FSHEX EIU" → allowed = cargo ÷ rate (3052.403 / 3000 = 1.017468 days = 1d 00h 25m). Golden-tested.
- **Commencement 12:00/14:00:** "If NOR before 12:00 → time counts 14:00 same day" (MV YUFIX; MY FELLAS NOR accepted 08:00 → laytime 14:00).
- **Commencement clause text (2026-09-23):** GENCON 1994 clause 6(c), amended by Adel's charter party — printed 13:00 → **14:00**, printed 06:00 → **08:00**: "Laytime … shall commence at 14.00 hours, if notice of readiness is given up to and including 12.00 hours, and at 08.00 hours next working day if notice given during office hours after 12.00 hours." Same clause: laytime "weather permitting, Sundays and holidays excepted, unless used, in which event time used shall count"; "Time used before commencement of laytime shall count" (not modelled — see OPEN ITEMS).
- **Once on demurrage:** MY FELLAS loading + discharge and MV YUFIX count every period after expiry at 100%, including Fri/weekend exceptions and all SOF stoppages (labour breaks, port closure, Friday prayer). Golden test reproduces MY FELLAS loading exactly: used 4d 21h 15m, 3.867949 days demurrage, expiry Wed 24/06 14:25.
- **Laytime end (Adel, 2026-09-24):** varies per vessel. Loading normally ends at **lashing completed**; when the documents take very long to be signed, time ends at **documents on board** (MY FELLAS: 11:15). Discharging ends at **discharge completed** (= Operations completed).
- **Other CP pattern (test_1–4):** NOR tendered any time → **NOR accepted next working day 08:00** → 24 h turn time → counting. Weekend Thu 14:00 → Sun 08:00 not to count; shifting to berth / master's instruction / bad weather not to count. Already expressible: commences from NOR accepted + turn time 24 h from NOR accepted.
- **Non-reversible** laytime per port (MY FELLAS, YUFIX). Despatch basis **WTS** (working time saved).

### OPEN ITEMS — pick up here (in this order unless Adel says otherwise)
1. ~~NOR after 12:00 under the 12:00/14:00 rule~~ — **DONE 2026-09-23** (amended GENCON 6(c), see "What the product does today").
2. ~~Overlapping stoppages in real SOFs~~ — **NOT an open item (corrected 2026-09-23).** PO13 is frozen: the DB forbids overlapping stoppages. `commitExtraction` already respects it — an overlapping SOF row is rejected by `createStoppage`, listed under "skipped" with the reason, and the rest of the SOF commits. The analyst adjusts that row by hand if needed. No product decision required.
3. ~~Despatch calculation~~ — **WTS DONE 2026-09-24**: despatch = laytime balance saved × despatch rate (test_2: allowed 4.3103068 d − used 20 h = 3d 11h 26m saved; golden `golden-test2-despatch.test.ts`). **ATS still refused** (`DESPATCH_ATS_UNDEFINED`) — needs laytime projected past completion through excepted periods; no evidence yet. Missing basis with a rate → refused.
4. **Vision-LLM extraction** for SOF ingestion — today "Import from SOF" always opens the MY FELLAS fixture; there is NO upload yet (Adel hit this 2026-09-24).  (Gemini: free tier trains on data → paid no-training tier for real customer documents). Review screen + commit already exist.
5. **Input timezone** — `datetime-local` inputs still mean browser time, not port time (see Monitored issues).
6. Still withheld: weather counting (B3/WWD), CountsAgainstOwner stoppages, pooled settlement rate (B7), B6/B9 reporting.
7. ~~Settlement rounding~~ — **DONE 2026-09-24 as an ORGANIZATION setting** (Adel chose option 3): Administration → Settlement → Day rounding = `DECIMALS_5` (default, i-Magellan: YUFIX 28,706.04) or `EXACT` (manual sheets: test_2 15,211.76). Stored in `company_configurations.settlement_day_precision` (migration 0019, DB CHECK). Amount always rounded to cents. Applies to statements built/rebuilt after the change.
8. **Partial weekend exception "Fri 17:00 → Mon 08:00 NTC even if used"** (MV YUFIX CP) — not expressible today (excluded weekdays are whole days). Did not affect YUFIX (OODAOD from Wednesday). Needs a bounded "excepted period between weekday+time and weekday+time" option when a real call hits it.
9. **"Time used before commencement of laytime shall count"** (GENCON 6(c) last sentence) — not modelled: today nothing before the commencement instant counts. Needs evidence of how "time used" is recorded (e.g. OPS_COMMENCED before commencement) before building.

### Known assumptions and verification gaps (from the 2026-09-23 self-audit — still open)
- **PWWD treated as running time minus configured exclusions.** "PWWD" (per weather working day) implies weather days do not count; weather counting is still withheld (B3) — a rule set with `weatherApplies` and weather events REFUSES. Confirm the intended PWWD meaning with Adel before relying on it for weather-affected calls.
- **GENCON 6(c) "during office hours":** the engine takes the recorded NOR instant as given — any time after 12:00 (including evening/night) → 08:00 next working day. Whether a notice outside office hours is valid (and deemed given at the next office opening instead) is NOT assessed; office hours are not configured anywhere. Confirm with Adel if a real call hits it.
- **"Next working day"** = next local day that is not an excluded weekday and not a holiday of the rule set's calendar (holidays only count when the rule set excludes holidays). A same-day 14:00 start on an excluded day is left to the calendar stage, which excludes that time anyway.
- **Multi-cargo + rate:** a RATE term sums ALL actual cargo quantities on the port call and divides by ONE rate. Charter parties with different rates per cargo/grade are not modelled.
- ~~No full claim verified end to end through the app~~ — **DONE 2026-09-24 in PRODUCTION**: MY FELLAS loading — SOF import → term (3000 MT/day, 12:00 rule, OODAOD, FSHEX) → laytime end = documents on board → calculation → statement: **Demurrage 13,537.82 / Net claim 13,537.82**, identical to Adel's PDF to the cent (EXACT day rounding). Still to do the same for a discharge and a despatch case.
- **SOF commit mapping** (`lib/actions/commit-extraction.ts`): events map to event types by engine semantic; stoppages map to stoppage reasons by **best-effort name match** (unmatched rows are skipped and reported); local SOF times are converted with the port call's timezone (`instantFromLocal`).

### Product principles (frozen)
- **Bounded semantic model:** Template → bounded typed configuration → immutable RuleSetVersion → deterministic pipeline. **No generic rule engine, DSL, or scripting.** New contract behaviour = a new bounded, typed option, evidenced by a real document.
- **The product is for any customer.** Adel's charter parties are EVIDENCE that discovers capabilities; their values are customer configuration (Category C), never product defaults.
- **Engine = trust foundation; SOF ingestion = differentiator.** Competitors (i-Magellan, Veson) make the analyst hand-key every event.
- **Vision-LLM choice (not wired yet):** Gemini — free tier costs $0 but Google may train on the data (fine only for Adel's own test documents); the paid tier (~$0.14 per 1000 pages) does not train and is required for real customer documents. Extraction output is always a draft; human review is the trust mechanism.

### Cloud Shell troubleshooting (hit before — don't rediscover)
- **Bundle "does not appear to be a git repository"** → wrong path; use `find ~ -name "<bundle>"`.
- **Sign-in fails when running the app inside Cloud Shell** → the exact preview host must be in `serverActions.allowedOrigins` in `next.config.ts` (`*.cloudshell.dev` already added), then restart the dev server.
- **Web Preview opens port 8080** → change the port in the preview URL to 3000.
- **Cloud Shell VM recycles between sessions** → a Postgres container started there is gone (the git repo in home persists). Production does NOT depend on Cloud Shell; it's only the push machine.

### Working agreement with Adel (standing instructions)
- Reply in **Egyptian Arabic**; all code, comments, file names, commit messages in **English**.
- One step at a time; don't stop except for a genuinely blocking question; don't ask technical questions inside Claude's own job — decide and proceed.
- Never invent contract semantics — derive from Adel's documents, otherwise refuse and ask.
- Never claim something works before verifying it in the browser/runtime (Playwright against the dev server), not just typecheck/tests.
- Don't reopen frozen decisions; push back once, then respect his call. No harsh or lecturing tone; own mistakes directly.

### Sandbox notes (for Claude)
- Repo at `/tmp/voyantix`; dev DB `postgresql://voyantix:voyantix@127.0.0.1:5432/voyantix_dev` (`pg_ctlcluster 16 main start`; run `npm run db:migrate` after pulling migrations — tests fail on missing columns otherwise).
- Dev server: `DATABASE_URL=... setsid nohup npx next dev -p 3000 &` (never `pkill -f "next dev"` from the same shell — it kills the shell).
- Playwright: `/home/claude/.npm-global/lib/node_modules/playwright`, Chromium `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Required-field labels contain `*`, so use non-exact `getByLabel`.
- React 19: state set inside `startTransition(async …)` is not committed until the action finishes — do optimistic updates BEFORE `startTransition`.

### Verification ladder (never conflate these)
`implemented` → `typechecked (tsc --noEmit)` → `tested (vitest on PostgreSQL)` → `browser/runtime verified`.

### Monitored / deferred issues
- **Next.js #668 "Router action dispatched before initialization"** — intermittent, not currently reproducing.
- **Org creation must seed protected event types** — `seedProtectedEventTypes(org.id)` inside the creation transaction; today only `scripts/bootstrap.ts` calls it.
- **Input timezone semantics (deferred).** Display uses the port call's `effectiveTimezone`; `datetime-local` INPUT still uses the browser zone. Must be fixed before entered wall-clock times can be trusted for a port in another zone.
- **`tsconfig.tsbuildinfo`** — build cache; keeps appearing modified.

---

## PHASE STRUCTURE OVERVIEW (OFFICIAL — from the approved Implementation Sequence)

| Phase | Name | Status | Blocked by |
|---|---|---|---|
| 1 | Platform — Auth/Tenancy/Authorization | ✅ COMPLETE | — |
| 2 | Master Data + Company Config + admin screens | ✅ COMPLETE | — |
| 3 | Commercial — Contract, Terms, RuleSets, Pools, resolver | ✅ COMPLETE | — |
| 4 | Voyage + PortCall + CargoPlan | ✅ COMPLETE | — |
| 5 | Operational — Event, Stoppage, ShiftPerformance | ✅ COMPLETE | — |
| 6 | Laytime Engine rebuild | ✅ COMPLETE | 🛑 B1–B5, B8 |
| 7 | Calculation + Statement persistence + StatementScopeResult | 🔄 BACKEND COMPLETE (UI → Ph8) | 🛑 B7 |
| 8 | Professional UX | 🔄 MAJOR ITEMS DONE (browser-verified) | — |
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

## Phase 3 — Commercial layer · ✅ COMPLETE · OFFICIAL
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

## Phase 4 — Voyage + PortCall · ✅ COMPLETE · OFFICIAL
**Purpose:** the operational spine — a voyage visiting one or more port calls, each anchored in real local time.
**Entities:** `Voyage` (`voyageReference` unique per org, `vesselName` text required, `vesselId?`, `contractId?`, `status`) — loses `portId`/`arrivalTime`/`norTender`/`norAcceptance`/`sailingTime` (all become port-call facts). `VoyagePortCall` (`voyageId`, `portId`, `facilityId?`, `function` LOAD/DISCHARGE, `sequence`, `status`, **`effectiveTimezone`**, `contractLaytimeTermId?`). `CargoPlan` re-parented to `portCallId`.
**Depends on:** Phase 3 (contract/term to resolve onto a port call), Phase 2 (ports/facilities).
**Includes backfill** of any existing voyages to the PortCall model.
**Must NOT include:** operational events/stoppages (Phase 5); any calculation.
**Exit criteria:** voyage + multi-port-call model persists, effectiveTimezone captured per call, backfill safe, tests green.

## Phase 5 — Operational · ✅ COMPLETE · OFFICIAL
**Purpose:** record what actually happened at each port call.
**Entities:** `OperationalEvent` (point-in-time; `portCallId`, `eventTypeId`, `occurredAt`, `recordedAt`, `recordedByUserId`, `supersededByEventId?`; append-only, corrections supersede). `Stoppage` (time span; overlap + one-open rules). `ShiftPerformance` (throughput; `shiftDate` NOT NULL; **never affects countability**).
**Depends on:** Phase 4 (everything hangs off `portCallId`), Phase 2 (event types, stoppage reasons).
**Must NOT include:** any calculation; ShiftPerformance must never feed countability.
**Exit criteria:** events/stoppages/shifts persist against port calls with their integrity rules, tests green.

## Phase 6 — Laytime Engine rebuild · ✅ BUILT (remaining withheld semantics refuse) · OFFICIAL · 🛑 B3–B5, B8
**Purpose:** the composable calculation engine — a pure function, no DB access, producing a *balance* (not an amount).
**Model:** composable axes, never `switch(termLabel)`. Pipeline: resolve scope → determine commencement (🛑B1) → apply turn time (🛑B2) → candidate window → partition (weekday/holiday/stoppage/weather/allowance/midnight boundaries, LOCAL time) → classify → apply EIU → accumulate per port call → pool (reversible) → saved/exceeded. **Engine stops at the balance; no rates.**
**Depends on:** Phases 3–5 (terms, port calls, events).
**Blocked by (withheld — do NOT invent):** B1 commencement, B2 turn time, B3 WWD weather, B4 holiday precedence, B5 SHEX weekday convention, B8 term applicability tie-break. Each isolated to its pipeline step; engine must REFUSE to calculate rather than assume a default.
**Pre-req risk gate:** validate the composable rule model against 2–3 real charterparties before building this phase.
**Must NOT include:** rates/settlement (Phase 7); persistence beyond the pure function's output contract.

## Phase 7 — Calculation + Statement persistence · ✅ COMPLETE (despatch settlement still refused) · OFFICIAL · 🛑 B7
**Purpose:** run the engine, persist the truth, produce the settlement amount and the statement.
**Status (2026-09-21):** all backend entities, actions and settlement built and tested against real PostgreSQL (422 tests). LaytimeAdjustment is now actually built (the earlier "table exists" note was wrong). Lifecycle invariants are DB-enforced. Only the calculation/statement UI remains — deferred to Phase 8 (Professional UX) per the product owner.
**Entities:** `LaytimeCalculation` (one run + `resolvedRulesJson` snapshot + `engineVersion`) ✅. `LaytimeInterval` (**the single source of calculation truth**) + `LaytimeIntervalStoppageLink` ✅. `LaytimeStatement` (voyage-level lifecycle) ✅. `StatementScopeResult` (per port call ✅; per pool reserved, B7-withheld, never emitted). `LaytimeAdjustment` ✅ built (signed money ledger on a draft; approval workflow still deferred). **No `TimeSheetEntry` table** — the time sheet is a query over `LaytimeInterval`.
**Settlement:** separate layer turns balance → amount (🛑B7 pooled settlement rate selection; non-pooled is fully defined).
**Frozen behaviours:** canonical statement (0 → empty, 1 → canonical, >1 → integrity exception, never pick one); one active draft (0 → create, 1 → update, >1 → log & write nothing); recalculation deletes existing intervals and rewrites inside one transaction; historical reproducibility via the three layers.
**Must NOT include:** reporting (Phase 9).

## Phase 8 — Professional UX · 🔄 IN PROGRESS · OFFICIAL
**Purpose:** raise the interface from functional to commercial-grade (dense dashboard, SOF-style timeline, document-like statement, real loading/error/empty states, multi-column forms with grouping).
**Depends on:** the underlying data/workflows of Phases 3–7 existing.
**Note:** do not build future-phase UI early just because a table exists.
**Done (2026-09-21, all browser-verified via Playwright against a dev server, and a clean production `next build`):** (1) port-call laytime calculation panel (Recalculate → balance/window/settlement/interval time-sheet; refusals as first-class outcomes); (2) voyage statement panel (build/rebuild draft, per-port-call scope rollup, adjustments ledger + net claim, finalize, link to the document); (3) printable statement document at `/admin/voyages/[id]/statement` (per-port-call breakdown + totals + Print/PDF, with @media print dropping the app chrome); (4) SOF-style port-call timeline (events + stoppage commenced/ceased marks on one chronological local-time track with elapsed gaps); (5) portfolio dashboard (KPI band + voyages table with statement status and net claim). **Remaining polish (open-ended):** richer loading skeletons, denser multi-column form grouping, and per-surface error states — none blocking.

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
| F8 | The engine semantics are fixed (now **10**); only they can affect the engine. Custom event types carry no semantic. **Amended 2026-09-24** with evidence (MY FELLAS sheet counts to documents on board; Adel: loads end at lashing completed): added `LASHING_COMPLETED`, `DOCUMENTS_ON_BOARD` as laytime-END events | Architecture / master-data.ts | 2/6 | ✅ |
| F9 | Protected event-type rows: label-only edit; code/semantic immutable; never deactivate/delete; enforced by DB CHECK + action payload | master-data.ts / event-types.ts | 2 | ✅ |
| F10 | Master data with a lifecycle uses active/inactive; no hard delete (exception: line-items like holidays) | Architecture | 2 | ✅ |
| F11 | StoppageReason has NO `defaultCountability`; countability comes only from `ContractStoppageRule` at calc time | Architecture | 2/3 | ✅ |
| F12 | Contract (header) vs ContractLaytimeTerm (commercial values) are separate; a RuleSet holds only reusable semantics | Architecture | 3 | ⏳ |
| F13 | `LaytimeRuleSetVersion` is immutable once referenced; editing creates a new version | Architecture §F | 3 | ⏳ |
| F14 | `ContractLaytimeTerm` is versioned; editing a term on a contract with a finalized statement creates a new term version | Architecture §F | 3/7 | ✅ |
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
| F28 | `VoyagePortCall.effectiveTimezone` resolves `Port.defaultTimezone → "UTC"` only. `CompanyConfiguration.defaultTimezone` is application/display-only and NEVER participates in engine/calculation timezone resolution. This decision resolves a contradiction in the approved Phase 2 FINAL architecture doc, where COMPANY CONFIG (§/table) and Parameter Ownership Matrix explicitly state `CompanyConfiguration.defaultTimezone` is "never used by the engine" / "display only", while Section D's fallback chain (`Port.defaultTimezone → CompanyConfiguration.defaultTimezone → "UTC"`) contradicted that. Resolved in favor of the repeated ownership rule + multi-country PortCall design. Section D's three-step chain is SUPERSEDED by this decision; the historical wording is preserved here, not deleted, for audit purposes | Product Owner (new) | 4 | ✅ |

---

# WITHHELD BUSINESS RULES — B1–B9 (NEVER INVENT)

The identifiers and their target phase are known; their **semantics are deliberately withheld** and must be asked for when the phase is reached. Build the structure that stores the user's choice; never encode the rule's meaning from maritime knowledge, intuition, or prior assumptions. If a needed rule is undefined at runtime, the engine must REFUSE to calculate rather than assume a default.

| # | Rule (identity only) | Belongs to | Data structure that must exist first |
|---|---|---|---|
| B1 | Commencement basis | Phase 6 | ✅ bounded event dropdown + `commencementTimeRule` (AT_EVENT / MORNING_NOR_1400 = amended GENCON 6(c): ≤12:00 → 14:00 same day, after 12:00 → 08:00 next working day) |
| B2 | Turn time trigger/semantics | Phase 6 | ✅ hours + trigger event (bounded); exclusive with the 14:00 rule |
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
| 2026-09 | PO1-PO3: ContractLaytimeTerm nullability; function LOAD/DISCHARGE enum; despatch optional | Product Owner (new) | 3 | frozen | See PRODUCT-OWNER DECISIONS section |
| 2026-09 | PO4-PO5: LaytimePool is Contract-owned; fields set, settlementPolicy vocab withheld (B7) | Product Owner (new) | 3 | frozen | See PRODUCT-OWNER DECISIONS section |
| 2026-09 | PO6: LaytimeRuleSet has NO status/lifecycle field. The generic setStatus template does not apply unless a future explicit decision introduces RuleSet lifecycle semantics. Do not add status by inference | Implementation review (new) | 3 | frozen | RuleSet actions are list/create/update only |
| 2026-09 | PO7: ContractLaytimeTerm term-versioning STRUCTURE and the finalized-statement trigger (F14) are deferred to Phase 7, where statements exist. Architecture defines the RuleSetVersion structure explicitly but NOT a term-version structure; inventing one now is out of scope. Phase 3 does in-place CRUD; the single-row schema does not preclude a later row-level versioning column | Implementation review (new) | 3/7 | frozen | Phase 3 term actions are list/create/update/setStatus in place |
| 2026-09 | Phase 3 BACKEND complete (commit 2d783db): 5 commercial tables + 5 entity action sets + pure applicability resolver, 130 tests green on PostgreSQL. Remaining Phase 3 work is the admin UI | This session | 3 | milestone | Next session: build Phase 3 commercial UI |
| 2026-09 | Phase 3 COMPLETE (commit a5d23f1): full commercial admin UI (rule sets + versions, contracts with terms and pools) browser-verified. Backend + UI done | This session | 3 | milestone | Next: Phase 4 Voyage + PortCall |
| 2026-09-14 | F28: Resolved internal contradiction in Phase 2 FINAL architecture doc between COMPANY CONFIG/Parameter Ownership Matrix ("CompanyConfiguration.defaultTimezone never used by engine") and Section D fallback chain (which included it). Decision: engine timezone resolution is Port.defaultTimezone → UTC only; CompanyConfiguration.defaultTimezone stays display-only | Product Owner (new) | 4 | frozen | Section D fallback chain in the architecture doc is superseded; CompanyConfiguration schema unaffected (field stays, role changes) |

| 2026-09-14 | Discovered CompanyConfiguration + ReferenceSequence were already implemented and migrated (inside platform.ts, migration 0004) before this session's Phase 4 planning began — roadmap CURRENT STATE and migration count had gone stale. A duplicate company-config.ts schema file was drafted based on the stale roadmap but never written to disk (caught via a TypeScript export-collision error before any file existed). Roadmap corrected to reflect actual repo state | This session | 4 | frozen | No code impact — the duplicate was never created. PO8-PO11 (Voyage/VoyagePortCall/ContractLaytimeTermId decisions) remain valid and unaffected |

| 2026-09-14 | Phase 4 COMPLETE (commit 212cd00): Voyage + VoyagePortCall + CargoPlan, schema through browser-verified UI, incl. PO11 resolution and F28 timezone snapshot. Two operational lessons recorded: drizzle-kit orders cross-table ALTERs wrong (a composite-unique ALTER on an existing table lands AFTER the FK that needs it — reorder before applying), and `drizzle-kit migrate` swallows SQL errors entirely, so applying via `psql -f` is how the real error surfaces | This session | 4 | milestone | Next: Phase 5 Operational layer |
| 2026-09-16 | Phase 5 UI browser-verified (Bundle B): shift cargo list scoped to the port call's cargo plans; event correction leaves the original visible, struck through, marked "corrected"; a second open stoppage is rejected with a clear message and no partial write. Closes the last Phase 5 verification gap — Phase 5 is complete backend + UI | This session | 5 | milestone | Phase 5 fully closed |
| 2026-09-16 | Phase 6 risk-gate REFRAMED to the product-positioning model. Reference charterparties are used to DISCOVER and validate generic product capabilities; a customer's contractual values remain customer configuration and are never promoted to global product defaults, hardcoded constants, or customer-specific branches. The old mandatory "analyze 2–3 charterparties before Phase 6" entry gate is SUPERSEDED (the recommendation survives as optional risk mitigation, its historical wording preserved and marked SUPERSEDED). New entry rule: Phase 6 proceeds per-step when the semantics that step needs are sufficiently defined, and pauses only on a genuinely undefined commercial semantic — never on charterparty count. E4 (partial/fractional counting) confirmed as a real capability from a reference calculation and flagged as touching the engine output contract (interval carries a counting fraction, not a flag); representation to be settled before the classification step. No code/schema/migration/UI changed | This session | 6 | frozen | Phase 6 may proceed per-step; reference contracts are evidence, not a gate |
| 2026-09-16 | Fix (commit b4f9578): PostgreSQL exclusion violations (SQLSTATE 23P01) were filtered out by `isMappableCode` before the constraint name was read, so the `stoppages_no_overlap` CONSTRAINT_MAP entry was unreachable and a real write race surfaced a raw DatabaseError instead of CONFLICT. Added 23P01 as a mappable SQLSTATE; verified against a real 23P01; guarded by stoppages test 15b. Single-request path was already correct via the application pre-check | This session | 5/all | fix | Concurrency fallback now returns CONFLICT |
| 2026-09-16 | Fix (commit 8e97587): operational timestamps were formatted with locale/timezone-free `toLocaleString`, causing an SSR/client hydration mismatch (UTC container vs viewer's zone). Introduced shared `lib/format.ts` `formatInstant(date, timeZone)` pinning explicit en-GB 24h locale AND an explicit IANA timeZone (required arg); events/stoppages now pass `c.effectiveTimezone` (F18/F28), so times read in the port's local time. Display only; input semantics deferred (see Monitored/deferred). 8 formatter tests | This session | 8/5 | fix | Hydration resolved; times in port-local time |
| 2026-09-20 | Phase 6 laytime engine built as a PURE module (`lib/laytime/`, blocks 7–14) on the consolidated Q1–Q18 decision baseline: commencement + turn time (event-driven; refuse if the configured event is missing/ambiguous/unrecognised, no silent fallback), classify (calendar+holiday exclusion, ContractStoppageRule countability, weather and CountsAgainstOwner isolated as refusals), EIU as a SEPARATE stage (single `eiuApplies` flag; the "used" determination isolated to the caller), accumulate + balance in canonical seconds (engine STOPS at balance, F16), and pooling (per-call contribution visible; overrun attribution left unresolved). Two product-owner window decisions (2026-09-20): countable START = `turnTimeTrigger` + `turnTimeHours` when turn time is configured, else the `commencementRule` event; countable END = `OPS_COMPLETED`. 108 unit tests, typecheck clean; no DB touched and no existing file modified (only new files added). Evidence-dependent gaps isolated as refusals, not invented: weather counting (Q9), the CountsAgainstOwner balance effect, and the EIU "used" definition (relevant only when eiuApplies=false). | This session | 6 | milestone | Engine ready to wire to an action layer + persistence (Phase 7) |
| 2026-09-20 | Phase 7 core built (calculation service + persistence + settlement). (1) ContractStoppageRule table/actions built as Phase 3 residue (per-(term,reason) countability; AlwaysExcluded/NeverExcluded defined, CountsAgainstOwner still refused by the engine). (2) Calculation service: `lib/laytime/units.ts` (allowance→seconds; only running-day and hour units defined, other units refused as withheld), `lib/laytime/service/compute.ts` (pure DB-agnostic bridge — derives window, closes open stoppages to window end, routes WEATHER_* to the weather channel, builds the EIU used-set from worked local days per F24), and `calculatePortCall` action (read-only, statement.recalculate). A refusal is a first-class result (ok:true, status refused, carrying the engine code), not an error. (3) Persistence (migration 0010): `laytime_calculations` (one per port call; resolvedRulesJson + engineVersion for F20; CHECK enforces the calculated/refused shapes), `laytime_intervals` (F19 single source of truth — no TimeSheetEntry), `laytime_interval_stoppage_links` (traceability by containment). `recalculatePortCall` deletes+rewrites in ONE transaction; `getPortCallCalculation` reads the sheet back. (4) Settlement `lib/laytime/settlement.ts` + `settlePortCall`: non-pooled only — demurrage = exceeded time pro-rated at the per-running-day rate; despatch REFUSED when configured because despatchBasis vocabulary is withheld; pooled (B7) untouched. **Assumption on record (non-pooled "fully defined"):** demurrage/despatch rates are per running day (86400s), pro-rated by seconds — consistent with the running-day allowance unit; flag if a real charterparty uses per-hour. 403 tests green (36→37 files), typecheck clean, all against real PostgreSQL. | This session | 7 | milestone | Remaining Phase 7: LaytimeStatement + StatementScopeResult (voyage-level lifecycle; per-pool scope is B7-withheld), then UI |
| 2026-09-21 | Phase 7 backend COMPLETED (statement layer + adjustments). (5) Statement layer (migration 0011): `laytime_statements` (draft/finalized) with the frozen lifecycle enforced by PostgreSQL itself — partial unique indexes give ONE active draft and ONE canonical finalized per voyage, and a CHECK ties the finalize stamp to the finalized status. `statement_scope_results` roll up each port call's settlement (per-pool reserved but never emitted, B7). Actions: `buildStatementDraft` (0→create / 1→rewrite scopes, one transaction), `finalizeStatement` (2nd finalize → CONFLICT, no draft → INVALID_STATE), `getStatement` (canonical if finalized else draft). (6) `LaytimeAdjustment` (migration 0012) — the earlier "table exists" claim was FALSE on this branch, now actually built: a signed money ledger entry + reason on a DRAFT statement, audited, netted into `netClaim = demurrage − despatch + adjustments` (plain arithmetic, NEVER touches the engine balance, F16); draft-only (finalized is locked); approval workflow still deferred. DB-integrity test suite proves the lifecycle invariants live in Postgres (a 2nd draft, a 2nd finalized, and a mismatched stamp are all rejected on direct insert). 422 tests green (39 files), typecheck clean, real PostgreSQL. Only the calculation/statement UI remains for Phase 7's purpose — deferred to Phase 8 per the product owner. | This session | 7 | milestone | Phase 7 backend done; next is Phase 8 (Professional UX): the calculation panel + statement UI + the dense operational dashboard |
| 2026-09-21 | F14 term versioning CLOSED (migration 0013) — the last open, now-unblocked backend item. `contract_laytime_terms` gains `versionNumber` + self-referencing `supersededByTermId`. `updateContractLaytimeTerm` branches: no finalized-statement dependency → in-place edit; a finalized statement depends on it (finalized statement → voyage port call → calculation.termId) → freeze: in one transaction create a new version with the edits, mark the old row superseded (left intact for the finalized statement's basis), and repoint every live port call to the new version. Superseded rows can't be edited directly (INVALID_STATE) and aren't listed. Mirrors the accepted F13 rule-set model; adds structural F20 protection on top of resolvedRulesJson. Verified a finalized statement's demurrage figure is unchanged after versioning. 425 tests green (40 files), typecheck clean. **Backend is now complete through Phase 7** — remaining work is Phase 8 (UI) and the withheld semantics (B1–B9 + engine-level refusals) that need real charterparty evidence. | This session | 3/7 | milestone | Backend complete; next is Phase 8 UI (browser-verified) when the product owner is ready |
| 2026-09-21 | Phase 8 major UI delivered, each BROWSER-VERIFIED with Playwright against a running dev server (login as admin@demo.test, real clicks, screenshots) and validated by a clean production `next build` (all 20 routes compile). Built: (1) `PortCallCalculation` — Recalculate → persisted balance/window/settlement + expandable interval time-sheet, refusals shown as first-class outcomes; (2) `VoyageStatement` — build/rebuild draft, per-port-call scope rollup, adjustments ledger, net claim, finalize; (3) `StatementDocument` + `/admin/voyages/[id]/statement` — a print-ready demurrage statement (per-call breakdown, totals, Print/Save-PDF; `.no-print` + `@media print` drop the app chrome); (4) `PortCallTimeline` — SOF-style chronological events + stoppage commenced/ceased marks in port-local time with elapsed gaps; (5) portfolio dashboard — KPI band + voyages table with statement status and net claim. Added `formatDurationSeconds` + `formatAmount`. End-to-end sanity: a seeded voyage priced to Demurrage 13,000 (26h over @ 12,000/day), a −3,000 adjustment → Net claim 10,000, finalized and rendered as a document. 425 backend tests still green; typecheck clean; production build clean. **Verification method now proven in-sandbox** (Chromium + Playwright driving `next dev`), so future UI is browser-verifiable here. Remaining Phase 8 is open-ended polish only. | This session | 8 | milestone | Phase 8 major items done; next: optional UX polish, or Phases 9–10 / withheld semantics when charterparty evidence arrives |
| 2026-09-21 | Adopted PRODUCT ARCHITECT + DOMAIN ARCHITECT operating mode; added `PRODUCT_HORIZON.md` (living capability register, four-category classification, Architecture-Now watchlist). First action from it: **AN-1 (E4 fractional counting) representation CLOSED** — the roadmap had required an interval to carry a counting fraction (0..1) settled before classification, but the engine shipped binary (`COUNTED|EXCLUDED`). Introduced `ClassifiedInterval.countedFraction` (authoritative; `treatment` is its coarse view), accumulation sums `elapsed × fraction`, persisted `laytime_intervals.counted_fraction` (migration 0014, backfilled), fraction-aware time-sheet badge. Behaviour identical today (0/1 only); NO trigger/percentage/precedence invented (still Category A, withheld). 428 tests green, typecheck clean, browser-verified Demurrage 13,000 unchanged. | This session | 6/7/8 | milestone | Engine output contract is now partial-counting-ready; AN-2 (cumulative/OODAOD) and AN-3 (currency) remain on the watchlist for their target phases |
| 2026-09-21 | Deployed to Railway (managed Postgres, always-on) from `origin/rebuild`; TLS-aware pool, tsx as runtime dep (`0ead2e4`). Live at voyantix-production.up.railway.app | Session | Deploy | milestone | Production exists; delivery via git bundle → Cloud Shell → push |
| 2026-09-22 | Product strategy: the deterministic engine is the trust foundation; SOF ingestion (vision-LLM + human review) is the differentiator. Ingestion slices 1–2 built (schema, editable review, commit-to-port-call), fixture-driven | Product Owner | 8+ | frozen | `docs/SOF_INGESTION.md` |
| 2026-09-22 | Commencement time-of-day rule MORNING_NOR_1400 in the engine (`87e9619`), from reference docs | Adel's documents | 6 | milestone | Exposed in the UI on 2026-09-23 |
| 2026-09-23 | Rate-based allowance (`1bcadca`, migration 0015): allowed = actual MT ÷ MT/day; refuses without actual quantity | Adel's documents | 6/7 | milestone | Golden: 3052.403/3000 → 87909.2064 s |
| 2026-09-23 | Live provisional status (`3994379`, `81038e8`): reference-only running meter for ACTIVE port calls, planned qty until actual exists, window end = now | Product Owner request | 8 | milestone | Not the settlement; labelled PROVISIONAL |
| 2026-09-23 | AN-2 CLOSED — once on demurrage, always on demurrage + per-stoppage-reason exceptions (`95d6238`, migrations 0016–0017). Stoppage rules UI added (none existed). Fix: term versioning now copies stoppage rules | Adel's documents + PO request | 6/7/8 | milestone | Golden test reproduces MY FELLAS loading exactly |
| 2026-09-23 | Bounded term vocabulary (`8457d9a`, migration 0018): commencement event, commencement time rule, turn-time trigger, allowance unit, despatch basis are dropdowns validated server-side | Self-audit | 3/8 | milestone | Free text the engine would refuse is rejected at save |
| 2026-09-23 | NOR-after-12:00 CLOSED: `MORNING_NOR_1400` now implements amended GENCON 94 cl. 6(c) — ≤12:00 (inclusive) → 14:00 same day; after 12:00 → 08:00 next working day from the rule set's calendar (excluded weekdays + holidays). Kept the stored value (no migration); prior refusals become results, no computed result changes. 470 tests, browser-verified | Clause text supplied by Adel (GENCON 6(c) with 13→14, 06→08) | 6/8 | milestone | Open: office-hours validity, "time used before commencement shall count" |
| 2026-09-24 | Settlement rounding: days rounded to 5 dp, amount to cents — matches i-Magellan (MV YUFIX USD 28,706.04). MV YUFIX golden test: all time figures exact. 477 tests, browser-verified (16 h over @ 10,000/day → 6,666.70) | Adel (MV YUFIX i-Magellan printout) | 7 | milestone | Despatch will use the same rounding |
| 2026-09-24 | Despatch WTS built: saved = laytime balance, × despatch rate; ATS refused. test_2 golden (time exact). Found rounding conflict: test_2 uses exact days (15,211.76) vs i-Magellan 5 dp (YUFIX 28,706.04) — open. 482 tests, browser-verified (32 h saved @ 5,000/day → 6,666.65) | Adel (test_2 sheet) | 7 | milestone | Rounding decision pending |
| 2026-09-24 | Settlement day rounding became an org setting (EXACT \| DECIMALS_5, default DECIMALS_5) — evidence conflicts between i-Magellan (5 dp) and manual sheets (exact). Migration 0019; admin-only action + audit; Administration → Settlement card. 492 tests, browser-verified (EXACT: 32 h @ 5,000 → 6,666.67) | Adel (option 3) | 7/8 | frozen | Both golden tests match their document under their own setting |
| 2026-09-24 | FIX (reported by Adel from production): live status showed "91d over" on a port call still ACTIVE after OPS_COMPLETED — the provisional meter counted to now. It now stops at a single live OPS_COMPLETED ("Completed on demurrage/within laytime", no ticking), matching the settled calculation. Also: time-sheet shows "Excluded weekday — counts (on demurrage)" instead of "Excepted (kept excluded)" beside a Counted badge; rate-based term label shows "3000 MT/day" not "0 days". 495 tests, browser-verified on a replica (3d 09h 39m / 11,909.35) | Adel (production screenshot) | 8 | fix | The same bug was visible in Claude's 2026-09-23 browser check and was missed |
| 2026-09-24 | Laytime END made configurable (supersedes the 2026-09-20 "countable END = OPS_COMPLETED" window decision; amends F8 to 10 semantics). Term default + per-port-call override on the voyage page; SOF mapping; live status + time-sheet agree. Display balance follows the sheet convention. Lesson: the MY FELLAS golden test fed the window end directly, so it passed while the app itself could not end at documents — goldens must now also run through `computePortCall` (added). 510 tests, browser-verified ($13,537.82), production build clean | Adel (MY FELLAS PDF + stated practice) | 6/7/8 | frozen | Migration 0020 |
| 2026-09-24 | FIX (production): with "Documents on board" chosen but not recorded, the live status ran to now again (91d). Now, once operations are completed, a missing laytime-end event is a clear refusal (`LAYTIME_END_EVENT_NOT_RECORDED`) naming the event; while operations are in progress it still runs to now. Refusal messages use readable event names | Adel (production screenshot) | 8 | fix | |
| 2026-09-24 | SOF commit made repeat-safe: an event type already live on the port call is kept (same time: silent; different time: reported, use Correct), identical stoppages are skipped. So re-committing a SOF after new event types became recordable (lashing / documents) adds only what is missing — no duplicate that would make the calculation refuse as ambiguous. Browser-verified on the MY FELLAS replica: re-commit added 2 events, result $13,537.82 | Adel (production: lashing/documents not recorded from the first commit) | 8 | fix | Stoppages from the SOF still need org stoppage reasons to match (none exist in demo) |
| 2026-09-24 | Statement draft staleness: a draft is a snapshot, so after a recalculation it showed the old total (Adel saw 11,909.35 while the calculation said 13,537.83). `getStatement` now returns `outdated` (a port call's calculation id changed, or calcs added/removed, since the build); the card shows an "Out of date — Rebuild draft" banner, refreshes right after any recalculation, and Finalize is disabled; the server also refuses to finalize an outdated draft. SOF commit now `revalidatePath`s the voyage so the Back button shows the new events | Adel (production screenshot) | 7/8 | fix | Changing the org rounding setting does not flag drafts (the settlement card says it applies on rebuild) |
| 2026-09-24 | **MILESTONE — first real claim reproduced end to end in production** (MY FELLAS loading, $13,537.82, Adel's screenshot). Time-sheet rows reworked to two lines (period + status, then the reason) — no more overlapping text; plain counted rows no longer repeat "Counted" | Adel (production) | 8/10 | milestone | Next: a discharge claim and a despatch claim the same way |
| 2026-09-23 | Session context was summarised once; the NOR-after-12:00 clause Adel had given was lost. Roadmap CURRENT STATE rewritten as the handoff so a fresh session starts from the repo, not memory | Session | — | process | Start the next session by reading CURRENT STATE |

---

# ROADMAP MAINTENANCE POLICY

After every meaningful milestone: update CURRENT STATE, update phase status, record new decisions in the Decision Log, record newly discovered dependencies, close resolved open questions, preserve completed history, and confirm the next step still matches this file. Before starting a new phase in any future session: (1) read this file, (2) read the current phase section, (3) verify the actual repo state, (4) execute ONLY the next approved step, (5) return here when the milestone completes. This file answers "where are we, where are we going, why, what is decided, what is not, and what happens next" — so no session needs to ask.

---

# PRODUCT-OWNER DECISIONS — Phase 3 commercial detail

> NEW decisions made by the Product Owner (2026-09), NOT inherited from the
> approved architecture. The architecture named these fields and fixed the
> Contract-vs-Term / RuleSet-vs-Version separation (F12–F14); it did NOT fix
> the nullability of most commercial fields, the function representation, or
> LaytimePool ownership. Those are decided here and are frozen from now on.

## PO1 — ContractLaytimeTerm.function
NOT NULL. Vocabulary fixed to LOAD / DISCHARGE, stored as a DB enum. There is
no `function = NULL` "both" meaning. Generic applicability is expressed only
through nullable scope dimensions (portId, cargoId).

## PO2 — ContractLaytimeTerm field nullability
| Field | Nullable | Storage |
|---|---|---|
| function | NOT NULL | LOAD/DISCHARGE enum |
| portId | NULL | tenant-safe composite FK |
| cargoId | NULL | tenant-safe composite FK |
| allowance | NOT NULL | numeric (no fixed precision) |
| allowanceUnit | NOT NULL | text |
| demurrageRate | NOT NULL | numeric |
| despatchRate | NULL | numeric |
| despatchBasis | NULL | text |
| turnTimeHours | NULL | numeric |
| turnTimeTrigger | NULL | text |
| commencementRule | NOT NULL | text |
| ruleSetVersionId | NOT NULL | tenant-safe composite FK |
| poolId | NULL | tenant-safe composite FK |

Withheld vocabularies (allowanceUnit, despatchBasis, turnTimeTrigger,
commencementRule) are stored as free text now — no enum/CHECK invented. Their
allowed values remain withheld under B1/B2 and are NOT reconstructed.

## PO3 — Despatch optionality
despatchRate and despatchBasis are optional; NULL means despatch is not
configured for that term. No B7 settlement semantics invented.

## PO4 — LaytimePool ownership
CONTRACT-OWNED. A pool belongs to one Contract and may be referenced by
several ContractLaytimeTerm rows of that same contract:
Contract → many LaytimePools → referenced by many terms (term.poolId optional).
Not Organization-global; not Term-owned.

## PO5 — LaytimePool fields
contractId (NOT NULL, tenant-safe composite FK), totalAllowance (NOT NULL,
numeric), allowanceUnit (NOT NULL, text), settlementPolicy (NOT NULL, text).
settlementPolicy vocabulary remains withheld (B7) — not invented.

## PO8 — Voyage.status vocabulary
`voyageStatusEnum`: ACTIVE | COMPLETED | CANCELLED. Default ACTIVE.
Purely administrative:
- ACTIVE = voyage is administratively open/active
- COMPLETED = voyage has been administratively closed as completed
- CANCELLED = voyage has been administratively cancelled
NOT mechanically derived from PortCall state. Exclusion from future
calculations/reports for CANCELLED voyages is NOT frozen by this
decision. No enforced transitions in Phase 4.

## PO9 — VoyagePortCall.status vocabulary
`portCallStatusEnum`: ACTIVE | COMPLETED | CANCELLED. Default ACTIVE.
Purely administrative:
- ACTIVE = PortCall remains administratively open
- COMPLETED = PortCall has been administratively closed as completed
- CANCELLED = PortCall has been administratively cancelled
Never represents NOR, berth, commencement, completion, departure, or
any other operational fact — those remain OperationalEvent semantics
(Phase 5). No enforced transitions in Phase 4.

## PO10 — VoyagePortCall.sequence semantics
Integer, NOT NULL, starts at 1. Unique per voyage via DB constraint
`unique(voyageId, sequence)`. Gaps allowed. Reordering via an explicit
action that renumbers affected rows in one transaction; insertion
between existing calls may shift later sequence values. Represents
intended visiting order only — never a timestamp.

## PO11 — ContractLaytimeTermId resolution timing (AMENDED)
Amended during Phase 4 review: the architecture allows multiple
CargoPlan rows per PortCall (1─* CargoPlan) while the current PortCall
model stores a single ContractLaytimeTermId column — the original memo
did not define behavior for this case.

NOT auto-resolved at PortCall creation. Resolved only via an explicit
`resolveContractLaytimeTerm` action; manually set only via a separate
`overrideContractLaytimeTerm` action. Same column for both outcomes,
distinguished in the audit log (action: "resolve" | "override"). NO
automatic re-resolution when contract/port/function/cargo later
change — always explicit, protecting historical reproducibility (F20)
and commercial intent.

Contract scope: resolution runs ONLY against ContractLaytimeTerms
belonging to Voyage.contractId's Contract — never org-wide terms. If
Voyage.contractId is null → explicit failure CONTRACT_REQUIRED, no
guessing.

Cargo context (from the PortCall's CargoPlan rows):
- 0 CargoPlans → INSUFFICIENT_CARGO_CONTEXT (not "zero matching
  terms"); contractLaytimeTermId unchanged
- Exactly 1 CargoPlan → its cargoId feeds the pure resolver normally
- >1 CargoPlans → MULTIPLE_CARGO_CONTEXTS; no automatic choice of
  cargo (no first/primary/latest), no silent aggregation;
  contractLaytimeTermId unchanged. Intentional Phase 4 limitation
  protecting commercial correctness — no new entity introduced, no
  change to the single-term-per-PortCall model in this phase.

Implementation must distinguish these 7 states explicitly (not
collapsed into one generic null/error): not yet resolved · insufficient
cargo context · multiple cargo contexts · zero matching terms ·
ambiguous matching terms · successfully resolved · manually overridden.
Exact UI deferred; server/action semantics must be explicit now.

Open risk carried forward: the underlying single-column-per-PortCall
model still cannot represent genuinely different terms for different
cargoes on the same call — MULTIPLE_CARGO_CONTEXTS is the deliberate
Phase 4 guard against silently picking wrong, not a solution.

## PO13 — Stoppage temporal integrity
- A closed Stoppage must have endTime > startTime.
- Zero-duration and negative-duration Stoppages are invalid.
- Open Stoppages remain allowed via endTime IS NULL.
- Historical half-open interval semantics [start,end) remain unchanged.
- Adjacent positive-duration intervals remain allowed.
- Database EXCLUDE enforcement remains authoritative for overlap.
- btree_gist is required for the PostgreSQL EXCLUDE implementation.
- Application pre-validation remains for friendly errors.
- This strict positive-duration rule is a NEW Phase 5 integrity decision.
  It is not claimed as historical behaviour; historical verification only
  established that endTime < startTime was rejected. PostgreSQL treats
  tstzrange(x, x, '[)') as EMPTY, and an empty range overlaps nothing, so
  a zero-length row would have evaded the EXCLUDE constraint entirely.

**Implementation note (not a separate decision):** the Stoppage overlap
invariant `stoppages_no_overlap` is deliberately migration-managed rather
than declared in `db/schema/operational.ts`, because drizzle-orm 0.45.2
exposes no first-class EXCLUDE builder. drizzle-kit does not see the
constraint at all, so it neither drops nor recreates it; the schema file
carries a comment pointing at migration 0008.

---

# PHASE 6 RISK GATE — METHODOLOGY AND STATUS

> **SUPERSEDED FRAMING (preserved for traceability).** The approved
> architecture originally *recommended* validating the composable rule model
> against 2–3 real charterparties before the engine is built, and an earlier
> version of this section treated that as a MANDATORY Phase 6 entry gate
> ("OPEN until 2–3 contracts examined"). That mandatory-count interpretation
> is now **SUPERSEDED** by the product-positioning methodology below.
>
> **CURRENT FRAMING.** VOYANTIX is a generic, multi-tenant commercial
> product. Reference charterparties are used to DISCOVER and validate
> product capabilities; a customer's contractual values remain customer
> configuration and are never promoted to global product rules without
> separate product justification. Analyzing further charterparties stays a
> RECOMMENDED risk-mitigation activity where semantic variation or risk
> justifies it — it is NOT a mandatory prerequisite for starting Phase 6.
> Phase 6 proceeds when the capability and commercial semantics required for
> the step being implemented are sufficiently defined, and PAUSES only if a
> step reaches a genuinely undefined commercial semantic (see Gate verdict).

## Product positioning — the distinction everything else rests on

**VOYANTIX PRODUCT CAPABILITY ≠ CUSTOMER CONTRACT CONFIGURATION ≠ ENGINE IMPLEMENTATION**

EZDK is a reference customer and a source of real domain evidence. It is
not the definition of the product. A rule observed in one customer's
charterparty proves the product needs a *capability*; it never makes that
customer's *value* a product constant or a default.

The engine consumes configuration. It must never branch on customer
identity — no `if organization == X`, no `switch(contractLabel)`.

## Five-stage classification

Every discovered requirement sits in exactly one stage:

| Stage | Meaning | How it is reached |
|---|---|---|
| 1. IDENTIFIED CAPABILITY | A real customer needs it | Observing one genuine need |
| 2. PROVEN MINIMUM SEMANTICS | The smallest generic model that covers the need without hardcoding a customer's value | Sufficient real evidence and reasoning — not a fixed contract count |
| 3. FROZEN PRODUCT MODEL | Final schema and axes | Stage 2 plus an explicit decision |
| 4. CUSTOMER CONFIGURATION | The value one customer selected | Data, never code |
| 5. ENGINE IMPLEMENTATION | Code executing the configuration | Reads data, never branches on identity |

Observing a need at one customer reaches stage 1 only. Stages 2 and 3 are
never reached automatically.

## Capabilities identified so far — all at stage 1

| | Capability |
|---|---|
| E1 | Tiered loading rate driven by an operational variable, with floor and ceiling |
| E2 | Recurring intra-week exclusion window with time boundaries |
| E3 | Holiday exclusion extended before and after the holiday itself |
| E4 | Partial-counting period — an interval counted at a fraction rather than in full |

None has proven minimum semantics: the evidence comes from a single
contract. No schema is proposed or frozen for any of them.

**E2 note:** `LaytimeRuleSetVersion.excludedWeekdays[]` is approved
architecture and is NOT replaced. Whether E2 is an additional composable
axis alongside it or an extension of it is an open question that further
contract evidence must settle.

**E4 note:** a real reference calculation now demonstrates the fractional
shape concretely — an interval whose contribution is only a FRACTION of its
elapsed duration, not the full amount and not zero. This touches the
engine's own output contract: the pipeline as described classifies each
interval as counting/not, but a fractional result means each interval must
carry a counting FRACTION (0..1), not a binary flag. The representation must
be settled BEFORE the engine's classification step is written, not during.
The capability is confirmed; the exact schema representation and any values
remain customer configuration and are NOT frozen from one reference example.

## B-rule status

For B1–B5 the correct statement is: **product capability identified; final
semantics and supported values remain subject to real charterparty
validation.** They do not leave the withheld list — what was learned is the
*shape of the axis*, not a universal value. Any customer still has to
configure their own values, and the engine refuses to calculate without
them.

**B8 — resolver STRUCTURE is frozen (F15); only the tie-break POLICY is
withheld.** The applicability resolver's behaviour is authoritative and
unchanged: exact function match; nullable port/cargo act as wildcard;
specificity based only on port/cargo; strict specificity only; exactly one
match → select; exactly one strict dominator → select; otherwise
TermAmbiguityException; zero matches → null. What remains withheld is only
the tie-break policy for a genuine ambiguity — resolved when the engine step
that needs it is implemented. Do not invent additional tie-break semantics.

## Default policy

Where no justified universal default exists, the system requires explicit
customer configuration rather than silently assuming a value. The engine
refuses to guess a missing commercial semantic.

## Capabilities identified but not yet implemented

The approved architecture already IDENTIFIES these capabilities — they are
not missing from the product model, and they are NOT "waiting for another
charterparty". Each is an implementation/semantic gap: the capability
exists in the model, its exact engine semantics may not yet be fully
defined, and the engine code is not yet written.

- discharge operations (LOAD/DISCHARGE PortCall already modelled)
- multi-port voyages (multiple PortCalls per Voyage already modelled)
- pooling / reversible laytime (LaytimePool / reversible structure already modelled)
- term applicability ambiguity (B8 — resolver STRUCTURE frozen; only the tie-break policy is withheld)

When the engine step for any of these is implemented and it reaches a
genuinely undefined commercial semantic, THAT step pauses until the
semantic is resolved (per the Gate verdict) — the pause is triggered by an
undefined semantic, never by the mere absence of another charterparty.

## Gate verdict

**PASS WITH ISOLATED EXTENSION.** The entity separation (Contract / Term /
RuleSet / Version), the applicability resolver, and the port-call anchoring
all survived a real non-standard reference contract without structural
change. Every gap found was additive, not structural.

**Entry rule (replaces the old 2–3-contract condition).** Phase 6 may
proceed when the specific capability and commercial semantics required for
the engine STEP being implemented are sufficiently defined. Phase 6 MUST
pause when a step reaches: an undefined commercial semantic, an unsupported
contractual behaviour, a genuine product-capability gap, or an ambiguity
that would force the engine to guess. Phase 6 must NOT pause merely because
only one customer has provided evidence, or because another charterparty
has not been analyzed, or because a hypothetical customer might someday need
something else — and must NOT proceed by hardcoding a customer's behaviour
just because it is the only known example.
