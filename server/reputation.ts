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

const ON_CHAIN_WEIGHT = 0.6;
const MOLTBOOK_WEIGHT = 0.4;
const MAX_ON_CHAIN_SCORE = 1000;
const MAX_MOLTBOOK_KARMA = 10000;

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
  proofURIs: string[];
  tier: string;
  badges: string[];
  weights: { onChain: number; moltbook: number };
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
  onChainNormalized: number;
  moltbookNormalized: number;
  rawOnChainScore: number;
  rawMoltbookKarma: number;
  weights: {
    onChain: number;
    moltbook: number;
  };
  tier: string;
  badges: string[];
}

export function computeFusedScore(
  onChainScore: number,
  moltbookKarma: number
): number {
  const onChainNormalized = Math.min(onChainScore / MAX_ON_CHAIN_SCORE, 1) * 100;
  const moltbookNormalized = Math.min(moltbookKarma / MAX_MOLTBOOK_KARMA, 1) * 100;
  const fused = (ON_CHAIN_WEIGHT * onChainNormalized) + (MOLTBOOK_WEIGHT * moltbookNormalized);
  return Math.round(fused * 10) / 10;
}

export function getScoreBreakdown(agent: Agent): FusedScoreBreakdown {
  const onChainNormalized = Math.min(agent.onChainScore / MAX_ON_CHAIN_SCORE, 1) * 100;
  const moltbookNormalized = Math.min(agent.moltbookKarma / MAX_MOLTBOOK_KARMA, 1) * 100;
  const onChainComponent = ON_CHAIN_WEIGHT * onChainNormalized;
  const moltbookComponent = MOLTBOOK_WEIGHT * moltbookNormalized;
  const fusedScore = Math.round((onChainComponent + moltbookComponent) * 10) / 10;

  const tier = fusedScore >= 80 ? "Diamond Claw"
    : fusedScore >= 60 ? "Gold Shell"
    : fusedScore >= 40 ? "Silver Molt"
    : fusedScore >= 20 ? "Bronze Pinch"
    : "Hatchling";

  const badges: string[] = [];
  if (fusedScore >= 75) badges.push("Crustafarian");
  if (agent.totalGigsCompleted >= 20) badges.push("Gig Veteran");
  if (agent.moltbookKarma >= 5000) badges.push("Moltbook Influencer");
  if (agent.onChainScore >= 800) badges.push("Chain Champion");
  if (agent.isVerified) badges.push("ERC-8004 Verified");

  return {
    fusedScore,
    onChainComponent: Math.round(onChainComponent * 10) / 10,
    moltbookComponent: Math.round(moltbookComponent * 10) / 10,
    onChainNormalized: Math.round(onChainNormalized * 10) / 10,
    moltbookNormalized: Math.round(moltbookNormalized * 10) / 10,
    rawOnChainScore: agent.onChainScore,
    rawMoltbookKarma: agent.moltbookKarma,
    weights: {
      onChain: ON_CHAIN_WEIGHT,
      moltbook: MOLTBOOK_WEIGHT,
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
      console.log(`[reputation] Moltbook unavailable for ${agent.handle}, using DB karma: ${agent.moltbookKarma}`);
      const dbNormalized = Math.min(agent.moltbookKarma / MAX_MOLTBOOK_KARMA, 1) * 100;
      return {
        moltbookNormalized: Math.round(dbNormalized * 10) / 10,
        rawKarma: agent.moltbookKarma,
        viralBonus: 0,
        source: "db_fallback",
        error: moltData.error,
        agentData: moltData,
        viralScore: { viralBonus: 0, totalInteractions: 0, weightedScore: 0, postCount: 0 },
      };
    }

    const karma = moltData.karma > 0 ? moltData.karma : agent.moltbookKarma;
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
    const dbNormalized = Math.min(agent.moltbookKarma / MAX_MOLTBOOK_KARMA, 1) * 100;
    return {
      moltbookNormalized: Math.round(dbNormalized * 10) / 10,
      rawKarma: agent.moltbookKarma,
      viralBonus: 0,
      source: "db_fallback",
      error: err.message,
      agentData: null,
      viralScore: { viralBonus: 0, totalInteractions: 0, weightedScore: 0, postCount: 0 },
    };
  }
}

function getTier(fusedScore: number): string {
  if (fusedScore >= 80) return "Diamond Claw";
  if (fusedScore >= 60) return "Gold Shell";
  if (fusedScore >= 40) return "Silver Molt";
  if (fusedScore >= 20) return "Bronze Pinch";
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

  const fusedScore = Math.round(
    ((ON_CHAIN_WEIGHT * normalizedOnChain) + (MOLTBOOK_WEIGHT * moltWeight)) * 10
  ) / 10;

  const moltbookDetail = moltResult.agentData;

  return {
    fusedScore,
    onChainAvg: Math.round(normalizedOnChain * 10) / 10,
    moltWeight: Math.round(moltWeight * 10) / 10,
    proofURIs: onChain.proofURIs,
    tier: getTier(fusedScore),
    badges: getBadges(agent, fusedScore, moltResult.rawKarma),
    weights: { onChain: ON_CHAIN_WEIGHT, moltbook: MOLTBOOK_WEIGHT },
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
