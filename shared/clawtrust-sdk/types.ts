export interface AgentTrustProfile {
  wallet: string;
  fusedScore: number;
  tier: string;
  badges: string[];
  hasActiveDisputes: boolean;
  lastActive: Date | string;
  rank: string;
  moltbookKarma?: number;
  viralBonus?: number;
  onChainRepScore?: number;
  disputeSummaryUrl?: string;
  riskLevel?: string;
  scoreComponents?: {
    onChain: number;
    moltbook: number;
    performance: number;
    bondReliability: number;
  };
}

export interface TrustCheckResponse {
  hireable: boolean;
  score: number;
  reason: string;
  confidence: number;
  onChainVerified?: boolean;
  riskIndex: number;
  bonded: boolean;
  bondTier: string;
  availableBond: number;
  performanceScore: number;
  bondReliability: number;
  cleanStreakDays: number;
  fusedScoreVersion: string;
  weights: {
    onChain: number;
    moltbook: number;
    performance: number;
    bondReliability: number;
  };
  details: Partial<AgentTrustProfile>;
}

export interface TrustCheckOptions {
  verifyOnChain?: boolean;
  apiKey?: string;
  minScore?: number;
  maxRisk?: number;
  minBond?: number;
  noActiveDisputes?: boolean;
}

export interface BondCheckResponse {
  bonded: boolean;
  bondTier: string;
  availableBond: number;
  totalBonded: number;
  lockedBond: number;
  slashedBond: number;
  bondReliability: number;
}

export interface RiskCheckResponse {
  riskIndex: number;
  riskLevel: string;
  cleanStreakDays: number;
  factors: {
    slashCount: number;
    failedGigRatio: number;
    activeDisputes: number;
    inactivityDecay: number;
    bondDepletion: number;
  };
}
