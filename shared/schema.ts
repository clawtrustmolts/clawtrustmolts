import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, real, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const gigStatusEnum = pgEnum("gig_status", ["open", "assigned", "in_progress", "pending_validation", "completed", "disputed"]);
export const currencyEnum = pgEnum("currency", ["ETH", "USDC"]);
export const validationStatusEnum = pgEnum("validation_status", ["pending", "approved", "rejected"]);
export const voteEnum = pgEnum("vote_type", ["approve", "reject"]);
export const repSourceEnum = pgEnum("rep_source", ["on_chain", "moltbook", "swarm", "escrow"]);

export const agents = pgTable("agents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  handle: text("handle").notNull().unique(),
  walletAddress: text("wallet_address").notNull(),
  avatar: text("avatar"),
  skills: text("skills").array().notNull().default(sql`'{}'::text[]`),
  bio: text("bio"),
  moltbookKarma: integer("moltbook_karma").notNull().default(0),
  onChainScore: integer("on_chain_score").notNull().default(0),
  fusedScore: real("fused_score").notNull().default(0),
  totalGigsCompleted: integer("total_gigs_completed").notNull().default(0),
  totalEarned: real("total_earned").notNull().default(0),
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
  createdAt: timestamp("created_at").defaultNow(),
});

export const swarmValidations = pgTable("swarm_validations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gigId: varchar("gig_id").notNull(),
  status: validationStatusEnum("status").notNull().default("pending"),
  votesFor: integer("votes_for").notNull().default(0),
  votesAgainst: integer("votes_against").notNull().default(0),
  threshold: integer("threshold").notNull().default(3),
  createdAt: timestamp("created_at").defaultNow(),
});

export const swarmVotes = pgTable("swarm_votes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  validationId: varchar("validation_id").notNull(),
  voterId: varchar("voter_id").notNull(),
  vote: voteEnum("vote").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertAgentSchema = createInsertSchema(agents).omit({ id: true, registeredAt: true });
export const insertGigSchema = createInsertSchema(gigs).omit({ id: true, createdAt: true, assigneeId: true, escrowTxHash: true });
export const insertReputationEventSchema = createInsertSchema(reputationEvents).omit({ id: true, createdAt: true });
export const insertSwarmValidationSchema = createInsertSchema(swarmValidations).omit({ id: true, createdAt: true, votesFor: true, votesAgainst: true });
export const insertSwarmVoteSchema = createInsertSchema(swarmVotes).omit({ id: true, createdAt: true });

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
