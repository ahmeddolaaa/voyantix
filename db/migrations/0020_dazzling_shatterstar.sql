ALTER TABLE "operational_event_types" DROP CONSTRAINT "operational_event_types_semantic_vocabulary_check";--> statement-breakpoint
ALTER TABLE "contract_laytime_terms" ADD COLUMN "laytime_end_event" text DEFAULT 'OPS_COMPLETED' NOT NULL;--> statement-breakpoint
ALTER TABLE "voyage_port_calls" ADD COLUMN "laytime_end_override" text;--> statement-breakpoint
ALTER TABLE "operational_event_types" ADD CONSTRAINT "operational_event_types_semantic_vocabulary_check" CHECK (system_semantic is null or system_semantic in (
        'NOR_TENDERED','NOR_ACCEPTED','BERTHED','OPS_COMMENCED',
        'OPS_COMPLETED','LASHING_COMPLETED','DOCUMENTS_ON_BOARD',
        'DEPARTED','WEATHER_START','WEATHER_END'
      ));--> statement-breakpoint
ALTER TABLE "contract_laytime_terms" ADD CONSTRAINT "contract_laytime_terms_laytime_end_event_check" CHECK ("laytime_end_event" IN ('OPS_COMPLETED', 'LASHING_COMPLETED', 'DOCUMENTS_ON_BOARD'));--> statement-breakpoint
ALTER TABLE "voyage_port_calls" ADD CONSTRAINT "voyage_port_calls_laytime_end_override_check" CHECK ("laytime_end_override" IS NULL OR "laytime_end_override" IN ('OPS_COMPLETED', 'LASHING_COMPLETED', 'DOCUMENTS_ON_BOARD'));--> statement-breakpoint
-- Every existing organization gets the two new protected event types (the
-- engine needs them to exist for any org). Skipped where the org already has
-- the semantic or a type with the same code.
INSERT INTO "operational_event_types" ("organization_id", "code", "label", "system_semantic", "is_protected", "display_order", "status")
SELECT o.id, v.code, v.label, v.semantic, true, v.display_order, 'active'
FROM "organizations" o
CROSS JOIN (VALUES
  ('lashing_completed', 'Lashing Completed', 'LASHING_COMPLETED', 52),
  ('documents_on_board', 'Documents on Board', 'DOCUMENTS_ON_BOARD', 54)
) AS v(code, label, semantic, display_order)
WHERE NOT EXISTS (
  SELECT 1 FROM "operational_event_types" t
  WHERE t.organization_id = o.id
    AND (t.system_semantic = v.semantic OR lower(trim(t.code)) = v.code)
);
