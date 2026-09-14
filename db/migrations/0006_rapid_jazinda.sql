ALTER TABLE "facilities" ADD CONSTRAINT "facilities_id_org_unique" UNIQUE("id","organization_id");
--> statement-breakpoint
ALTER TABLE "contract_laytime_terms" ADD CONSTRAINT "contract_laytime_terms_id_org_unique" UNIQUE("id","organization_id");
--> statement-breakpoint
CREATE TYPE "public"."port_call_status" AS ENUM('ACTIVE', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TABLE "voyage_port_calls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"voyage_id" uuid NOT NULL,
	"port_id" uuid NOT NULL,
	"facility_id" uuid,
	"function" "contract_function" NOT NULL,
	"sequence" integer NOT NULL,
	"status" "port_call_status" DEFAULT 'ACTIVE' NOT NULL,
	"effective_timezone" text NOT NULL,
	"contract_laytime_term_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voyage_port_calls_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "voyage_port_calls" ADD CONSTRAINT "voyage_port_calls_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voyage_port_calls" ADD CONSTRAINT "voyage_port_calls_voyage_org_fk" FOREIGN KEY ("voyage_id","organization_id") REFERENCES "public"."voyages"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voyage_port_calls" ADD CONSTRAINT "voyage_port_calls_port_org_fk" FOREIGN KEY ("port_id","organization_id") REFERENCES "public"."ports"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voyage_port_calls" ADD CONSTRAINT "voyage_port_calls_facility_org_fk" FOREIGN KEY ("facility_id","organization_id") REFERENCES "public"."facilities"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voyage_port_calls" ADD CONSTRAINT "voyage_port_calls_term_org_fk" FOREIGN KEY ("contract_laytime_term_id","organization_id") REFERENCES "public"."contract_laytime_terms"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voyage_port_calls_org_idx" ON "voyage_port_calls" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "voyage_port_calls_voyage_idx" ON "voyage_port_calls" USING btree ("voyage_id");--> statement-breakpoint
CREATE UNIQUE INDEX "voyage_port_calls_voyage_sequence_unique_idx" ON "voyage_port_calls" USING btree ("voyage_id","sequence");--> statement-breakpoint
