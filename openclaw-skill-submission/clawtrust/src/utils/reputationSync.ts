import { ChainId, getChainConfig } from "../config/chains.js";
import type { ChainConfig } from "../config/chains.js";
import type { WalletProvider } from "../client.js";

const GET_FUSED_SCORE_SELECTOR = "0xb242f17c";
const SUBMIT_FUSED_FEEDBACK_SELECTOR = "0x8c6ec3a6";
const BALANCE_OF_SELECTOR = "0x70a08231";

const DEFAULT_API_URL = "https://clawtrust.org/api";

interface FusedScoreData {
  onChainScore: number;
  moltbookKarma: number;
  performanceScore: number;
  bondScore: number;
  fusedScore: number;
  timestamp: number;
}

interface PassportData {
  hasPassport: boolean;
  nftBalance: number;
}

export interface SyncOptions {
  walletProvider?: WalletProvider;
  apiUrl?: string;
}

export interface ReputationSyncResult {
  score: number;
  syncedAt: string;
  fromChain: ChainId;
  toChain: ChainId;
  success: boolean;
  txHash?: string;
  passport?: PassportData;
  scoreBreakdown?: Omit<FusedScoreData, "fusedScore" | "timestamp">;
  error?: string;
}

export interface CrossChainReputation {
  base: { score: number | null; error?: string };
  skale: { score: number | null; error?: string };
  mostActive: ChainId | null;
}

function word(hex: string): string {
  return hex.padStart(64, "0");
}

function encodeAddress(address: string): string {
  return word(address.toLowerCase().replace("0x", ""));
}

function encodeUint256(value: number): string {
  return word(value.toString(16));
}

function decodeUint256FromHex(hex: string, wordIndex: number): number {
  const start = wordIndex * 64;
  const slice = hex.substring(start, start + 64);
  if (!slice || slice.length === 0) return 0;
  return parseInt(slice, 16) || 0;
}

function stringToHexBytes(str: string): string {
  const encoder = new TextEncoder();
  const bytes = encoder.encode(str);
  let hex = "";
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, "0");
  }
  return hex;
}

function encodeStringABI(str: string): string[] {
  const hexBytes = stringToHexBytes(str);
  const byteLength = hexBytes.length / 2;
  const words: string[] = [];
  words.push(encodeUint256(byteLength));
  const paddedHex = hexBytes.padEnd(Math.ceil(hexBytes.length / 64) * 64 || 64, "0");
  for (let i = 0; i < paddedHex.length; i += 64) {
    words.push(paddedHex.substring(i, i + 64).padEnd(64, "0"));
  }
  return words;
}

function encodeSubmitFusedFeedback(
  agentAddress: string,
  onChainScore: number,
  moltbookKarma: number,
  performanceScore: number,
  bondScore: number,
  tags: string[],
  proof: string
): string {
  const headWords: string[] = [];
  headWords.push(encodeAddress(agentAddress));
  headWords.push(encodeUint256(onChainScore));
  headWords.push(encodeUint256(moltbookKarma));
  headWords.push(encodeUint256(performanceScore));
  headWords.push(encodeUint256(bondScore));

  const headSize = 7;

  const tagsEncoding: string[] = [];
  tagsEncoding.push(encodeUint256(tags.length));
  const tagStringEncodings: string[][] = [];
  for (const tag of tags) {
    tagStringEncodings.push(encodeStringABI(tag));
  }

  const tagOffsets: number[] = [];
  let currentTagOffset = tags.length * 32;
  for (const enc of tagStringEncodings) {
    tagOffsets.push(currentTagOffset);
    currentTagOffset += enc.length * 32;
  }
  for (const offset of tagOffsets) {
    tagsEncoding.push(encodeUint256(offset));
  }
  for (const enc of tagStringEncodings) {
    tagsEncoding.push(...enc);
  }

  const proofEncoding = encodeStringABI(proof);

  const tagsOffset = headSize * 32;
  const proofOffset = tagsOffset + tagsEncoding.length * 32;

  headWords.push(encodeUint256(tagsOffset));
  headWords.push(encodeUint256(proofOffset));

  const allWords = [...headWords, ...tagsEncoding, ...proofEncoding];
  return SUBMIT_FUSED_FEEDBACK_SELECTOR + allWords.join("");
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

async function syncViaApi(
  apiUrl: string,
  agentAddress: string,
  fromChain: ChainId,
  toChain: ChainId,
  fusedScore: FusedScoreData,
  passport: PassportData
): Promise<{ txHash: string }> {
  const res = await fetch(`${apiUrl}/reputation/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agentAddress,
      fromChain,
      toChain,
      fusedScore: {
        onChainScore: fusedScore.onChainScore,
        moltbookKarma: fusedScore.moltbookKarma,
        performanceScore: fusedScore.performanceScore,
        bondScore: fusedScore.bondScore,
        fusedScore: fusedScore.fusedScore,
      },
      passport: {
        hasPassport: passport.hasPassport,
        nftBalance: passport.nftBalance,
      },
    }),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "Unknown error");
    throw new Error(`API sync failed (${res.status}): ${errorText}`);
  }

  const data = (await res.json()) as { txHash?: string; error?: string };

  if (data.error) {
    throw new Error(`API sync error: ${data.error}`);
  }

  if (!data.txHash) {
    throw new Error("API sync response missing txHash");
  }

  return { txHash: data.txHash };
}

async function getFusedScoreFromChain(
  config: ChainConfig,
  agentAddress: string
): Promise<FusedScoreData> {
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

async function getPassportData(
  config: ChainConfig,
  agentAddress: string
): Promise<PassportData> {
  const data = BALANCE_OF_SELECTOR + encodeAddress(agentAddress);

  try {
    const result = await ethCall(
      config.rpcUrl,
      config.contracts.ClawCardNFT,
      data
    );

    if (!result || result === "0x") return { hasPassport: false, nftBalance: 0 };

    const balance = parseInt(result.replace("0x", ""), 16);
    return { hasPassport: balance > 0, nftBalance: balance };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read passport data from ${config.name}: ${message}`);
  }
}

export async function syncReputation(
  agentAddress: string,
  fromChain: ChainId,
  toChain: ChainId,
  options?: SyncOptions
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

    const [fusedScore, passport] = await Promise.all([
      getFusedScoreFromChain(fromConfig, agentAddress),
      getPassportData(fromConfig, agentAddress),
    ]);

    if (fusedScore.fusedScore === 0 && fusedScore.onChainScore === 0 && !passport.hasPassport) {
      return {
        score: 0,
        syncedAt: new Date().toISOString(),
        fromChain,
        toChain,
        success: false,
        passport,
        error: `Agent ${agentAddress} has no reputation data or passport on ${fromConfig.name}.`,
      };
    }

    const syncTimestamp = new Date().toISOString();

    const scoreBreakdown = {
      onChainScore: fusedScore.onChainScore,
      moltbookKarma: fusedScore.moltbookKarma,
      performanceScore: fusedScore.performanceScore,
      bondScore: fusedScore.bondScore,
    };

    let txHash: string;

    if (options?.walletProvider) {
      const calldata = encodeSubmitFusedFeedback(
        agentAddress,
        fusedScore.onChainScore,
        fusedScore.moltbookKarma,
        fusedScore.performanceScore,
        fusedScore.bondScore,
        ["cross-chain-sync"],
        `sync:${fromChain}:${syncTimestamp}`
      );

      txHash = await sendTransaction(
        options.walletProvider,
        toConfig.contracts.ClawTrustRepAdapter,
        calldata
      );
    } else {
      const apiUrl = (options?.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, "");
      const apiResult = await syncViaApi(apiUrl, agentAddress, fromChain, toChain, fusedScore, passport);
      txHash = apiResult.txHash;
    }

    return {
      score: fusedScore.fusedScore,
      syncedAt: syncTimestamp,
      fromChain,
      toChain,
      success: true,
      txHash,
      passport,
      scoreBreakdown,
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
    base: { score: null },
    skale: { score: null },
    mostActive: null,
  };

  let baseTimestamp = 0;
  let skaleTimestamp = 0;

  try {
    const baseConfig = getChainConfig(ChainId.BASE);
    const baseScore = await getFusedScoreFromChain(baseConfig, agentAddress);
    result.base = { score: baseScore.fusedScore };
    baseTimestamp = baseScore.timestamp;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    result.base = { score: null, error: `Base chain error: ${message}` };
  }

  try {
    const skaleConfig = getChainConfig(ChainId.SKALE);
    const skaleScore = await getFusedScoreFromChain(skaleConfig, agentAddress);
    result.skale = { score: skaleScore.fusedScore };
    skaleTimestamp = skaleScore.timestamp;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    result.skale = { score: null, error: `SKALE chain error: ${message}` };
  }

  if (baseTimestamp > 0 || skaleTimestamp > 0) {
    result.mostActive = skaleTimestamp > baseTimestamp ? ChainId.SKALE : ChainId.BASE;
  }

  return result;
}

export async function hasReputationOnChain(
  agentAddress: string,
  chain: ChainId
): Promise<{ exists: boolean; error?: string }> {
  try {
    const config = getChainConfig(chain);

    const [passport, fusedScore] = await Promise.all([
      getPassportData(config, agentAddress),
      getFusedScoreFromChain(config, agentAddress),
    ]);

    const exists = passport.hasPassport || fusedScore.fusedScore > 0 || fusedScore.onChainScore > 0;
    return { exists };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { exists: false, error: `Failed to check reputation on ${chain}: ${message}` };
  }
}
