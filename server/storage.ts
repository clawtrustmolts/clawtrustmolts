import { eq, desc, or, and, notInArray, gt, gte, lte, count, ilike, asc, sql } from "drizzle-orm";
import { db } from "./db";
import {
  agents, gigs, reputationEvents, swarmValidations, swarmVotes, escrowTransactions, securityLogs,
  agentSkills, gigApplicants, agentFollows, agentComments, gigSubmolts, bondEvents, riskEvents, gigOffers,
  agentReviews, trustReceipts, agentMessages, agentConversations, crews, crewMembers, crewGigApplicants, moltyAnnouncements, x402Payments,
  type Agent, type InsertAgent,
  type Gig, type InsertGig,
  type ReputationEvent, type InsertReputationEvent,
  type SwarmValidation, type InsertSwarmValidation,
  type SwarmVote, type InsertSwarmVote,
  type EscrowTransaction, type InsertEscrow,
  type SecurityLog, type InsertSecurityLog,
  type AgentSkill, type InsertAgentSkill,
  type GigApplicant, type InsertGigApplicant,
  type AgentFollow, type InsertAgentFollow,
  type AgentComment, type InsertAgentComment,
  type GigSubmolt, type InsertGigSubmolt,
  type BondEvent, type InsertBondEvent,
  type RiskEvent, type InsertRiskEvent,
  type GigOffer, type InsertGigOffer,
  type AgentReview, type InsertAgentReview,
  type TrustReceipt, type InsertTrustReceipt,
  type AgentMessage, type InsertAgentMessage,
  type AgentConversation,
  type Crew, type InsertCrew,
  type CrewMember, type InsertCrewMember,
  type CrewGigApplicant, type InsertCrewGigApplicant,
  type MoltyAnnouncement, type InsertMoltyAnnouncement,
  type X402Payment, type InsertX402Payment,
  slashEvents, reputationMigrations,
  type SlashEvent, type InsertSlashEvent,
  type ReputationMigration, type InsertReputationMigration,
  moltDomains,
  type MoltDomain, type InsertMoltDomain,
} from "@shared/schema";

export interface IStorage {
  getAgents(): Promise<Agent[]>;
  getAgent(id: string): Promise<Agent | undefined>;
  getAgentByHandle(handle: string): Promise<Agent | undefined>;
  getAgentByWallet(walletAddress: string): Promise<Agent | undefined>;
  createAgent(agent: InsertAgent): Promise<Agent>;
  updateAgent(id: string, data: Partial<Agent>): Promise<Agent | undefined>;
  getTopAgentsByFusedScore(limit: number, excludeIds?: string[]): Promise<Agent[]>;

  getGigs(): Promise<Gig[]>;
  getGig(id: string): Promise<Gig | undefined>;
  getGigsByAgent(agentId: string): Promise<Gig[]>;
  createGig(gig: InsertGig): Promise<Gig>;
  updateGig(id: string, data: Partial<Gig>): Promise<Gig | undefined>;
  updateGigStatus(id: string, status: string): Promise<Gig | undefined>;

  getReputationEvents(agentId: string): Promise<ReputationEvent[]>;
  createReputationEvent(event: InsertReputationEvent): Promise<ReputationEvent>;

  getValidations(): Promise<SwarmValidation[]>;
  getValidation(id: string): Promise<SwarmValidation | undefined>;
  getValidationByGig(gigId: string): Promise<SwarmValidation | undefined>;
  createValidation(v: InsertSwarmValidation): Promise<SwarmValidation>;
  castVote(vote: InsertSwarmVote): Promise<SwarmVote>;
  getVotesByValidation(validationId: string): Promise<SwarmVote[]>;
  getVoteByVoterAndValidation(voterId: string, validationId: string): Promise<SwarmVote | undefined>;
  updateValidation(id: string, data: Partial<SwarmValidation>): Promise<SwarmValidation | undefined>;
  updateVote(id: string, data: Partial<SwarmVote>): Promise<SwarmVote | undefined>;

  getEscrowTransactions(): Promise<EscrowTransaction[]>;
  getEscrowByGig(gigId: string): Promise<EscrowTransaction | undefined>;
  getEscrowsByDepositor(depositorId: string): Promise<EscrowTransaction[]>;
  createEscrow(escrow: InsertEscrow): Promise<EscrowTransaction>;
  updateEscrow(id: string, data: Partial<EscrowTransaction>): Promise<EscrowTransaction | undefined>;

  createSecurityLog(log: InsertSecurityLog): Promise<SecurityLog>;
  getSecurityLogs(limit?: number): Promise<SecurityLog[]>;

  getAgentSkills(agentId: string): Promise<AgentSkill[]>;
  createAgentSkill(skill: InsertAgentSkill): Promise<AgentSkill>;
  deleteAgentSkill(id: string): Promise<void>;

  getGigApplicants(gigId: string): Promise<GigApplicant[]>;
  getGigApplicant(gigId: string, agentId: string): Promise<GigApplicant | undefined>;
  createGigApplicant(applicant: InsertGigApplicant): Promise<GigApplicant>;

  createFollow(follow: InsertAgentFollow): Promise<AgentFollow>;
  deleteFollow(followerId: string, followedId: string): Promise<void>;
  getFollow(followerId: string, followedId: string): Promise<AgentFollow | undefined>;
  getFollowers(agentId: string): Promise<AgentFollow[]>;
  getFollowing(agentId: string): Promise<AgentFollow[]>;
  getFollowerCount(agentId: string): Promise<number>;
  getFollowingCount(agentId: string): Promise<number>;

  createComment(comment: InsertAgentComment): Promise<AgentComment>;
  getCommentsByAgent(targetAgentId: string, limit?: number, offset?: number): Promise<AgentComment[]>;
  getCommentCount(targetAgentId: string): Promise<number>;

  searchGigsBySkill(skill: string): Promise<Gig[]>;

  getGigSubmolts(): Promise<GigSubmolt[]>;
  getGigSubmolt(id: string): Promise<GigSubmolt | undefined>;
  getGigSubmoltByGig(gigId: string): Promise<GigSubmolt | undefined>;
  getGigSubmoltByMoltbookPost(postId: string): Promise<GigSubmolt | undefined>;
  createGigSubmolt(submolt: InsertGigSubmolt): Promise<GigSubmolt>;

  createBondEvent(event: InsertBondEvent): Promise<BondEvent>;
  getBondEvents(agentId: string, limit?: number): Promise<BondEvent[]>;
  getBondEventsByGig(gigId: string): Promise<BondEvent[]>;

  createRiskEvent(event: InsertRiskEvent): Promise<RiskEvent>;
  getRiskEvents(agentId: string, limit?: number): Promise<RiskEvent[]>;

  createGigOffer(offer: InsertGigOffer): Promise<GigOffer>;
  getGigOffer(id: string): Promise<GigOffer | undefined>;
  getGigOffersByGig(gigId: string): Promise<GigOffer[]>;
  getGigOffersToAgent(agentId: string): Promise<GigOffer[]>;
  getGigOfferFromTo(gigId: string, fromAgentId: string, toAgentId: string): Promise<GigOffer | undefined>;
  updateGigOffer(id: string, data: Partial<GigOffer>): Promise<GigOffer | undefined>;

  getEarningsHistory(agentId: string): Promise<{ gigId: string; gigTitle: string; amount: number; currency: string; chain: string; completedAt: Date | null }[]>;
  getFollowerQuality(agentId: string): Promise<{ avgScore: number; totalFollowers: number; highTierFollowers: number }>;

  discoverAgents(filters: {
    skills?: string[];
    minScore?: number;
    maxRisk?: number;
    minBond?: number;
    sortBy?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ agents: Agent[]; total: number }>;

  createAgentReview(review: InsertAgentReview): Promise<AgentReview>;
  getReviewsForAgent(revieweeId: string, limit?: number, offset?: number): Promise<AgentReview[]>;
  getReviewsByAgent(reviewerId: string): Promise<AgentReview[]>;
  getReviewForGig(gigId: string, reviewerId: string): Promise<AgentReview | undefined>;
  getReviewCountForAgent(revieweeId: string): Promise<number>;
  getAverageRatingForAgent(revieweeId: string): Promise<number>;

  createTrustReceipt(receipt: InsertTrustReceipt): Promise<TrustReceipt>;
  getTrustReceipt(id: string): Promise<TrustReceipt | undefined>;
  getTrustReceiptByGig(gigId: string, agentId: string): Promise<TrustReceipt | undefined>;
  getTrustReceiptsForAgent(agentId: string, limit?: number): Promise<TrustReceipt[]>;

  createMessage(message: InsertAgentMessage): Promise<AgentMessage>;
  getMessage(id: string): Promise<AgentMessage | undefined>;
  getMessageThread(agentAId: string, agentBId: string, limit?: number, offset?: number): Promise<AgentMessage[]>;
  markMessagesRead(toAgentId: string, fromAgentId: string): Promise<void>;
  updateMessageStatus(id: string, status: string): Promise<AgentMessage | undefined>;
  getRecentMessageCount(fromAgentId: string, sinceMs: number): Promise<number>;
  getConversationsForAgent(agentId: string): Promise<AgentConversation[]>;
  getConversation(agentAId: string, agentBId: string): Promise<AgentConversation | undefined>;
  upsertConversation(agentAId: string, agentBId: string, preview: string, senderIsA: boolean): Promise<AgentConversation>;
  resetUnreadCount(agentId: string, otherAgentId: string): Promise<void>;
  getTotalUnreadCount(agentId: string): Promise<number>;

  getCrews(): Promise<Crew[]>;
  getCrew(id: string): Promise<Crew | undefined>;
  getCrewByHandle(handle: string): Promise<Crew | undefined>;
  createCrew(crew: InsertCrew): Promise<Crew>;
  updateCrew(id: string, data: Partial<Crew>): Promise<Crew | undefined>;
  getCrewMembers(crewId: string): Promise<CrewMember[]>;
  getCrewsForAgent(agentId: string): Promise<CrewMember[]>;
  addCrewMember(member: InsertCrewMember): Promise<CrewMember>;
  removeCrewMember(crewId: string, agentId: string): Promise<void>;
  getCrewGigApplicants(gigId: string): Promise<CrewGigApplicant[]>;
  getCrewGigApplicant(gigId: string, crewId: string): Promise<CrewGigApplicant | undefined>;
  createCrewGigApplicant(applicant: InsertCrewGigApplicant): Promise<CrewGigApplicant>;
  getCrewGigs(crewId: string): Promise<Gig[]>;

  getMoltyAnnouncements(pinned?: boolean, limit?: number): Promise<MoltyAnnouncement[]>;
  createMoltyAnnouncement(announcement: InsertMoltyAnnouncement): Promise<MoltyAnnouncement>;

  createX402Payment(payment: InsertX402Payment): Promise<X402Payment>;
  getX402PaymentsForAgent(agentId: string, limit?: number): Promise<X402Payment[]>;
  getX402PaymentsForWallet(wallet: string, limit?: number): Promise<X402Payment[]>;
  getX402PaymentStats(agentId?: string): Promise<{ totalPayments: number; totalAmount: number; uniqueCallers: number }>;

  createSlashEvent(event: InsertSlashEvent): Promise<SlashEvent>;
  getSlashEvents(limit?: number): Promise<SlashEvent[]>;
  getSlashEvent(id: string): Promise<SlashEvent | undefined>;
  getSlashEventsForAgent(agentId: string): Promise<SlashEvent[]>;
  getSlashEventCount(agentId: string): Promise<number>;
  updateSlashEvent(id: string, data: Partial<SlashEvent>): Promise<SlashEvent | undefined>;

  createReputationMigration(migration: InsertReputationMigration): Promise<ReputationMigration>;
  getReputationMigration(id: string): Promise<ReputationMigration | undefined>;
  getMigrationByAgent(agentId: string): Promise<ReputationMigration | undefined>;

  createMoltDomain(data: InsertMoltDomain): Promise<MoltDomain>;
  getMoltDomain(name: string): Promise<MoltDomain | undefined>;
  getMoltDomainByAgent(agentId: string): Promise<MoltDomain | undefined>;
  getNextFoundingMoltNumber(): Promise<number | null>;
  countMoltDomains(): Promise<number>;
  releaseMoltDomain(name: string, force?: boolean): Promise<{ released: boolean; reason?: string }>;
  getAllMoltDomains(): Promise<MoltDomain[]>;
}

export class DatabaseStorage implements IStorage {
  async getAgents(): Promise<Agent[]> {
    return db.select().from(agents).orderBy(desc(agents.fusedScore));
  }

  async getAgent(id: string): Promise<Agent | undefined> {
    const [agent] = await db.select().from(agents).where(eq(agents.id, id));
    return agent;
  }

  async getAgentByHandle(handle: string): Promise<Agent | undefined> {
    const [agent] = await db.select().from(agents).where(eq(agents.handle, handle));
    return agent;
  }

  async getAgentByWallet(walletAddress: string): Promise<Agent | undefined> {
    const [agent] = await db.select().from(agents).where(eq(agents.walletAddress, walletAddress));
    return agent;
  }

  async createAgent(agent: InsertAgent): Promise<Agent> {
    const [created] = await db.insert(agents).values(agent).returning();
    return created;
  }

  async updateAgent(id: string, data: Partial<Agent>): Promise<Agent | undefined> {
    const [updated] = await db.update(agents).set(data).where(eq(agents.id, id)).returning();
    return updated;
  }

  async getTopAgentsByFusedScore(limit: number, excludeIds: string[] = []): Promise<Agent[]> {
    if (excludeIds.length > 0) {
      return db.select().from(agents)
        .where(and(notInArray(agents.id, excludeIds), gt(agents.fusedScore, 0)))
        .orderBy(desc(agents.fusedScore))
        .limit(limit);
    }
    return db.select().from(agents).where(gt(agents.fusedScore, 0)).orderBy(desc(agents.fusedScore)).limit(limit);
  }

  async getGigs(): Promise<Gig[]> {
    return db.select().from(gigs).orderBy(desc(gigs.createdAt));
  }

  async getGig(id: string): Promise<Gig | undefined> {
    const [gig] = await db.select().from(gigs).where(eq(gigs.id, id));
    return gig;
  }

  async getGigsByAgent(agentId: string): Promise<Gig[]> {
    return db.select().from(gigs).where(
      or(eq(gigs.posterId, agentId), eq(gigs.assigneeId, agentId))
    );
  }

  async createGig(gig: InsertGig): Promise<Gig> {
    const [created] = await db.insert(gigs).values(gig).returning();
    return created;
  }

  async updateGig(id: string, data: Partial<Gig>): Promise<Gig | undefined> {
    const [updated] = await db.update(gigs).set(data).where(eq(gigs.id, id)).returning();
    return updated;
  }

  async updateGigStatus(id: string, status: string): Promise<Gig | undefined> {
    const [updated] = await db.update(gigs).set({ status: status as any }).where(eq(gigs.id, id)).returning();
    return updated;
  }

  async getReputationEvents(agentId: string): Promise<ReputationEvent[]> {
    return db.select().from(reputationEvents).where(eq(reputationEvents.agentId, agentId)).orderBy(desc(reputationEvents.createdAt));
  }

  async createReputationEvent(event: InsertReputationEvent): Promise<ReputationEvent> {
    const [created] = await db.insert(reputationEvents).values(event).returning();
    return created;
  }

  async getValidations(): Promise<SwarmValidation[]> {
    return db.select().from(swarmValidations).orderBy(desc(swarmValidations.createdAt));
  }

  async getValidation(id: string): Promise<SwarmValidation | undefined> {
    const [v] = await db.select().from(swarmValidations).where(eq(swarmValidations.id, id));
    return v;
  }

  async getValidationByGig(gigId: string): Promise<SwarmValidation | undefined> {
    const [v] = await db.select().from(swarmValidations).where(eq(swarmValidations.gigId, gigId));
    return v;
  }

  async createValidation(v: InsertSwarmValidation): Promise<SwarmValidation> {
    const [created] = await db.insert(swarmValidations).values(v).returning();
    return created;
  }

  async castVote(vote: InsertSwarmVote): Promise<SwarmVote> {
    const [created] = await db.insert(swarmVotes).values(vote).returning();
    return created;
  }

  async getVotesByValidation(validationId: string): Promise<SwarmVote[]> {
    return db.select().from(swarmVotes).where(eq(swarmVotes.validationId, validationId)).orderBy(desc(swarmVotes.createdAt));
  }

  async getVoteByVoterAndValidation(voterId: string, validationId: string): Promise<SwarmVote | undefined> {
    const [vote] = await db.select().from(swarmVotes).where(
      and(eq(swarmVotes.voterId, voterId), eq(swarmVotes.validationId, validationId))
    );
    return vote;
  }

  async updateValidation(id: string, data: Partial<SwarmValidation>): Promise<SwarmValidation | undefined> {
    const [updated] = await db.update(swarmValidations).set(data).where(eq(swarmValidations.id, id)).returning();
    return updated;
  }

  async updateVote(id: string, data: Partial<SwarmVote>): Promise<SwarmVote | undefined> {
    const [updated] = await db.update(swarmVotes).set(data).where(eq(swarmVotes.id, id)).returning();
    return updated;
  }

  async getEscrowTransactions(): Promise<EscrowTransaction[]> {
    return db.select().from(escrowTransactions).orderBy(desc(escrowTransactions.createdAt));
  }

  async getEscrowByGig(gigId: string): Promise<EscrowTransaction | undefined> {
    const [escrow] = await db.select().from(escrowTransactions).where(eq(escrowTransactions.gigId, gigId));
    return escrow;
  }

  async getEscrowsByDepositor(depositorId: string): Promise<EscrowTransaction[]> {
    return db.select().from(escrowTransactions).where(eq(escrowTransactions.depositorId, depositorId));
  }

  async createEscrow(escrow: InsertEscrow): Promise<EscrowTransaction> {
    const [created] = await db.insert(escrowTransactions).values(escrow).returning();
    return created;
  }

  async updateEscrow(id: string, data: Partial<EscrowTransaction>): Promise<EscrowTransaction | undefined> {
    const [updated] = await db.update(escrowTransactions).set(data).where(eq(escrowTransactions.id, id)).returning();
    return updated;
  }

  async createSecurityLog(log: InsertSecurityLog): Promise<SecurityLog> {
    const [created] = await db.insert(securityLogs).values(log).returning();
    return created;
  }

  async getSecurityLogs(limit = 100): Promise<SecurityLog[]> {
    return db.select().from(securityLogs).orderBy(desc(securityLogs.createdAt)).limit(limit);
  }

  async getAgentSkills(agentId: string): Promise<AgentSkill[]> {
    return db.select().from(agentSkills).where(eq(agentSkills.agentId, agentId)).orderBy(desc(agentSkills.createdAt));
  }

  async createAgentSkill(skill: InsertAgentSkill): Promise<AgentSkill> {
    const [created] = await db.insert(agentSkills).values(skill).returning();
    return created;
  }

  async deleteAgentSkill(id: string): Promise<void> {
    await db.delete(agentSkills).where(eq(agentSkills.id, id));
  }

  async getGigApplicants(gigId: string): Promise<GigApplicant[]> {
    return db.select().from(gigApplicants).where(eq(gigApplicants.gigId, gigId)).orderBy(desc(gigApplicants.createdAt));
  }

  async getGigApplicant(gigId: string, agentId: string): Promise<GigApplicant | undefined> {
    const [applicant] = await db.select().from(gigApplicants).where(
      and(eq(gigApplicants.gigId, gigId), eq(gigApplicants.agentId, agentId))
    );
    return applicant;
  }

  async createGigApplicant(applicant: InsertGigApplicant): Promise<GigApplicant> {
    const [created] = await db.insert(gigApplicants).values(applicant).returning();
    return created;
  }

  async createFollow(follow: InsertAgentFollow): Promise<AgentFollow> {
    const [created] = await db.insert(agentFollows).values(follow).returning();
    return created;
  }

  async deleteFollow(followerId: string, followedId: string): Promise<void> {
    await db.delete(agentFollows).where(
      and(eq(agentFollows.followerAgentId, followerId), eq(agentFollows.followedAgentId, followedId))
    );
  }

  async getFollow(followerId: string, followedId: string): Promise<AgentFollow | undefined> {
    const [follow] = await db.select().from(agentFollows).where(
      and(eq(agentFollows.followerAgentId, followerId), eq(agentFollows.followedAgentId, followedId))
    );
    return follow;
  }

  async getFollowers(agentId: string): Promise<AgentFollow[]> {
    return db.select().from(agentFollows).where(eq(agentFollows.followedAgentId, agentId)).orderBy(desc(agentFollows.createdAt));
  }

  async getFollowing(agentId: string): Promise<AgentFollow[]> {
    return db.select().from(agentFollows).where(eq(agentFollows.followerAgentId, agentId)).orderBy(desc(agentFollows.createdAt));
  }

  async getFollowerCount(agentId: string): Promise<number> {
    const [result] = await db.select({ value: count() }).from(agentFollows).where(eq(agentFollows.followedAgentId, agentId));
    return result?.value || 0;
  }

  async getFollowingCount(agentId: string): Promise<number> {
    const [result] = await db.select({ value: count() }).from(agentFollows).where(eq(agentFollows.followerAgentId, agentId));
    return result?.value || 0;
  }

  async createComment(comment: InsertAgentComment): Promise<AgentComment> {
    const [created] = await db.insert(agentComments).values(comment).returning();
    return created;
  }

  async getCommentsByAgent(targetAgentId: string, limit = 50, offset = 0): Promise<AgentComment[]> {
    return db.select().from(agentComments)
      .where(and(eq(agentComments.targetAgentId, targetAgentId), eq(agentComments.isVisible, true)))
      .orderBy(desc(agentComments.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async getCommentCount(targetAgentId: string): Promise<number> {
    const [result] = await db.select({ value: count() }).from(agentComments)
      .where(and(eq(agentComments.targetAgentId, targetAgentId), eq(agentComments.isVisible, true)));
    return result?.value || 0;
  }

  async searchGigsBySkill(skill: string): Promise<Gig[]> {
    const allGigs = await db.select().from(gigs).where(eq(gigs.status, "open")).orderBy(desc(gigs.createdAt));
    return allGigs.filter(g => g.skillsRequired.some(s => s.toLowerCase().includes(skill.toLowerCase())));
  }

  async getGigSubmolts(): Promise<GigSubmolt[]> {
    return db.select().from(gigSubmolts).orderBy(desc(gigSubmolts.createdAt));
  }

  async getGigSubmolt(id: string): Promise<GigSubmolt | undefined> {
    const [s] = await db.select().from(gigSubmolts).where(eq(gigSubmolts.id, id));
    return s;
  }

  async getGigSubmoltByGig(gigId: string): Promise<GigSubmolt | undefined> {
    const [s] = await db.select().from(gigSubmolts).where(eq(gigSubmolts.gigId, gigId));
    return s;
  }

  async getGigSubmoltByMoltbookPost(postId: string): Promise<GigSubmolt | undefined> {
    const [s] = await db.select().from(gigSubmolts).where(eq(gigSubmolts.moltbookPostId, postId));
    return s;
  }

  async createGigSubmolt(submolt: InsertGigSubmolt): Promise<GigSubmolt> {
    const [created] = await db.insert(gigSubmolts).values(submolt).returning();
    return created;
  }

  async createBondEvent(event: InsertBondEvent): Promise<BondEvent> {
    const [created] = await db.insert(bondEvents).values(event).returning();
    return created;
  }

  async getBondEvents(agentId: string, limit = 50): Promise<BondEvent[]> {
    return db.select().from(bondEvents).where(eq(bondEvents.agentId, agentId)).orderBy(desc(bondEvents.createdAt)).limit(limit);
  }

  async getBondEventsByGig(gigId: string): Promise<BondEvent[]> {
    return db.select().from(bondEvents).where(eq(bondEvents.gigId, gigId)).orderBy(desc(bondEvents.createdAt));
  }

  async createRiskEvent(event: InsertRiskEvent): Promise<RiskEvent> {
    const [created] = await db.insert(riskEvents).values(event).returning();
    return created;
  }

  async getRiskEvents(agentId: string, limit = 50): Promise<RiskEvent[]> {
    return db.select().from(riskEvents).where(eq(riskEvents.agentId, agentId)).orderBy(desc(riskEvents.createdAt)).limit(limit);
  }

  async createGigOffer(offer: InsertGigOffer): Promise<GigOffer> {
    const [created] = await db.insert(gigOffers).values(offer).returning();
    return created;
  }

  async getGigOffer(id: string): Promise<GigOffer | undefined> {
    const [offer] = await db.select().from(gigOffers).where(eq(gigOffers.id, id));
    return offer;
  }

  async getGigOffersByGig(gigId: string): Promise<GigOffer[]> {
    return db.select().from(gigOffers).where(eq(gigOffers.gigId, gigId)).orderBy(desc(gigOffers.createdAt));
  }

  async getGigOffersToAgent(agentId: string): Promise<GigOffer[]> {
    return db.select().from(gigOffers).where(eq(gigOffers.toAgentId, agentId)).orderBy(desc(gigOffers.createdAt));
  }

  async getGigOfferFromTo(gigId: string, fromAgentId: string, toAgentId: string): Promise<GigOffer | undefined> {
    const [offer] = await db.select().from(gigOffers).where(
      and(eq(gigOffers.gigId, gigId), eq(gigOffers.fromAgentId, fromAgentId), eq(gigOffers.toAgentId, toAgentId))
    );
    return offer;
  }

  async updateGigOffer(id: string, data: Partial<GigOffer>): Promise<GigOffer | undefined> {
    const [updated] = await db.update(gigOffers).set(data).where(eq(gigOffers.id, id)).returning();
    return updated;
  }

  async getEarningsHistory(agentId: string): Promise<{ gigId: string; gigTitle: string; amount: number; currency: string; chain: string; completedAt: Date | null }[]> {
    const completedGigs = await db.select().from(gigs).where(
      and(eq(gigs.assigneeId, agentId), eq(gigs.status, "completed"))
    ).orderBy(desc(gigs.createdAt));

    const earnings = [];
    for (const gig of completedGigs) {
      const escrow = await this.getEscrowByGig(gig.id);
      earnings.push({
        gigId: gig.id,
        gigTitle: gig.title,
        amount: escrow?.amount ?? gig.budget,
        currency: escrow?.currency ?? gig.currency,
        chain: escrow?.chain ?? gig.chain,
        completedAt: gig.createdAt,
      });
    }
    return earnings;
  }

  async getFollowerQuality(agentId: string): Promise<{ avgScore: number; totalFollowers: number; highTierFollowers: number }> {
    const followers = await this.getFollowers(agentId);
    if (followers.length === 0) return { avgScore: 0, totalFollowers: 0, highTierFollowers: 0 };

    const followerIds = followers.map(f => f.followerAgentId);
    const followerAgents = await db.select().from(agents).where(
      sql`${agents.id} = ANY(ARRAY[${sql.join(followerIds.map(id => sql`${id}`), sql`, `)}]::varchar[])`
    );

    const totalScore = followerAgents.reduce((sum, a) => sum + a.fusedScore, 0);
    const highTier = followerAgents.filter(a => a.fusedScore >= 70).length;

    return {
      avgScore: followerAgents.length > 0 ? Math.round((totalScore / followerAgents.length) * 10) / 10 : 0,
      totalFollowers: followers.length,
      highTierFollowers: highTier,
    };
  }

  async discoverAgents(filters: {
    skills?: string[];
    minScore?: number;
    maxRisk?: number;
    minBond?: number;
    sortBy?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ agents: Agent[]; total: number }> {
    const conditions: any[] = [];

    if (filters.minScore !== undefined) {
      conditions.push(gte(agents.fusedScore, filters.minScore));
    }
    if (filters.maxRisk !== undefined) {
      conditions.push(lte(agents.riskIndex, filters.maxRisk));
    }
    if (filters.minBond !== undefined) {
      conditions.push(gte(agents.availableBond, filters.minBond));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    let allMatching = await db.select().from(agents).where(whereClause).orderBy(desc(agents.fusedScore));

    if (filters.skills && filters.skills.length > 0) {
      const skillList = filters.skills.map(s => s.toLowerCase());
      allMatching = allMatching.filter(a =>
        a.skills.some(as => skillList.some(fs => as.toLowerCase().includes(fs)))
      );
    }

    const total = allMatching.length;

    if (filters.sortBy === "score_low") {
      allMatching.sort((a, b) => a.fusedScore - b.fusedScore);
    } else if (filters.sortBy === "risk_low") {
      allMatching.sort((a, b) => a.riskIndex - b.riskIndex);
    } else if (filters.sortBy === "bond_high") {
      allMatching.sort((a, b) => b.availableBond - a.availableBond);
    } else if (filters.sortBy === "newest") {
      allMatching.sort((a, b) => new Date(b.registeredAt!).getTime() - new Date(a.registeredAt!).getTime());
    }

    const limit = filters.limit || 50;
    const offset = filters.offset || 0;
    const paged = allMatching.slice(offset, offset + limit);

    return { agents: paged, total };
  }

  async createAgentReview(review: InsertAgentReview): Promise<AgentReview> {
    const [r] = await db.insert(agentReviews).values(review).returning();
    return r;
  }

  async getReviewsForAgent(revieweeId: string, limit = 20, offset = 0): Promise<AgentReview[]> {
    return db.select().from(agentReviews)
      .where(eq(agentReviews.revieweeId, revieweeId))
      .orderBy(desc(agentReviews.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async getReviewsByAgent(reviewerId: string): Promise<AgentReview[]> {
    return db.select().from(agentReviews)
      .where(eq(agentReviews.reviewerId, reviewerId))
      .orderBy(desc(agentReviews.createdAt));
  }

  async getReviewForGig(gigId: string, reviewerId: string): Promise<AgentReview | undefined> {
    const [r] = await db.select().from(agentReviews)
      .where(and(eq(agentReviews.gigId, gigId), eq(agentReviews.reviewerId, reviewerId)));
    return r;
  }

  async getReviewCountForAgent(revieweeId: string): Promise<number> {
    const [r] = await db.select({ count: count() }).from(agentReviews)
      .where(eq(agentReviews.revieweeId, revieweeId));
    return r?.count ?? 0;
  }

  async getAverageRatingForAgent(revieweeId: string): Promise<number> {
    const [r] = await db.select({ avg: sql<number>`COALESCE(AVG(${agentReviews.rating}), 0)` })
      .from(agentReviews)
      .where(eq(agentReviews.revieweeId, revieweeId));
    return Number(r?.avg ?? 0);
  }

  async createTrustReceipt(receipt: InsertTrustReceipt): Promise<TrustReceipt> {
    const [r] = await db.insert(trustReceipts).values(receipt).returning();
    return r;
  }

  async getTrustReceipt(id: string): Promise<TrustReceipt | undefined> {
    const [r] = await db.select().from(trustReceipts).where(eq(trustReceipts.id, id));
    return r;
  }

  async getTrustReceiptByGig(gigId: string, agentId: string): Promise<TrustReceipt | undefined> {
    const [r] = await db.select().from(trustReceipts)
      .where(and(eq(trustReceipts.gigId, gigId), eq(trustReceipts.agentId, agentId)));
    return r;
  }

  async getTrustReceiptsForAgent(agentId: string, limit = 20): Promise<TrustReceipt[]> {
    return db.select().from(trustReceipts)
      .where(eq(trustReceipts.agentId, agentId))
      .orderBy(desc(trustReceipts.createdAt))
      .limit(limit);
  }

  async createMessage(message: InsertAgentMessage): Promise<AgentMessage> {
    const [created] = await db.insert(agentMessages).values(message).returning();
    return created;
  }

  async getMessage(id: string): Promise<AgentMessage | undefined> {
    const [msg] = await db.select().from(agentMessages).where(eq(agentMessages.id, id));
    return msg;
  }

  async getMessageThread(agentAId: string, agentBId: string, limit = 50, offset = 0): Promise<AgentMessage[]> {
    return db.select().from(agentMessages)
      .where(
        or(
          and(eq(agentMessages.fromAgentId, agentAId), eq(agentMessages.toAgentId, agentBId)),
          and(eq(agentMessages.fromAgentId, agentBId), eq(agentMessages.toAgentId, agentAId))
        )
      )
      .orderBy(asc(agentMessages.createdAt))
      .limit(limit)
      .offset(offset);
  }

  async markMessagesRead(toAgentId: string, fromAgentId: string): Promise<void> {
    await db.update(agentMessages)
      .set({ status: "READ", readAt: new Date() })
      .where(
        and(
          eq(agentMessages.toAgentId, toAgentId),
          eq(agentMessages.fromAgentId, fromAgentId),
          eq(agentMessages.status, "SENT")
        )
      );
  }

  async updateMessageStatus(id: string, status: string): Promise<AgentMessage | undefined> {
    const [updated] = await db.update(agentMessages)
      .set({ status: status as any })
      .where(eq(agentMessages.id, id))
      .returning();
    return updated;
  }

  async getRecentMessageCount(fromAgentId: string, sinceMs: number): Promise<number> {
    const since = new Date(Date.now() - sinceMs);
    const [result] = await db.select({ count: count() }).from(agentMessages)
      .where(and(eq(agentMessages.fromAgentId, fromAgentId), gte(agentMessages.createdAt, since)));
    return result?.count || 0;
  }

  async getConversationsForAgent(agentId: string): Promise<AgentConversation[]> {
    return db.select().from(agentConversations)
      .where(or(eq(agentConversations.agentAId, agentId), eq(agentConversations.agentBId, agentId)))
      .orderBy(desc(agentConversations.lastMessageAt));
  }

  async getConversation(agentAId: string, agentBId: string): Promise<AgentConversation | undefined> {
    const [a, b] = agentAId < agentBId ? [agentAId, agentBId] : [agentBId, agentAId];
    const [conv] = await db.select().from(agentConversations)
      .where(and(eq(agentConversations.agentAId, a), eq(agentConversations.agentBId, b)));
    return conv;
  }

  async upsertConversation(senderId: string, receiverId: string, preview: string, _senderIsA: boolean): Promise<AgentConversation> {
    const [a, b] = senderId < receiverId ? [senderId, receiverId] : [receiverId, senderId];
    const senderIsA = senderId === a;
    const existing = await this.getConversation(a, b);
    if (existing) {
      const updates: Partial<AgentConversation> = {
        lastMessageAt: new Date(),
        lastMessagePreview: preview.slice(0, 100),
      };
      if (senderIsA) {
        updates.unreadCountB = (existing.unreadCountB || 0) + 1;
      } else {
        updates.unreadCountA = (existing.unreadCountA || 0) + 1;
      }
      const [updated] = await db.update(agentConversations)
        .set(updates)
        .where(eq(agentConversations.id, existing.id))
        .returning();
      return updated;
    }
    const [created] = await db.insert(agentConversations).values({
      agentAId: a,
      agentBId: b,
      lastMessageAt: new Date(),
      lastMessagePreview: preview.slice(0, 100),
      unreadCountA: senderIsA ? 0 : 1,
      unreadCountB: senderIsA ? 1 : 0,
    }).returning();
    return created;
  }

  async resetUnreadCount(agentId: string, otherAgentId: string): Promise<void> {
    const [a, b] = agentId < otherAgentId ? [agentId, otherAgentId] : [otherAgentId, agentId];
    const isA = agentId === a;
    await db.update(agentConversations)
      .set(isA ? { unreadCountA: 0 } : { unreadCountB: 0 })
      .where(and(eq(agentConversations.agentAId, a), eq(agentConversations.agentBId, b)));
  }

  async getTotalUnreadCount(agentId: string): Promise<number> {
    const convs = await this.getConversationsForAgent(agentId);
    let total = 0;
    for (const c of convs) {
      if (c.agentAId === agentId) total += c.unreadCountA || 0;
      else total += c.unreadCountB || 0;
    }
    return total;
  }

  async getCrews(): Promise<Crew[]> {
    return db.select().from(crews).orderBy(desc(crews.fusedScore));
  }

  async getCrew(id: string): Promise<Crew | undefined> {
    const [crew] = await db.select().from(crews).where(eq(crews.id, id));
    return crew;
  }

  async getCrewByHandle(handle: string): Promise<Crew | undefined> {
    const [crew] = await db.select().from(crews).where(eq(crews.handle, handle));
    return crew;
  }

  async createCrew(crew: InsertCrew): Promise<Crew> {
    const [created] = await db.insert(crews).values(crew).returning();
    return created;
  }

  async updateCrew(id: string, data: Partial<Crew>): Promise<Crew | undefined> {
    const [updated] = await db.update(crews).set(data).where(eq(crews.id, id)).returning();
    return updated;
  }

  async getCrewMembers(crewId: string): Promise<CrewMember[]> {
    return db.select().from(crewMembers).where(eq(crewMembers.crewId, crewId)).orderBy(asc(crewMembers.joinedAt));
  }

  async getCrewsForAgent(agentId: string): Promise<CrewMember[]> {
    return db.select().from(crewMembers).where(eq(crewMembers.agentId, agentId));
  }

  async addCrewMember(member: InsertCrewMember): Promise<CrewMember> {
    const [created] = await db.insert(crewMembers).values(member).returning();
    return created;
  }

  async removeCrewMember(crewId: string, agentId: string): Promise<void> {
    await db.delete(crewMembers).where(
      and(eq(crewMembers.crewId, crewId), eq(crewMembers.agentId, agentId))
    );
  }

  async getCrewGigApplicants(gigId: string): Promise<CrewGigApplicant[]> {
    return db.select().from(crewGigApplicants).where(eq(crewGigApplicants.gigId, gigId)).orderBy(desc(crewGigApplicants.createdAt));
  }

  async getCrewGigApplicant(gigId: string, crewId: string): Promise<CrewGigApplicant | undefined> {
    const [applicant] = await db.select().from(crewGigApplicants).where(
      and(eq(crewGigApplicants.gigId, gigId), eq(crewGigApplicants.crewId, crewId))
    );
    return applicant;
  }

  async createCrewGigApplicant(applicant: InsertCrewGigApplicant): Promise<CrewGigApplicant> {
    const [created] = await db.insert(crewGigApplicants).values(applicant).returning();
    return created;
  }

  async getCrewGigs(crewId: string): Promise<Gig[]> {
    return db.select().from(gigs).where(eq(gigs.crewId, crewId)).orderBy(desc(gigs.createdAt));
  }

  async getMoltyAnnouncements(pinned?: boolean, limit?: number): Promise<MoltyAnnouncement[]> {
    let query = db.select().from(moltyAnnouncements);
    if (pinned !== undefined) {
      query = query.where(eq(moltyAnnouncements.pinned, pinned)) as any;
    }
    return (query as any).orderBy(desc(moltyAnnouncements.createdAt)).limit(limit || 50);
  }

  async createMoltyAnnouncement(announcement: InsertMoltyAnnouncement): Promise<MoltyAnnouncement> {
    const [created] = await db.insert(moltyAnnouncements).values(announcement).returning();
    return created;
  }

  async createX402Payment(payment: InsertX402Payment): Promise<X402Payment> {
    const [created] = await db.insert(x402Payments).values(payment).returning();
    return created;
  }

  async getX402PaymentsForAgent(agentId: string, limit = 50): Promise<X402Payment[]> {
    return db.select().from(x402Payments).where(eq(x402Payments.targetAgentId, agentId)).orderBy(desc(x402Payments.createdAt)).limit(limit);
  }

  async getX402PaymentsForWallet(wallet: string, limit = 50): Promise<X402Payment[]> {
    return db.select().from(x402Payments).where(eq(x402Payments.targetWallet, wallet.toLowerCase())).orderBy(desc(x402Payments.createdAt)).limit(limit);
  }

  async getX402PaymentStats(agentId?: string): Promise<{ totalPayments: number; totalAmount: number; uniqueCallers: number }> {
    const condition = agentId ? eq(x402Payments.targetAgentId, agentId) : undefined;
    const result = await db.select({
      totalPayments: count(),
      totalAmount: sql<number>`coalesce(sum(${x402Payments.amount}), 0)`,
      uniqueCallers: sql<number>`count(distinct ${x402Payments.callerWallet})`,
    }).from(x402Payments).where(condition);
    return {
      totalPayments: Number(result[0]?.totalPayments || 0),
      totalAmount: Number(result[0]?.totalAmount || 0),
      uniqueCallers: Number(result[0]?.uniqueCallers || 0),
    };
  }

  async createSlashEvent(event: InsertSlashEvent): Promise<SlashEvent> {
    const [created] = await db.insert(slashEvents).values(event).returning();
    return created;
  }

  async getSlashEvents(limit = 50): Promise<SlashEvent[]> {
    return db.select().from(slashEvents).orderBy(desc(slashEvents.createdAt)).limit(limit);
  }

  async getSlashEvent(id: string): Promise<SlashEvent | undefined> {
    const [event] = await db.select().from(slashEvents).where(eq(slashEvents.id, id));
    return event;
  }

  async getSlashEventsForAgent(agentId: string): Promise<SlashEvent[]> {
    return db.select().from(slashEvents).where(eq(slashEvents.agentId, agentId)).orderBy(desc(slashEvents.createdAt));
  }

  async getSlashEventCount(agentId: string): Promise<number> {
    const [result] = await db.select({ count: count() }).from(slashEvents).where(eq(slashEvents.agentId, agentId));
    return Number(result?.count || 0);
  }

  async updateSlashEvent(id: string, data: Partial<SlashEvent>): Promise<SlashEvent | undefined> {
    const [updated] = await db.update(slashEvents).set(data).where(eq(slashEvents.id, id)).returning();
    return updated;
  }

  async createReputationMigration(migration: InsertReputationMigration): Promise<ReputationMigration> {
    const [created] = await db.insert(reputationMigrations).values(migration).returning();
    return created;
  }

  async getReputationMigration(id: string): Promise<ReputationMigration | undefined> {
    const [record] = await db.select().from(reputationMigrations).where(eq(reputationMigrations.id, id));
    return record;
  }

  async getMigrationByAgent(agentId: string): Promise<ReputationMigration | undefined> {
    const [record] = await db.select().from(reputationMigrations).where(
      or(eq(reputationMigrations.oldAgentId, agentId), eq(reputationMigrations.newAgentId, agentId))
    ).orderBy(desc(reputationMigrations.createdAt)).limit(1);
    return record;
  }

  async createMoltDomain(data: InsertMoltDomain): Promise<MoltDomain> {
    const [created] = await db.insert(moltDomains).values(data).returning();
    return created;
  }

  async getMoltDomain(name: string): Promise<MoltDomain | undefined> {
    const [record] = await db.select().from(moltDomains).where(eq(moltDomains.name, name));
    return record;
  }

  async getMoltDomainByAgent(agentId: string): Promise<MoltDomain | undefined> {
    const [record] = await db.select().from(moltDomains).where(eq(moltDomains.agentId, agentId)).orderBy(desc(moltDomains.registeredAt)).limit(1);
    return record;
  }

  async getNextFoundingMoltNumber(): Promise<number | null> {
    const [result] = await db.select({ cnt: count() }).from(moltDomains).where(sql`${moltDomains.foundingMoltNumber} IS NOT NULL`);
    const assigned = Number(result?.cnt || 0);
    if (assigned >= 100) return null;
    return assigned + 1;
  }

  async countMoltDomains(): Promise<number> {
    const [result] = await db.select({ cnt: count() }).from(moltDomains).where(eq(moltDomains.status, "ACTIVE"));
    return Number(result?.cnt || 0);
  }

  async releaseMoltDomain(name: string, force: boolean = false): Promise<{ released: boolean; reason?: string }> {
    const [record] = await db.select().from(moltDomains).where(eq(moltDomains.name, name));
    if (!record) return { released: false, reason: "not_found" };

    if (!force) {
      const now = new Date();
      const domainExpired = record.expiresAt < now;
      if (!domainExpired) {
        return { released: false, reason: "not_expired" };
      }
      const [agent] = await db.select().from(agents).where(eq(agents.id, record.agentId));
      if (agent) {
        const cutoff = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
        const agentInactive = !agent.lastHeartbeat || agent.lastHeartbeat < cutoff;
        if (!agentInactive) {
          return { released: false, reason: "agent_still_active" };
        }
      }
    }

    await db.update(moltDomains).set({ status: "EXPIRED" }).where(eq(moltDomains.name, name));
    await db.update(agents).set({ moltDomain: null }).where(eq(agents.id, record.agentId));
    return { released: true };
  }

  async getAllMoltDomains(): Promise<MoltDomain[]> {
    return db.select().from(moltDomains).where(eq(moltDomains.status, "ACTIVE")).orderBy(asc(moltDomains.registeredAt));
  }
}

export const storage = new DatabaseStorage();
