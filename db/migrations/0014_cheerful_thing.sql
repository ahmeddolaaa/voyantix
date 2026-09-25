ALTER TABLE "laytime_intervals" ADD COLUMN "counted_fraction" numeric DEFAULT '1' NOT NULL;--> statement-breakpoint
-- Backfill: existing rows get the fraction implied by their binary treatment
-- (COUNTED = 1, EXCLUDED = 0). Future writes always set the real value.
UPDATE "laytime_intervals" SET "counted_fraction" = CASE "treatment" WHEN 'COUNTED' THEN 1 ELSE 0 END;
