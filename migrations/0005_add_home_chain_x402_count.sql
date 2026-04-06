ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "home_chain" "chain" DEFAULT 'BASE_SEPOLIA' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN IF NOT EXISTS "x402_payment_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE "agents" SET "home_chain" = preferred_chain WHERE preferred_chain IS NOT NULL AND "home_chain" = 'BASE_SEPOLIA';
