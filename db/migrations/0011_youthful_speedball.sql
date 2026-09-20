CREATE TYPE "public"."laytime_statement_status" AS ENUM('draft', 'finalized');--> statement-breakpoint
CREATE TYPE "public"."statement_scope_type" AS ENUM('port_call', 'pool');--> statement-breakpoint
CREATE TYPE "public"."statement_settlement_kind" AS ENUM('demurrage', 'despatch', 'none', 'settlement_refused', 'calc_refused');--> statement-breakpoint
CREATE TABLE "laytime_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"voyage_id" uuid NOT NULL,
	"status" "laytime_statement_status" DEFAULT 'draft' NOT NULL,
	"finalized_at" timestamp with time zone,
	"finalized_by_user_id" uuid,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "laytime_statements_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "laytime_statements_finalize_stamp_check" CHECK ((status = 'draft' and finalized_at is null and finalized_by_user_id is null)
          or (status = 'finalized' and finalized_at is not null and finalized_by_user_id is not null))
);
--> statement-breakpoint
CREATE TABLE "statement_scope_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"statement_id" uuid NOT NULL,
	"scope_type" "statement_scope_type" NOT NULL,
	"port_call_id" uuid,
	"pool_id" uuid,
	"calculation_id" uuid,
	"balance_outcome" "laytime_balance_outcome",
	"balance_seconds" numeric,
	"settlement_kind" "statement_settlement_kind" NOT NULL,
	"amount" numeric,
	"settlement_refusal_code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "statement_scope_results_scope_shape_check" CHECK ((scope_type = 'port_call' and port_call_id is not null and pool_id is null)
          or (scope_type = 'pool' and pool_id is not null and port_call_id is null))
);
--> statement-breakpoint
ALTER TABLE "laytime_statements" ADD CONSTRAINT "laytime_statements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laytime_statements" ADD CONSTRAINT "laytime_statements_finalized_by_user_id_users_id_fk" FOREIGN KEY ("finalized_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laytime_statements" ADD CONSTRAINT "laytime_statements_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laytime_statements" ADD CONSTRAINT "laytime_statements_voyage_org_fk" FOREIGN KEY ("voyage_id","organization_id") REFERENCES "public"."voyages"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_scope_results" ADD CONSTRAINT "statement_scope_results_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_scope_results" ADD CONSTRAINT "statement_scope_results_calculation_id_laytime_calculations_id_fk" FOREIGN KEY ("calculation_id") REFERENCES "public"."laytime_calculations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_scope_results" ADD CONSTRAINT "statement_scope_results_statement_org_fk" FOREIGN KEY ("statement_id","organization_id") REFERENCES "public"."laytime_statements"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_scope_results" ADD CONSTRAINT "statement_scope_results_port_call_org_fk" FOREIGN KEY ("port_call_id","organization_id") REFERENCES "public"."voyage_port_calls"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_scope_results" ADD CONSTRAINT "statement_scope_results_pool_org_fk" FOREIGN KEY ("pool_id","organization_id") REFERENCES "public"."laytime_pools"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "laytime_statements_org_idx" ON "laytime_statements" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "laytime_statements_voyage_idx" ON "laytime_statements" USING btree ("voyage_id");--> statement-breakpoint
CREATE UNIQUE INDEX "laytime_statements_voyage_draft_unique_idx" ON "laytime_statements" USING btree ("voyage_id") WHERE status = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "laytime_statements_voyage_final_unique_idx" ON "laytime_statements" USING btree ("voyage_id") WHERE status = 'finalized';--> statement-breakpoint
CREATE INDEX "statement_scope_results_org_idx" ON "statement_scope_results" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "statement_scope_results_statement_idx" ON "statement_scope_results" USING btree ("statement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "statement_scope_results_statement_port_call_unique_idx" ON "statement_scope_results" USING btree ("statement_id","port_call_id") WHERE port_call_id is not null;