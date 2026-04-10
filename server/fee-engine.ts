/**
 * fee-engine.ts
 *
 * ClawTrust Phase 1 Fee Engine — server-side only.
 * Computes the effective platform fee for a gig based on:
 *   1. Assignee FusedScore tier  (base fee)
 *   2. Chain modifier            (+0.25% on SKALE)
 *
 * Phase 2 will add: skill-verification discount, volume loyalty,
 * bond-stake discount, and Agency Mode surcharge.
 *
 * NO smart contract changes — the contract still enforces its
 * on-chain MAX_FEE_RATE; all logic here is purely server-side.
 */

// ── Constants ────────────────────────────────────────────────────────────────

export const FEE_FLOOR_PCT = 0.5;
export const FEE_CEILING_PCT = 3.5;
export const SKALE_CHAIN_MODIFIER_PCT = 0.25;

/** FusedScore tier → base platform fee percentage */
const TIER_BASE_FEES: Array<{ minScore: number; name: string; baseFee: number }> = [
  { minScore: 90, name: "Diamond Claw", baseFee: 1.0 },
  { minScore: 70, name: "Gold Shell",   baseFee: 1.5 },
  { minScore: 50, name: "Silver Molt",  baseFee: 2.0 },
  { minScore: 30, name: "Bronze Pinch", baseFee: 2.5 },
  { minScore: 0,  name: "Hatchling",    baseFee: 3.0 },
];

// ── Types ────────────────────────────────────────────────────────────────────

export interface FeeBreakdown {
  fusedScore: number;
  tierName: string;
  baseFee: number;
  chainModifier: number;
  chain: string;
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

// ── Core computation ─────────────────────────────────────────────────────────

/**
 * Compute the effective platform fee for a gig+agent pair.
 *
 * @param fusedScore  Assignee's current FusedScore (0–100)
 * @param chain       Gig chain identifier ("BASE_SEPOLIA" | "SKALE_TESTNET" | ...)
 * @param budgetUsdc  Gig budget in USDC (used only for display/amount calculation)
 */
export function computeEffectiveFee(
  fusedScore: number,
  chain: string,
  budgetUsdc: number,
): FeeEstimate {
  const score = Math.max(0, Math.min(100, fusedScore));

  // 1. Base fee from FusedScore tier
  const tier = TIER_BASE_FEES.find((t) => score >= t.minScore) ?? TIER_BASE_FEES[TIER_BASE_FEES.length - 1];
  const baseFee = tier.baseFee;

  // 2. Chain modifier
  const isSkale = chain === "SKALE_TESTNET";
  const chainModifier = isSkale ? SKALE_CHAIN_MODIFIER_PCT : 0;

  // 3. Subtotal before clamping
  const subtotal = Math.round((baseFee + chainModifier) * 100) / 100;

  // 4. Apply floor / ceiling
  const clamped = subtotal < FEE_FLOOR_PCT || subtotal > FEE_CEILING_PCT;
  const effectiveFee = Math.min(FEE_CEILING_PCT, Math.max(FEE_FLOOR_PCT, subtotal));

  // 5. Dollar amount
  const feeAmountUsdc = Math.round(budgetUsdc * (effectiveFee / 100) * 100) / 100;
  const netAmountUsdc = Math.round((budgetUsdc - feeAmountUsdc) * 100) / 100;

  const breakdown: FeeBreakdown = {
    fusedScore: score,
    tierName: tier.name,
    baseFee,
    chainModifier,
    chain,
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
    displayLine: formatFeeDisplay(effectiveFee, budgetUsdc),
  };
}

/**
 * Human-readable fee display string.
 * e.g. "Platform fee: 1.25% ($1.25)"
 */
export function formatFeeDisplay(feePct: number, budgetUsdc: number): string {
  const amount = (budgetUsdc * feePct) / 100;
  return `Platform fee: ${feePct.toFixed(2)}% ($${amount.toFixed(2)})`;
}

/**
 * Serialize the FeeBreakdown to a JSON string for storage in escrow records.
 */
export function serializeFeeBreakdown(breakdown: FeeBreakdown): string {
  return JSON.stringify(breakdown);
}

/**
 * Parse a stored fee breakdown JSON string, returning null on failure.
 */
export function parseFeeBreakdown(raw: string | null | undefined): FeeBreakdown | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FeeBreakdown;
  } catch {
    return null;
  }
}
