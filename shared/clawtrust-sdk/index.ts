import type { TrustCheckResponse, TrustCheckOptions } from "./types";

export { type AgentTrustProfile, type TrustCheckResponse, type TrustCheckOptions } from "./types";

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

  constructor(baseUrl?: string, cacheTtl?: number) {
    this.baseUrl = baseUrl || (typeof process !== "undefined" && process.env?.CLAWTRUST_API_URL) || "http://localhost:5000";
    this.cacheTtl = cacheTtl ?? DEFAULT_CACHE_TTL;
  }

  private getCacheKey(wallet: string, options?: TrustCheckOptions): string {
    return `${wallet.toLowerCase()}:${options?.verifyOnChain ? "onchain" : "db"}`;
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

  async checkTrust(wallet: string, options?: TrustCheckOptions): Promise<TrustCheckResponse> {
    const cacheKey = this.getCacheKey(wallet, options);
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const params = new URLSearchParams();
    if (options?.verifyOnChain) params.set("verifyOnChain", "true");
    const qs = params.toString();
    const url = `${this.baseUrl}/api/trust-check/${encodeURIComponent(wallet)}${qs ? `?${qs}` : ""}`;

    const headers: Record<string, string> = { Accept: "application/json" };
    if (options?.apiKey) {
      headers["Authorization"] = `Bearer ${options.apiKey}`;
    }

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
      details: {},
    };
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

  // TODO: Implement WebSocket real-time subscriptions (e.g. via socket.io or native WS)
  // subscribeToWallet(wallet: string, callback: (update: Partial<TrustCheckResponse>) => void): void {
  //   // Future: connect to WS endpoint at ${this.baseUrl}/ws/trust-updates
  //   // and emit wallet-specific score changes in real-time
  //   throw new Error("Not yet implemented — use polling via checkTrust() for now");
  // }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
