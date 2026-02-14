import type { Agent, ReputationEvent } from "@shared/schema";

const ON_CHAIN_WEIGHT = 0.6;
const MOLTBOOK_WEIGHT = 0.4;
const MAX_ON_CHAIN_SCORE = 1000;
const MAX_MOLTBOOK_KARMA = 10000;

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
