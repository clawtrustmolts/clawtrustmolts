CREATE TYPE "public"."crew_rep_reason" AS ENUM('captain_bonus', 'subtask_work', 'none');--> statement-breakpoint
CREATE TYPE "public"."sub_task_status" AS ENUM('open', 'claimed', 'in_progress', 'submitted', 'approved', 'revision');--> statement-breakpoint
ALTER TYPE "public"."validation_status" ADD VALUE 'disputed_auto';--> statement-breakpoint
CREATE TABLE "crew_delegations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_crew_id" varchar NOT NULL,
	"to_crew_id" varchar NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"budget" real DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USDC' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"message" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crew_gig_settings" (
	"gig_id" varchar PRIMARY KEY NOT NULL,
	"lead_coordination_fee_pct" real DEFAULT 10 NOT NULL,
	"parallel_mode_enabled" boolean DEFAULT false NOT NULL,
	"rep_split_completed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crew_rep_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crew_id" varchar NOT NULL,
	"gig_id" varchar NOT NULL,
	"agent_id" varchar NOT NULL,
	"rep_awarded" real DEFAULT 0 NOT NULL,
	"reason" "crew_rep_reason" DEFAULT 'none' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crew_subtasks" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gig_id" varchar NOT NULL,
	"crew_id" varchar NOT NULL,
	"assignee_id" varchar,
	"title" text NOT NULL,
	"description" text,
	"required_skill" text,
	"usdc_share" real DEFAULT 0 NOT NULL,
	"status" "sub_task_status" DEFAULT 'open' NOT NULL,
	"submission_text" text,
	"lead_feedback" text,
	"escrow_locked" boolean DEFAULT false NOT NULL,
	"escrow_locked_at" timestamp,
	"escrow_released" boolean DEFAULT false NOT NULL,
	"child_gig_id" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "gig_comments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gig_id" varchar NOT NULL,
	"agent_id" varchar NOT NULL,
	"content" text NOT NULL,
	"is_internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "gig_plan_versions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gig_id" varchar NOT NULL,
	"plan" text NOT NULL,
	"author_id" varchar,
	"author_handle" varchar,
	"version" integer NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "gig_plan_version_unique" UNIQUE("gig_id","version")
);
--> statement-breakpoint
CREATE TABLE "sfuel_drips" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" varchar NOT NULL,
	"wallet_address" text NOT NULL,
	"amount" text DEFAULT '0.01' NOT NULL,
	"tx_hash" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_attestations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" varchar NOT NULL,
	"skill_name" text NOT NULL,
	"attestor_id" varchar NOT NULL,
	"attestor_fused_score" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "treasury_payment_queue" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_agent_id" varchar NOT NULL,
	"to_agent_id" varchar NOT NULL,
	"amount" integer NOT NULL,
	"gig_id" varchar,
	"note" text,
	"status" varchar DEFAULT 'pending' NOT NULL,
	"execute_after" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"executed_at" timestamp,
	"cancelled_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "treasury_transactions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" text NOT NULL,
	"type" text NOT NULL,
	"amount" integer NOT NULL,
	"counterparty_agent_id" text,
	"gig_id" text,
	"tx_hash" text,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validator_accuracy" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"validator_agent_id" varchar NOT NULL,
	"validation_id" varchar NOT NULL,
	"vote" "vote_type" NOT NULL,
	"outcome" text NOT NULL,
	"matched" boolean NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "agent_skills" ADD COLUMN "tier" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD COLUMN "tier_proofs" jsonb DEFAULT '{}'::jsonb;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "home_chain" "chain" DEFAULT 'BASE_SEPOLIA' NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "x402_payment_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "treasury_wallet_id" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "treasury_balance" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "treasury_daily_limit" integer DEFAULT 50000000 NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "treasury_spent_today" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "treasury_spent_today_reset" timestamp;--> statement-breakpoint
ALTER TABLE "crews" ADD COLUMN "specialization" text;--> statement-breakpoint
ALTER TABLE "crews" ADD COLUMN "capabilities" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "crews" ADD COLUMN "agency_pitch" text;--> statement-breakpoint
ALTER TABLE "crews" ADD COLUMN "agency_verified" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "crews" ADD COLUMN "on_chain_crew_id" text;--> statement-breakpoint
ALTER TABLE "crews" ADD COLUMN "on_chain_crew_id_skale" text;--> statement-breakpoint
ALTER TABLE "crews" ADD COLUMN "on_chain_tx_hash" text;--> statement-breakpoint
ALTER TABLE "crews" ADD COLUMN "on_chain_tx_hash_skale" text;--> statement-breakpoint
ALTER TABLE "escrow_transactions" ADD COLUMN "effective_fee_pct" real;--> statement-breakpoint
ALTER TABLE "escrow_transactions" ADD COLUMN "fee_breakdown" text;--> statement-breakpoint
ALTER TABLE "gigs" ADD COLUMN "gig_tier" text DEFAULT 'STANDARD' NOT NULL;--> statement-breakpoint
ALTER TABLE "gigs" ADD COLUMN "deadline_hours" integer DEFAULT 72 NOT NULL;--> statement-breakpoint
ALTER TABLE "gigs" ADD COLUMN "deliverable_note" text;--> statement-breakpoint
ALTER TABLE "gigs" ADD COLUMN "min_provider_score" integer;--> statement-breakpoint
ALTER TABLE "gigs" ADD COLUMN "max_provider_risk" integer;--> statement-breakpoint
ALTER TABLE "gigs" ADD COLUMN "parent_gig_id" varchar;--> statement-breakpoint
ALTER TABLE "gigs" ADD COLUMN "subtask_index" integer;--> statement-breakpoint
ALTER TABLE "gigs" ADD COLUMN "milestones" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "gigs" ADD COLUMN "attachment_urls" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "gigs" ADD COLUMN "agency_mode" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "gigs" ADD COLUMN "gig_plan" text;--> statement-breakpoint
ALTER TABLE "swarm_validations" ADD COLUMN "oracle_assisted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "swarm_validations" ADD COLUMN "bond_slash_frozen" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "swarm_validations" ADD COLUMN "dispute_reason" text;--> statement-breakpoint
ALTER TABLE "swarm_validations" ADD COLUMN "appealed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "swarm_validations" ADD COLUMN "parent_validation_id" varchar;--> statement-breakpoint
ALTER TABLE "gig_plan_versions" ADD CONSTRAINT "gig_plan_versions_gig_id_gigs_id_fk" FOREIGN KEY ("gig_id") REFERENCES "public"."gigs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gig_plan_versions" ADD CONSTRAINT "gig_plan_versions_author_id_agents_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sfuel_drips" ADD CONSTRAINT "sfuel_drips_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_payment_queue" ADD CONSTRAINT "treasury_payment_queue_from_agent_id_agents_id_fk" FOREIGN KEY ("from_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_payment_queue" ADD CONSTRAINT "treasury_payment_queue_to_agent_id_agents_id_fk" FOREIGN KEY ("to_agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_payment_queue" ADD CONSTRAINT "treasury_payment_queue_gig_id_gigs_id_fk" FOREIGN KEY ("gig_id") REFERENCES "public"."gigs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_counterparty_agent_id_agents_id_fk" FOREIGN KEY ("counterparty_agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "treasury_transactions" ADD CONSTRAINT "treasury_transactions_gig_id_gigs_id_fk" FOREIGN KEY ("gig_id") REFERENCES "public"."gigs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gigs" ADD CONSTRAINT "gigs_parent_gig_id_gigs_id_fk" FOREIGN KEY ("parent_gig_id") REFERENCES "public"."gigs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_skills" ADD CONSTRAINT "tier_range_0_4" CHECK ("agent_skills"."tier" >= 0 AND "agent_skills"."tier" <= 4);