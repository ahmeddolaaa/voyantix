import { db } from "../db/client";
import {
  vessels,
  ports,
  cargos,
  factories,
  stoppageReasons,
  contractTerms,
  voyages,
} from "../db/schema";
import { getDefaultOrganizationId } from "../lib/current-org";

async function main() {
  const orgId = await getDefaultOrganizationId();

  const [vessel] = await db
    .insert(vessels)
    .values({ id: crypto.randomUUID(), organizationId: orgId, name: "MV Ocean Dawn" })
    .returning();

  const [port] = await db
    .insert(ports)
    .values({ id: crypto.randomUUID(), organizationId: orgId, name: "Alexandria" })
    .returning();

  const [cargo] = await db
    .insert(cargos)
    .values({ id: crypto.randomUUID(), organizationId: orgId, name: "Iron Ore Pellets" })
    .returning();

  const [factory] = await db
    .insert(factories)
    .values({ id: crypto.randomUUID(), organizationId: orgId, name: "EZDK Plant 1" })
    .returning();

  const [reason1] = await db
    .insert(stoppageReasons)
    .values({ id: crypto.randomUUID(), organizationId: orgId, name: "Weather Delay" })
    .returning();
  await db.insert(stoppageReasons).values({
    id: crypto.randomUUID(),
    organizationId: orgId,
    name: "Crane Breakdown",
  });

  const [terms] = await db
    .insert(contractTerms)
    .values({
      id: crypto.randomUUID(),
      organizationId: orgId,
      termsReference: "CP-EZDK-2026-01",
      portId: port.id,
      cargoId: cargo.id,
      allowedLaytimeDays: 3,
      demurrageRatePerDay: 9990,
      despatchRatePerDay: 4995,
    })
    .returning();

  await db.insert(voyages).values({
    id: crypto.randomUUID(),
    organizationId: orgId,
    voyageReference: "VOY-001",
    vesselId: vessel.id,
    portId: port.id,
    contractTermsId: terms.id,
    status: "On Laytime",
    arrivalTime: "2026-08-10T02:00:00Z",
    norTender: "2026-08-10T05:00:00Z",
    norAcceptance: "2026-08-10T08:00:00Z",
    sailingTime: null,
  });

  console.log("Seed complete. Organization:", orgId);
  console.log("Reference data ready: 1 vessel, 1 port, 1 cargo, 1 factory,");
  console.log("2 stoppage reasons, 1 contract terms, 1 demo voyage (VOY-001).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
