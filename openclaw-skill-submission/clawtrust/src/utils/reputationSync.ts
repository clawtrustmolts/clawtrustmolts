import { ChainId, getChainConfig } from "../config/chains.js";
import type { ChainConfig } from "../config/chains.js";
import type { WalletProvider } from "../client.js";

const GET_FUSED_SCORE_SELECTOR = "0xb242f17c";
const SUBMIT_FUSED_FEEDBACK_SELECTOR = "0x8c6ec3a6";
const BALANCE_OF_SELECTOR = "0x70a08231";
const IS_REGISTERED_SELECTOR = "0xc3c5a547";
const GET_SCORE_SELECTOR = "0xd47875d0";
const GET_FEEDBACK_COUNT_SELECTOR = "0x01ff73e7";

interface FusedScoreData {
  onChainScore: number;
  moltbookKarma: number;
  performanceScore: number;
  bondScore: number;
  fusedScore: number;
  timestamp: number;
}

interface ERC8004Data {
  isRegistered: boolean;
  registryScore: number;
  feedbackCount: number;
  passportBalance: number;
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
  errors: string[];
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

function decodeBoolFromHex(hex: string): boolean {
  if (!hex || hex === "0x") return false;
  const cleaned = hex.replace("0x", "");
  return parseInt(cleaned, 16) !== 0;
}

function decodeInt256FromHex(hex: string): number {
  if (!hex || hex === "0x") return 0;
  const cleaned = hex.replace("0x", "").padStart(64, "0");
  const val = BigInt("0x" + cleaned);
  const maxPositive = BigInt("0x7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
  if (val > maxPositive) {
    return Number(val - BigInt("0x10000000000000000000000000000000000000000000000000000000000000000"));
  }
  return Number(val);
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

async function getERC8004Data(
  config: ChainConfig,
  agentAddress: string
): Promise<ERC8004Data> {
  const addrEncoded = encodeAddress(agentAddress);

  const [registeredResult, scoreResult, countResult, balanceResult] = await Promise.all([
    ethCall(config.rpcUrl, config.contracts.ERC8004IdentityRegistry, IS_REGISTERED_SELECTOR + addrEncoded),
    ethCall(config.rpcUrl, config.contracts.ERC8004IdentityRegistry, GET_SCORE_SELECTOR + addrEncoded),
    ethCall(config.rpcUrl, config.contracts.ERC8004IdentityRegistry, GET_FEEDBACK_COUNT_SELECTOR + addrEncoded),
    ethCall(config.rpcUrl, config.contracts.ClawCardNFT, BALANCE_OF_SELECTOR + addrEncoded),
  ]);

  return {
    isRegistered: decodeBoolFromHex(registeredResult),
    registryScore: decodeInt256FromHex(scoreResult),
    feedbackCount: decodeUint256FromHex(countResult.replace("0x", ""), 0),
    passportBalance: decodeUint256FromHex(balanceResult.replace("0x", ""), 0),
  };
}

export async function syncReputation(
  agentAddress: string,
  fromChain: ChainId,
  toChain: ChainId,
  walletProvider?: WalletProvider
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

    const [fusedScore, erc8004] = await Promise.all([
      getFusedScoreFromChain(fromConfig, agentAddress),
      getERC8004Data(fromConfig, agentAddress),
    ]);

    const hasReputation =
      fusedScore.fusedScore > 0 ||
      fusedScore.onChainScore > 0 ||
      erc8004.isRegistered ||
      erc8004.passportBalance > 0;

    if (!hasReputation) {
      return {
        score: 0,
        syncedAt: new Date().toISOString(),
        fromChain,
        toChain,
        success: false,
        error: `Agent ${agentAddress} has no reputation data, ERC-8004 identity, or passport on ${fromConfig.name}.`,
      };
    }

    if (!walletProvider) {
      return {
        score: fusedScore.fusedScore,
        syncedAt: new Date().toISOString(),
        fromChain,
        toChain,
        success: false,
        error: "A walletProvider with oracle permissions on the destination chain is required to write the reputation snapshot. Pass a WalletProvider as the 4th argument to complete the cross-chain sync.",
      };
    }

    const syncTimestamp = new Date().toISOString();

    const calldata = encodeSubmitFusedFeedback(
      agentAddress,
      fusedScore.onChainScore,
      fusedScore.moltbookKarma,
      fusedScore.performanceScore,
      fusedScore.bondScore,
      ["cross-chain-sync"],
      `sync:${fromChain}:${syncTimestamp}:registered=${erc8004.isRegistered}:feedbacks=${erc8004.feedbackCount}:registryScore=${erc8004.registryScore}`
    );

    const txHash = await sendTransaction(
      walletProvider,
      toConfig.contracts.ClawTrustRepAdapter,
      calldata
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
    errors: [],
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
    result.errors.push(`Base Sepolia: ${message}`);
  }

  try {
    const skaleConfig = getChainConfig(ChainId.SKALE);
    const skaleScore = await getFusedScoreFromChain(skaleConfig, agentAddress);
    result.skale = skaleScore.fusedScore;
    skaleTimestamp = skaleScore.timestamp;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    result.errors.push(`SKALE on Base: ${message}`);
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

    const [erc8004, fusedScore] = await Promise.all([
      getERC8004Data(config, agentAddress),
      getFusedScoreFromChain(config, agentAddress),
    ]);

    return erc8004.isRegistered || erc8004.passportBalance > 0 || fusedScore.fusedScore > 0 || fusedScore.onChainScore > 0;
  } catch {
    return false;
  }
}
