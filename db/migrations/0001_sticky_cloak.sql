CREATE TYPE "public"."entity_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TABLE "cargoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"grade" text,
	"status" "entity_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "facilities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"port_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"type" text,
	"status" "entity_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "holiday_calendars" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"status" "entity_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "holiday_calendars_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "holidays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"holiday_calendar_id" uuid NOT NULL,
	"date" date NOT NULL,
	"label" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "operational_event_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"system_semantic" text,
	"is_protected" boolean DEFAULT false NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"status" "entity_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operational_event_types_protected_semantic_check" CHECK ((is_protected = true and system_semantic is not null) or (is_protected = false and system_semantic is null)),
	CONSTRAINT "operational_event_types_protected_active_check" CHECK ((is_protected = false) or (is_protected = true and status = 'active')),
	CONSTRAINT "operational_event_types_semantic_vocabulary_check" CHECK (system_semantic is null or system_semantic in (
        'NOR_TENDERED','NOR_ACCEPTED','BERTHED','OPS_COMMENCED',
        'OPS_COMPLETED','DEPARTED','WEATHER_START','WEATHER_END'
      ))
);
--> statement-breakpoint
CREATE TABLE "ports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"country" text NOT NULL,
	"unlocode" text,
	"default_timezone" text NOT NULL,
	"default_holiday_calendar_id" uuid,
	"status" "entity_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ports_id_org_unique" UNIQUE("id","organization_id")
);
--> statement-breakpoint
CREATE TABLE "stoppage_reasons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"is_weather_related" boolean DEFAULT false NOT NULL,
	"status" "entity_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vessels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"imo" text,
	"dwt" integer,
	"flag" text,
	"status" "entity_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cargoes" ADD CONSTRAINT "cargoes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "facilities" ADD CONSTRAINT "facilities_port_org_fk" FOREIGN KEY ("port_id","organization_id") REFERENCES "public"."ports"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holiday_calendars" ADD CONSTRAINT "holiday_calendars_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_holiday_calendar_id_holiday_calendars_id_fk" FOREIGN KEY ("holiday_calendar_id") REFERENCES "public"."holiday_calendars"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_event_types" ADD CONSTRAINT "operational_event_types_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ports" ADD CONSTRAINT "ports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ports" ADD CONSTRAINT "ports_holiday_calendar_org_fk" FOREIGN KEY ("default_holiday_calendar_id","organization_id") REFERENCES "public"."holiday_calendars"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stoppage_reasons" ADD CONSTRAINT "stoppage_reasons_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vessels" ADD CONSTRAINT "vessels_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cargoes_org_idx" ON "cargoes" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cargoes_org_name_unique_idx" ON "cargoes" USING btree ("organization_id",lower(trim("name")));--> statement-breakpoint
CREATE INDEX "facilities_org_idx" ON "facilities" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "facilities_port_idx" ON "facilities" USING btree ("port_id");--> statement-breakpoint
CREATE UNIQUE INDEX "facilities_port_name_unique_idx" ON "facilities" USING btree ("port_id",lower(trim("name")));--> statement-breakpoint
CREATE UNIQUE INDEX "facilities_port_code_unique_idx" ON "facilities" USING btree ("port_id",lower(trim("code"))) WHERE "facilities"."code" is not null;--> statement-breakpoint
CREATE INDEX "holiday_calendars_org_idx" ON "holiday_calendars" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "holiday_calendars_org_name_unique_idx" ON "holiday_calendars" USING btree ("organization_id",lower(trim("name")));--> statement-breakpoint
CREATE INDEX "holidays_calendar_idx" ON "holidays" USING btree ("holiday_calendar_id");--> statement-breakpoint
CREATE UNIQUE INDEX "holidays_calendar_date_unique_idx" ON "holidays" USING btree ("holiday_calendar_id","date");--> statement-breakpoint
CREATE INDEX "operational_event_types_org_idx" ON "operational_event_types" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "operational_event_types_org_code_unique_idx" ON "operational_event_types" USING btree ("organization_id",lower(trim("code")));--> statement-breakpoint
CREATE UNIQUE INDEX "operational_event_types_org_semantic_unique_idx" ON "operational_event_types" USING btree ("organization_id","system_semantic") WHERE "operational_event_types"."system_semantic" is not null;--> statement-breakpoint
CREATE INDEX "ports_org_idx" ON "ports" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ports_org_name_unique_idx" ON "ports" USING btree ("organization_id",lower(trim("name")));--> statement-breakpoint
CREATE UNIQUE INDEX "ports_org_unlocode_unique_idx" ON "ports" USING btree ("organization_id",lower(trim("unlocode"))) WHERE "ports"."unlocode" is not null;--> statement-breakpoint
CREATE INDEX "stoppage_reasons_org_idx" ON "stoppage_reasons" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stoppage_reasons_org_name_unique_idx" ON "stoppage_reasons" USING btree ("organization_id",lower(trim("name")));--> statement-breakpoint
CREATE INDEX "vessels_org_idx" ON "vessels" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "vessels_org_name_idx" ON "vessels" USING btree ("organization_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "vessels_org_imo_unique_idx" ON "vessels" USING btree ("organization_id",lower(trim("imo"))) WHERE "vessels"."imo" is not null;