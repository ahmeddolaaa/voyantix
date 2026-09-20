CREATE TYPE "public"."stoppage_countability" AS ENUM('AlwaysExcluded', 'NeverExcluded', 'CountsAgainstOwner');--> statement-breakpoint
CREATE TABLE "contract_stoppage_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"stoppage_reason_id" uuid NOT NULL,
	"countability" "stoppage_countability" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contract_stoppage_rules" ADD CONSTRAINT "contract_stoppage_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_stoppage_rules" ADD CONSTRAINT "contract_stoppage_rules_term_org_fk" FOREIGN KEY ("term_id","organization_id") REFERENCES "public"."contract_laytime_terms"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contract_stoppage_rules" ADD CONSTRAINT "contract_stoppage_rules_reason_org_fk" FOREIGN KEY ("stoppage_reason_id","organization_id") REFERENCES "public"."stoppage_reasons"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "contract_stoppage_rules_org_idx" ON "contract_stoppage_rules" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "contract_stoppage_rules_term_idx" ON "contract_stoppage_rules" USING btree ("term_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contract_stoppage_rules_term_reason_unique_idx" ON "contract_stoppage_rules" USING btree ("term_id","stoppage_reason_id");