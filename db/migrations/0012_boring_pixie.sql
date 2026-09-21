CREATE TABLE "laytime_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"amount" numeric NOT NULL,
	"reason" text NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "laytime_adjustments" ADD CONSTRAINT "laytime_adjustments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laytime_adjustments" ADD CONSTRAINT "laytime_adjustments_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laytime_adjustments" ADD CONSTRAINT "laytime_adjustments_statement_org_fk" FOREIGN KEY ("statement_id","organization_id") REFERENCES "public"."laytime_statements"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "laytime_adjustments_org_idx" ON "laytime_adjustments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "laytime_adjustments_statement_idx" ON "laytime_adjustments" USING btree ("statement_id");