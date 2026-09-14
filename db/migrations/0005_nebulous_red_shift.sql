ALTER TABLE "vessels" ADD CONSTRAINT "vessels_id_org_unique" UNIQUE("id","organization_id");--> statement-breakpoint
CREATE TYPE "public"."voyage_status" AS ENUM('ACTIVE', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "voyages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"voyage_reference" text NOT NULL,
	"vessel_name" text NOT NULL,
	"vessel_id" uuid,
	"contract_id" uuid,
	"status" "voyage_status" DEFAULT 'ACTIVE' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voyages_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "voyages" ADD CONSTRAINT "voyages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voyages" ADD CONSTRAINT "voyages_vessel_org_fk" FOREIGN KEY ("vessel_id","organization_id") REFERENCES "public"."vessels"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voyages" ADD CONSTRAINT "voyages_contract_org_fk" FOREIGN KEY ("contract_id","organization_id") REFERENCES "public"."contracts"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voyages_org_idx" ON "voyages" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "voyages_org_reference_unique_idx" ON "voyages" USING btree ("organization_id",lower(trim("voyage_reference")));