import type { Agent, ReputationEvent } from "@shared/schema";
import { type Address, getAddress, isAddress } from "viem";
import {
  getPublicClient,
  REPUTATION_REGISTRY_ADDRESS,
  REPUTATION_REGISTRY_ABI,
} from "./chain-client";
import {
  fetchMoltbookData,
  computeViralScore,
  normalizeMoltbookScore,
  type MoltbookAgentData,
  type MoltbookNormalized,
  type MoltbookViralScore,
} from "./moltbook-client";
export type { MoltbookViralScore };

const ON_CHAIN_WEIGHT_V1 = 0.6;
const MOLTBOOK_WEIGHT_V1 = 0.4;

export const PERFORMANCE_WEIGHT = 0.35;
export const ON_CHAIN_WEIGHT = 0.30;
export const BOND_RELIABILITY_WEIGHT = 0.20;
export const ECOSYSTEM_WEIGHT = 0.15;
export const MOLTBOOK_WEIGHT = ECOSYSTEM_WEIGHT;

export const INACTIVITY_DECAY_THRESHOLD_DAYS = 30;
export const INACTIVITY_DECAY_PENALTY = 0.10;

export const TRUST_SCORE_LABEL = "TrustScore";

export const MAX_ON_CHAIN_SCORE = 1000;
export const MAX_MOLTBOOK_KARMA = 10000;

export interface OnChainFeedback {
  from: string;
  to: string;
  score: number;
  tags: string[];
  proofUri: string;
  timestamp: number;
}

export interface OnChainReputation {
  onChainAvg: number;
  feedbackCount: number;
  feedbacks: OnChainFeedback[];
  proofURIs: string[];
  rawScore: number;
  source: "live" | "fallback";
  error?: string;
}

export interface FusedReputationResult {
  fusedScore: number;
  onChainAvg: number;
  moltWeight: number;
  performanceNormalized: number;
  bondReliabilityNormalized: number;
  proofURIs: string[];
  tier: string;
  badges: string[];
  weights: { onChain: number; moltbook: number; performance: number; bondReliability: number };
  source: "live" | "fallback";
  feedbacks: OnChainFeedback[];
  moltbook: {
    rawKarma: number;
    viralBonus: number;
    normalized: number;
    source: "api" | "scrape" | "cached" | "db_fallback";
    postCount: number;
    followers: number;
    topPostCount: number;
    viralScore: MoltbookViralScore;
    error?: string;
  };
  error?: string;
}

export interface FusedScoreBreakdown {
  fusedScore: number;
  onChainComponent: number;
  moltbookComponent: number;
  performanceComponent: number;
  bondReliabilityComponent: number;
  onChainNormalized: number;
  moltbookNormalized: number;
  performanceNormalized: number;
  bondReliabilityNormalized: number;
  rawOnChainScore: number;
  rawMoltbookKarma: number;
  weights: {
    onChain: number;
    moltbook: number;
    performance: number;
    bondReliability: number;
  };
  tier: string;
  badges: string[];
}

export function computeFusedScore(
  onChainScore: number,
  moltbookKarma: number,
  performanceScore?: number,
  bondReliability?: number,
  lastHeartbeat?: Date | null
): number {
  const onChainNormalized = Math.min(onChainScore / MAX_ON_CHAIN_SCORE, 1) * 100;
  const ecosystemNormalized = Math.min(moltbookKarma / MAX_MOLTBOOK_KARMA, 1) * 100;
  const perfNormalized = Math.min(performanceScore ?? 0, 100);
  const bondRelNormalized = Math.min(bondReliability ?? 0, 100);

  let fused =
    (PERFORMANCE_WEIGHT * perfNormalized) +
    (ON_CHAIN_WEIGHT * onChainNormalized) +
    (BOND_RELIABILITY_WEIGHT * bondRelNormalized) +
    (ECOSYSTEM_WEIGHT * ecosystemNormalized);

  if (lastHeartbeat) {
    const daysSinceHeartbeat = (Date.now() - lastHeartbeat.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceHeartbeat >= INACTIVITY_DECAY_THRESHOLD_DAYS) {
      fused *= (1 - INACTIVITY_DECAY_PENALTY);
    }
  }

  return Math.round(fused * 10) / 10;
}

export function computeSkillTrustMultiplier(
  agentVerifiedSkills: string[],
  requiredSkills: string[]
): number {
  if (requiredSkills.length === 0) return 1.0;
  const matchCount = requiredSkills.filter(rs =>
    agentVerifiedSkills.some(vs => vs.toLowerCase() === rs.toLowerCase())
  ).length;
  const matchRatio = matchCount / requiredSkills.length;
  return 1.0 + (matchRatio * 0.15);
}

export function computeContextualTrustScore(
  fusedScore: number,
  agentVerifiedSkills: string[],
  requiredSkills: string[]
): { trustScore: number; multiplier: number; matchedSkills: number; totalRequired: number } {
  const multiplier = computeSkillTrustMultiplier(agentVerifiedSkills, requiredSkills);
  return {
    trustScore: Math.round(fusedScore * multiplier * 10) / 10,
    multiplier: Math.round(multiplier * 100) / 100,
    matchedSkills: requiredSkills.filter(rs =>
      agentVerifiedSkills.some(vs => vs.toLowerCase() === rs.toLowerCase())
    ).length,
    totalRequired: requiredSkills.length,
  };
}

export function computeFusedScoreV1(
  onChainScore: number,
  moltbookKarma: number
): number {
  const onChainNormalized = Math.min(onChainScore / MAX_ON_CHAIN_SCORE, 1) * 100;
  const moltbookNormalized = Math.min(moltbookKarma / MAX_MOLTBOOK_KARMA, 1) * 100;
  const fused = (ON_CHAIN_WEIGHT_V1 * onChainNormalized) + (MOLTBOOK_WEIGHT_V1 * moltbookNormalized);
  return Math.round(fused * 10) / 10;
}

export function getScoreBreakdown(agent: Agent): FusedScoreBreakdown {
  const onChainNormalized = Math.min(agent.onChainScore / MAX_ON_CHAIN_SCORE, 1) * 100;
  const moltbookNormalized = Math.min(agent.moltbookKarma / MAX_MOLTBOOK_KARMA, 1) * 100;
  const performanceNormalized = Math.min(agent.performanceScore ?? 0, 100);
  const bondReliabilityNormalized = Math.min(agent.bondReliability ?? 0, 100);

  const performanceComponent = PERFORMANCE_WEIGHT * performanceNormalized;
  const onChainComponent = ON_CHAIN_WEIGHT * onChainNormalized;
  const bondReliabilityComponent = BOND_RELIABILITY_WEIGHT * bondReliabilityNormalized;
  const moltbookComponent = ECOSYSTEM_WEIGHT * moltbookNormalized;

  let fusedScore = performanceComponent + onChainComponent + bondReliabilityComponent + moltbookComponent;

  if (agent.lastHeartbeat) {
    const daysSinceHeartbeat = (Date.now() - agent.lastHeartbeat.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceHeartbeat >= INACTIVITY_DECAY_THRESHOLD_DAYS) {
      fusedScore *= (1 - INACTIVITY_DECAY_PENALTY);
    }
  }

  fusedScore = Math.round(fusedScore * 10) / 10;

  const tier = getTier(fusedScore);

  const badges: string[] = [];
  if (fusedScore >= 75) badges.push("Crustafarian");
  if (agent.totalGigsCompleted >= 20) badges.push("Gig Veteran");
  if (agent.moltbookKarma >= 5000) badges.push("Moltbook Influencer");
  if (agent.onChainScore >= 800) badges.push("Chain Champion");
  if (agent.isVerified) badges.push("ERC-8004 Verified");
  if (agent.bondReliability >= 90) badges.push("Bond Reliable");

  return {
    fusedScore,
    onChainComponent: Math.round(onChainComponent * 10) / 10,
    moltbookComponent: Math.round(moltbookComponent * 10) / 10,
    performanceComponent: Math.round(performanceComponent * 10) / 10,
    bondReliabilityComponent: Math.round(bondReliabilityComponent * 10) / 10,
    onChainNormalized: Math.round(onChainNormalized * 10) / 10,
    moltbookNormalized: Math.round(moltbookNormalized * 10) / 10,
    performanceNormalized: Math.round(performanceNormalized * 10) / 10,
    bondReliabilityNormalized: Math.round(bondReliabilityNormalized * 10) / 10,
    rawOnChainScore: agent.onChainScore,
    rawMoltbookKarma: agent.moltbookKarma,
    weights: {
      onChain: ON_CHAIN_WEIGHT,
      moltbook: ECOSYSTEM_WEIGHT,
      performance: PERFORMANCE_WEIGHT,
      bondReliability: BOND_RELIABILITY_WEIGHT,
    },
    tier,
    badges,
  };
}

export async function fetchOnChainReputation(
  walletAddress: string
): Promise<OnChainReputation> {
  const client = getPublicClient();

  let address: Address;
  try {
    address = getAddress(walletAddress.toLowerCase());
  } catch {
    return {
      onChainAvg: 0,
      feedbackCount: 0,
      feedbacks: [],
      proofURIs: [],
      rawScore: 0,
      source: "fallback",
      error: `Invalid wallet address: ${walletAddress}`,
    };
  }

  try {
    const rawScore = await client.readContract({
      address: REPUTATION_REGISTRY_ADDRESS,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: "getScore",
      args: [address],
    });

    const feedbackCount = await client.readContract({
      address: REPUTATION_REGISTRY_ADDRESS,
      abi: REPUTATION_REGISTRY_ABI,
      functionName: "getFeedbackCount",
      args: [address],
    });

    const count = Number(feedbackCount);
    const score = Number(rawScore);
    const feedbacks: OnChainFeedback[] = [];
    const proofURIs: string[] = [];

    const maxFetch = Math.min(count, 50);
    for (let i = 0; i < maxFetch; i++) {
      try {
        const fb = await client.readContract({
          address: REPUTATION_REGISTRY_ADDRESS,
          abi: REPUTATION_REGISTRY_ABI,
          functionName: "getFeedback",
          args: [address, BigInt(i)],
        });

        const feedback: OnChainFeedback = {
          from: fb.from,
          to: fb.to,
          score: Number(fb.score),
          tags: [...fb.tags],
          proofUri: fb.proofUri,
          timestamp: Number(fb.timestamp),
        };
        feedbacks.push(feedback);

        if (fb.proofUri && fb.proofUri.length > 0) {
          proofURIs.push(fb.proofUri);
        }
      } catch {
        break;
      }
    }

    const rawAvg = count > 0
      ? feedbacks.reduce((sum, f) => sum + f.score, 0) / feedbacks.length
      : score;
    const onChainAvg = Math.max(rawAvg, 0);

    return {
      onChainAvg: Math.round(onChainAvg * 10) / 10,
      feedbackCount: count,
      feedbacks,
      proofURIs,
      rawScore: score,
      source: "live",
    };
  } catch (err: any) {
    const errorMsg = err?.message || "Unknown RPC error";
    console.warn(`[reputation] On-chain fetch failed for ${walletAddress}: ${errorMsg}`);

    return {
      onChainAvg: 0,
      feedbackCount: 0,
      feedbacks: [],
      proofURIs: [],
      rawScore: 0,
      source: "fallback",
      error: `Registry call failed: ${errorMsg.substring(0, 200)}`,
    };
  }
}

export interface MoltbookReputationResult extends MoltbookNormalized {
  agentData: MoltbookAgentData | null;
  viralScore: MoltbookViralScore;
}

export async function fetchMoltbookReputation(
  agent: Agent
): Promise<MoltbookReputationResult> {
  try {
    const moltData = await fetchMoltbookData(agent.handle, agent.moltbookLink);

    if (moltData.error && moltData.karma === 0) {
      console.log(`[reputation] Moltbook unavailable for ${agent.handle}, ecosystem component = 0`);
      return {
        moltbookNormalized: 0,
        rawKarma: 0,
        viralBonus: 0,
        source: "db_fallback",
        error: moltData.error,
        agentData: moltData,
        viralScore: { viralBonus: 0, totalInteractions: 0, weightedScore: 0, postCount: 0 },
      };
    }

    const karma = moltData.karma > 0 ? moltData.karma : 0;
    const viralResult = computeViralScore(moltData.topPosts);
    const normalized = normalizeMoltbookScore(karma, viralResult.viralBonus);

    return {
      moltbookNormalized: normalized,
      rawKarma: karma,
      viralBonus: viralResult.viralBonus,
      source: moltData.source,
      agentData: moltData,
      viralScore: viralResult,
    };
  } catch (err: any) {
    console.warn(`[reputation] Moltbook fetch error for ${agent.handle}: ${err.message}`);
    return {
      moltbookNormalized: 0,
      rawKarma: 0,
      viralBonus: 0,
      source: "db_fallback",
      error: err.message,
      agentData: null,
      viralScore: { viralBonus: 0, totalInteractions: 0, weightedScore: 0, postCount: 0 },
    };
  }
}

export function getTier(fusedScore: number): string {
  if (fusedScore >= 90) return "Diamond Claw";
  if (fusedScore >= 70) return "Gold Shell";
  if (fusedScore >= 50) return "Silver Molt";
  if (fusedScore >= 30) return "Bronze Pinch";
  return "Hatchling";
}

function getBadges(agent: Agent, fusedScore: number, rawKarma: number): string[] {
  const badges: string[] = [];
  if (fusedScore >= 75) badges.push("Crustafarian");
  if (agent.totalGigsCompleted >= 20) badges.push("Gig Veteran");
  if (rawKarma >= 5000) badges.push("Moltbook Influencer");
  if (agent.onChainScore >= 800) badges.push("Chain Champion");
  if (agent.isVerified) badges.push("ERC-8004 Verified");
  return badges;
}

export async function computeLiveFusedReputation(
  agent: Agent
): Promise<FusedReputationResult> {
  const [onChain, moltResult] = await Promise.all([
    fetchOnChainReputation(agent.walletAddress),
    fetchMoltbookReputation(agent),
  ]);

  let onChainAvg: number;
  if (onChain.source === "live") {
    onChainAvg = onChain.onChainAvg;
  } else {
    onChainAvg = Math.min(agent.onChainScore / MAX_ON_CHAIN_SCORE, 1) * 100;
  }

  const normalizedOnChain = Math.min(Math.max(onChainAvg, 0), 100);
  const moltWeight = moltResult.moltbookNormalized;
  const perfNormalized = Math.min(agent.performanceScore ?? 0, 100);
  const bondRelNormalized = Math.min(agent.bondReliability ?? 0, 100);

  let fusedScore =
    PERFORMANCE_WEIGHT * perfNormalized +
    ON_CHAIN_WEIGHT * normalizedOnChain +
    BOND_RELIABILITY_WEIGHT * bondRelNormalized +
    ECOSYSTEM_WEIGHT * moltWeight;

  if (agent.lastHeartbeat) {
    const daysSinceHeartbeat = (Date.now() - agent.lastHeartbeat.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceHeartbeat >= INACTIVITY_DECAY_THRESHOLD_DAYS) {
      fusedScore *= (1 - INACTIVITY_DECAY_PENALTY);
    }
  }

  fusedScore = Math.round(fusedScore * 10) / 10;

  const moltbookDetail = moltResult.agentData;

  return {
    fusedScore,
    onChainAvg: Math.round(normalizedOnChain * 10) / 10,
    moltWeight: Math.round(moltWeight * 10) / 10,
    performanceNormalized: Math.round(perfNormalized * 10) / 10,
    bondReliabilityNormalized: Math.round(bondRelNormalized * 10) / 10,
    proofURIs: onChain.proofURIs,
    tier: getTier(fusedScore),
    badges: getBadges(agent, fusedScore, moltResult.rawKarma),
    weights: { onChain: ON_CHAIN_WEIGHT, moltbook: ECOSYSTEM_WEIGHT, performance: PERFORMANCE_WEIGHT, bondReliability: BOND_RELIABILITY_WEIGHT },
    source: onChain.source,
    feedbacks: onChain.feedbacks,
    moltbook: {
      rawKarma: moltResult.rawKarma,
      viralBonus: moltResult.viralBonus,
      normalized: moltWeight,
      source: moltResult.source,
      postCount: moltbookDetail?.postCount ?? 0,
      followers: moltbookDetail?.followers ?? 0,
      topPostCount: moltbookDetail?.topPosts?.length ?? 0,
      viralScore: moltResult.viralScore,
      error: moltResult.error,
    },
    error: onChain.error,
  };
}

export function estimateRepBoostFromMolt(
  currentKarma: number,
  postInteractions: number
): { karmaBoost: number; newKarma: number; scoreDelta: number } {
  const karmaBoost = Math.min(Math.floor(postInteractions * 0.1), 500);
  const newKarma = currentKarma + karmaBoost;
  const oldFused = computeFusedScore(0, currentKarma);
  const newFused = computeFusedScore(0, newKarma);
  return {
    karmaBoost,
    newKarma,
    scoreDelta: Math.round((newFused - oldFused) * 10) / 10,
  };
}
