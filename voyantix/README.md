# Voyantix

Laytime, demurrage and despatch management for bulk chartering operations.

A standalone web application — no Power Platform, no vendor lock-in,
self-hostable, and multi-tenant from the schema up.

---

## Running it

```bash
npm install
npx drizzle-kit push     # create the SQLite schema
npx tsx scripts/seed.ts  # load reference data + a demo voyage
npm run dev              # http://localhost:3000
```

No environment variables are required for local development. The database
is a single SQLite file (`voyantix.db`) in the project root.

To run the test suite:

```bash
npx vitest run
```

---

## What's here

**Company level**
- Portfolio — every voyage, with status
- Reports — deliberately an honest empty state; cross-voyage reporting is
  not built yet and shows no fabricated data

**Voyage level**
- Overview — timing and headline exposure figures
- Cargo Plan — full CRUD
- Rates & Targets — shift performance CRUD
- Stoppages — review, correct, delete
- Field Entry — operational stoppage capture, with "Now" shortcuts,
  overlap prevention and a one-open-stoppage-at-a-time rule
- Timeline — stoppages and shifts merged in true chronological order
- Laytime Statement — the commercial document, with the canonical
  selection rule enforced
- Audit Trail — every change, in order

---

## The rules that matter

Three business rules were established through extensive production
testing on the previous implementation and are enforced here at the
service and database layer, not just in the UI.

### Canonical statement selection

For any voyage, exactly one Finalized statement is commercially binding:

| Finalized statements | Behaviour |
|---|---|
| 0 | No canonical statement. Empty state. A draft is never substituted. |
| 1 | That statement is canonical. |
| >1 | Data integrity exception. Nothing is displayed as authoritative. |

The `>1` case deliberately refuses to pick one. Choosing "the most
recent" or "the first" would put arbitrary figures in front of a
counterparty, which is exactly the failure this rule exists to prevent.
See `lib/canonical-statement.ts`.

### One active draft

Recalculation never creates duplicates:

| Draft statements | Behaviour |
|---|---|
| 0 | Create a new draft |
| 1 | Update that draft in place |
| >1 | Refuse to write anything, log the exception |

Finalized statements are excluded from the draft lookup, so recalculation
can never overwrite a commercially agreed statement.

### Time sheet entries are the current result only

A time sheet entry represents the current calculation result for its
draft statement — it is not a historical record and there is no
versioning. Each recalculation deletes the statement's existing entries
before writing the new set.

The whole update-delete-recreate sequence runs inside a single database
transaction, so a partial failure can never leave a statement holding a
mix of old and new intervals. Junction rows clean themselves up via
`ON DELETE CASCADE` at the schema level.

`lib/__tests__/recalculate-voyage.integration.test.ts` runs six
consecutive recalculations and asserts that exactly one statement and one
set of entries survive. If that test ever fails, the duplication bug has
come back.

---

## The calculation engine

`lib/engine/laytime-engine.ts` is a pure function: no database access, no
side effects, fully unit tested.

Given a laytime window, allowed days, rates and stoppages, it produces
the interval breakdown plus the aggregate figures. Stoppages are clipped
to the window, overlapping stoppages are merged, and the interval that
straddles the allowed-laytime threshold is split so the On Laytime → On
Demurrage transition lands at exactly the right moment.

Time balance is `allowed − used`. A negative balance is demurrage, a
positive one is despatch, and the settlement amount is the absolute
balance multiplied by the applicable rate from the voyage's own contract
terms.

Invalid input is surfaced rather than silently absorbed: a stoppage whose
end precedes its start is excluded from the calculation and flagged in
the UI as an invalid duration instead of producing a negative number.

---

## Architecture notes

- **Next.js 16** with the App Router, React server components, and server
  actions. No separate API layer to maintain.
- **Drizzle ORM** over SQLite. Swapping to PostgreSQL for production is a
  driver change plus a dialect line in `drizzle.config.ts`; the schema and
  queries carry over.
- **Multi-tenancy is in the schema already.** Every business table has an
  `organizationId` and every query filters on it. `lib/current-org.ts`
  currently returns a single fixed development organization — replacing it
  with a real session lookup is the only change needed to support multiple
  customers, and no business logic has to move.
- **Design tokens** live in `app/globals.css` and mirror the approved
  Voyantix visual reference exactly: deep teal navy chrome, warm neutral
  page surface, brass for primary actions, teal for despatch, rust for
  demurrage exposure. Fraunces for headings, IBM Plex Sans for interface,
  IBM Plex Mono for figures.

---

## Deliberately not built

These are known gaps, not oversights. Nothing here is faked with
placeholder data.

- **Authentication and permissions.** The schema is ready; the auth layer
  is not built. Every user currently operates as the single development
  organization.
- **Reports.** The screen exists and says so plainly.
- **Achieved rate.** No agreed formula exists, so the field shows
  "definition pending" rather than a guessed number.
- **Contract terms with no cargo.** The column is nullable, matching the
  existing data, but no generic-versus-specific matching logic has been
  invented. Terms are looked up directly from the voyage.
- **Contract stoppage rules.** The table is carried forward as a
  placeholder. Its business meaning was never specified and the engine
  does not consult it.
- **Statement versioning history.** Explicitly out of scope — time sheet
  entries are current-result-only by decision.
