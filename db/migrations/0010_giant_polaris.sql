CREATE TYPE "public"."laytime_balance_outcome" AS ENUM('SAVED', 'EXCEEDED', 'EXACT');--> statement-breakpoint
CREATE TYPE "public"."laytime_calculation_status" AS ENUM('calculated', 'refused');--> statement-breakpoint
CREATE TYPE "public"."laytime_interval_treatment" AS ENUM('COUNTED', 'EXCLUDED');--> statement-breakpoint
CREATE TABLE "laytime_calculations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"port_call_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"rule_set_version_id" uuid NOT NULL,
	"status" "laytime_calculation_status" NOT NULL,
	"refusal_code" text,
	"refusal_reason" text,
	"window_start" timestamp with time zone,
	"window_end" timestamp with time zone,
	"commencement_at" timestamp with time zone,
	"turn_time_start" timestamp with time zone,
	"turn_time_end" timestamp with time zone,
	"allowed_seconds" numeric,
	"used_seconds" numeric,
	"balance_seconds" numeric,
	"outcome" "laytime_balance_outcome",
	"resolved_rules_json" jsonb NOT NULL,
	"engine_version" text NOT NULL,
	"calculated_by_user_id" uuid NOT NULL,
	"calculated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "laytime_calculations_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "laytime_calculations_outcome_shape_check" CHECK ((status = 'refused' and refusal_code is not null
             and window_start is null and window_end is null
             and allowed_seconds is null and used_seconds is null
             and balance_seconds is null and outcome is null)
          or
          (status = 'calculated' and refusal_code is null
             and window_start is not null and window_end is not null
             and allowed_seconds is not null and used_seconds is not null
             and balance_seconds is not null and outcome is not null))
);
--> statement-breakpoint
CREATE TABLE "laytime_interval_stoppage_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"interval_id" uuid NOT NULL,
	"stoppage_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "laytime_intervals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"calculation_id" uuid NOT NULL,
	"port_call_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"treatment" "laytime_interval_treatment" NOT NULL,
	"reasons" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "laytime_intervals_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "laytime_intervals_end_after_start_check" CHECK (end_time > start_time)
);
--> statement-breakpoint
ALTER TABLE "stoppages" ADD CONSTRAINT "stoppages_id_org_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "laytime_calculations" ADD CONSTRAINT "laytime_calculations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laytime_calculations" ADD CONSTRAINT "laytime_calculations_calculated_by_user_id_users_id_fk" FOREIGN KEY ("calculated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laytime_calculations" ADD CONSTRAINT "laytime_calculations_port_call_org_fk" FOREIGN KEY ("port_call_id","organization_id") REFERENCES "public"."voyage_port_calls"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laytime_calculations" ADD CONSTRAINT "laytime_calculations_term_org_fk" FOREIGN KEY ("term_id","organization_id") REFERENCES "public"."contract_laytime_terms"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laytime_calculations" ADD CONSTRAINT "laytime_calculations_rule_set_version_org_fk" FOREIGN KEY ("rule_set_version_id","organization_id") REFERENCES "public"."laytime_rule_set_versions"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laytime_interval_stoppage_links" ADD CONSTRAINT "laytime_interval_stoppage_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laytime_interval_stoppage_links" ADD CONSTRAINT "laytime_interval_stoppage_links_interval_org_fk" FOREIGN KEY ("interval_id","organization_id") REFERENCES "public"."laytime_intervals"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laytime_interval_stoppage_links" ADD CONSTRAINT "laytime_interval_stoppage_links_stoppage_org_fk" FOREIGN KEY ("stoppage_id","organization_id") REFERENCES "public"."stoppages"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laytime_intervals" ADD CONSTRAINT "laytime_intervals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laytime_intervals" ADD CONSTRAINT "laytime_intervals_calculation_org_fk" FOREIGN KEY ("calculation_id","organization_id") REFERENCES "public"."laytime_calculations"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laytime_intervals" ADD CONSTRAINT "laytime_intervals_port_call_org_fk" FOREIGN KEY ("port_call_id","organization_id") REFERENCES "public"."voyage_port_calls"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "laytime_calculations_org_idx" ON "laytime_calculations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "laytime_calculations_port_call_idx" ON "laytime_calculations" USING btree ("port_call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "laytime_calculations_port_call_unique_idx" ON "laytime_calculations" USING btree ("port_call_id");--> statement-breakpoint
CREATE INDEX "laytime_interval_stoppage_links_org_idx" ON "laytime_interval_stoppage_links" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "laytime_interval_stoppage_links_interval_idx" ON "laytime_interval_stoppage_links" USING btree ("interval_id");--> statement-breakpoint
CREATE UNIQUE INDEX "laytime_interval_stoppage_links_interval_stoppage_unique_idx" ON "laytime_interval_stoppage_links" USING btree ("interval_id","stoppage_id");--> statement-breakpoint
CREATE INDEX "laytime_intervals_org_idx" ON "laytime_intervals" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "laytime_intervals_calculation_idx" ON "laytime_intervals" USING btree ("calculation_id");--> statement-breakpoint
CREATE INDEX "laytime_intervals_port_call_idx" ON "laytime_intervals" USING btree ("port_call_id");--> statement-breakpoint
CREATE UNIQUE INDEX "laytime_intervals_calc_sequence_unique_idx" ON "laytime_intervals" USING btree ("calculation_id","sequence");--> statement-breakpoint