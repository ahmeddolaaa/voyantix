CREATE TABLE "laytime_rule_set_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"rule_set_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"excluded_weekdays" integer[] DEFAULT '{}' NOT NULL,
	"exclude_holidays" boolean DEFAULT false NOT NULL,
	"eiu_applies" boolean DEFAULT false NOT NULL,
	"weather_applies" boolean DEFAULT false NOT NULL,
	"working_day_start" time,
	"working_day_end" time,
	"holiday_calendar_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "laytime_rule_set_versions_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "laytime_rule_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "laytime_rule_sets_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
ALTER TABLE "laytime_rule_set_versions" ADD CONSTRAINT "laytime_rule_set_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laytime_rule_set_versions" ADD CONSTRAINT "laytime_rule_set_versions_rule_set_org_fk" FOREIGN KEY ("rule_set_id","organization_id") REFERENCES "public"."laytime_rule_sets"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laytime_rule_set_versions" ADD CONSTRAINT "laytime_rule_set_versions_holiday_calendar_org_fk" FOREIGN KEY ("holiday_calendar_id","organization_id") REFERENCES "public"."holiday_calendars"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "laytime_rule_sets" ADD CONSTRAINT "laytime_rule_sets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "laytime_rule_set_versions_org_idx" ON "laytime_rule_set_versions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "laytime_rule_set_versions_rule_set_idx" ON "laytime_rule_set_versions" USING btree ("rule_set_id");--> statement-breakpoint
CREATE UNIQUE INDEX "laytime_rule_set_versions_ruleset_version_unique_idx" ON "laytime_rule_set_versions" USING btree ("rule_set_id","version_number");--> statement-breakpoint
CREATE INDEX "laytime_rule_sets_org_idx" ON "laytime_rule_sets" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "laytime_rule_sets_org_name_unique_idx" ON "laytime_rule_sets" USING btree ("organization_id",lower(trim("name")));