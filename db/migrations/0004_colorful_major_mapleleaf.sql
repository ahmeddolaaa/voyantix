CREATE TYPE "public"."contract_function" AS ENUM('LOAD', 'DISCHARGE');--> statement-breakpoint
ALTER TABLE "cargoes" ADD CONSTRAINT "cargoes_id_org_unique" UNIQUE("id","organization_id");--> statement-breakpoint
CREATE TABLE "contract_laytime_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"function" "contract_function" NOT NULL,
	"port_id" uuid,
	"cargo_id" uuid,
	"allowance" numeric NOT NULL,
	"allowance_unit" text NOT NULL,
	"demurrage_rate" numeric NOT NULL,
	"despatch_rate" numeric,
	"despatch_basis" text,
	"turn_time_hours" numeric,
	"turn_time_trigger" text,
	"commencement_rule" text NOT NULL,
	"rule_set_version_id" uuid NOT NULL,
	"pool_id" uuid,
	"status" "entity_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "laytime_pools" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"contract_id" uuid NOT NULL,
	"name" text NOT NULL,
	"total_allowance" numeric NOT NULL,
	"allowance_unit" text NOT NULL,
	"settlement_policy" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "laytime_pools_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "contract_laytime_terms" ADD CONSTRAINT "contract_laytime_terms_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_laytime_terms" ADD CONSTRAINT "contract_laytime_terms_contract_org_fk" FOREIGN KEY ("contract_id","organization_id") REFERENCES "public"."contracts"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_laytime_terms" ADD CONSTRAINT "contract_laytime_terms_rule_set_version_org_fk" FOREIGN KEY ("rule_set_version_id","organization_id") REFERENCES "public"."laytime_rule_set_versions"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_laytime_terms" ADD CONSTRAINT "contract_laytime_terms_pool_org_fk" FOREIGN KEY ("pool_id","organization_id") REFERENCES "public"."laytime_pools"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_laytime_terms" ADD CONSTRAINT "contract_laytime_terms_port_org_fk" FOREIGN KEY ("port_id","organization_id") REFERENCES "public"."ports"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_laytime_terms" ADD CONSTRAINT "contract_laytime_terms_cargo_org_fk" FOREIGN KEY ("cargo_id","organization_id") REFERENCES "public"."cargoes"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laytime_pools" ADD CONSTRAINT "laytime_pools_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laytime_pools" ADD CONSTRAINT "laytime_pools_contract_org_fk" FOREIGN KEY ("contract_id","organization_id") REFERENCES "public"."contracts"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_laytime_terms_org_idx" ON "contract_laytime_terms" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "contract_laytime_terms_contract_idx" ON "contract_laytime_terms" USING btree ("contract_id");--> statement-breakpoint
CREATE INDEX "laytime_pools_org_idx" ON "laytime_pools" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "laytime_pools_contract_idx" ON "laytime_pools" USING btree ("contract_id");--> statement-breakpoint
CREATE UNIQUE INDEX "laytime_pools_contract_name_unique_idx" ON "laytime_pools" USING btree ("contract_id",lower(trim("name")));