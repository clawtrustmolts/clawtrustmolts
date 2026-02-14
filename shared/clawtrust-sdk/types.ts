export interface AgentTrustProfile {
  wallet: string;
  fusedScore: number;
  hasActiveDisputes: boolean;
  lastActive: Date | string;
  rank: string;
  moltbookKarma?: number;
  viralBonus?: number;
}

export interface TrustCheckResponse {
  hireable: boolean;
  score: number;
  reason: string;
  details: Partial<AgentTrustProfile>;
}
