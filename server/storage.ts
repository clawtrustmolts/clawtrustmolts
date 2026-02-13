import { eq, desc, or } from "drizzle-orm";
import { db } from "./db";
import {
  agents, gigs, reputationEvents, swarmValidations, swarmVotes,
  type Agent, type InsertAgent,
  type Gig, type InsertGig,
  type ReputationEvent, type InsertReputationEvent,
  type SwarmValidation, type InsertSwarmValidation,
  type SwarmVote, type InsertSwarmVote,
} from "@shared/schema";

export interface IStorage {
  getAgents(): Promise<Agent[]>;
  getAgent(id: string): Promise<Agent | undefined>;
  createAgent(agent: InsertAgent): Promise<Agent>;

  getGigs(): Promise<Gig[]>;
  getGig(id: string): Promise<Gig | undefined>;
  getGigsByAgent(agentId: string): Promise<Gig[]>;
  createGig(gig: InsertGig): Promise<Gig>;
  updateGigStatus(id: string, status: string): Promise<Gig | undefined>;

  getReputationEvents(agentId: string): Promise<ReputationEvent[]>;
  createReputationEvent(event: InsertReputationEvent): Promise<ReputationEvent>;

  getValidations(): Promise<SwarmValidation[]>;
  getValidation(id: string): Promise<SwarmValidation | undefined>;
  createValidation(v: InsertSwarmValidation): Promise<SwarmValidation>;
  castVote(vote: InsertSwarmVote): Promise<SwarmVote>;
  updateValidation(id: string, data: Partial<SwarmValidation>): Promise<SwarmValidation | undefined>;
}

export class DatabaseStorage implements IStorage {
  async getAgents(): Promise<Agent[]> {
    return db.select().from(agents).orderBy(desc(agents.fusedScore));
  }

  async getAgent(id: string): Promise<Agent | undefined> {
    const [agent] = await db.select().from(agents).where(eq(agents.id, id));
    return agent;
  }

  async createAgent(agent: InsertAgent): Promise<Agent> {
    const [created] = await db.insert(agents).values(agent).returning();
    return created;
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

  async createValidation(v: InsertSwarmValidation): Promise<SwarmValidation> {
    const [created] = await db.insert(swarmValidations).values(v).returning();
    return created;
  }

  async castVote(vote: InsertSwarmVote): Promise<SwarmVote> {
    const [created] = await db.insert(swarmVotes).values(vote).returning();
    return created;
  }

  async updateValidation(id: string, data: Partial<SwarmValidation>): Promise<SwarmValidation | undefined> {
    const [updated] = await db.update(swarmValidations).set(data).where(eq(swarmValidations.id, id)).returning();
    return updated;
  }
}

export const storage = new DatabaseStorage();
