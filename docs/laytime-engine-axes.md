# Laytime Engine — Composable Axes (Design Reference)

> **Status:** design reference for Phase 6. Not a schema, not code, not a
> customer configuration. This document describes the *generic product
> capabilities* a commercial laytime engine must expose, how each is stored
> as customer configuration, and how the engine consumes it. It contains no
> customer contract values — every example value below is a standard maritime
> convention, not any customer's selection.

---

## How to read this document

Laytime is not a fixed sequence of steps. It is a set of **independent,
composable axes** that intersect over the time between a port call's
commencement and its completion. The same stretch of time is judged by
several axes at once (is it a weekend? was it worked? is the vessel already
on demurrage? is the weather workable?), and the result for each interval is
not a yes/no but a **classification plus a counting fraction plus a reason**.

The engine is therefore modelled as:

> a pure function that takes (time boundaries, operational events, weather,
> occupancy) plus a set of composable rules, and produces a **classified
> time-sheet** — a sequence of intervals, each carrying a classification, a
> counting fraction (0..1), an exclusion basis, a usage policy, and a reason.
> It accumulates the counted time into a **balance** per scope, pools where
> reversible, and stops at the balance. It never produces an amount — rates
> and settlement are Phase 7.

Two hard rules govern everything below:

1. **Capability, not value.** Each axis is a product capability. Its *values*
   (a turn-time duration, which weekdays are excluded, a loading rate, a
   pro-rata percentage) are always customer configuration — never a global
   default, a hardcoded constant, or a customer-specific branch. The engine
   reads configuration and refuses to
   calculate when a required semantic is undefined.
2. **Composition, not sequence.** Axes are not a fixed pipeline order. They
   compose. `once-on-demurrage`, `interruption vs exception`, and
   `pro-rata` are axes that reshape how other axes apply — not steps bolted
   onto the end.

### The interval — the engine's unit of output

Every interval the engine emits carries, structurally (no customer values):

| Field | Meaning |
|---|---|
| `start`, `end` | absolute instants bounding the interval |
| `classification` | what kind of period this is (working / turn-time / weekend / holiday / weather-stoppage / operational-stoppage / on-demurrage / ...) |
| `exclusionBasis` | the rule basis in force for this interval (SHINC / SHEX / WWD / custom window / none) |
| `usagePolicy` | how activity affects the exclusion — UU (unless used) / EIU (even if used) / WWD-conditional / n/a |
| `wasUsed` | whether real work occurred in the interval (relevant only when usagePolicy = UU) |
| `countingFraction` | 0..1 — the interval's share of counted time after basis + usage + pro-rata are applied |
| `reason` | reference to the specific rule / stoppage reason / event that produced this classification (an id, never free text) |
| `countedDuration` | derived: `(end − start) × countingFraction` |

`countingFraction = 0` means the interval does not count but stays visible
with its reason (this is what makes the time-sheet explain itself).
`= 1` is full counting. `0 < f < 1` is pro-rata (E4). The old binary
counts/doesn't-count is just the special case {0, 1}.

---

## Layer 1 — Commencement (when the clock starts)

Commencement is not a point; it is a chain of conditional decisions. Each
link is an independent axis.

### 1.1 — NOR tender & validity

**Capability.** The product must let a customer define when a Notice of
Readiness is *valid*: the recipients it must reach, the tendering method
(in writing / by which channel), the time window it may be tendered in
(e.g. office hours only, certain weekdays only), and the physical-readiness
preconditions (holds clean / inspection passed / vessel ready in all
respects).

**Storage (customer configuration).** Term-level conditions on NOR validity.
The physical-readiness preconditions are operational facts recorded as
events (Phase 5); the acceptance window and recipient rules are commercial
values on the term.

**Engine consumption.** The engine finds the NOR-tendered event, tests it
against the validity conditions, and determines the effective NOR against
which acceptance and turn time are measured. An invalid NOR does not start
the chain.

**WIPON / WIBON / WIFPON / WCCON.** Whether-in-port / in-berth / in-free-
pratique / customs-cleared-or-not. These decide whether a NOR tendered
before the vessel is physically at berth is valid. This is a configurable
axis — a customer selects which conditions may be waived at tender time.

**Interactions.** Feeds 1.2 (acceptance) and 1.3 (turn time). Related to
B1 (commencement basis) — capability identified; values withheld.

### 1.2 — NOR acceptance

**Capability.** The gap between tender and acceptance is itself meaningful:
some contracts deem acceptance automatic after a period, some require an
explicit acceptance event, some back-date acceptance to tender. The product
must represent the acceptance rule, not assume immediate acceptance.

**Storage.** Commercial rule on the term; the acceptance event (if explicit)
is a Phase 5 operational event.

**Engine consumption.** Resolves the effective acceptance instant, from which
turn time and commencement are measured.

**Interactions.** B1. Never assume "NOR accepted = NOR tendered".

### 1.3 — Turn time

**Capability.** A grace period after acceptance before laytime commences.
The product must expose: its **duration**, its **trigger** (from acceptance /
from tender / from berthing), and its **usage policy** (UU / EIU) — turn time
is frequently EIU (consumed even if the vessel works during it), but this is
a customer value, not a default.

**Storage.** `turnTimeHours` and `turnTimeTrigger` already exist on
ContractLaytimeTerm (Phase 3) as free values. The usage policy of turn time
is a gap to confirm (see Layer 2.2 — UU/EIU is a shared axis).

**Engine consumption.** Emits a turn-time interval with the configured
duration; its `countingFraction` is 0 (does not count) but it remains
visible; whether activity during it changes anything depends on its usage
policy.

**Interactions.** B2 (turn time). Composes with Layer 2's usage-policy axis.

---

## Layer 2 — Partition & classification (how time is judged)

Between commencement and completion, time is cut at every boundary and each
piece is classified. The boundaries and the classification axes are
independent and compose.

### 2.0 — Partitioning (mechanical, no customer values)

The engine cuts the candidate window at every relevant boundary: midnight
(local time), start/end of each excluded-weekday window, start/end of each
holiday window, start/end of each stoppage, start/end of each weather period,
and turn-time edges. This step is pure mechanics — it produces raw intervals
with no judgement yet. **All boundaries are computed in the port call's LOCAL
time** (F18), against `PortCall.effectiveTimezone`.

### 2.1 — Exclusion basis

**Capability.** The rule basis in force. Standard conventions the product
must represent as configuration:

- **SHINC** — Sundays & Holidays Included (they count)
- **SHEX** — Sundays & Holidays Excluded (they don't)
- **WWD** — Weather Working Day (counts only insofar as weather permitted work)
- **WWDSHEX / WWDSHINC** — combinations
- **custom recurring window** — an intra-week exclusion with explicit time
  boundaries (E2), and holiday windows that extend before/after the holiday
  itself (E3)

**Storage.** `LaytimeRuleSetVersion.excludedWeekdays[]`, `excludeHolidays`,
`weatherApplies`, `workingDayStart/End`, `holidayCalendarId` (Phase 3). The
custom-window and holiday-extension capabilities (E2/E3) are identified but
not yet frozen — a gap.

**Engine consumption.** Determines which intervals are candidates for
exclusion, and under which basis.

**Interactions.** B3 (weather), B4 (holiday precedence), B5 (SHEX weekday
convention), E2, E3. The *values* (which weekdays, which offsets) are
customer configuration.

### 2.2 — Usage policy (UU / EIU / WWD-conditional) — per rule

**Capability — this is a first-class axis, independent per exclusion.** An
excluded period behaves in one of several ways when work actually happens
in it:

- **UU (Unless Used)** — excluded by default, but **counts if worked**.
  Activity converts it to counting.
- **EIU (Even If Used)** — excluded **always**, activity is irrelevant.
- **WWD-conditional** — counts only to the extent weather permitted work,
  independent of whether work was attempted.

Crucially, **this policy is set per exclusion rule**, not once per term. A
contract can make weekends EIU, holidays UU, and weather WWD-conditional
simultaneously. The product must store a usage policy on each exclusion
rule, and the engine must apply each independently.

**Storage.** This is a **capability gap**: today the schema stores *which*
periods are excluded, but not a per-rule UU/EIU/WWD-conditional policy in a
uniform way. Needs product definition before the classify step is built.

**Engine consumption.** For each excluded interval, the engine reads its
usage policy and the interval's `wasUsed` (derived from operational events /
occupancy — never from ShiftPerformance, per F24). UU + used → counts;
UU + not used → 0; EIU → 0 regardless; WWD-conditional → fraction from
weather.

**Interactions.** Composes with 2.1 (basis) and 2.3 (fraction). Overridden by
Layer 3 (once-on-demurrage). This is the axis I previously collapsed
incorrectly — it must be modelled from the start, not added later.

### 2.3 — Counting fraction (full / zero / pro-rata)

**Capability.** An interval's contribution can be the full elapsed time,
zero, or a **fraction** of it. Pro-rata is not rare: it appears in WWD
(weather permitted only part of the period), berth/anchorage sharing, and
explicit contractual pro-rata clauses (E4).

**Storage.** Capability gap — the schema has no fractional representation
yet. Pro-rata may be driven by a rule (WWD) or asserted per interval
(from the SOF). Needs product definition.

**Engine consumption.** Produces `countingFraction ∈ [0,1]`. This is the E4
axis that touches the engine's **output contract** — settled before the
classify step is written.

**Interactions.** E4. Composes with usage policy (a UU interval that is
worked may still be pro-rated by weather).

### 2.4 — Interruption vs exception

**Capability — a structural distinction the engine must honour.**

- An **exception** excludes a *specific bounded period* (this weekend, this
  holiday). Time outside it is unaffected.
- An **interruption** *stops the clock for everyone* while a condition holds
  (e.g. a general stoppage), regardless of the weekday/holiday classification
  underneath it.

These are not the same and cannot be modelled as one. An interruption
suppresses counting across whatever it overlaps; an exception only removes
its own window.

**Storage.** Stoppages exist (Phase 5); whether a given stoppage acts as an
interruption or an exception, and its countability, comes from
`ContractStoppageRule` (F11 — countability lives on the rule, not the reason).
The interruption-vs-exception distinction as an explicit axis is a gap to
confirm.

**Engine consumption.** Interruptions are applied over the partitioned
intervals as an overriding layer; exceptions are per-window classifications.

**Interactions.** Composes with everything; interacts with Layer 3
(on demurrage, some interruptions stop applying).

---

## Layer 3 — State transitions during counting

Some rules do not classify an interval — they change how *all subsequent*
classification behaves. These are axes that reshape other axes mid-calculation.

### 3.1 — Once on demurrage, always on demurrage

**Capability.** Once accumulated counted time exceeds the allowed laytime,
the vessel is *on demurrage*, and from that instant the exceptions typically
**fall away** — weekends, holidays, and often weather begin to count. This is
a state transition in the middle of the calculation, not a per-interval flag.

**Storage.** Whether this doctrine applies (and any carve-outs, e.g. "except
strikes") is a term-level commercial choice. Capability gap to define.

**Engine consumption.** The engine tracks cumulative counted time as it walks
intervals in order; when it crosses the allowance, it switches the active
rule set for the remainder (exceptions suppressed per the configured
carve-outs). This means the engine cannot classify each interval in
isolation — it is **stateful across the ordered walk**.

**Interactions.** Overrides Layer 2 (basis + usage policy) from the crossover
point. This is why the engine walks intervals in order, not as an unordered set.

### 3.2 — Reversible vs non-reversible laytime

**Capability.** Time saved at one port call may be transferable to another
(reversible), or not (each port call settles independently). Reversibility is
a pool-level property.

**Storage.** `LaytimePool` + `settlementPolicy` (Phase 3, contract-owned per
PO4). The reversibility semantics themselves are partly B6/B7 territory.

**Engine consumption.** The engine produces a balance per scope; the pool
layer then nets balances across the pooled port calls before saved/exceeded
is determined.

**Interactions.** B6 (reversible attribution — reporting), B7 (pooled
settlement rate — Phase 7). Engine stops at the netted balance; rate is
Phase 7.

---

## Layer 4 — Result (balance, not amount)

### 4.1 — Allowance

**Capability.** Allowed laytime is derived, commonly `quantity ÷ rate`, where
the rate may itself be tiered by an operational variable with floor/ceiling
(E1 — e.g. loading rate by number of holds). The product must represent a
configurable allowance basis, including tiered rates.

**Storage.** `allowance`, `allowanceUnit` on the term (Phase 3). Tiered-rate
capability (E1) identified, not frozen.

**Engine consumption.** Computes allowed time per scope; used only to compare
against counted time (and to detect the on-demurrage crossover, 3.1).

### 4.2 — Balance per scope, then pool

**Capability.** For each scope (port call, and pool), balance =
allowed − counted. Positive → time saved (despatch side); negative → time
exceeded (demurrage side).

**Engine consumption.** Accumulates per port call, then nets across the pool
where reversible (3.2). **Stops here — at the balance.** No rates, no amount.

### 4.3 — Despatch / demurrage basis (Phase 7 boundary, noted here for completeness)

**Capability.** Settlement converts the balance to an amount. Two despatch
bases exist and differ materially: **all time saved** vs **working time
saved**. Demurrage is usually a single daily rate; despatch is often half
demurrage. This is **Phase 7**, but the engine's balance output must carry
enough structure (counted vs elapsed, per interval) for either basis to be
computed later.

**Storage / engine.** Out of Phase 6 scope. Listed so the interval output
contract (Layer 0) is designed rich enough to serve it — which the
classification + fraction + elapsed model does.

---

## Layer 5 — Capability-gap summary

Each axis mapped to: whether the Phase 3 commercial model already stores it,
whether it is a genuine capability gap, and which withheld rule it relates to.
"Gap" means the product needs a capability it does not yet represent uniformly
— to be defined by product decision, never invented from one customer.

| Axis | Phase 3 storage | Status | Related |
|---|---|---|---|
| NOR validity (recipients, window, readiness, WIPON/WIBON) | partial (term + events) | capability gap on the validity-condition model | B1 |
| NOR acceptance rule | partial | gap — acceptance semantics | B1 |
| Turn time (duration, trigger) | `turnTimeHours`, `turnTimeTrigger` | stored as free values | B2 |
| Turn time usage policy (UU/EIU) | — | gap (shared with 2.2) | B2 |
| Exclusion basis (SHINC/SHEX/WWD/...) | `excludedWeekdays[]`, `excludeHolidays`, `weatherApplies`, `workingDayStart/End`, `holidayCalendarId` | mostly stored | B3, B4, B5 |
| Custom recurring window / holiday extension | — | gap | E2, E3 |
| **Usage policy per rule (UU/EIU/WWD-conditional)** | — | **gap — first-class axis** | B3, B5 |
| **Counting fraction (pro-rata)** | — | **gap — touches output contract** | E4 |
| Interruption vs exception | stoppages + `ContractStoppageRule` (F11) | distinction is a gap to confirm | — |
| Once on demurrage | — | gap — stateful transition | — |
| Reversibility / pooling | `LaytimePool` + `settlementPolicy` | stored | B6, B7 |
| Tiered allowance rate | `allowance`, `allowanceUnit` | flat stored; tiering is a gap | E1 |
| Balance per scope + pool netting | derivable | engine logic (Phase 6) | — |
| Despatch basis (all/working time saved) | — | Phase 7 | B7 |

### The genuine capability gaps, gathered

The engine cannot be written correctly until these are given a product-level
representation (schema/capability, not values):

1. **Usage policy per exclusion rule** (UU / EIU / WWD-conditional), set
   independently per rule — Layer 2.2.
2. **Counting fraction / pro-rata** on the interval — Layer 2.3 / E4 —
   because it changes the engine's output contract.
3. **Once-on-demurrage** as a stateful mid-walk transition — Layer 3.1.
4. **Interruption vs exception** as an explicit distinction — Layer 2.4.
5. **NOR validity + acceptance model** — Layer 1.1 / 1.2 — the conditions and
   the acceptance semantics.

The remaining axes are either already stored (basis, turn-time values,
pooling, allowance) or are Phase 7/9 (despatch basis, reversible attribution).

---

## First implementation decision

Before any engine code:

1. **Fix the interval output contract** (Layer 0): classification +
   `exclusionBasis` + `usagePolicy` + `wasUsed` + `countingFraction` +
   `reason` + derived `countedDuration`. Everything downstream (time-sheet,
   balance, pooling, both despatch bases) depends on this shape. E4 forces
   `countingFraction` to be real, not a flag.

2. Then define the five capability gaps above as configuration (product
   decisions), each with the engine refusing to calculate when its semantic
   is undefined.

3. Only then build the engine as a stateful, ordered walk over partitioned
   intervals, applying composable axes — never `switch(termLabel)`, never a
   branch on customer identity.

The engine stops at the balance. Rates and settlement are Phase 7.

---

*This document is a design reference. It freezes nothing. Every capability
here becomes real only through an explicit product decision; every value
remains customer configuration.*
