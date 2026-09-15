-- Phase 5 prerequisites, hoisted above the generated statements.
-- btree_gist supplies the '=' operator class GiST needs for the uuid
-- component of stoppages_no_overlap; the range component needs no
-- extension. The stoppage_reasons composite unique must exist before
-- stoppages_reason_org_fk can reference it.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "stoppage_reasons" ADD CONSTRAINT "stoppage_reasons_id_org_unique" UNIQUE("id","organization_id");--> statement-breakpoint
ALTER TABLE "operational_event_types" ADD CONSTRAINT "operational_event_types_id_org_unique" UNIQUE("id","organization_id");--> statement-breakpoint
CREATE TABLE "operational_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"port_call_id" uuid NOT NULL,
	"event_type_id" uuid NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recorded_by_user_id" uuid NOT NULL,
	"superseded_by_event_id" uuid,
	CONSTRAINT "operational_events_id_org_unique" UNIQUE("id","organization_id"),
	CONSTRAINT "operational_events_no_self_supersede_check" CHECK (superseded_by_event_id is null or superseded_by_event_id <> id)
);
--> statement-breakpoint
CREATE TABLE "shift_performances" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"port_call_id" uuid NOT NULL,
	"facility_id" uuid,
	"cargo_id" uuid NOT NULL,
	"shift_date" date NOT NULL,
	"crane" text,
	"operation_type" text,
	"quantity_mt" numeric NOT NULL,
	"recorded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stoppages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"port_call_id" uuid NOT NULL,
	"reason_id" uuid NOT NULL,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone,
	"notes" text,
	"recorded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stoppages_end_after_start_check" CHECK (end_time is null or end_time > start_time)
);
--> statement-breakpoint
ALTER TABLE "operational_events" ADD CONSTRAINT "operational_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_events" ADD CONSTRAINT "operational_events_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_events" ADD CONSTRAINT "operational_events_port_call_org_fk" FOREIGN KEY ("port_call_id","organization_id") REFERENCES "public"."voyage_port_calls"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_events" ADD CONSTRAINT "operational_events_event_type_org_fk" FOREIGN KEY ("event_type_id","organization_id") REFERENCES "public"."operational_event_types"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operational_events" ADD CONSTRAINT "operational_events_superseded_by_org_fk" FOREIGN KEY ("superseded_by_event_id","organization_id") REFERENCES "public"."operational_events"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_performances" ADD CONSTRAINT "shift_performances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_performances" ADD CONSTRAINT "shift_performances_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_performances" ADD CONSTRAINT "shift_performances_port_call_org_fk" FOREIGN KEY ("port_call_id","organization_id") REFERENCES "public"."voyage_port_calls"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_performances" ADD CONSTRAINT "shift_performances_facility_org_fk" FOREIGN KEY ("facility_id","organization_id") REFERENCES "public"."facilities"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shift_performances" ADD CONSTRAINT "shift_performances_cargo_org_fk" FOREIGN KEY ("cargo_id","organization_id") REFERENCES "public"."cargoes"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stoppages" ADD CONSTRAINT "stoppages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stoppages" ADD CONSTRAINT "stoppages_recorded_by_user_id_users_id_fk" FOREIGN KEY ("recorded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stoppages" ADD CONSTRAINT "stoppages_port_call_org_fk" FOREIGN KEY ("port_call_id","organization_id") REFERENCES "public"."voyage_port_calls"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stoppages" ADD CONSTRAINT "stoppages_reason_org_fk" FOREIGN KEY ("reason_id","organization_id") REFERENCES "public"."stoppage_reasons"("id","organization_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "operational_events_org_idx" ON "operational_events" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "operational_events_port_call_idx" ON "operational_events" USING btree ("port_call_id");--> statement-breakpoint
CREATE INDEX "operational_events_port_call_occurred_idx" ON "operational_events" USING btree ("port_call_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "operational_events_superseded_by_unique_idx" ON "operational_events" USING btree ("superseded_by_event_id") WHERE "operational_events"."superseded_by_event_id" is not null;--> statement-breakpoint
CREATE INDEX "shift_performances_org_idx" ON "shift_performances" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "shift_performances_port_call_idx" ON "shift_performances" USING btree ("port_call_id");--> statement-breakpoint
CREATE INDEX "shift_performances_port_call_date_idx" ON "shift_performances" USING btree ("port_call_id","shift_date");--> statement-breakpoint
CREATE INDEX "stoppages_org_idx" ON "stoppages" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "stoppages_port_call_idx" ON "stoppages" USING btree ("port_call_id");--> statement-breakpoint
CREATE INDEX "stoppages_port_call_start_idx" ON "stoppages" USING btree ("port_call_id","start_time");--> statement-breakpoint
-- MIGRATION-MANAGED CONSTRAINT (not present in db/schema/operational.ts).
-- Enforces both frozen Stoppage rules at once: no overlapping stoppages
-- on one port call, and at most one open stoppage (two unbounded ranges
-- always overlap). '[)' keeps the historical half-open semantics, so
-- 10:00-11:00 and 11:00-12:00 remain legal neighbours.
ALTER TABLE "stoppages" ADD CONSTRAINT "stoppages_no_overlap"
  EXCLUDE USING gist (
    "port_call_id" WITH =,
    tstzrange("start_time", "end_time", '[)') WITH &&
  );
