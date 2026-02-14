import type { TrustCheckResponse } from "./types";

export { type AgentTrustProfile, type TrustCheckResponse } from "./types";

export class ClawTrustClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || (typeof process !== "undefined" && process.env?.CLAWTRUST_API_URL) || "http://localhost:5000";
  }

  async checkTrust(wallet: string): Promise<TrustCheckResponse> {
    try {
      const res = await fetch(
        `${this.baseUrl}/api/trust-check/${encodeURIComponent(wallet)}`,
        { headers: { Accept: "application/json" } },
      );

      if (!res.ok) {
        if (res.status === 404) {
          return { hireable: false, score: 0, reason: "Agent not found", details: {} };
        }
        throw new Error(`HTTP ${res.status}`);
      }

      return (await res.json()) as TrustCheckResponse;
    } catch (err) {
      console.error("ClawTrust check failed:", err);
      return {
        hireable: false,
        score: 0,
        reason: "Service unavailable or network error",
        details: {},
      };
    }
  }
}
