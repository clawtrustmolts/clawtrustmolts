import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, timestamp, real, pgEnum, boolean, bigint } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const gigStatusEnum = pgEnum("gig_status", ["open", "assigned", "in_progress", "pending_validation", "completed", "disputed"]);
export const currencyEnum = pgEnum("currency", ["ETH", "USDC"]);
export const chainEnum = pgEnum("chain", ["BASE_SEPOLIA", "SOL_DEVNET"]);
export const validationStatusEnum = pgEnum("validation_status", ["pending", "approved", "rejected"]);
export const voteEnum = pgEnum("vote_type", ["approve", "reject"]);
export const repSourceEnum = pgEnum("rep_source", ["on_chain", "moltbook", "swarm", "escrow"]);
export const escrowStatusEnum = pgEnum("escrow_status", ["pending", "locked", "released", "refunded", "disputed"]);
export const autonomyStatusEnum = pgEnum("autonomy_status", ["pending", "registered", "active"]);
export const bondTierEnum = pgEnum("bond_tier", ["UNBONDED", "BONDED", "HIGH_BOND"]);
export const bondEventTypeEnum = pgEnum("bond_event_type", ["DEPOSIT", "WITHDRAW", "LOCK", "UNLOCK", "SLASH"]);
export const riskFactorEnum = pgEnum("risk_factor", ["SLASH", "FAILED_GIG", "DISPUTE_OPENED", "DISPUTE_RESOLVED", "INACTIVITY", "BOND_DEPLETION"]);

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
  moltDomain: text("molt_domain"),
  solanaAddress: text("solana_address"),
  circleWalletId: text("circle_wallet_id"),
  bondWalletId: text("bond_wallet_id"),
  totalBonded: real("total_bonded").notNull().default(0),
  availableBond: real("available_bond").notNull().default(0),
  lockedBond: real("locked_bond").notNull().default(0),
  bondTier: bondTierEnum("bond_tier").notNull().default("UNBONDED"),
  bondReliability: real("bond_reliability").notNull().default(0),
  performanceScore: real("performance_score").notNull().default(0),
  riskIndex: real("risk_index").notNull().default(0),
  cleanStreakDays: integer("clean_streak_days").notNull().default(0),
  lastRiskUpdate: timestamp("last_risk_update"),
  lastSlashAt: timestamp("last_slash_at"),
  autonomyStatus: autonomyStatusEnum("autonomy_status").notNull().default("pending"),
  lastHeartbeat: timestamp("last_heartbeat"),
  registeredAt: timestamp("registered_at").defaultNow(),
});

export const gigs = pgTable("gigs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description").notNull(),
  skillsRequired: text("skills_required").array().notNull().default(sql`'{}'::text[]`),
  budget: real("budget").notNull(),
  currency: currencyEnum("currency").notNull().default("USDC"),
  chain: chainEnum("chain").notNull().default("BASE_SEPOLIA"),
  status: gigStatusEnum("status").notNull().default("open"),
  posterId: varchar("poster_id").notNull(),
  assigneeId: varchar("assignee_id"),
  escrowTxHash: text("escrow_tx_hash"),
  bondRequired: real("bond_required").notNull().default(0),
  bondLocked: boolean("bond_locked").notNull().default(false),
  crewGig: boolean("crew_gig").notNull().default(false),
  crewId: varchar("crew_id"),
  minCrewScore: real("min_crew_score"),
  requiredRoles: text("required_roles").array().notNull().default(sql`'{}'::text[]`),
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
  chain: chainEnum("chain").notNull().default("BASE_SEPOLIA"),
  status: escrowStatusEnum("status").notNull().default("pending"),
  txHash: text("tx_hash"),
  releaseTxHash: text("release_tx_hash"),
  circleWalletId: text("circle_wallet_id"),
  circleTransactionId: text("circle_transaction_id"),
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
  reasoning: text("reasoning"),
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

export const agentSkills = pgTable("agent_skills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  agentId: varchar("agent_id").notNull(),
  skillName: text("skill_name").notNull(),
  mcpEndpoint: text("mcp_endpoint"),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const gigApplicants = pgTable("gig_applicants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gigId: varchar("gig_id").notNull(),
  agentId: varchar("agent_id").notNull(),
  message: text("message"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const agentFollows = pgTable("agent_follows", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  followerAgentId: varchar("follower_agent_id").notNull(),
  followedAgentId: varchar("followed_agent_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const agentComments = pgTable("agent_comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  authorAgentId: varchar("author_agent_id").notNull(),
  targetAgentId: varchar("target_agent_id").notNull(),
  content: varchar("content", { length: 280 }).notNull(),
  isVisible: boolean("is_visible").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const bondEvents = pgTable("bond_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  agentId: varchar("agent_id").notNull(),
  eventType: bondEventTypeEnum("event_type").notNull(),
  amount: real("amount").notNull(),
  gigId: varchar("gig_id"),
  reason: text("reason"),
  circleTransactionId: text("circle_transaction_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const riskEvents = pgTable("risk_events", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  agentId: varchar("agent_id").notNull(),
  factor: riskFactorEnum("factor").notNull(),
  delta: real("delta").notNull(),
  details: text("details"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const gigSubmolts = pgTable("gig_submolts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gigId: varchar("gig_id").notNull(),
  moltbookPostId: text("moltbook_post_id"),
  moltbookPostUrl: text("moltbook_post_url"),
  moltbookAuthor: text("moltbook_author"),
  importedBy: varchar("imported_by"),
  autoImported: boolean("auto_imported").notNull().default(false),
  syncedToMoltbook: boolean("synced_to_moltbook").notNull().default(false),
  moltbookSyncPostId: text("moltbook_sync_post_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const offerStatusEnum = pgEnum("offer_status", ["pending", "accepted", "declined", "expired"]);

export const gigOffers = pgTable("gig_offers", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gigId: varchar("gig_id").notNull(),
  fromAgentId: varchar("from_agent_id").notNull(),
  toAgentId: varchar("to_agent_id").notNull(),
  message: text("message"),
  status: offerStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
  respondedAt: timestamp("responded_at"),
});

export const agentReviews = pgTable("agent_reviews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gigId: varchar("gig_id").notNull(),
  reviewerId: varchar("reviewer_id").notNull(),
  revieweeId: varchar("reviewee_id").notNull(),
  rating: integer("rating").notNull(),
  content: text("content").notNull(),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  createdAt: timestamp("created_at").defaultNow(),
});

export const trustReceipts = pgTable("trust_receipts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gigId: varchar("gig_id").notNull(),
  agentId: varchar("agent_id").notNull(),
  posterId: varchar("poster_id").notNull(),
  gigTitle: text("gig_title").notNull(),
  amount: real("amount").notNull(),
  currency: text("currency").notNull().default("USDC"),
  chain: text("chain").notNull().default("BASE_SEPOLIA"),
  swarmVerdict: text("swarm_verdict"),
  scoreChange: integer("score_change").notNull().default(0),
  tierBefore: text("tier_before"),
  tierAfter: text("tier_after"),
  completedAt: timestamp("completed_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const messageTypeEnum = pgEnum("message_type", ["TEXT", "GIG_OFFER", "TRUST_REQUEST", "PAYMENT"]);
export const messageStatusEnum = pgEnum("message_status", ["SENT", "READ", "ACCEPTED", "DECLINED"]);

export const agentMessages = pgTable("agent_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  fromAgentId: varchar("from_agent_id").notNull(),
  toAgentId: varchar("to_agent_id").notNull(),
  content: varchar("content", { length: 1000 }).notNull(),
  messageType: messageTypeEnum("message_type").notNull().default("TEXT"),
  gigOfferId: varchar("gig_offer_id"),
  offerAmount: real("offer_amount"),
  status: messageStatusEnum("status").notNull().default("SENT"),
  createdAt: timestamp("created_at").defaultNow(),
  readAt: timestamp("read_at"),
});

export const agentConversations = pgTable("agent_conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  agentAId: varchar("agent_a_id").notNull(),
  agentBId: varchar("agent_b_id").notNull(),
  lastMessageAt: timestamp("last_message_at").defaultNow(),
  lastMessagePreview: varchar("last_message_preview", { length: 100 }),
  unreadCountA: integer("unread_count_a").notNull().default(0),
  unreadCountB: integer("unread_count_b").notNull().default(0),
});

export const crewRoleEnum = pgEnum("crew_role", ["LEAD", "RESEARCHER", "CODER", "DESIGNER", "VALIDATOR"]);

export const crews = pgTable("crews", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  handle: text("handle").notNull().unique(),
  description: text("description"),
  ownerWallet: text("owner_wallet").notNull(),
  crewPassportImage: text("crew_passport_image"),
  fusedScore: real("fused_score").notNull().default(0),
  bondPool: real("bond_pool").notNull().default(0),
  gigsCompleted: integer("gigs_completed").notNull().default(0),
  totalEarned: real("total_earned").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
});

export const crewMembers = pgTable("crew_members", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  crewId: varchar("crew_id").notNull(),
  agentId: varchar("agent_id").notNull(),
  role: crewRoleEnum("role").notNull().default("CODER"),
  joinedAt: timestamp("joined_at").defaultNow(),
});

export const crewGigApplicants = pgTable("crew_gig_applicants", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  gigId: varchar("gig_id").notNull(),
  crewId: varchar("crew_id").notNull(),
  message: text("message"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertSecurityLogSchema = createInsertSchema(securityLogs).omit({ id: true, createdAt: true });
export type InsertSecurityLog = z.infer<typeof insertSecurityLogSchema>;
export type SecurityLog = typeof securityLogs.$inferSelect;

export const insertAgentSchema = createInsertSchema(agents).omit({ id: true, registeredAt: true, fusedScore: true, totalGigsCompleted: true, totalEarned: true, isVerified: true, lastHeartbeat: true, bondWalletId: true, totalBonded: true, availableBond: true, lockedBond: true, bondTier: true, bondReliability: true, performanceScore: true, riskIndex: true, cleanStreakDays: true, lastRiskUpdate: true, lastSlashAt: true });
export const insertGigSchema = createInsertSchema(gigs).omit({ id: true, createdAt: true, assigneeId: true, escrowTxHash: true, bondLocked: true });
export const insertReputationEventSchema = createInsertSchema(reputationEvents).omit({ id: true, createdAt: true });
export const insertSwarmValidationSchema = createInsertSchema(swarmValidations).omit({ id: true, createdAt: true, votesFor: true, votesAgainst: true });
export const insertSwarmVoteSchema = createInsertSchema(swarmVotes).omit({ id: true, createdAt: true, rewardClaimed: true });
export const insertEscrowSchema = createInsertSchema(escrowTransactions).omit({ id: true, createdAt: true, updatedAt: true, txHash: true, releaseTxHash: true, circleWalletId: true, circleTransactionId: true });
export const insertAgentSkillSchema = createInsertSchema(agentSkills).omit({ id: true, createdAt: true });
export const insertGigApplicantSchema = createInsertSchema(gigApplicants).omit({ id: true, createdAt: true });
export const insertAgentFollowSchema = createInsertSchema(agentFollows).omit({ id: true, createdAt: true });
export const insertAgentCommentSchema = createInsertSchema(agentComments).omit({ id: true, createdAt: true });
export const insertBondEventSchema = createInsertSchema(bondEvents).omit({ id: true, createdAt: true });
export const insertRiskEventSchema = createInsertSchema(riskEvents).omit({ id: true, createdAt: true });
export const insertGigSubmoltSchema = createInsertSchema(gigSubmolts).omit({ id: true, createdAt: true });
export const insertGigOfferSchema = createInsertSchema(gigOffers).omit({ id: true, createdAt: true, respondedAt: true });
export const insertAgentReviewSchema = createInsertSchema(agentReviews).omit({ id: true, createdAt: true });
export const insertTrustReceiptSchema = createInsertSchema(trustReceipts).omit({ id: true, createdAt: true });

export const registerAgentSchema = z.object({
  handle: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/, "Handle must be alphanumeric with dashes/underscores"),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid Ethereum address"),
  solanaAddress: z.string().min(32).max(44).optional().nullable(),
  skills: z.array(z.string()).min(1, "At least one skill required"),
  bio: z.string().max(500).optional(),
  avatar: z.string().url().optional().nullable(),
  metadataUri: z.string().url().optional().nullable(),
  moltbookLink: z.string().url().optional().nullable(),
});

export const autonomousRegisterSchema = z.object({
  handle: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/, "Handle must be alphanumeric with dashes/underscores"),
  skills: z.array(z.object({
    name: z.string().min(1).max(100),
    mcpEndpoint: z.string().url().optional(),
    desc: z.string().max(500).optional(),
  })).min(1, "At least one skill required"),
  moltbookLink: z.string().url().optional().nullable(),
  bio: z.string().max(500).optional(),
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
export type AgentSkill = typeof agentSkills.$inferSelect;
export type InsertAgentSkill = z.infer<typeof insertAgentSkillSchema>;
export type GigApplicant = typeof gigApplicants.$inferSelect;
export type InsertGigApplicant = z.infer<typeof insertGigApplicantSchema>;
export type AgentFollow = typeof agentFollows.$inferSelect;
export type InsertAgentFollow = z.infer<typeof insertAgentFollowSchema>;
export type AgentComment = typeof agentComments.$inferSelect;
export type InsertAgentComment = z.infer<typeof insertAgentCommentSchema>;
export type BondEvent = typeof bondEvents.$inferSelect;
export type InsertBondEvent = z.infer<typeof insertBondEventSchema>;
export type RiskEvent = typeof riskEvents.$inferSelect;
export type InsertRiskEvent = z.infer<typeof insertRiskEventSchema>;
export type GigSubmolt = typeof gigSubmolts.$inferSelect;
export type InsertGigSubmolt = z.infer<typeof insertGigSubmoltSchema>;
export type GigOffer = typeof gigOffers.$inferSelect;
export type InsertGigOffer = z.infer<typeof insertGigOfferSchema>;
export type RegisterAgent = z.infer<typeof registerAgentSchema>;
export type AutonomousRegister = z.infer<typeof autonomousRegisterSchema>;
export type MoltSync = z.infer<typeof moltSyncSchema>;
export type AgentReview = typeof agentReviews.$inferSelect;
export type InsertAgentReview = z.infer<typeof insertAgentReviewSchema>;
export type TrustReceipt = typeof trustReceipts.$inferSelect;
export type InsertTrustReceipt = z.infer<typeof insertTrustReceiptSchema>;

export const insertAgentMessageSchema = createInsertSchema(agentMessages).omit({ id: true, createdAt: true, readAt: true });
export const insertAgentConversationSchema = createInsertSchema(agentConversations).omit({ id: true });

export const sendMessageSchema = z.object({
  content: z.string().min(1).max(1000),
  messageType: z.enum(["TEXT", "GIG_OFFER", "TRUST_REQUEST", "PAYMENT"]).default("TEXT"),
  gigOfferId: z.string().optional().nullable(),
  offerAmount: z.number().positive().optional().nullable(),
});

export type AgentMessage = typeof agentMessages.$inferSelect;
export type InsertAgentMessage = z.infer<typeof insertAgentMessageSchema>;
export type AgentConversation = typeof agentConversations.$inferSelect;
export type InsertAgentConversation = z.infer<typeof insertAgentConversationSchema>;
export type SendMessage = z.infer<typeof sendMessageSchema>;

export const moltyAnnouncements = pgTable("molty_announcements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  content: text("content").notNull(),
  eventType: text("event_type").notNull(),
  relatedAgentId: varchar("related_agent_id"),
  relatedGigId: varchar("related_gig_id"),
  pinned: boolean("pinned").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertMoltyAnnouncementSchema = createInsertSchema(moltyAnnouncements).omit({ id: true, createdAt: true });
export type MoltyAnnouncement = typeof moltyAnnouncements.$inferSelect;
export type InsertMoltyAnnouncement = z.infer<typeof insertMoltyAnnouncementSchema>;

export const MOLTY_HANDLE = "Molty";

export const insertCrewSchema = createInsertSchema(crews).omit({ id: true, createdAt: true, fusedScore: true, bondPool: true, gigsCompleted: true, totalEarned: true, crewPassportImage: true });
export const insertCrewMemberSchema = createInsertSchema(crewMembers).omit({ id: true, joinedAt: true });
export const insertCrewGigApplicantSchema = createInsertSchema(crewGigApplicants).omit({ id: true, createdAt: true });

export const createCrewSchema = z.object({
  name: z.string().min(2).max(64),
  handle: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_-]+$/, "Handle must be alphanumeric with dashes/underscores"),
  description: z.string().max(500).optional(),
  members: z.array(z.object({
    agentId: z.string(),
    role: z.enum(["LEAD", "RESEARCHER", "CODER", "DESIGNER", "VALIDATOR"]),
  })).min(2, "A crew needs at least 2 agents").max(10),
});

export type Crew = typeof crews.$inferSelect;
export type InsertCrew = z.infer<typeof insertCrewSchema>;
export type CrewMember = typeof crewMembers.$inferSelect;
export type InsertCrewMember = z.infer<typeof insertCrewMemberSchema>;
export type CrewGigApplicant = typeof crewGigApplicants.$inferSelect;
export type InsertCrewGigApplicant = z.infer<typeof insertCrewGigApplicantSchema>;
export type CreateCrew = z.infer<typeof createCrewSchema>;

export const x402Payments = pgTable("x402_payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  endpoint: text("endpoint").notNull(),
  callerWallet: text("caller_wallet"),
  targetWallet: text("target_wallet"),
  targetAgentId: varchar("target_agent_id"),
  amount: real("amount").notNull(),
  currency: text("currency").notNull().default("USDC"),
  chain: text("chain").notNull().default("base-sepolia"),
  txHash: text("tx_hash"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertX402PaymentSchema = createInsertSchema(x402Payments).omit({ id: true, createdAt: true });
export type X402Payment = typeof x402Payments.$inferSelect;
export type InsertX402Payment = z.infer<typeof insertX402PaymentSchema>;
