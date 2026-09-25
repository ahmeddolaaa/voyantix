ALTER TABLE "contract_laytime_terms" ADD COLUMN "allowance_basis" text DEFAULT 'FIXED' NOT NULL;--> statement-breakpoint
ALTER TABLE "contract_laytime_terms" ADD COLUMN "allowance_rate" numeric;