import { storage } from "./storage";
import { createEscrowWallet, getWalletBalance, transferUSDC, isCircleConfigured, getWalletAddress } from "./circle-wallet";
import type { Agent, BondEvent } from "@shared/schema";
import { ON_CHAIN_WEIGHT, ECOSYSTEM_WEIGHT, PERFORMANCE_WEIGHT, BOND_RELIABILITY_WEIGHT, MAX_ON_CHAIN_SCORE, MAX_MOLTBOOK_KARMA, INACTIVITY_DECAY_THRESHOLD_DAYS, INACTIVITY_DECAY_PENALTY } from "./reputation";
import { queueBlockchainAction, depositBondOnChain, updatePerformanceScoreOnChain, lockBondForGigOnChain, slashBondOnChain, readOnChainBond, markBlockchainActionComplete } from "./blockchain";

const BOND_TIERS = {
  UNBONDED: { min: 0, max: 0 },
  BONDED: { min: 10, max: 499.99 },
  HIGH_BOND: { min: 500, max: Infinity },
} as const;

const SLASH_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_DEPOSIT = 10;
const MAX_SLASH_PERCENT = 0.2;

export const MIN_FUSED_SCORE = 15;

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

  const walletAddress = agent.walletAddress;
  if (walletAddress && /^0x[a-fA-F0-9]{40}$/.test(walletAddress) && !/^0x0+$/.test(walletAddress)) {
    const actionId = await queueBlockchainAction({
      type: "BOND_DEPOSIT",
      agentId,
      payload: { agentId, agentWallet: walletAddress, amount },
    });

    setImmediate(async () => {
      try {
        const depositResult = await depositBondOnChain({ agentId, agentWallet: walletAddress, amount });
        if (depositResult !== null) {
          if (actionId !== null) {
            await markBlockchainActionComplete(actionId);
          }
          if (depositResult !== "SKIPPED") {
            const onChain = await readOnChainBond(walletAddress);
            if (onChain !== null) {
              const diff = Math.abs(onChain.totalDeposited - newTotal);
              if (diff > 1) {
                console.warn(`[Bond] RECONCILIATION MISMATCH agent=${agentId} wallet=${walletAddress} dbTotal=${newTotal} onChainTotal=${onChain.totalDeposited} diff=${diff.toFixed(2)}`);
              } else {
                console.log(`[Bond] Reconciliation OK agent=${agentId}: db=${newTotal} onChain=${onChain.totalDeposited}`);
              }
            }
          }
        } else {
          console.warn(`[Bond] depositOnChain failed for ${agentId} — BOND_DEPOSIT queued id=${actionId} will retry`);
        }
      } catch (err: any) {
        console.warn(`[Bond] depositOnChain error for ${agentId}:`, err.message?.slice(0, 100));
      }
    });
  }

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

  const recentDeposits = await storage.getBondEvents(agentId, 100);
  const lastDeposit = recentDeposits.find(e => e.eventType === "DEPOSIT" && e.createdAt);
  if (lastDeposit) {
    const depositAge = Date.now() - new Date(lastDeposit.createdAt!).getTime();
    if (depositAge < FLASH_WITHDRAW_THRESHOLD_MS) {
      console.warn(`[Bond] FLASH_WITHDRAW detected for agent ${agentId} — deposit was ${Math.round(depositAge / 3600000)}h ago`);
      await storage.createBondEvent({
        agentId,
        eventType: "FLASH_WITHDRAW",
        amount,
        reason: `Flash withdraw: bond withdrawn ${Math.round(depositAge / 3600000)}h after deposit (threshold: 48h)`,
      });
      await storage.createReputationEvent({
        agentId,
        eventType: "Flash Withdraw Penalty",
        scoreChange: -5,
        source: "escrow",
        details: `Bond withdrawn within ${Math.round(depositAge / 3600000)}h of deposit (${amount} USDC). Flash-deposit pattern detected.`,
        proofUri: null,
      });
    }
  }

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

  await storage.createSlashEvent({
    agentId,
    gigId: gigId || null,
    amount: slashAmount,
    reason,
    scoreBefore: agent.fusedScore ?? 0,
    scoreAfter: Math.max(0, (agent.fusedScore ?? 0) - slashAmount * 0.1),
  });

  const slashedAgent = await storage.getAgent(agentId);
  const slashWallet = slashedAgent?.walletAddress;
  if (slashWallet && /^0x[a-fA-F0-9]{40}$/.test(slashWallet) && !/^0x0+$/.test(slashWallet) && gigId) {
    const slashResult = await slashBondOnChain({ gigId });
    if (slashResult === null) {
      await queueBlockchainAction({
        type: "BOND_SLASH",
        agentId,
        gigId,
        payload: { gigId },
      });
    }
  }

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

const MIN_PERFORMANCE_SCORE = 10;

export function computePerformanceScore(
  agent: Agent,
  disputeRate: number = 0,
  repeatHireRate: number = 0
): number {
  // agent.totalGigsCompleted already includes both gig and commerce completions
  const totalJobsDone = agent.totalGigsCompleted || 0;
  const gigsComponent = Math.min(totalJobsDone * 5, 100);
  const reliabilityComponent = Math.min(agent.bondReliability ?? 0, 100);
  const disputePenalty = Math.min(disputeRate * 100, 50);
  const repeatHireBonus = Math.min(repeatHireRate * 30, 30);

  const score = Math.round(
    gigsComponent * 0.40 +
    reliabilityComponent * 0.30 +
    repeatHireBonus * 0.30 -
    disputePenalty * 0.20
  );
  return Math.max(0, Math.min(100, score));
}

export async function computeDisputeRate(agentId: string): Promise<number> {
  const agent = await storage.getAgent(agentId);
  if (!agent || agent.totalGigsCompleted === 0) return 0;
  const slashEvents = await storage.getBondEvents(agentId, 1000);
  const slashCount = slashEvents.filter(e => e.eventType === "SLASH").length;
  return slashCount / Math.max(agent.totalGigsCompleted, 1);
}

export async function computeRepeatHireRate(agentId: string): Promise<number> {
  try {
    const allGigs = await storage.getGigs();
    const completedAssigned = allGigs.filter(g => g.assigneeId === agentId && g.status === "completed");
    if (completedAssigned.length <= 1) return 0;
    const posterCounts = new Map<string, number>();
    for (const g of completedAssigned) {
      posterCounts.set(g.posterId, (posterCounts.get(g.posterId) || 0) + 1);
    }
    const repeatGigs = completedAssigned.filter(g => (posterCounts.get(g.posterId) || 0) > 1).length;
    const totalCompleted = completedAssigned.length;
    return totalCompleted > 0 ? repeatGigs / totalCompleted : 0;
  } catch {
    return 0;
  }
}

const BOND_MATURITY_DAYS = 7;
const FLASH_WITHDRAW_THRESHOLD_MS = 48 * 60 * 60 * 1000;

export async function syncPerformanceScore(agentId: string): Promise<number> {
  const agent = await storage.getAgent(agentId);
  if (!agent) throw new Error("Agent not found");

  const bondEvents = await storage.getBondEvents(agentId, 1000);
  const slashCount = bondEvents.filter(e => e.eventType === "SLASH").length;
  const now = Date.now();
  const deposits = bondEvents.filter(e => e.eventType === "DEPOSIT" && e.createdAt);
  let totalBondDays = 0;
  for (const dep of deposits) {
    const depositTime = new Date(dep.createdAt!).getTime();
    const heldDays = (now - depositTime) / (1000 * 60 * 60 * 24);
    if (heldDays >= BOND_MATURITY_DAYS) {
      totalBondDays += heldDays;
    }
  }
  const maxBondDays = deposits.length * 365;
  let bondReliability: number;
  if (deposits.length > 0 && maxBondDays > 0 && totalBondDays > 0) {
    const holdRatio = Math.min(totalBondDays / maxBondDays, 1);
    const slashPenalty = slashCount / deposits.length;
    bondReliability = Math.round(Math.max(0, (holdRatio - slashPenalty)) * 100);
  } else {
    bondReliability = agent.bondTier !== "UNBONDED" ? 50 : (agent.isVerified ? 50 : 0);
  }

  const [disputeRate, repeatHireRate] = await Promise.all([
    computeDisputeRate(agentId),
    computeRepeatHireRate(agentId),
  ]);

  const updatedAgent = { ...agent, bondReliability };
  // agent.totalGigsCompleted already includes both gig and commerce completions via settle endpoint
  const score = computePerformanceScore(updatedAgent, disputeRate, repeatHireRate);

  const onChainNorm = Math.min((agent.onChainScore / MAX_ON_CHAIN_SCORE) * 100, 100);
  const ecosystemNorm = Math.min((agent.moltbookKarma / MAX_MOLTBOOK_KARMA) * 100, 100);
  const verifiedSkillsBonus = Math.min((agent.verifiedSkills || []).length, 5);
  let fusedScore =
    (PERFORMANCE_WEIGHT * score) +
    (ON_CHAIN_WEIGHT * onChainNorm) +
    (BOND_RELIABILITY_WEIGHT * bondReliability) +
    (ECOSYSTEM_WEIGHT * ecosystemNorm) +
    verifiedSkillsBonus;

  if (agent.lastHeartbeat) {
    const daysSinceHeartbeat = (Date.now() - agent.lastHeartbeat.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceHeartbeat >= INACTIVITY_DECAY_THRESHOLD_DAYS) {
      fusedScore *= (1 - INACTIVITY_DECAY_PENALTY);
    }
  }

  fusedScore = Math.round(fusedScore);

  await storage.updateAgent(agentId, {
    performanceScore: score,
    bondReliability,
    fusedScore: Math.max(0, Math.min(100, fusedScore)),
  });
  console.log(`[Bond] Synced scores for ${agentId}: perf=${score}, bondRel=${bondReliability}, fused=${fusedScore}, disputeRate=${disputeRate.toFixed(2)}, repeatHireRate=${repeatHireRate.toFixed(2)}`);

  // Only push performance scores on-chain for agents that have an active bond.
  // The bond contract's updatePerformanceScore reverts for unregistered agents,
  // causing "Missing or invalid parameters" RPC errors and wasting nonce budget.
  const hasBond = (agent.totalBonded ?? 0) > 0;
  if (hasBond && agent.walletAddress && /^0x[a-fA-F0-9]{40}$/.test(agent.walletAddress) && !/^0x0+$/.test(agent.walletAddress)) {
    const tx = await updatePerformanceScoreOnChain({ agentWallet: agent.walletAddress, score });
    if (tx === null) {
      await queueBlockchainAction({
        type: "BOND_PERF_SCORE",
        agentId,
        payload: { agentWallet: agent.walletAddress, score },
      }).catch(() => {});
    }
  }

  return score;
}

export async function lockBondForGig(agentId: string, gigId: string, bondRequired: number): Promise<{
  locked: boolean;
  autoSlashed: boolean;
  reason: string;
}> {
  const agent = await storage.getAgent(agentId);
  if (!agent) throw new Error("Agent not found");

  if (bondRequired <= 0) {
    return { locked: false, autoSlashed: false, reason: "No bond required for this gig" };
  }

  if (agent.bondTier === "UNBONDED") {
    return { locked: false, autoSlashed: false, reason: "Agent has no active bond" };
  }

  if (agent.availableBond < bondRequired) {
    return { locked: false, autoSlashed: false, reason: `Insufficient bond. Required: ${bondRequired}, Available: ${agent.availableBond}` };
  }

  const perfScore = computePerformanceScore(agent);
  await storage.updateAgent(agentId, { performanceScore: perfScore });

  if (perfScore < MIN_PERFORMANCE_SCORE) {
    const slashAmount = Math.min(bondRequired * MAX_SLASH_PERCENT, agent.availableBond);
    if (slashAmount > 0) {
      const newTotal = agent.totalBonded - slashAmount;
      const newAvailable = agent.availableBond - slashAmount;
      const newTier = computeTier(newTotal);

      await storage.updateAgent(agentId, {
        totalBonded: newTotal,
        availableBond: newAvailable,
        bondTier: newTier,
      });

      await storage.createBondEvent({
        agentId,
        eventType: "SLASH",
        amount: slashAmount,
        gigId,
        reason: `Auto-slashed ${slashAmount.toFixed(2)} USDC: performance score ${perfScore} below threshold ${MIN_PERFORMANCE_SCORE}`,
      });

      console.log(`[Bond] Auto-slash for agent ${agentId}: ${slashAmount.toFixed(2)} USDC (perf: ${perfScore})`);
    }

    return { locked: false, autoSlashed: true, reason: `Performance score ${perfScore} is below threshold ${MIN_PERFORMANCE_SCORE}. Bond auto-slashed.` };
  }

  await lockBond(agentId, bondRequired, gigId);

  const freshAgent = await storage.getAgent(agentId);
  const walletAddress = freshAgent?.walletAddress;
  if (walletAddress && /^0x[a-fA-F0-9]{40}$/.test(walletAddress) && !/^0x0+$/.test(walletAddress)) {
    const lockResult = await lockBondForGigOnChain({ agentWallet: walletAddress, gigId, amount: bondRequired });
    if (lockResult === null) {
      await queueBlockchainAction({
        type: "BOND_LOCK",
        agentId,
        gigId,
        payload: { agentWallet: walletAddress, gigId, amount: bondRequired },
      });
    }
  }

  return { locked: true, autoSlashed: false, reason: `Locked ${bondRequired} USDC for gig ${gigId}` };
}

export async function unlockBondForGig(agentId: string, gigId: string): Promise<void> {
  const events = await storage.getBondEvents(agentId, 1000);
  const lockEvent = events.find(e => e.eventType === "LOCK" && e.gigId === gigId);
  if (lockEvent) {
    await unlockBond(agentId, lockEvent.amount, gigId);
    await syncPerformanceScore(agentId);
  }
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
