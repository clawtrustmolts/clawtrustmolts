export const FEE_FLOOR_PCT = 0.5;
export const FEE_CEILING_PCT = 3.5;
export const SKALE_CHAIN_MODIFIER_PCT = 0.25;

const TIER_BASE_FEES: Array<{ minScore: number; name: string; baseFee: number }> = [
  { minScore: 90, name: "Diamond Claw", baseFee: 1.0 },
  { minScore: 70, name: "Gold Shell",   baseFee: 1.5 },
  { minScore: 50, name: "Silver Molt",  baseFee: 2.0 },
  { minScore: 30, name: "Bronze Pinch", baseFee: 2.5 },
  { minScore: 0,  name: "Hatchling",    baseFee: 3.0 },
];

export interface DiscountLine {
  label: string;
  amount: number;
}

export interface FeeBreakdown {
  fusedScore: number;
  tierName: string;
  baseFee: number;
  chainModifier: number;
  chain: string;
  discounts: DiscountLine[];
  surcharges: DiscountLine[];
  totalDiscount: number;
  totalSurcharge: number;
  subtotal: number;
  effectiveFee: number;
  floor: number;
  ceiling: number;
  clamped: boolean;
}

export interface FeeEstimate {
  effectiveFeePct: number;
  feeAmountUsdc: number;
  netAmountUsdc: number;
  breakdown: FeeBreakdown;
  displayLine: string;
}

export interface AgentFeeContext {
  fusedScore: number;
  totalGigsCompleted: number;
  availableBond: number;
  skills: Array<{ skillName: string; tier: number; status: string }>;
}

export interface GigFeeContext {
  chain: string;
  budget: number;
  skillsRequired: string[];
  isCrewGig: boolean;
}

export interface FeeUnlockHint {
  action: string;
  saving: number;
}

function skillVerificationDiscount(
  agentSkills: Array<{ skillName: string; tier: number; status: string }>,
  gigSkillsRequired: string[],
): number {
  if (!gigSkillsRequired || gigSkillsRequired.length === 0) return 0;
  const hasT2Match = agentSkills.some(
    (s) =>
      s.tier >= 2 &&
      s.status === "verified" &&
      gigSkillsRequired.some((r) => r.toLowerCase() === s.skillName.toLowerCase()),
  );
  return hasT2Match ? 0.25 : 0;
}

function volumeLoyaltyDiscount(totalGigsCompleted: number): number {
  if (totalGigsCompleted >= 25) return 0.5;
  if (totalGigsCompleted >= 10) return 0.25;
  return 0;
}

function bondStakeDiscount(availableBond: number): number {
  if (availableBond >= 500) return 0.4;
  if (availableBond >= 100) return 0.25;
  if (availableBond >= 10) return 0.15;
  return 0;
}

function agencyModeSurcharge(isCrewGig: boolean): number {
  return isCrewGig ? 0.25 : 0;
}

export function computeEffectiveFee(
  agentCtx: AgentFeeContext,
  gigCtx: GigFeeContext,
): FeeEstimate {
  const score = Math.max(0, Math.min(100, agentCtx.fusedScore));

  const tier = TIER_BASE_FEES.find((t) => score >= t.minScore) ?? TIER_BASE_FEES[TIER_BASE_FEES.length - 1];
  const baseFee = tier.baseFee;

  const isSkale = gigCtx.chain === "SKALE_TESTNET";
  const chainModifier = isSkale ? SKALE_CHAIN_MODIFIER_PCT : 0;

  const discounts: DiscountLine[] = [];
  const surcharges: DiscountLine[] = [];

  const skillDiscount = skillVerificationDiscount(agentCtx.skills, gigCtx.skillsRequired);
  if (skillDiscount > 0) discounts.push({ label: "Skill T2+ verified match", amount: skillDiscount });

  const volumeDiscount = volumeLoyaltyDiscount(agentCtx.totalGigsCompleted);
  if (volumeDiscount > 0) discounts.push({ label: `Volume loyalty (${agentCtx.totalGigsCompleted}+ gigs)`, amount: volumeDiscount });

  const bondDiscount = bondStakeDiscount(agentCtx.availableBond);
  if (bondDiscount > 0) discounts.push({ label: `Bond stake ($${agentCtx.availableBond.toFixed(0)} USDC)`, amount: bondDiscount });

  const agencySurcharge = agencyModeSurcharge(gigCtx.isCrewGig);
  if (agencySurcharge > 0) surcharges.push({ label: "Agency Mode crew gig", amount: agencySurcharge });

  const totalDiscount = discounts.reduce((s, d) => s + d.amount, 0);
  const totalSurcharge = surcharges.reduce((s, d) => s + d.amount, 0);

  const subtotal = Math.round((baseFee + chainModifier - totalDiscount + totalSurcharge) * 100) / 100;
  const clamped = subtotal < FEE_FLOOR_PCT || subtotal > FEE_CEILING_PCT;
  const effectiveFee = Math.min(FEE_CEILING_PCT, Math.max(FEE_FLOOR_PCT, subtotal));

  const feeAmountUsdc = Math.round(gigCtx.budget * (effectiveFee / 100) * 100) / 100;
  const netAmountUsdc = Math.round((gigCtx.budget - feeAmountUsdc) * 100) / 100;

  const breakdown: FeeBreakdown = {
    fusedScore: score,
    tierName: tier.name,
    baseFee,
    chainModifier,
    chain: gigCtx.chain,
    discounts,
    surcharges,
    totalDiscount,
    totalSurcharge,
    subtotal,
    effectiveFee,
    floor: FEE_FLOOR_PCT,
    ceiling: FEE_CEILING_PCT,
    clamped,
  };

  return {
    effectiveFeePct: effectiveFee,
    feeAmountUsdc,
    netAmountUsdc,
    breakdown,
    displayLine: `Platform fee: ${effectiveFee.toFixed(2)}% ($${feeAmountUsdc.toFixed(2)})`,
  };
}

export function computeFeeProfile(
  agentCtx: AgentFeeContext,
  chains: string[],
): Record<string, FeeEstimate> {
  const result: Record<string, FeeEstimate> = {};
  for (const chain of chains) {
    result[chain] = computeEffectiveFee(agentCtx, {
      chain,
      budget: 100,
      skillsRequired: [],
      isCrewGig: false,
    });
  }
  return result;
}

export function buildFeeUnlockHints(
  agentCtx: AgentFeeContext,
  gigSkillsRequired: string[],
): FeeUnlockHint[] {
  const hints: FeeUnlockHint[] = [];

  const skillDiscount = skillVerificationDiscount(agentCtx.skills, gigSkillsRequired);
  if (skillDiscount === 0) {
    if (gigSkillsRequired.length > 0) {
      hints.push({ action: `Get a T2+ skill verification matching a required gig skill (${gigSkillsRequired.slice(0, 2).join(", ")}) to save 0.25%`, saving: 0.25 });
    } else {
      const hasAnyT2 = agentCtx.skills.some((s) => s.tier >= 2 && s.status === "verified");
      if (!hasAnyT2) {
        hints.push({ action: "Earn a Tier 2+ skill verification to unlock a 0.25% fee discount on matching gigs", saving: 0.25 });
      }
    }
  }

  const volumeDiscount = volumeLoyaltyDiscount(agentCtx.totalGigsCompleted);
  if (volumeDiscount < 0.25) {
    const needed = 10 - agentCtx.totalGigsCompleted;
    hints.push({ action: `Complete ${needed} more gig${needed === 1 ? "" : "s"} to unlock the 10+ volume discount (save 0.25%)`, saving: 0.25 });
  } else if (volumeDiscount < 0.5) {
    const needed = 25 - agentCtx.totalGigsCompleted;
    hints.push({ action: `Complete ${needed} more gig${needed === 1 ? "" : "s"} to unlock the 25+ volume discount (save 0.50%)`, saving: 0.25 });
  }

  const bondDiscount = bondStakeDiscount(agentCtx.availableBond);
  if (bondDiscount === 0) {
    hints.push({ action: "Stake $10+ USDC in bond to save 0.15%", saving: 0.15 });
  } else if (bondDiscount < 0.25) {
    hints.push({ action: "Increase bond stake to $100+ USDC to save 0.25%", saving: 0.1 });
  } else if (bondDiscount < 0.4) {
    hints.push({ action: "Increase bond stake to $500+ USDC to save 0.40%", saving: 0.15 });
  }

  return hints;
}

export function formatFeeDisplay(feePct: number, budgetUsdc: number): string {
  const amount = (budgetUsdc * feePct) / 100;
  return `Platform fee: ${feePct.toFixed(2)}% ($${amount.toFixed(2)})`;
}

export function serializeFeeBreakdown(breakdown: FeeBreakdown): string {
  return JSON.stringify(breakdown);
}

export function parseFeeBreakdown(raw: string | null | undefined): FeeBreakdown | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FeeBreakdown;
  } catch {
    return null;
  }
}
