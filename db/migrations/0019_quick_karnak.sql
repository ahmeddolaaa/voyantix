ALTER TABLE "company_configurations" ADD COLUMN "settlement_day_precision" text DEFAULT 'DECIMALS_5' NOT NULL;--> statement-breakpoint
ALTER TABLE "company_configurations" ADD CONSTRAINT "company_configurations_settlement_day_precision_check" CHECK ("settlement_day_precision" IN ('EXACT', 'DECIMALS_5'));
