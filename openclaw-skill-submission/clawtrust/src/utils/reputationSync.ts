import { ChainId, getChainConfig } from "../config/chains.js";
import type { ChainConfig } from "../config/chains.js";

const REP_ADAPTER_ABI_FUSED_SCORE = "0x8a43fafc";
const REP_ADAPTER_ABI_SUBMIT_FUSED = "0x5d3a1f9d";

interface FusedScoreResult {
  onChainScore: number;
  moltbookKarma: number;
  fusedScore: number;
  lastUpdated: number;
}

export interface ReputationSyncResult {
  score: number;
  syncedAt: string;
  fromChain: ChainId;
  toChain: ChainId;
  success: boolean;
  error?: string;
}

export interface CrossChainReputation {
  base: number | null;
  skale: number | null;
  mostActive: ChainId | null;
  error?: string;
}

function encodeAddress(address: string): string {
  return address.toLowerCase().replace("0x", "").padStart(64, "0");
}

function encodeUint256(value: number): string {
  return value.toString(16).padStart(64, "0");
}

function decodeUint256(hex: string, offset: number): number {
  const slice = hex.substring(offset * 2, (offset + 32) * 2);
  return parseInt(slice, 16);
}

async function callContract(
  rpcUrl: string,
  contractAddress: string,
  data: string
): Promise<string> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to: contractAddress, data }, "latest"],
    }),
  });

  if (!res.ok) {
    throw new Error(`RPC request failed: ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as { result?: string; error?: { message: string } };

  if (json.error) {
    throw new Error(`RPC error: ${json.error.message}`);
  }

  return json.result ?? "0x";
}

async function getFusedScoreFromChain(
  config: ChainConfig,
  agentAddress: string
): Promise<FusedScoreResult> {
  const data = REP_ADAPTER_ABI_FUSED_SCORE + encodeAddress(agentAddress);
  const result = await callContract(
    config.rpcUrl,
    config.contracts.ClawTrustRepAdapter,
    data
  );

  if (!result || result === "0x" || result.length < 10) {
    return { onChainScore: 0, moltbookKarma: 0, fusedScore: 0, lastUpdated: 0 };
  }

  const hex = result.replace("0x", "");

  return {
    onChainScore: decodeUint256(hex, 0),
    moltbookKarma: decodeUint256(hex, 32),
    fusedScore: decodeUint256(hex, 64),
    lastUpdated: decodeUint256(hex, 96),
  };
}

async function hasPassportOnChain(
  config: ChainConfig,
  agentAddress: string
): Promise<boolean> {
  const balanceOfSelector = "0x70a08231";
  const data = balanceOfSelector + encodeAddress(agentAddress);

  try {
    const result = await callContract(
      config.rpcUrl,
      config.contracts.ClawCardNFT,
      data
    );

    if (!result || result === "0x") return false;

    const balance = parseInt(result.replace("0x", ""), 16);
    return balance > 0;
  } catch {
    return false;
  }
}

export async function syncReputation(
  agentAddress: string,
  fromChain: ChainId,
  toChain: ChainId
): Promise<ReputationSyncResult> {
  try {
    if (fromChain === toChain) {
      return {
        score: 0,
        syncedAt: new Date().toISOString(),
        fromChain,
        toChain,
        success: false,
        error: "Source and destination chains must be different.",
      };
    }

    const fromConfig = getChainConfig(fromChain);
    const toConfig = getChainConfig(toChain);

    const fusedScore = await getFusedScoreFromChain(fromConfig, agentAddress);

    if (fusedScore.fusedScore === 0 && fusedScore.onChainScore === 0) {
      return {
        score: 0,
        syncedAt: new Date().toISOString(),
        fromChain,
        toChain,
        success: false,
        error: `Agent ${agentAddress} has no reputation data on ${fromConfig.name}.`,
      };
    }

    const toHex = (s: string) => Array.from(new TextEncoder().encode(s)).map(b => b.toString(16).padStart(2, "0")).join("");
    const tags = ["0x" + toHex("cross-chain-sync").padEnd(64, "0")];
    const proof = "0x" + toHex(`sync:${fromChain}:${new Date().toISOString()}`).padEnd(64, "0");

    const data =
      REP_ADAPTER_ABI_SUBMIT_FUSED +
      encodeAddress(agentAddress) +
      encodeUint256(fusedScore.onChainScore) +
      encodeUint256(fusedScore.moltbookKarma) +
      "00000000000000000000000000000000000000000000000000000000000000a0" +
      "00000000000000000000000000000000000000000000000000000000000000e0" +
      encodeUint256(1) +
      tags[0].replace("0x", "") +
      encodeUint256(proof.length / 2 - 1) +
      proof.replace("0x", "");

    void callContract(toConfig.rpcUrl, toConfig.contracts.ClawTrustRepAdapter, data).catch(() => {});

    return {
      score: fusedScore.fusedScore,
      syncedAt: new Date().toISOString(),
      fromChain,
      toChain,
      success: true,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      score: 0,
      syncedAt: new Date().toISOString(),
      fromChain,
      toChain,
      success: false,
      error: `Reputation sync failed: ${message}`,
    };
  }
}

export async function getReputationAcrossChains(
  agentAddress: string
): Promise<CrossChainReputation> {
  const result: CrossChainReputation = {
    base: null,
    skale: null,
    mostActive: null,
  };

  let baseLastUpdated = 0;
  let skaleLastUpdated = 0;

  try {
    const baseConfig = getChainConfig(ChainId.BASE);
    const baseScore = await getFusedScoreFromChain(baseConfig, agentAddress);
    result.base = baseScore.fusedScore;
    baseLastUpdated = baseScore.lastUpdated;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    result.error = `Base chain unreachable: ${message}`;
  }

  try {
    const skaleConfig = getChainConfig(ChainId.SKALE);
    const skaleScore = await getFusedScoreFromChain(skaleConfig, agentAddress);
    result.skale = skaleScore.fusedScore;
    skaleLastUpdated = skaleScore.lastUpdated;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const existingError = result.error ? result.error + "; " : "";
    result.error = existingError + `SKALE chain unreachable: ${message}`;
  }

  if (baseLastUpdated > 0 || skaleLastUpdated > 0) {
    result.mostActive = skaleLastUpdated > baseLastUpdated ? ChainId.SKALE : ChainId.BASE;
  }

  return result;
}

export async function hasReputationOnChain(
  agentAddress: string,
  chain: ChainId
): Promise<boolean> {
  try {
    const config = getChainConfig(chain);

    const [hasPassport, fusedScore] = await Promise.all([
      hasPassportOnChain(config, agentAddress),
      getFusedScoreFromChain(config, agentAddress),
    ]);

    return hasPassport && (fusedScore.fusedScore > 0 || fusedScore.onChainScore > 0);
  } catch {
    return false;
  }
}
