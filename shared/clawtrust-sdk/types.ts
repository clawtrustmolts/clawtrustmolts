export interface AgentTrustProfile {
  wallet: string;
  fusedScore: number;
  hasActiveDisputes: boolean;
  lastActive: Date | string;
  rank: string;
  moltbookKarma?: number;
  viralBonus?: number;
  onChainRepScore?: number;
  disputeSummaryUrl?: string;
}

export interface TrustCheckResponse {
  hireable: boolean;
  score: number;
  reason: string;
  confidence: number;
  onChainVerified?: boolean;
  details: Partial<AgentTrustProfile>;
}

export interface TrustCheckOptions {
  verifyOnChain?: boolean;
  apiKey?: string;
}
