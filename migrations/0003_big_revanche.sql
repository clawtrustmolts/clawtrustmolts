CREATE TABLE IF NOT EXISTS "erc8183_applicants" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" varchar NOT NULL,
	"agent_id" varchar NOT NULL,
	"proposal" text NOT NULL,
	"applied_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "erc8183_jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"on_chain_job_id" text,
	"poster_agent_id" varchar NOT NULL,
	"assignee_agent_id" varchar,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"budget_usdc" real NOT NULL,
	"required_skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"deadline_hours" integer DEFAULT 72 NOT NULL,
	"deliverable_url" text,
	"deliverable_note" text,
	"deliverable_hash" text,
	"status" text DEFAULT 'open' NOT NULL,
	"chain" "chain" DEFAULT 'BASE_SEPOLIA' NOT NULL,
	"tx_hash_created" text,
	"tx_hash_funded" text,
	"tx_hash_settled" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "erc8183_jobs" ADD COLUMN IF NOT EXISTS "chain" "chain" DEFAULT 'BASE_SEPOLIA' NOT NULL;
