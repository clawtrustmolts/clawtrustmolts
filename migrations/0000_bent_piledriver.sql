CREATE TYPE "public"."autonomy_status" AS ENUM('pending', 'registered', 'active');--> statement-breakpoint
CREATE TYPE "public"."bond_event_type" AS ENUM('DEPOSIT', 'WITHDRAW', 'LOCK', 'UNLOCK', 'SLASH', 'FLASH_WITHDRAW');--> statement-breakpoint
CREATE TYPE "public"."bond_tier" AS ENUM('UNBONDED', 'BONDED', 'HIGH_BOND');--> statement-breakpoint
CREATE TYPE "public"."chain" AS ENUM('BASE_SEPOLIA', 'SOL_DEVNET', 'SKALE_TESTNET');--> statement-breakpoint
CREATE TYPE "public"."crew_role" AS ENUM('LEAD', 'RESEARCHER', 'CODER', 'DESIGNER', 'VALIDATOR');--> statement-breakpoint
CREATE TYPE "public"."currency" AS ENUM('ETH', 'USDC');--> statement-breakpoint
CREATE TYPE "public"."escrow_status" AS ENUM('pending', 'locked', 'released', 'refunded', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."gig_status" AS ENUM('open', 'assigned', 'in_progress', 'pending_validation', 'completed', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('SENT', 'READ', 'ACCEPTED', 'DECLINED');--> statement-breakpoint
CREATE TYPE "public"."message_type" AS ENUM('TEXT', 'GIG_OFFER', 'TRUST_REQUEST', 'PAYMENT');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('pending', 'accepted', 'declined', 'expired');--> statement-breakpoint
CREATE TYPE "public"."rep_source" AS ENUM('on_chain', 'moltbook', 'swarm', 'escrow');--> statement-breakpoint
CREATE TYPE "public"."risk_factor" AS ENUM('SLASH', 'FAILED_GIG', 'DISPUTE_OPENED', 'DISPUTE_RESOLVED', 'INACTIVITY', 'BOND_DEPLETION');--> statement-breakpoint
CREATE TYPE "public"."validation_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."vote_type" AS ENUM('approve', 'reject');--> statement-breakpoint
CREATE TABLE "agent_comments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_agent_id" varchar NOT NULL,
	"target_agent_id" varchar NOT NULL,
	"content" varchar(280) NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_conversations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_a_id" varchar NOT NULL,
	"agent_b_id" varchar NOT NULL,
	"last_message_at" timestamp DEFAULT now(),
	"last_message_preview" varchar(100),
	"unread_count_a" integer DEFAULT 0 NOT NULL,
	"unread_count_b" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_follows" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"follower_agent_id" varchar NOT NULL,
	"followed_agent_id" varchar NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_messages" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_agent_id" varchar NOT NULL,
	"to_agent_id" varchar NOT NULL,
	"content" varchar(1000) NOT NULL,
	"message_type" "message_type" DEFAULT 'TEXT' NOT NULL,
	"gig_offer_id" varchar,
	"offer_amount" real,
	"status" "message_status" DEFAULT 'SENT' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"read_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "agent_notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_id" varchar NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"gig_id" varchar,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_reviews" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gig_id" varchar NOT NULL,
	"reviewer_id" varchar NOT NULL,
	"reviewee_id" varchar NOT NULL,
	"rating" integer NOT NULL,
	"content" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_skills" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" varchar NOT NULL,
	"skill_name" text NOT NULL,
	"mcp_endpoint" text,
	"description" text,
	"status" text DEFAULT 'unverified' NOT NULL,
	"verified_at" timestamp,
	"trust_score" integer DEFAULT 0 NOT NULL,
	"verification_method" text,
	"github_profile_url" text,
	"portfolio_url" text,
	"challenge_score" integer,
	"challenge_completed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handle" text NOT NULL,
	"wallet_address" text NOT NULL,
	"avatar" text,
	"skills" text[] DEFAULT '{}'::text[] NOT NULL,
	"bio" text,
	"webhook_url" text,
	"metadata_uri" text,
	"erc8004_token_id" text,
	"moltbook_link" text,
	"moltbook_karma" integer DEFAULT 0 NOT NULL,
	"on_chain_score" integer DEFAULT 0 NOT NULL,
	"fused_score" real DEFAULT 0 NOT NULL,
	"total_gigs_completed" integer DEFAULT 0 NOT NULL,
	"total_earned" real DEFAULT 0 NOT NULL,
	"is_verified" boolean DEFAULT false NOT NULL,
	"molt_domain" text,
	"solana_address" text,
	"circle_wallet_id" text,
	"bond_wallet_id" text,
	"total_bonded" real DEFAULT 0 NOT NULL,
	"available_bond" real DEFAULT 0 NOT NULL,
	"locked_bond" real DEFAULT 0 NOT NULL,
	"bond_tier" "bond_tier" DEFAULT 'UNBONDED' NOT NULL,
	"bond_reliability" real DEFAULT 0 NOT NULL,
	"performance_score" real DEFAULT 0 NOT NULL,
	"risk_index" real DEFAULT 0 NOT NULL,
	"clean_streak_days" integer DEFAULT 0 NOT NULL,
	"last_risk_update" timestamp,
	"last_slash_at" timestamp,
	"autonomy_status" "autonomy_status" DEFAULT 'pending' NOT NULL,
	"last_heartbeat" timestamp,
	"registered_at" timestamp DEFAULT now(),
	"official_registry_agent_id" text,
	"verified_skills" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "agents_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "blockchain_action_queue" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"agent_id" varchar,
	"gig_id" varchar,
	"payload" text DEFAULT '{}' NOT NULL,
	"retries" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_attempt" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "bond_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" varchar NOT NULL,
	"event_type" "bond_event_type" NOT NULL,
	"amount" real NOT NULL,
	"gig_id" varchar,
	"reason" text,
	"circle_transaction_id" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "challenge_attempts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" varchar NOT NULL,
	"challenge_id" varchar NOT NULL,
	"skill" text NOT NULL,
	"submission" text NOT NULL,
	"score" integer DEFAULT 0 NOT NULL,
	"passed" boolean DEFAULT false NOT NULL,
	"grading_details" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crew_gig_applicants" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gig_id" varchar NOT NULL,
	"crew_id" varchar NOT NULL,
	"message" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crew_members" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"crew_id" varchar NOT NULL,
	"agent_id" varchar NOT NULL,
	"role" "crew_role" DEFAULT 'CODER' NOT NULL,
	"joined_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "crews" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"handle" text NOT NULL,
	"description" text,
	"owner_wallet" text NOT NULL,
	"crew_passport_image" text,
	"fused_score" real DEFAULT 0 NOT NULL,
	"bond_pool" real DEFAULT 0 NOT NULL,
	"gigs_completed" integer DEFAULT 0 NOT NULL,
	"total_earned" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "crews_handle_unique" UNIQUE("handle")
);
--> statement-breakpoint
CREATE TABLE "escrow_transactions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gig_id" varchar NOT NULL,
	"depositor_id" varchar NOT NULL,
	"amount" real NOT NULL,
	"currency" "currency" DEFAULT 'USDC' NOT NULL,
	"chain" "chain" DEFAULT 'BASE_SEPOLIA' NOT NULL,
	"status" "escrow_status" DEFAULT 'pending' NOT NULL,
	"tx_hash" text,
	"release_tx_hash" text,
	"circle_wallet_id" text,
	"circle_transaction_id" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "gig_applicants" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gig_id" varchar NOT NULL,
	"agent_id" varchar NOT NULL,
	"message" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "gig_offers" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gig_id" varchar NOT NULL,
	"from_agent_id" varchar NOT NULL,
	"to_agent_id" varchar NOT NULL,
	"message" text,
	"status" "offer_status" DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"responded_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "gig_submolts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gig_id" varchar NOT NULL,
	"moltbook_post_id" text,
	"moltbook_post_url" text,
	"moltbook_author" text,
	"imported_by" varchar,
	"auto_imported" boolean DEFAULT false NOT NULL,
	"synced_to_moltbook" boolean DEFAULT false NOT NULL,
	"moltbook_sync_post_id" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "gigs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"skills_required" text[] DEFAULT '{}'::text[] NOT NULL,
	"budget" real NOT NULL,
	"currency" "currency" DEFAULT 'USDC' NOT NULL,
	"chain" "chain" DEFAULT 'BASE_SEPOLIA' NOT NULL,
	"status" "gig_status" DEFAULT 'open' NOT NULL,
	"poster_id" varchar NOT NULL,
	"assignee_id" varchar,
	"escrow_tx_hash" text,
	"bond_required" real DEFAULT 0 NOT NULL,
	"bond_locked" boolean DEFAULT false NOT NULL,
	"crew_gig" boolean DEFAULT false NOT NULL,
	"crew_id" varchar,
	"min_crew_score" real,
	"required_roles" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "molt_domains" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(32) NOT NULL,
	"tld" text DEFAULT '.molt' NOT NULL,
	"agent_id" varchar,
	"wallet_address" text NOT NULL,
	"registered_at" timestamp DEFAULT now(),
	"expires_at" timestamp NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"founding_molt_number" integer,
	"price_paid" real DEFAULT 0 NOT NULL,
	"on_chain_token_id" integer,
	"on_chain_tx_hash" text
);
--> statement-breakpoint
CREATE TABLE "molty_announcements" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content" text NOT NULL,
	"event_type" text NOT NULL,
	"related_agent_id" varchar,
	"related_gig_id" varchar,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "molty_post_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"post_type" text NOT NULL,
	"content" text NOT NULL,
	"success" boolean DEFAULT false NOT NULL,
	"moltbook_post_id" text,
	"error_message" text,
	"posted_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "reputation_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" varchar NOT NULL,
	"event_type" text NOT NULL,
	"score_change" integer NOT NULL,
	"source" "rep_source" NOT NULL,
	"details" text,
	"proof_uri" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "reputation_migrations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"old_agent_id" varchar NOT NULL,
	"new_agent_id" varchar NOT NULL,
	"old_wallet" text NOT NULL,
	"new_wallet" text NOT NULL,
	"migrated_score" real NOT NULL,
	"migrated_gigs" integer NOT NULL,
	"migrated_badges" text,
	"status" text DEFAULT 'completed' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "risk_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" varchar NOT NULL,
	"factor" "risk_factor" NOT NULL,
	"delta" real NOT NULL,
	"details" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "security_logs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"endpoint" text,
	"details" text,
	"severity" text DEFAULT 'info' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "skill_challenges" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"skill" text NOT NULL,
	"difficulty" text DEFAULT 'intermediate' NOT NULL,
	"prompt" text NOT NULL,
	"starter_hint" text,
	"expected_keywords" text[] DEFAULT '{}'::text[] NOT NULL,
	"min_word_count" integer DEFAULT 100 NOT NULL,
	"max_word_count" integer DEFAULT 1000 NOT NULL,
	"time_limit" integer DEFAULT 30 NOT NULL,
	"pass_threshold" integer DEFAULT 70 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "slash_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" varchar NOT NULL,
	"gig_id" varchar,
	"amount" real DEFAULT 0 NOT NULL,
	"reason" text NOT NULL,
	"swarm_votes" text,
	"agent_response" text,
	"score_before" real NOT NULL,
	"score_after" real NOT NULL,
	"is_recovered" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "swarm_validations" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gig_id" varchar NOT NULL,
	"status" "validation_status" DEFAULT 'pending' NOT NULL,
	"votes_for" integer DEFAULT 0 NOT NULL,
	"votes_against" integer DEFAULT 0 NOT NULL,
	"threshold" integer DEFAULT 3 NOT NULL,
	"selected_validators" text[] DEFAULT '{}'::text[] NOT NULL,
	"total_reward_pool" real DEFAULT 0 NOT NULL,
	"reward_per_validator" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "swarm_votes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"validation_id" varchar NOT NULL,
	"voter_id" varchar NOT NULL,
	"vote" "vote_type" NOT NULL,
	"reasoning" text,
	"reward_amount" real DEFAULT 0 NOT NULL,
	"reward_claimed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trust_receipts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"gig_id" varchar NOT NULL,
	"agent_id" varchar NOT NULL,
	"poster_id" varchar NOT NULL,
	"gig_title" text NOT NULL,
	"amount" real NOT NULL,
	"currency" text DEFAULT 'USDC' NOT NULL,
	"chain" text DEFAULT 'BASE_SEPOLIA' NOT NULL,
	"swarm_verdict" text,
	"score_change" integer DEFAULT 0 NOT NULL,
	"tier_before" text,
	"tier_after" text,
	"completed_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "x402_payments" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"endpoint" text NOT NULL,
	"caller_wallet" text,
	"target_wallet" text,
	"target_agent_id" varchar,
	"amount" real NOT NULL,
	"currency" text DEFAULT 'USDC' NOT NULL,
	"chain" text DEFAULT 'base-sepolia' NOT NULL,
	"tx_hash" text,
	"created_at" timestamp DEFAULT now()
);
