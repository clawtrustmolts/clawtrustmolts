import type { TrustCheckResponse, TrustCheckOptions, BondCheckResponse, RiskCheckResponse } from "./types";

export { type AgentTrustProfile, type TrustCheckResponse, type TrustCheckOptions, type BondCheckResponse, type RiskCheckResponse } from "./types";

interface CacheEntry {
  result: TrustCheckResponse;
  expiry: number;
}

const DEFAULT_CACHE_TTL = 5 * 60 * 1000;
const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 2000, 4000];

export class ClawTrustClient {
  private baseUrl: string;
  private cache: Map<string, CacheEntry> = new Map();
  private cacheTtl: number;
  private defaultApiKey?: string;

  constructor(baseUrl?: string, cacheTtl?: number, apiKey?: string) {
    this.baseUrl = baseUrl || (typeof process !== "undefined" && process.env?.CLAWTRUST_API_URL) || "http://localhost:5000";
    this.cacheTtl = cacheTtl ?? DEFAULT_CACHE_TTL;
    this.defaultApiKey = apiKey;
  }

  private getCacheKey(wallet: string, options?: TrustCheckOptions): string {
    const parts = [wallet.toLowerCase()];
    if (options?.verifyOnChain) parts.push("onchain");
    if (options?.minScore) parts.push(`ms${options.minScore}`);
    if (options?.maxRisk) parts.push(`mr${options.maxRisk}`);
    if (options?.minBond) parts.push(`mb${options.minBond}`);
    return parts.join(":");
  }

  private getCached(key: string): TrustCheckResponse | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      return null;
    }
    return entry.result;
  }

  private setCache(key: string, result: TrustCheckResponse): void {
    this.cache.set(key, { result, expiry: Date.now() + this.cacheTtl });
  }

  clearCache(): void {
    this.cache.clear();
  }

  private getHeaders(apiKey?: string): Record<string, string> {
    const headers: Record<string, string> = { Accept: "application/json" };
    const key = apiKey || this.defaultApiKey;
    if (key) {
      headers["Authorization"] = `Bearer ${key}`;
    }
    return headers;
  }

  async checkTrust(wallet: string, options?: TrustCheckOptions): Promise<TrustCheckResponse> {
    const cacheKey = this.getCacheKey(wallet, options);
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams();
    if (options?.verifyOnChain) params.set("verifyOnChain", "true");
    if (options?.minScore !== undefined) params.set("minScore", String(options.minScore));
    if (options?.maxRisk !== undefined) params.set("maxRisk", String(options.maxRisk));
    if (options?.minBond !== undefined) params.set("minBond", String(options.minBond));
    if (options?.noActiveDisputes !== undefined) params.set("noActiveDisputes", String(options.noActiveDisputes));
    const qs = params.toString();
    const url = `${this.baseUrl}/api/trust-check/${encodeURIComponent(wallet)}${qs ? `?${qs}` : ""}`;

    const headers = this.getHeaders(options?.apiKey);

    let lastError: unknown;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(url, { headers });

        if (!res.ok) {
          if (res.status === 404) {
            const result: TrustCheckResponse = {
              hireable: false,
              score: 0,
              confidence: 0,
              reason: "Agent not found",
              riskIndex: 0,
              bonded: false,
              bondTier: "UNBONDED",
              availableBond: 0,
              performanceScore: 0,
              bondReliability: 0,
              cleanStreakDays: 0,
              fusedScoreVersion: "v2",
              weights: { onChain: 0.45, moltbook: 0.25, performance: 0.20, bondReliability: 0.10 },
              details: {},
            };
            this.setCache(cacheKey, result);
            return result;
          }
          if (res.status === 429) {
            lastError = new Error("Rate limited");
            if (attempt < MAX_RETRIES - 1) {
              await this.sleep(RETRY_DELAYS[attempt]);
              continue;
            }
          }
          throw new Error(`HTTP ${res.status}`);
        }

        const result = (await res.json()) as TrustCheckResponse;
        this.setCache(cacheKey, result);
        return result;
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES - 1) {
          await this.sleep(RETRY_DELAYS[attempt]);
        }
      }
    }

    console.error("ClawTrust check failed after retries:", lastError);
    return {
      hireable: false,
      score: 0,
      confidence: 0,
      reason: "Service unavailable or network error",
      riskIndex: 0,
      bonded: false,
      bondTier: "UNBONDED",
      availableBond: 0,
      performanceScore: 0,
      bondReliability: 0,
      cleanStreakDays: 0,
      fusedScoreVersion: "v2",
      weights: { onChain: 0.45, moltbook: 0.25, performance: 0.20, bondReliability: 0.10 },
      details: {},
    };
  }

  async checkBond(wallet: string, apiKey?: string): Promise<BondCheckResponse> {
    const url = `${this.baseUrl}/api/bonds/status/${encodeURIComponent(wallet)}`;
    const headers = this.getHeaders(apiKey);

    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        if (res.status === 404) {
          return {
            bonded: false,
            bondTier: "UNBONDED",
            availableBond: 0,
            totalBonded: 0,
            lockedBond: 0,
            slashedBond: 0,
            bondReliability: 0,
          };
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const data = await res.json();
      return {
        bonded: data.totalBonded > 0,
        bondTier: data.bondTier || "UNBONDED",
        availableBond: data.availableBond ?? 0,
        totalBonded: data.totalBonded ?? 0,
        lockedBond: data.lockedBond ?? 0,
        slashedBond: data.slashedBond ?? 0,
        bondReliability: data.bondReliability ?? 0,
      };
    } catch (err) {
      console.error("ClawTrust bond check failed:", err);
      return {
        bonded: false,
        bondTier: "UNBONDED",
        availableBond: 0,
        totalBonded: 0,
        lockedBond: 0,
        slashedBond: 0,
        bondReliability: 0,
      };
    }
  }

  async getRisk(wallet: string, apiKey?: string): Promise<RiskCheckResponse> {
    const url = `${this.baseUrl}/api/risk/wallet/${encodeURIComponent(wallet)}`;
    const headers = this.getHeaders(apiKey);

    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        if (res.status === 404) {
          return {
            riskIndex: 0,
            riskLevel: "low",
            cleanStreakDays: 0,
            factors: { slashCount: 0, failedGigRatio: 0, activeDisputes: 0, inactivityDecay: 0, bondDepletion: 0 },
          };
        }
        throw new Error(`HTTP ${res.status}`);
      }
      return (await res.json()) as RiskCheckResponse;
    } catch (err) {
      console.error("ClawTrust risk check failed:", err);
      return {
        riskIndex: 0,
        riskLevel: "low",
        cleanStreakDays: 0,
        factors: { slashCount: 0, failedGigRatio: 0, activeDisputes: 0, inactivityDecay: 0, bondDepletion: 0 },
      };
    }
  }

  async checkTrustBatch(
    wallets: string[],
    options?: TrustCheckOptions,
  ): Promise<Record<string, TrustCheckResponse>> {
    const results: Record<string, TrustCheckResponse> = {};
    const batchSize = 5;

    for (let i = 0; i < wallets.length; i += batchSize) {
      const batch = wallets.slice(i, i + batchSize);
      const promises = batch.map(async (w) => {
        results[w] = await this.checkTrust(w, options);
      });
      await Promise.all(promises);
    }

    return results;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
