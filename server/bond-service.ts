import { storage } from "./storage";
import { createEscrowWallet, getWalletBalance, transferUSDC, isCircleConfigured, getWalletAddress } from "./circle-wallet";
import type { Agent, BondEvent } from "@shared/schema";

const BOND_TIERS = {
  UNBONDED: { min: 0, max: 0 },
  BONDED: { min: 10, max: 499.99 },
  HIGH_BOND: { min: 500, max: Infinity },
} as const;

const SLASH_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_DEPOSIT = 10;
const MAX_SLASH_PERCENT = 0.2;

function computeTier(totalBonded: number): "UNBONDED" | "BONDED" | "HIGH_BOND" {
  if (totalBonded >= BOND_TIERS.HIGH_BOND.min) return "HIGH_BOND";
  if (totalBonded >= BOND_TIERS.BONDED.min) return "BONDED";
  return "UNBONDED";
}

export async function getBondStatus(agentId: string): Promise<{
  totalBonded: number;
  availableBond: number;
  lockedBond: number;
  bondTier: string;
  bondReliability: number;
  bondWalletId: string | null;
  bondWalletAddress: string | null;
  lastSlashAt: string | null;
  circleConfigured: boolean;
}> {
  const agent = await storage.getAgent(agentId);
  if (!agent) throw new Error("Agent not found");

  let bondWalletAddress: string | null = null;
  if (agent.bondWalletId) {
    bondWalletAddress = await getWalletAddress(agent.bondWalletId).catch(() => null);
  }

  return {
    totalBonded: agent.totalBonded,
    availableBond: agent.availableBond,
    lockedBond: agent.lockedBond,
    bondTier: agent.bondTier,
    bondReliability: agent.bondReliability,
    bondWalletId: agent.bondWalletId,
    bondWalletAddress,
    lastSlashAt: agent.lastSlashAt?.toISOString() || null,
    circleConfigured: isCircleConfigured(),
  };
}

export async function ensureBondWallet(agentId: string): Promise<{ walletId: string; address: string }> {
  const agent = await storage.getAgent(agentId);
  if (!agent) throw new Error("Agent not found");

  if (agent.bondWalletId) {
    const address = await getWalletAddress(agent.bondWalletId);
    if (address) return { walletId: agent.bondWalletId, address };
  }

  if (!isCircleConfigured()) {
    throw new Error("Circle is not configured. Bond wallet creation requires CIRCLE_API_KEY.");
  }

  const wallet = await createEscrowWallet("BASE_SEPOLIA");
  await storage.updateAgent(agentId, { bondWalletId: wallet.walletId });
  console.log(`[Bond] Created bond wallet for agent ${agentId}: ${wallet.address}`);

  return { walletId: wallet.walletId, address: wallet.address };
}

export async function depositBond(agentId: string, amount: number): Promise<BondEvent> {
  if (amount < MIN_DEPOSIT) {
    throw new Error(`Minimum deposit is ${MIN_DEPOSIT} USDC`);
  }

  const agent = await storage.getAgent(agentId);
  if (!agent) throw new Error("Agent not found");

  const newTotal = agent.totalBonded + amount;
  const newAvailable = agent.availableBond + amount;
  const newTier = computeTier(newTotal);

  const completedGigs = agent.totalGigsCompleted || 0;
  const slashCount = await getSlashCount(agentId);
  const reliability = completedGigs > 0
    ? Math.max(0, Math.min(100, ((completedGigs - slashCount) / completedGigs) * 100))
    : 100;

  await storage.updateAgent(agentId, {
    totalBonded: newTotal,
    availableBond: newAvailable,
    bondTier: newTier,
    bondReliability: reliability,
  });

  const event = await storage.createBondEvent({
    agentId,
    eventType: "DEPOSIT",
    amount,
    reason: `Deposited ${amount} USDC bond`,
  });

  console.log(`[Bond] Agent ${agentId} deposited ${amount} USDC. Total: ${newTotal}, Tier: ${newTier}`);
  return event;
}

export async function withdrawBond(agentId: string, amount: number): Promise<BondEvent> {
  const agent = await storage.getAgent(agentId);
  if (!agent) throw new Error("Agent not found");

  if (amount > agent.availableBond) {
    throw new Error(`Insufficient available bond. Available: ${agent.availableBond} USDC, Requested: ${amount} USDC`);
  }

  if (amount <= 0) {
    throw new Error("Withdrawal amount must be positive");
  }

  const newTotal = agent.totalBonded - amount;
  const newAvailable = agent.availableBond - amount;
  const newTier = computeTier(newTotal);

  await storage.updateAgent(agentId, {
    totalBonded: newTotal,
    availableBond: newAvailable,
    bondTier: newTier,
  });

  const event = await storage.createBondEvent({
    agentId,
    eventType: "WITHDRAW",
    amount,
    reason: `Withdrew ${amount} USDC bond`,
  });

  console.log(`[Bond] Agent ${agentId} withdrew ${amount} USDC. Total: ${newTotal}, Tier: ${newTier}`);
  return event;
}

export async function lockBond(agentId: string, amount: number, gigId: string): Promise<BondEvent> {
  const agent = await storage.getAgent(agentId);
  if (!agent) throw new Error("Agent not found");

  if (amount > agent.availableBond) {
    throw new Error(`Insufficient available bond to lock. Available: ${agent.availableBond}, Requested: ${amount}`);
  }

  await storage.updateAgent(agentId, {
    availableBond: agent.availableBond - amount,
    lockedBond: agent.lockedBond + amount,
  });

  const event = await storage.createBondEvent({
    agentId,
    eventType: "LOCK",
    amount,
    gigId,
    reason: `Locked ${amount} USDC for gig ${gigId}`,
  });

  console.log(`[Bond] Agent ${agentId} locked ${amount} USDC for gig ${gigId}`);
  return event;
}

export async function unlockBond(agentId: string, amount: number, gigId: string): Promise<BondEvent> {
  const agent = await storage.getAgent(agentId);
  if (!agent) throw new Error("Agent not found");

  const unlockAmount = Math.min(amount, agent.lockedBond);

  await storage.updateAgent(agentId, {
    availableBond: agent.availableBond + unlockAmount,
    lockedBond: agent.lockedBond - unlockAmount,
  });

  const event = await storage.createBondEvent({
    agentId,
    eventType: "UNLOCK",
    amount: unlockAmount,
    gigId,
    reason: `Unlocked ${unlockAmount} USDC from gig ${gigId}`,
  });

  console.log(`[Bond] Agent ${agentId} unlocked ${unlockAmount} USDC from gig ${gigId}`);
  return event;
}

export async function slashBond(agentId: string, gigId: string, reason: string): Promise<BondEvent> {
  const agent = await storage.getAgent(agentId);
  if (!agent) throw new Error("Agent not found");

  if (agent.lastSlashAt) {
    const timeSinceSlash = Date.now() - agent.lastSlashAt.getTime();
    if (timeSinceSlash < SLASH_COOLDOWN_MS) {
      throw new Error("Double-slash protection: Agent was slashed within the last 7 days");
    }
  }

  const slashAmount = Math.min(
    agent.lockedBond * MAX_SLASH_PERCENT,
    agent.lockedBond
  );

  if (slashAmount <= 0) {
    throw new Error("No locked bond available to slash");
  }

  const newTotal = agent.totalBonded - slashAmount;
  const newLocked = agent.lockedBond - slashAmount;
  const newTier = computeTier(newTotal);

  const completedGigs = agent.totalGigsCompleted || 0;
  const slashCount = (await getSlashCount(agentId)) + 1;
  const reliability = completedGigs > 0
    ? Math.max(0, Math.min(100, ((completedGigs - slashCount) / Math.max(completedGigs, slashCount)) * 100))
    : 0;

  await storage.updateAgent(agentId, {
    totalBonded: newTotal,
    lockedBond: newLocked,
    bondTier: newTier,
    bondReliability: reliability,
    lastSlashAt: new Date(),
  });

  const event = await storage.createBondEvent({
    agentId,
    eventType: "SLASH",
    amount: slashAmount,
    gigId,
    reason: `Slashed ${slashAmount.toFixed(2)} USDC: ${reason}`,
  });

  console.log(`[Bond] Agent ${agentId} slashed ${slashAmount.toFixed(2)} USDC for gig ${gigId}: ${reason}`);
  return event;
}

export function checkBondEligibility(agent: Agent, requiredBond: number = 0): {
  eligible: boolean;
  reason: string;
  bondTier: string;
  availableBond: number;
} {
  if (requiredBond <= 0) {
    return { eligible: true, reason: "No bond required", bondTier: agent.bondTier, availableBond: agent.availableBond };
  }

  if (agent.bondTier === "UNBONDED") {
    return { eligible: false, reason: "Agent has no active bond", bondTier: agent.bondTier, availableBond: agent.availableBond };
  }

  if (agent.availableBond < requiredBond) {
    return {
      eligible: false,
      reason: `Insufficient bond. Required: ${requiredBond} USDC, Available: ${agent.availableBond} USDC`,
      bondTier: agent.bondTier,
      availableBond: agent.availableBond,
    };
  }

  return { eligible: true, reason: "Bond check passed", bondTier: agent.bondTier, availableBond: agent.availableBond };
}

export async function getBondHistory(agentId: string, limit = 50): Promise<BondEvent[]> {
  return storage.getBondEvents(agentId, limit);
}

async function getSlashCount(agentId: string): Promise<number> {
  const events = await storage.getBondEvents(agentId, 1000);
  return events.filter(e => e.eventType === "SLASH").length;
}

export async function getNetworkBondStats(): Promise<{
  totalBonded: number;
  bondedAgents: number;
  highBondAgents: number;
  avgBond: number;
}> {
  const allAgents = await storage.getAgents();
  const bondedAgents = allAgents.filter(a => a.totalBonded > 0);
  const totalBonded = bondedAgents.reduce((sum, a) => sum + a.totalBonded, 0);
  const highBondAgents = allAgents.filter(a => a.bondTier === "HIGH_BOND").length;
  const avgBond = bondedAgents.length > 0 ? totalBonded / bondedAgents.length : 0;

  return {
    totalBonded,
    bondedAgents: bondedAgents.length,
    highBondAgents,
    avgBond,
  };
}
