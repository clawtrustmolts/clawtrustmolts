import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, real, pgEnum, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const gigStatusEnum = pgEnum("gig_status", ["open", "assigned", "in_progress", "pending_validation", "completed", "disputed"]);
export const currencyEnum = pgEnum("currency", ["ETH", "USDC"]);
export const validationStatusEnum = pgEnum("validation_status", ["pending", "approved", "rejected"]);
export const voteEnum = pgEnum("vote_type", ["approve", "reject"]);
export const repSourceEnum = pgEnum("rep_source", ["on_chain", "moltbook", "swarm", "escrow"]);
export const escrowStatusEnum = pgEnum("escrow_status", ["pending", "locked", "released", "refunded", "disputed"]);

export const agents = pgTable("agents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  handle: text("handle").notNull().unique(),
  walletAddress: text("wallet_address").notNull(),
  avatar: text("avatar"),
  skills: text("skills").array().notNull().default(sql`'{}'::text[]`),
  bio: text("bio"),
  metadataUri: text("metadata_uri"),
  erc8004TokenId: text("erc8004_token_id"),
  moltbookLink: text("moltbook_link"),
  moltbookKarma: integer("moltbook_karma").notNull().default(0),
  onChainScore: integer("on_chain_score").notNull().default(0),
  fusedScore: real("fused_score").notNull().default(0),
  totalGigsCompleted: integer("total_gigs_completed").notNull().default(0),
  totalEarned: real("total_earned").notNull().default(0),
  isVerified: boolean("is_verified").notNull().default(false),
  registeredAt: timestamp("registered_at").defaultNow(),
});

export const gigs = pgTable("gigs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description").notNull(),
  skillsRequired: text("skills_required").array().notNull().default(sql`'{}'::text[]`),
  budget: real("budget").notNull(),
  currency: currencyEnum("currency").notNull().default("USDC"),
  status: gigStatusEnum("status").notNull().default("open"),
  posterId: varchar("poster_id").notNull(),
  assigneeId: varchar("assignee_id"),
  escrowTxHash: text("escrow_tx_hash"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const reputationEvents = pgTable("reputation_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  agentId: varchar("agent_id").notNull(),
  eventType: text("event_type").notNull(),
  scoreChange: integer("score_change").notNull(),
  source: repSourceEnum("source").notNull(),
  details: text("details"),
  proofUri: text("proof_uri"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const escrowTransactions = pgTable("escrow_transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gigId: varchar("gig_id").notNull(),
  depositorId: varchar("depositor_id").notNull(),
  amount: real("amount").notNull(),
  currency: currencyEnum("currency").notNull().default("USDC"),
  status: escrowStatusEnum("status").notNull().default("pending"),
  txHash: text("tx_hash"),
  releaseTxHash: text("release_tx_hash"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const swarmValidations = pgTable("swarm_validations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gigId: varchar("gig_id").notNull(),
  status: validationStatusEnum("status").notNull().default("pending"),
  votesFor: integer("votes_for").notNull().default(0),
  votesAgainst: integer("votes_against").notNull().default(0),
  threshold: integer("threshold").notNull().default(3),
  selectedValidators: text("selected_validators").array().notNull().default(sql`'{}'::text[]`),
  totalRewardPool: real("total_reward_pool").notNull().default(0),
  rewardPerValidator: real("reward_per_validator").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const swarmVotes = pgTable("swarm_votes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  validationId: varchar("validation_id").notNull(),
  voterId: varchar("voter_id").notNull(),
  vote: voteEnum("vote").notNull(),
  rewardAmount: real("reward_amount").notNull().default(0),
  rewardClaimed: boolean("reward_claimed").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const securityLogs = pgTable("security_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  eventType: text("event_type").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  endpoint: text("endpoint"),
  details: text("details"),
  severity: text("severity").notNull().default("info"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSecurityLogSchema = createInsertSchema(securityLogs).omit({ id: true, createdAt: true });
export type InsertSecurityLog = z.infer<typeof insertSecurityLogSchema>;
export type SecurityLog = typeof securityLogs.$inferSelect;

export const insertAgentSchema = createInsertSchema(agents).omit({ id: true, registeredAt: true, fusedScore: true, totalGigsCompleted: true, totalEarned: true, isVerified: true });
export const insertGigSchema = createInsertSchema(gigs).omit({ id: true, createdAt: true, assigneeId: true, escrowTxHash: true });
export const insertReputationEventSchema = createInsertSchema(reputationEvents).omit({ id: true, createdAt: true });
export const insertSwarmValidationSchema = createInsertSchema(swarmValidations).omit({ id: true, createdAt: true, votesFor: true, votesAgainst: true });
export const insertSwarmVoteSchema = createInsertSchema(swarmVotes).omit({ id: true, createdAt: true, rewardClaimed: true });
export const insertEscrowSchema = createInsertSchema(escrowTransactions).omit({ id: true, createdAt: true, updatedAt: true, txHash: true, releaseTxHash: true });

export const registerAgentSchema = z.object({
  handle: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/, "Handle must be alphanumeric with dashes/underscores"),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid Ethereum address"),
  skills: z.array(z.string()).min(1, "At least one skill required"),
  bio: z.string().max(500).optional(),
  avatar: z.string().url().optional().nullable(),
  metadataUri: z.string().url().optional().nullable(),
  moltbookLink: z.string().url().optional().nullable(),
});

export const moltSyncSchema = z.object({
  agentId: z.string().uuid().optional(),
  handle: z.string().min(1).max(100).optional(),
  postUrl: z.string().url("Must be a valid URL").max(500).optional(),
  karmaBoost: z.number().int().min(1).max(1000).optional(),
  suggestGig: z.boolean().optional(),
  fetchLive: z.boolean().optional(),
}).refine(
  (data) => data.agentId || data.handle,
  { message: "Either agentId or handle must be provided" }
);

export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agents.$inferSelect;
export type InsertGig = z.infer<typeof insertGigSchema>;
export type Gig = typeof gigs.$inferSelect;
export type InsertReputationEvent = z.infer<typeof insertReputationEventSchema>;
export type ReputationEvent = typeof reputationEvents.$inferSelect;
export type InsertSwarmValidation = z.infer<typeof insertSwarmValidationSchema>;
export type SwarmValidation = typeof swarmValidations.$inferSelect;
export type InsertSwarmVote = z.infer<typeof insertSwarmVoteSchema>;
export type SwarmVote = typeof swarmVotes.$inferSelect;
export type InsertEscrow = z.infer<typeof insertEscrowSchema>;
export type EscrowTransaction = typeof escrowTransactions.$inferSelect;
export type RegisterAgent = z.infer<typeof registerAgentSchema>;
export type MoltSync = z.infer<typeof moltSyncSchema>;
