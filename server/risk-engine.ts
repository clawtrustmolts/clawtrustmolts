import { storage } from "./storage";
import type { Agent, RiskEvent } from "@shared/schema";

const RISK_WEIGHTS = {
  SLASH: 15,
  FAILED_GIG: 25,
  DISPUTE: 20,
  INACTIVITY: 10,
  BOND_DEPLETION: 10,
} as const;

const CLEAN_STREAK_DISCOUNT = 0.10;
const CLEAN_STREAK_THRESHOLD_DAYS = 30;
const INACTIVITY_THRESHOLD_DAYS = 14;
const RECENT_WINDOW_DAYS = 90;
const MAX_RISK = 100;
const BASE_FEE = 1.0;

type RiskFactor = "SLASH" | "FAILED_GIG" | "DISPUTE_OPENED" | "DISPUTE_RESOLVED" | "INACTIVITY" | "BOND_DEPLETION";

export interface RiskBreakdown {
  slashComponent: number;
  failedGigComponent: number;
  disputeComponent: number;
  inactivityComponent: number;
  bondDepletionComponent: number;
  cleanStreakBonus: number;
  rawScore: number;
  finalScore: number;
}

export interface RiskProfile {
  riskIndex: number;
  breakdown: RiskBreakdown;
  trend: "improving" | "stable" | "worsening";
  cleanStreakDays: number;
  feeMultiplier: number;
  lastUpdated: string | null;
  recentEvents: RiskEvent[];
}

function getRecentWindowStart(): Date {
  const d = new Date();
  d.setDate(d.getDate() - RECENT_WINDOW_DAYS);
  return d;
}

export function computeRiskIndex(
  agent: Agent,
  recentSlashCount: number,
  failedGigRatio: number,
  activeDisputeCount: number,
  inactivityDays: number,
  bondDepletionFreq: number,
): RiskBreakdown {
  const slashComponent = Math.min(recentSlashCount * RISK_WEIGHTS.SLASH, 45);
  const failedGigComponent = Math.min(failedGigRatio * RISK_WEIGHTS.FAILED_GIG, 25);
  const disputeComponent = Math.min(activeDisputeCount * RISK_WEIGHTS.DISPUTE, 40);

  let inactivityComponent = 0;
  if (inactivityDays > INACTIVITY_THRESHOLD_DAYS) {
    const decayFactor = Math.min((inactivityDays - INACTIVITY_THRESHOLD_DAYS) / 30, 1);
    inactivityComponent = decayFactor * RISK_WEIGHTS.INACTIVITY;
  }

  const bondDepletionComponent = Math.min(bondDepletionFreq * RISK_WEIGHTS.BOND_DEPLETION, 20);

  const rawScore = slashComponent + failedGigComponent + disputeComponent + inactivityComponent + bondDepletionComponent;

  let cleanStreakBonus = 0;
  if (agent.cleanStreakDays >= CLEAN_STREAK_THRESHOLD_DAYS) {
    cleanStreakBonus = rawScore * CLEAN_STREAK_DISCOUNT;
  }

  const finalScore = Math.max(0, Math.min(MAX_RISK, Math.round((rawScore - cleanStreakBonus) * 10) / 10));

  return {
    slashComponent: Math.round(slashComponent * 10) / 10,
    failedGigComponent: Math.round(failedGigComponent * 10) / 10,
    disputeComponent: Math.round(disputeComponent * 10) / 10,
    inactivityComponent: Math.round(inactivityComponent * 10) / 10,
    bondDepletionComponent: Math.round(bondDepletionComponent * 10) / 10,
    cleanStreakBonus: Math.round(cleanStreakBonus * 10) / 10,
    rawScore: Math.round(rawScore * 10) / 10,
    finalScore,
  };
}

export function computeFeeDiscount(riskIndex: number): number {
  if (riskIndex <= 10) return 0.15;
  if (riskIndex <= 25) return 0.10;
  if (riskIndex <= 50) return 0.05;
  return 0;
}

export function computeFeeMultiplier(riskIndex: number): number {
  return BASE_FEE * (1 - computeFeeDiscount(riskIndex));
}

function determineTrend(events: RiskEvent[]): "improving" | "stable" | "worsening" {
  if (events.length < 2) return "stable";

  const midpoint = Math.floor(events.length / 2);
  const recentHalf = events.slice(0, midpoint);
  const olderHalf = events.slice(midpoint);

  const recentAvg = recentHalf.reduce((sum, e) => sum + e.delta, 0) / recentHalf.length;
  const olderAvg = olderHalf.reduce((sum, e) => sum + e.delta, 0) / olderHalf.length;

  const diff = recentAvg - olderAvg;
  if (diff < -2) return "improving";
  if (diff > 2) return "worsening";
  return "stable";
}

export async function calculateRiskProfile(agentId: string): Promise<RiskProfile> {
  const agent = await storage.getAgent(agentId);
  if (!agent) throw new Error("Agent not found");

  const recentStart = getRecentWindowStart();

  const bondEvents = await storage.getBondEvents(agentId, 1000);
  const recentSlashes = bondEvents.filter(
    e => e.eventType === "SLASH" && e.createdAt && new Date(e.createdAt) >= recentStart
  );
  const recentSlashCount = recentSlashes.length;

  const gigs = await storage.getGigsByAgent(agentId);
  const completedGigs = gigs.filter(g => g.status === "completed").length;
  const failedGigs = gigs.filter(g => g.status === "disputed").length;
  const totalRelevant = completedGigs + failedGigs;
  const failedGigRatio = totalRelevant > 0 ? failedGigs / totalRelevant : 0;

  const escrows = await storage.getEscrowTransactions();
  const agentGigIds = new Set(gigs.map(g => g.id));
  const activeDisputeCount = escrows.filter(
    e => e.status === "disputed" && agentGigIds.has(e.gigId)
  ).length;

  const lastActive = agent.lastHeartbeat || agent.registeredAt || new Date();
  const inactivityDays = Math.floor(
    (Date.now() - new Date(lastActive).getTime()) / (1000 * 60 * 60 * 24)
  );

  const recentBondDepletions = bondEvents.filter(
    e => e.eventType === "WITHDRAW" && e.createdAt && new Date(e.createdAt) >= recentStart
  );
  const bondDepletionFreq = Math.min(recentBondDepletions.length, 5) / 5;

  const breakdown = computeRiskIndex(
    agent,
    recentSlashCount,
    failedGigRatio,
    activeDisputeCount,
    inactivityDays,
    bondDepletionFreq,
  );

  const riskEvents = await storage.getRiskEvents(agentId, 20);
  const trend = determineTrend(riskEvents);

  return {
    riskIndex: breakdown.finalScore,
    breakdown,
    trend,
    cleanStreakDays: agent.cleanStreakDays,
    feeMultiplier: computeFeeMultiplier(breakdown.finalScore),
    lastUpdated: agent.lastRiskUpdate?.toISOString() || null,
    recentEvents: riskEvents,
  };
}

export async function updateRiskIndex(agentId: string): Promise<number> {
  const profile = await calculateRiskProfile(agentId);

  await storage.updateAgent(agentId, {
    riskIndex: profile.riskIndex,
    lastRiskUpdate: new Date(),
  });

  console.log(`[Risk] Updated risk index for ${agentId}: ${profile.riskIndex}`);
  return profile.riskIndex;
}

export async function recordRiskEvent(
  agentId: string,
  factor: RiskFactor,
  delta: number,
  details?: string,
): Promise<RiskEvent> {
  const event = await storage.createRiskEvent({
    agentId,
    factor,
    delta,
    details: details || null,
  });

  if (factor === "SLASH" || factor === "FAILED_GIG" || factor === "DISPUTE_OPENED" || factor === "BOND_DEPLETION") {
    await storage.updateAgent(agentId, { cleanStreakDays: 0 });
  }

  if (factor === "DISPUTE_RESOLVED") {
    const agent = await storage.getAgent(agentId);
    if (agent) {
      const currentStreak = agent.cleanStreakDays;
      await storage.updateAgent(agentId, { cleanStreakDays: currentStreak + 1 });
    }
  }

  await updateRiskIndex(agentId);

  console.log(`[Risk] Event recorded for ${agentId}: ${factor} (delta: ${delta})`);
  return event;
}

export async function checkGigRiskEligibility(agentId: string, maxRisk?: number): Promise<{
  eligible: boolean;
  riskIndex: number;
  reason?: string;
}> {
  const profile = await calculateRiskProfile(agentId);
  const threshold = maxRisk ?? 75;

  if (profile.riskIndex > threshold) {
    return {
      eligible: false,
      riskIndex: profile.riskIndex,
      reason: `Risk index ${profile.riskIndex} exceeds maximum allowed ${threshold}`,
    };
  }

  return { eligible: true, riskIndex: profile.riskIndex };
}

export async function runInactivityCheck(): Promise<number> {
  const agents = await storage.getAgents();
  let updated = 0;

  for (const agent of agents) {
    const lastActive = agent.lastHeartbeat || agent.registeredAt || new Date();
    const daysSince = Math.floor(
      (Date.now() - new Date(lastActive).getTime()) / (1000 * 60 * 60 * 24)
    );

    if (daysSince > INACTIVITY_THRESHOLD_DAYS) {
      const existingEvents = await storage.getRiskEvents(agent.id, 5);
      const recentInactivity = existingEvents.find(
        e => e.factor === "INACTIVITY" && e.createdAt &&
          (Date.now() - new Date(e.createdAt).getTime()) < 24 * 60 * 60 * 1000
      );

      if (!recentInactivity) {
        const decayFactor = Math.min((daysSince - INACTIVITY_THRESHOLD_DAYS) / 30, 1);
        await recordRiskEvent(
          agent.id,
          "INACTIVITY",
          decayFactor * RISK_WEIGHTS.INACTIVITY,
          `Inactive for ${daysSince} days`,
        );
        updated++;
      }
    }
  }

  console.log(`[Risk] Inactivity check complete: ${updated} agents flagged`);
  return updated;
}

export function getRiskLevel(riskIndex: number): "low" | "medium" | "high" {
  if (riskIndex <= 25) return "low";
  if (riskIndex <= 60) return "medium";
  return "high";
}
