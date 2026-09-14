CREATE TABLE "cargo_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"port_call_id" uuid NOT NULL,
	"cargo_id" uuid NOT NULL,
	"planned_quantity_mt" numeric NOT NULL,
	"actual_quantity_mt" numeric,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cargo_plans" ADD CONSTRAINT "cargo_plans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargo_plans" ADD CONSTRAINT "cargo_plans_port_call_org_fk" FOREIGN KEY ("port_call_id","organization_id") REFERENCES "public"."voyage_port_calls"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cargo_plans" ADD CONSTRAINT "cargo_plans_cargo_org_fk" FOREIGN KEY ("cargo_id","organization_id") REFERENCES "public"."cargoes"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cargo_plans_org_idx" ON "cargo_plans" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "cargo_plans_port_call_idx" ON "cargo_plans" USING btree ("port_call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cargo_plans_port_call_cargo_unique_idx" ON "cargo_plans" USING btree ("port_call_id","cargo_id");