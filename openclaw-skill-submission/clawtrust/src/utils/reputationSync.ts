import { ChainId, getChainConfig } from "../config/chains.js";
import type { ChainConfig } from "../config/chains.js";
import type { WalletProvider } from "../client.js";

const GET_FUSED_SCORE_SELECTOR = "0xb242f17c";
const SUBMIT_FUSED_FEEDBACK_SELECTOR = "0x8c6ec3a6";
const BALANCE_OF_SELECTOR = "0x70a08231";

interface FusedScoreResult {
  onChainScore: number;
  moltbookKarma: number;
  performanceScore: number;
  bondScore: number;
  fusedScore: number;
  timestamp: number;
}

export interface ReputationSyncResult {
  score: number;
  syncedAt: string;
  fromChain: ChainId;
  toChain: ChainId;
  success: boolean;
  txHash?: string;
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

function decodeUint256FromHex(hex: string, wordIndex: number): number {
  const start = wordIndex * 64;
  const slice = hex.substring(start, start + 64);
  if (!slice || slice.length === 0) return 0;
  return parseInt(slice, 16) || 0;
}

async function ethCall(
  rpcUrl: string,
  to: string,
  data: string
): Promise<string> {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_call",
      params: [{ to, data }, "latest"],
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

async function sendTransaction(
  walletProvider: WalletProvider,
  to: string,
  data: string
): Promise<string> {
  const accounts = (await walletProvider.request({ method: "eth_accounts" })) as string[];
  if (!accounts || accounts.length === 0) {
    throw new Error("No accounts available in wallet provider.");
  }

  const txHash = (await walletProvider.request({
    method: "eth_sendTransaction",
    params: [{ from: accounts[0], to, data }],
  })) as string;

  return txHash;
}

async function getFusedScoreFromChain(
  config: ChainConfig,
  agentAddress: string
): Promise<FusedScoreResult> {
  const data = GET_FUSED_SCORE_SELECTOR + encodeAddress(agentAddress);
  const result = await ethCall(
    config.rpcUrl,
    config.contracts.ClawTrustRepAdapter,
    data
  );

  if (!result || result === "0x" || result.length < 10) {
    return { onChainScore: 0, moltbookKarma: 0, performanceScore: 0, bondScore: 0, fusedScore: 0, timestamp: 0 };
  }

  const hex = result.replace("0x", "");

  return {
    onChainScore: decodeUint256FromHex(hex, 0),
    moltbookKarma: decodeUint256FromHex(hex, 1),
    performanceScore: decodeUint256FromHex(hex, 2),
    bondScore: decodeUint256FromHex(hex, 3),
    fusedScore: decodeUint256FromHex(hex, 4),
    timestamp: decodeUint256FromHex(hex, 5),
  };
}

async function hasPassportOnChain(
  config: ChainConfig,
  agentAddress: string
): Promise<boolean> {
  const data = BALANCE_OF_SELECTOR + encodeAddress(agentAddress);

  try {
    const result = await ethCall(
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

function encodeStringForABI(str: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  const length = encodeUint256(bytes.length);
  let hexData = "";
  for (const b of bytes) {
    hexData += b.toString(16).padStart(2, "0");
  }
  const paddedLength = Math.ceil(hexData.length / 64) * 64;
  hexData = hexData.padEnd(paddedLength, "0");
  return length + hexData;
}

function buildSubmitFusedFeedbackCalldata(
  agentAddress: string,
  onChainScore: number,
  moltbookKarma: number,
  performanceScore: number,
  bondScore: number,
  tags: string[],
  proof: string
): string {
  const tagsOffset = 6 * 32;
  const encodedTags: string[] = [];
  encodedTags.push(encodeUint256(tags.length));
  for (const tag of tags) {
    const tagOffset = (tags.length + 1) * 32 + encodedTags.slice(1).reduce((sum, s) => sum + s.length / 2, 0);
    encodedTags.push(encodeUint256(tagOffset));
  }
  for (const tag of tags) {
    const encoded = encodeStringForABI(tag);
    encodedTags.push(encoded);
  }
  const tagsData = encodedTags.join("");

  const proofOffset = tagsOffset + tagsData.length / 2;
  const encodedProof = encodeStringForABI(proof);

  return (
    SUBMIT_FUSED_FEEDBACK_SELECTOR +
    encodeAddress(agentAddress) +
    encodeUint256(onChainScore) +
    encodeUint256(moltbookKarma) +
    encodeUint256(performanceScore) +
    encodeUint256(bondScore) +
    encodeUint256(tagsOffset).replace(/^0+/, "").padStart(64, "0") +
    encodeUint256(proofOffset).replace(/^0+/, "").padStart(64, "0") +
    tagsData +
    encodedProof
  );
}

export async function syncReputation(
  agentAddress: string,
  fromChain: ChainId,
  toChain: ChainId,
  walletProvider: WalletProvider
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

    const syncTimestamp = new Date().toISOString();
    const calldata = buildSubmitFusedFeedbackCalldata(
      agentAddress,
      fusedScore.onChainScore,
      fusedScore.moltbookKarma,
      fusedScore.performanceScore,
      fusedScore.bondScore,
      ["cross-chain-sync"],
      `sync:${fromChain}:${syncTimestamp}`
    );

    const txHash = await sendTransaction(
      walletProvider,
      toConfig.contracts.ClawTrustRepAdapter,
      "0x" + calldata.replace(SUBMIT_FUSED_FEEDBACK_SELECTOR, "").replace(/^/, SUBMIT_FUSED_FEEDBACK_SELECTOR)
    );

    return {
      score: fusedScore.fusedScore,
      syncedAt: syncTimestamp,
      fromChain,
      toChain,
      success: true,
      txHash,
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

  let baseTimestamp = 0;
  let skaleTimestamp = 0;

  try {
    const baseConfig = getChainConfig(ChainId.BASE);
    const baseScore = await getFusedScoreFromChain(baseConfig, agentAddress);
    result.base = baseScore.fusedScore;
    baseTimestamp = baseScore.timestamp;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    result.error = `Base chain unreachable: ${message}`;
  }

  try {
    const skaleConfig = getChainConfig(ChainId.SKALE);
    const skaleScore = await getFusedScoreFromChain(skaleConfig, agentAddress);
    result.skale = skaleScore.fusedScore;
    skaleTimestamp = skaleScore.timestamp;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const existingError = result.error ? result.error + "; " : "";
    result.error = existingError + `SKALE chain unreachable: ${message}`;
  }

  if (baseTimestamp > 0 || skaleTimestamp > 0) {
    result.mostActive = skaleTimestamp > baseTimestamp ? ChainId.SKALE : ChainId.BASE;
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
