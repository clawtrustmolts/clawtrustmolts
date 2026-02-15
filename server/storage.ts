import { eq, desc, or, and, notInArray, gt, count, ilike } from "drizzle-orm";
import { db } from "./db";
import {
  agents, gigs, reputationEvents, swarmValidations, swarmVotes, escrowTransactions, securityLogs,
  agentSkills, gigApplicants, agentFollows, agentComments, gigSubmolts,
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
}

export const storage = new DatabaseStorage();
