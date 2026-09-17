# Laytime Semantic Model (Frozen Conceptual Reference)

> **Status:** the stable conceptual reference for Phase 6 engine
> implementation. This is a domain design document, not a rules-engine
> specification. It contains no code, no schema, and no customer contract
> values. It supersedes the exploratory discussion captured in
> `laytime-engine-axes.md`, which remains on record as the reasoning trail.
>
> **The one sentence this document exists to make permanent:** VOYANTIX is
> configurable through a deliberately bounded maritime semantic vocabulary,
> **not** through customer-programmable rules.

---

## The authoritative model

```
Human-friendly Templates / Presets
        ↓
Bounded Typed Semantic Configuration
        ↓
Immutable LaytimeRuleSetVersion
        ↓
Deterministic Laytime Pipeline
```

What this model explicitly is NOT:

- **No** generic `CanonicalRule[]`.
- **No** generic Rule object.
- **No** generic rule-composition engine.
- **No** DSL, expression tree, interpreter, or customer-authored rule language.
- **No** numeric rule priority, hidden tie-break, or arbitrary ordering.

The `LaytimeRuleSetVersion` **is itself** the bounded semantic container.
There is no layer of rule objects between it and the engine. The engine
reads a small, fixed set of semantic axes and applies them deterministically.

### Why the reasoning arrived here

Three conceptual passes each tested whether more machinery was justified.
Each time, the existing Phase 2 architecture already had the answer, and the
correct move was to **describe the existing axes precisely, not generalise
them into a rule framework**. Every abstraction that was proposed and then
rejected — `CanonicalRule[]`, per-rule usage policy, a provenance graph —
turned out to be machinery invented ahead of any evidence that demanded it.
This document is the smallest model that remains correct for real
charterparty calculations and can evolve safely when real evidence requires
expansion.

---

## Four layers that must never be confused

Every statement in this document is pinned to exactly one of these. The most
common error is calling a whole semantic axis "frozen" merely because its
field exists — that conflates STRUCTURE with SEMANTICS.

| Layer | Meaning | Example |
|---|---|---|
| **STRUCTURE** | the axis/field exists in the architecture | `excludedWeekdays` exists |
| **BUSINESS SEMANTICS** | the commercial meaning, proven by evidence | how holiday precedence resolves |
| **CONFIGURATION VALUE** | the value one customer selected — data | which weekdays a given contract excludes |
| **UNRESOLVED SEMANTICS** | meaning not yet established; needs charterparty evidence | weather authority, EIU partial-work edge cases |

A field existing (STRUCTURE) never implies its business meaning is frozen
(SEMANTICS), and never makes one customer's value (CONFIGURATION) a universal
product rule.

---

## The bounded semantic axes (on LaytimeRuleSetVersion)

These are the reusable laytime semantics. Each is an **independent semantic
decision the engine needs to know** — not a rule object, not something with
scope/effect/precedence.

### Weekly exclusion semantics
- **Structure:** established (the axis for a configured set of excluded weekdays exists).
- **Configuration value:** the actual set of excluded weekdays is customer/contract data.
- **Unresolved:** the SHEX weekday convention's exact treatment where it interacts with other axes.

### Holiday semantics + holiday calendar selection
- **Structure:** established (holiday exclusion + calendar reference exist).
- **Source data:** the holidays themselves live in the selected calendar.
- **Unresolved:** holiday precedence (calendar vs contract list) and any before/after extension of a holiday — evidence-dependent.

### Working-day semantics
- **Structure:** established (a working-day window definition exists).
- **Configuration value:** the actual window bounds are customer data.

### Weather applicability
- **Structure:** established (a weather-applicability axis exists), orthogonal to weekly/holiday exclusion.
- **Source data:** weather-related operational periods are structured operational data.
- **Unresolved:** the authoritative weather source, provider integration, partial-hour pro-rating, and final contractual weather treatment — evidence-dependent.

### EIU applicability
- **Structure:** established (an EIU-applicability axis exists).
- **Behaviour:** EIU is both a RuleSetVersion semantic AND a distinct engine stage (see EIU section).
- **Unresolved:** EIU edge cases, notably partial work inside an otherwise-excluded window — evidence-dependent.

**Composition of the axes is not itself an axis.** Commercial shorthands are
combinations of configured axis values (see Term labels), never rule objects.

---

## Ownership — preserved exactly

The model changes none of the existing ownership boundaries. Placing any of
these on a generic Rule abstraction is explicitly rejected.

**ContractLaytimeTerm owns** (contract-specific commercial values):
allowance, allowance unit, demurrage/despatch rates, despatch basis,
**turn-time duration**, **turn-time trigger**, **commencement rule**,
pool membership, and other negotiated values.

**LaytimeRuleSetVersion owns** (reusable semantics): the bounded semantic
axes above.

**ContractStoppageRule owns** (contract-specific): stoppage countability by
reason (F11 — countability lives on the rule, not on the StoppageReason).

**Operational data** (OperationalEvent, Stoppage, Holiday, PortCall) remains
separate source data, never semantics.

### Turn time and commencement are NOT rule primitives

This is deliberate and load-bearing. Turn time and commencement are
**commercial values owned by ContractLaytimeTerm**, negotiated per fixture.
The engine **consumes** them as **distinct pipeline stages** (determine
commencement; apply turn time) — it does not treat them as classification
rules. Modelling them as RuleSet primitives would break the ownership the
architecture set on purpose and merge separate pipeline stages. Their exact
semantics (commencement basis, turn-time trigger/consumption) remain
evidence-dependent, but their ownership and pipeline placement are settled.

---

## EIU — a semantic AND a separate stage

```
RuleSetVersion.eiuApplies
        ↓
CLASSIFY
        ↓
APPLY EIU
```

EIU is deliberately kept as its own pipeline stage. It is **not** a per-rule
`usagePolicy` — that abstraction was proposed and rejected, because the known
commercial shorthands apply EIU at the RuleSetVersion level, not per
exclusion, and no evidence yet requires per-rule EIU semantics.

- **CLASSIFY** determines the interval's initial contractual/operational
  classification and the excluded/counted state that follows from the axes.
- **APPLY EIU** then evaluates whether EIU applicability changes the
  effective treatment of an otherwise-excluded interval.

What must survive EIU: the original classification and the fact that EIU was
evaluated. The engine must always be able to distinguish:

- **excluded, nothing worked** — excluded, `eiuApplied` not triggering a change
- **excluded, work occurred, EIU changed the treatment** — `eiuApplied` true, original reason preserved
- **excluded, work occurred, treatment stayed excluded** — the work is recorded, the exclusion held

The precise treatment of **partial work inside an excluded window** is an
unresolved EIU edge case — **NEEDS REAL CHARTERPARTY EVIDENCE**. It is not
guessed here.

---

## WWD / weather — an orthogonal axis

Weather applicability is an independent semantic axis, orthogonal to weekly
and holiday exclusion. The current architecture supports weather
applicability, weather-related operational periods, and weather
classification of intervals.

The architecture may later be extended by a dedicated WeatherPeriod
abstraction, but that is not introduced now.

Explicitly NOT frozen (all evidence-dependent): the authoritative weather
source, any weather-provider integration, partial-hour pro-rating, and the
final contractual weather treatment.

---

## Term labels — the engine never branches on them

The engine must **never** branch on commercial labels such as SHINC, SHEX,
FHEX EIU, or FSHEX EIU. There is no `switch(termLabel)` anywhere.

Such a label is simply a **name for a particular combination of configured
semantic-axis values**. The engine reasons through the axis values, not the
label. A label maps to: a configured excluded-weekday set, a holiday
treatment, a weather applicability, an EIU applicability, and a working-day
window — all of them data.

**No universal weekday assumption is ever written.** A shorthand does not
mean a fixed, market-independent weekday set. The excluded weekdays are
always configuration data supplied per contract; the same shorthand can
resolve to different configured values for different customers.

---

## Interval model — three things kept separate

The interval remains the single source of calculation truth. Three concepts
stay conceptually distinct (as the existing architecture already keeps them,
flat on the interval — no new object is introduced):

1. **CLASSIFICATION** — what kind of interval/state this is.
2. **EFFECTIVE TREATMENT** — how this interval contributes to laytime.
3. **PROVENANCE** — why it received that treatment.

The existing architecture is the baseline: start, end, duration,
classification-related state, treatment/countability-related state, source
fact references, EIU state, weather state, commencement state, laytime state.

Explicitly NOT introduced: `RuleResult`, generic `RuleMatch`, generic
`RuleApplication`, or a provenance graph.

### Partial counting — a result, not a configurable axis

Partial counting is a **calculation treatment/result capability**, not a
RuleSet configuration axis. If a `countingFraction` representation is
retained, it is a candidate representation of a **calculation result**, never
a generic configurable rule property. Its exact contractual semantics — who
supplies the fraction, how it is calculated, whether it applies to weather
only or other cases, and how conflicts behave — **NEEDS REAL CHARTERPARTY
EVIDENCE** and is not frozen here.

### Counted duration

Elapsed duration is a property of the interval. Effective treatment
determines how much of it contributes to laytime. **Counted duration is an
engine-derived result.** The exact persistence, rounding, and storage of that
result is an implementation/persistence concern to be handled later — not a
domain decision. The architecture already defines LaytimeInterval as the
single truth and separately snapshots resolved rules in
`LaytimeCalculation.resolvedRulesJson`; no additional persistence machinery
is invented here.

---

## Provenance — minimum only

The engine must be able to answer "why was this interval treated this way?"
in a structured form. The existing architecture already provides the full
baseline for this, and it is sufficient:

- `resolvedRulesJson` snapshot (which semantic axes were in force)
- `exclusionReason`
- `weekdayClass`
- `holidayId` where applicable
- `operationOccurred`
- `eiuApplied`
- `weatherApplied`
- `commencementState`
- `LaytimeIntervalStoppageLink`

Together these explain why an interval received its treatment, combining the
active semantic configuration (snapshot) with the per-interval source facts
and treatment state. No additional provenance entity is designed.

A future enhancement for **multiple simultaneous reasons** on one interval
may prove necessary, but a list/array representation is **not frozen now** —
it **NEEDS REAL CHARTERPARTY EVIDENCE** before its structure is fixed.

---

## Composition — no generic algorithm

There is no generic rule-composition algorithm. The engine consumes the
bounded semantic axes directly. Interactions are documented only at the level
the architecture actually establishes.

| Interaction | Status |
|---|---|
| weekday + holiday | mechanically, both mark the same interval excluded → it is excluded; which reason is recorded / any display precedence is **NEEDS REAL CHARTERPARTY EVIDENCE** |
| holiday + weather | interaction semantics **NEEDS REAL CHARTERPARTY EVIDENCE** |
| weather + stoppage | interaction semantics **NEEDS REAL CHARTERPARTY EVIDENCE** |
| EIU + excluded period | defined as a stage sequence (CLASSIFY → APPLY EIU); partial-work edge cases **NEEDS REAL CHARTERPARTY EVIDENCE** |
| multiple exclusion mechanisms | mechanically the interval is excluded; the applied-reason / precedence semantics **NEEDS REAL CHARTERPARTY EVIDENCE** |
| partial counting + another exclusion | **NEEDS REAL CHARTERPARTY EVIDENCE** |

"An excluded interval stays excluded when a second exclusion also covers it"
is a **mechanical fact**, not a frozen composition law. It is documented as
mechanics, not elevated into a universal rule-resolution algorithm.

### Permanent principles (these do not depend on evidence)

- no numeric rule priority
- no hidden tie-break
- no arbitrary ordering
- no guessing
- ambiguous or unresolved commercial semantics must never silently produce a
  potentially incorrect commercial result — the engine refuses to calculate
  rather than guess

These principles constrain the engine; they are **not** themselves a generic
rule-resolution engine.

---

## Templates / presets

A Template (or preset) is a **human-friendly configuration shortcut**. It
resolves directly into the bounded semantic configuration that becomes a
RuleSetVersion:

```
Template / Preset
        ↓
bounded semantic configuration
        ↓
RuleSetVersion
```

Rules for templates:

- no hidden execution behaviour
- not a second engine
- not a second independent semantic model
- **no dedicated persistent Template entity is assumed at this stage**

A template that needs a semantic the axes cannot express does not extend the
template — it signals a possibly-missing axis, handled through the
extensibility process below. Editing a template produces a **new**
RuleSetVersion, preserving immutability (F13) and historical reproducibility:
the old version stays, and a historical calculation reproduces from its
frozen version plus `resolvedRulesJson`. Template persistence and UX are a
later product decision.

---

## Extensibility — deliberate evolution, never customer code

When a future charterparty cannot be represented:

1. Check whether current configuration already represents it.
2. If not, determine whether an existing semantic axis is insufficient.
3. If the axis needs a bounded extension, treat that as deliberate product evolution.
4. If a genuinely new semantic dimension is required, review it as a product/architecture change.
5. If the contract itself is ambiguous, refuse to guess.
6. Never provide an arbitrary scripting escape hatch.

The product expands through **deliberate semantic-vocabulary evolution**, not
customer-authored programming. There is no generic escape hatch that bypasses
the typed axes.

---

## Phase 6 risk gate — historical wording preserved

Earlier roadmap wording framed "validate against 2–3 real charterparties
before Phase 6" as a mandatory entry gate. That wording is preserved in the
roadmap and marked **SUPERSEDED**, not deleted. The current methodology:

Real charterparty evidence is recommended risk evidence, and is required for
specific semantic decisions when those decisions are reached — but additional
charterparties are **not** a universal prerequisite for starting Phase 6.
Phase 6 may proceed by capability when the semantics required for the
specific engine step being implemented are sufficiently defined. It pauses
only when the relevant calculation semantics are genuinely undefined.

---

## Final decision register

Statuses distinguish STRUCTURE from SEMANTICS from CONFIGURATION VALUE from
IMPLEMENTATION DETAIL. A field existing is never by itself frozen business
semantics.

| Item | Layer | Status |
|---|---|---|
| Ownership split (Term / RuleSet / StoppageRule) | structure | **FROZEN** |
| RuleSetVersion is the bounded semantic container (no rule objects) | structure | **FROZEN** |
| Weekly-exclusion axis exists | structure | **FROZEN** |
| The configured excluded-weekday set | configuration value | **CONFIGURATION VALUE** |
| Holiday-exclusion axis + calendar selection exist | structure | **FROZEN** |
| Holiday precedence / before-after extension semantics | semantics | **NEEDS REAL CHARTERPARTY EVIDENCE** |
| Working-day-window axis exists | structure | **FROZEN** |
| The configured working-day bounds | configuration value | **CONFIGURATION VALUE** |
| Weather-applicability axis exists (orthogonal) | structure | **FROZEN** |
| Weather authority / provider / partial-hour / final treatment | semantics | **NEEDS REAL CHARTERPARTY EVIDENCE** |
| EIU applicability axis + APPLY EIU stage | structure | **FROZEN** |
| EIU edge cases (partial work in window) | semantics | **NEEDS REAL CHARTERPARTY EVIDENCE** |
| Turn time / commencement term-owned, consumed as stages | structure / ownership | **FROZEN** |
| Turn time / commencement business semantics | semantics | **NEEDS REAL CHARTERPARTY EVIDENCE** |
| Stoppage countability on ContractStoppageRule | structure | **FROZEN** |
| Engine never branches on term labels | principle | **FROZEN** |
| Interval separates classification / treatment / provenance | structure | **FROZEN** |
| Provenance via flat interval metadata + resolvedRulesJson | structure | **FROZEN** (sufficient) |
| Counted duration is engine-derived; storage/rounding | result / implementation | **IMPLEMENTATION DETAIL** |
| Recurring intra-week window (E2) | capability | **IDENTIFIED CAPABILITY** |
| Holiday offsets/extension (E3) | semantics | **NEEDS REAL CHARTERPARTY EVIDENCE** |
| Partial counting (E4) as a result capability | capability | **IDENTIFIED CAPABILITY**; semantics **NEEDS REAL CHARTERPARTY EVIDENCE** |
| `countingFraction` as a configurable RuleSet axis | — | **REJECTED** (it is a result, not configuration) |
| Multiple-reason array/list on interval | semantics | **NEEDS REAL CHARTERPARTY EVIDENCE** |
| Templates/presets → axes → RuleSetVersion | capability | **IDENTIFIED CAPABILITY** |
| Dedicated persistent Template entity | storage / UX | **NEW DECISION REQUIRED** (later) |
| Storage representation (columns / JSONB / child table) | implementation | **IMPLEMENTATION DETAIL** |
| Generic `CanonicalRule[]` abstraction | — | **REJECTED** |
| `usagePolicy`-per-rule | — | **REJECTED** |
| `RuleMatch` / `RuleApplication` / provenance graph | — | **REJECTED** |
| Generic DSL / arbitrary customer rules | — | **REJECTED** |
| Numeric rule priority / hidden tie-breaking | — | **REJECTED** |
| Customer-specific code branches | — | **REJECTED** |

---

## Final validation checklist

- No generic Rule abstraction is introduced. ✓
- Turn time and commencement remain term-owned, consumed as stages. ✓
- EIU remains a separate engine stage. ✓
- WWD remains an orthogonal axis. ✓
- No universal SHEX weekday assumption appears. ✓
- Partial counting is not frozen as a configurable axis. ✓
- Provenance remains minimal (flat metadata + snapshot). ✓
- Structure, semantics, configuration, and implementation are distinguished throughout. ✓
- Historical risk-gate wording preserved as SUPERSEDED, not erased. ✓
- Consistent with the existing Phase 2 architecture. ✓

*This document freezes the conceptual model. It introduces no new
abstraction: it is an accurate description of the existing RuleSetVersion
semantic container, with open semantics honestly marked and future evolution
constrained to deliberate, evidence-driven vocabulary extension.*
