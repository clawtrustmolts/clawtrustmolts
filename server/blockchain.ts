/**
 * blockchain.ts — viem contract clients for all 6 deployed ClawTrust contracts.
 * Loaded once at startup; all on-chain calls go through here.
 */

import { createPublicClient, createWalletClient, http, getContract, parseUnits, type Address, keccak256, toHex, isAddress, parseAbi, decodeEventLog } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync } from "fs";
import { join } from "path";
import { storage } from "./storage";
import { syncScoreToSkale } from "./skale-chain";

// ─── Config ──────────────────────────────────────────────────────────

const RPC_URL = process.env.BASE_RPC_URL || "https://sepolia.base.org";

/**
 * NETWORK_MODE — set to "mainnet" in production env vars to switch all
 * contract addresses to Base Mainnet (8453) instead of Base Sepolia (84532).
 * One-click mainnet readiness: deploy contracts, set VITE_NETWORK_MODE=mainnet
 * and each MAINNET_* address env var, then redeploy.
 */
export const NETWORK_MODE: "testnet" | "mainnet" =
  (process.env.NETWORK_MODE === "mainnet") ? "mainnet" : "testnet";

const IS_MAINNET = NETWORK_MODE === "mainnet";

// ─── Redeployed 2026-03-19 (Task #27) — security patches (CRITICAL-3, CRITICAL-4, HIGH-1, getGigVerdict) ──
const CONTRACT_ADDRESSES = {
  clawCardNFT:    (IS_MAINNET
    ? (process.env.MAINNET_CLAW_CARD_NFT_ADDRESS   || "")
    : (process.env.CLAW_CARD_NFT_ADDRESS            || "0xf24e41980ed48576Eb379D2116C1AaD075B342C4")) as Address,
  escrow:         (IS_MAINNET
    ? (process.env.MAINNET_ESCROW_ADDRESS           || "")
    : (process.env.CLAW_TRUST_ESCROW_ADDRESS        || "0x6B676744B8c4900F9999E9a9323728C160706126")) as Address,
  swarmValidator: (IS_MAINNET
    ? (process.env.MAINNET_SWARM_VALIDATOR_ADDRESS  || "")
    : (process.env.CLAW_TRUST_SWARM_VALIDATOR_ADDRESS|| "0xb219ddb4a65934Cea396C606e7F6bcfBF2F68743")) as Address,
  repAdapter:     (IS_MAINNET
    ? (process.env.MAINNET_REP_ADAPTER_ADDRESS      || "")
    : (process.env.CLAW_TRUST_REP_ADAPTER_ADDRESS   || "0xEfF3d3170e37998C7db987eFA628e7e56E1866DB")) as Address,
  bond:           (IS_MAINNET
    ? (process.env.MAINNET_BOND_ADDRESS             || "")
    : (process.env.CLAW_TRUST_BOND_ADDRESS          || "0x23a1E1e958C932639906d0650A13283f6E60132c")) as Address,
  crew:           (IS_MAINNET
    ? (process.env.MAINNET_CREW_ADDRESS             || "")
    : (process.env.CLAW_TRUST_CREW_ADDRESS          || "0x33D0f79974C383dc374C888774eB52b0fca41BA2")) as Address,
  registry:       (IS_MAINNET
    ? (process.env.MAINNET_REGISTRY_ADDRESS         || "")
    : (process.env.CLAW_TRUST_REGISTRY_ADDRESS      || "0x82AEAA9921aC1408626851c90FCf74410D059dF4")) as Address,
};

// Startup guard: warn if crew contract is at an unexpected address
if (!IS_MAINNET && !process.env.CLAW_TRUST_CREW_ADDRESS) {
  console.warn("[Crew] CLAW_TRUST_CREW_ADDRESS is unset — using fallback 0x33D0f79974C383dc374C888774eB52b0fca41BA2 (ClawTrustCrew v2 on Base Sepolia)");
}
if (!process.env.SKALE_MAINNET_CREW_ADDRESS) {
  console.warn("[Crew] SKALE_MAINNET_CREW_ADDRESS is unset — using fallback 0x427d0D6481bC708979Bdc2F80f659549BdB27f96 (ClawTrustCrew v2 on SKALE)");
}

/** Returns a summary of current network config for the /api/system/network endpoint */
export function getNetworkConfig() {
  return {
    mode: NETWORK_MODE,
    chainId: IS_MAINNET ? 8453 : 84532,
    chainName: IS_MAINNET ? "Base Mainnet" : "Base Sepolia",
    contracts: {
      escrow:         CONTRACT_ADDRESSES.escrow,
      bond:           CONTRACT_ADDRESSES.bond,
      swarmValidator: CONTRACT_ADDRESSES.swarmValidator,
      registry:       CONTRACT_ADDRESSES.registry,
      repAdapter:     CONTRACT_ADDRESSES.repAdapter,
    },
    mainnetReady: IS_MAINNET
      ? Object.values(CONTRACT_ADDRESSES).every(a => a && a.length > 5)
      : false,
    mainnetChecklist: {
      escrowDeployed:         IS_MAINNET ? !!process.env.MAINNET_ESCROW_ADDRESS   : null,
      bondDeployed:           IS_MAINNET ? !!process.env.MAINNET_BOND_ADDRESS     : null,
      swarmValidatorDeployed: IS_MAINNET ? !!process.env.MAINNET_SWARM_VALIDATOR_ADDRESS : null,
      registryDeployed:       IS_MAINNET ? !!process.env.MAINNET_REGISTRY_ADDRESS  : null,
      oracleKeySet:           !!process.env.ORACLE_PRIVATE_KEY,
      usdcConfigured:         IS_MAINNET ? true : null,
      networkModeSet:         IS_MAINNET,
    },
  };
}

// ─── ABI loader ──────────────────────────────────────────────────────

function loadAbi(contractName: string): any[] {
  const artifactPath = join(
    process.cwd(),
    "contracts/artifacts/contracts",
    `${contractName}.sol`,
    `${contractName}.json`
  );
  try {
    const artifact = JSON.parse(readFileSync(artifactPath, "utf-8"));
    return artifact.abi;
  } catch (err: any) {
    console.error(`[blockchain] Failed to load ABI for ${contractName}:`, err.message);
    return [];
  }
}

const ABIS = {
  clawCardNFT:    loadAbi("ClawCardNFT"),
  escrow:         loadAbi("ClawTrustEscrow"),
  swarmValidator: loadAbi("ClawTrustSwarmValidator"),
  repAdapter:     loadAbi("ClawTrustRepAdapter"),
  bond:           loadAbi("ClawTrustBond"),
  crew:           loadAbi("ClawTrustCrew"),
  registry:       loadAbi("ClawTrustRegistry"),
};

// ─── Clients ─────────────────────────────────────────────────────────

export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(RPC_URL, { timeout: 20_000, retryCount: 3 }),
});

function normalizePrivateKey(raw: string): `0x${string}` {
  const clean = raw.trim();
  return (clean.startsWith("0x") ? clean : `0x${clean}`) as `0x${string}`;
}

function buildWalletClient() {
  const raw = process.env.DEPLOYER_PRIVATE_KEY;
  if (!raw || raw.trim() === "") {
    console.warn("[blockchain] DEPLOYER_PRIVATE_KEY not set — write calls disabled");
    return null;
  }
  try {
    const pk = normalizePrivateKey(raw);
    const account = privateKeyToAccount(pk);
    return createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(RPC_URL, { timeout: 20_000, retryCount: 3 }),
    });
  } catch (err: any) {
    console.error("[blockchain] Failed to build wallet client:", err.message, "— write calls disabled");
    return null;
  }
}

export const walletClient = buildWalletClient();

export function getDeployerAddress(): Address | null {
  const raw = process.env.DEPLOYER_PRIVATE_KEY;
  if (!raw || raw.trim() === "") return null;
  try {
    return privateKeyToAccount(normalizePrivateKey(raw)).address;
  } catch {
    return null;
  }
}

// ─── Contract instances ───────────────────────────────────────────────

function makeContract(name: keyof typeof CONTRACT_ADDRESSES, abiKey: keyof typeof ABIS) {
  return getContract({
    address: CONTRACT_ADDRESSES[name],
    abi: ABIS[abiKey],
    client: { public: publicClient, wallet: walletClient ?? undefined },
  });
}

export const clawCardNFT      = makeContract("clawCardNFT",    "clawCardNFT");
export const escrowContract   = makeContract("escrow",         "escrow");
export const swarmValidator   = makeContract("swarmValidator", "swarmValidator");
export const repAdapter       = makeContract("repAdapter",     "repAdapter");
export const bondContract     = makeContract("bond",           "bond");
export const crewContract     = makeContract("crew",           "crew");
export const registryContract = makeContract("registry",       "registry");

export const REGISTRY_ADDRESS = CONTRACT_ADDRESSES.registry;
export const REGISTRY_BASESCAN = `https://sepolia.basescan.org/address/${CONTRACT_ADDRESSES.registry}`;

// ─── Chain identifier constants ───────────────────────────────────────
// Canonical values matching shared/schema.ts chainEnum — always use these,
// never hard-code the string to prevent naming drift.
export const CHAIN_BASE_SEPOLIA = "BASE_SEPOLIA" as const;
export const CHAIN_SKALE_TESTNET = "SKALE_TESTNET" as const;
export type ClawChain = typeof CHAIN_BASE_SEPOLIA | typeof CHAIN_SKALE_TESTNET;

// ─── SKALE swarm validator (zero-gas) ────────────────────────────────

const SKALE_SWARM_RPC = "https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha";
const SKALE_SWARM_ADDRESS = (process.env.SKALE_SWARM_VALIDATOR_ADDRESS || "0x7693a841Eec79Da879241BC0eCcc80710F39f399") as Address;

const skaleChainDef = {
  id: 324705682,
  name: "SKALE Base Sepolia",
  nativeCurrency: { name: "sFUEL", symbol: "sFUEL", decimals: 18 },
  rpcUrls: {
    default: { http: [SKALE_SWARM_RPC] },
    public:  { http: [SKALE_SWARM_RPC] },
  },
} as const;

export const skaleSwarmPublicClient = createPublicClient({
  chain: skaleChainDef as any,
  transport: http(SKALE_SWARM_RPC, { timeout: 20_000, retryCount: 2, retryDelay: 1500 }),
});

function buildSkaleWalletClient() {
  const raw = process.env.DEPLOYER_PRIVATE_KEY;
  if (!raw || raw.trim() === "") return null;
  try {
    const pk = normalizePrivateKey(raw);
    const account = privateKeyToAccount(pk);
    return createWalletClient({
      account,
      chain: skaleChainDef as any,
      transport: http(SKALE_SWARM_RPC, { timeout: 20_000, retryCount: 2, retryDelay: 1500 }),
    });
  } catch {
    return null;
  }
}

const skaleWalletClient = buildSkaleWalletClient();

export const skaleSwarmValidator = getContract({
  address: SKALE_SWARM_ADDRESS,
  abi: ABIS.swarmValidator,
  client: { public: skaleSwarmPublicClient, wallet: skaleWalletClient ?? undefined },
});

// ─── SKALE Crew contract (v2 with formCrewFor) ────────────────────────────────
const SKALE_CREW_ADDRESS = (process.env.SKALE_MAINNET_CREW_ADDRESS || "0x427d0D6481bC708979Bdc2F80f659549BdB27f96") as Address;

export const skaleCrewContract = getContract({
  address: SKALE_CREW_ADDRESS,
  abi: ABIS.crew,
  client: { public: skaleSwarmPublicClient, wallet: skaleWalletClient ?? undefined },
});

// ─── Local Nonce Manager ─────────────────────────────────────────────────────
// Base Sepolia (and SKALE) RPC nodes sometimes don't reflect pending txs quickly
// enough when eth_getTransactionCount("pending") is called for rapid sequential
// transactions. This means two consecutive calls can receive the same nonce,
// producing "nonce too low" errors after the first tx mines.
//
// Solution: track the nonce locally after the first fetch and auto-increment
// without querying the chain again. Reset only on nonce-related errors.
class NonceMgr {
  private next: number | null = null;

  reset(): void { this.next = null; }

  async acquire(getFromChain: () => Promise<number>): Promise<number> {
    if (this.next === null) {
      this.next = await getFromChain();
    }
    return this.next++;
  }

  onError(err: any): void {
    const msg = ((err?.message ?? "") as string).toLowerCase();
    // "timed out" is intentionally excluded: the tx was already broadcast with
    // the current nonce and this.next is already incremented to N+1. Resetting
    // here would cause a re-fetch that returns N (still pending) and the next
    // tx would be sent with a duplicate nonce → "nonce too low" chain of errors.
    if (
      msg.includes("nonce") ||
      msg.includes("already known") ||
      msg.includes("replacement transaction underpriced") ||
      msg.includes("missing or invalid") ||
      msg.includes("invalid parameters")
    ) {
      this.next = null; // force re-fetch from chain on next tx
    }
  }
}

const _baseNonceMgr = new NonceMgr();
const _skaleNonceMgr = new NonceMgr();

// Separate nonce lock for SKALE chain (independent nonce sequence from Base Sepolia)
let _skaleNonceLock: Promise<void> = Promise.resolve();
async function withSkaleNonceLock(fn: (nonce: number) => Promise<any>): Promise<any> {
  const result = _skaleNonceLock.then(async () => {
    if (!skaleWalletClient?.account) return fn(0);
    const nonce = await _skaleNonceMgr.acquire(() =>
      skaleSwarmPublicClient.getTransactionCount({
        address: skaleWalletClient!.account!.address,
        blockTag: "latest",
      })
    );
    try {
      return await fn(nonce);
    } catch (err: any) {
      _skaleNonceMgr.onError(err);
      throw err;
    }
  });
  _skaleNonceLock = result.then(() => {}, () => {});
  return result;
}

function isSkaleWriteReady(): boolean {
  if (!skaleWalletClient) {
    console.warn("[blockchain] skaleWalletClient not available — skipping SKALE on-chain write");
    return false;
  }
  return true;
}

// ─── Utility ─────────────────────────────────────────────────────────

function isWriteReady(): boolean {
  if (!walletClient) {
    console.warn("[blockchain] walletClient not available — skipping on-chain write");
    return false;
  }
  return true;
}

// ─── Nonce serialization lock — prevents concurrent tx nonce conflicts ───────
// Uses NonceMgr above to track nonce locally, avoiding RPC races.

let _nonceLock: Promise<void> = Promise.resolve();

async function withNonceLock(fn: (nonce: number) => Promise<any>): Promise<any> {
  const result = _nonceLock.then(async () => {
    if (!walletClient?.account) return fn(0); // no oracle, let viem pick nonce
    const nonce = await _baseNonceMgr.acquire(() =>
      publicClient.getTransactionCount({
        address: walletClient!.account!.address,
        // Use "latest" — Base Sepolia's public RPC does not reliably support
        // eth_getTransactionCount with "pending" tag, which causes stale nonces.
        // The local NonceMgr increments from the confirmed baseline for same-run txs.
        blockTag: "latest",
      })
    );
    try {
      return await fn(nonce);
    } catch (err: any) {
      _baseNonceMgr.onError(err);
      throw err;
    }
  });
  _nonceLock = result.then(() => {}, () => {});
  return result;
}

// ─── FIX 4 — Mint passport on agent registration ─────────────────────

/**
 * Mints an ERC-8004 ClawCard NFT (soulbound identity passport) for a newly registered agent.
 *
 * GAS MODEL — Oracle-Sponsored (Base Sepolia):
 *   This function calls `adminMintFull()` on the ClawCard NFT contract using the platform
 *   oracle wallet (`ORACLE_PRIVATE_KEY`). The oracle pays all ETH gas. The agent wallet
 *   is the *recipient* of the minted NFT but **never pays any gas**. This is the canonical
 *   zero-gas registration path for Base Sepolia.
 *
 *   For SKALE Base Sepolia, `registerAgentOnSkale()` (skale-chain.ts) is used instead, with
 *   an automatic sFUEL drip from the deployer wallet so the agent wallet also pays 0 gas.
 */
export async function mintPassportForAgent(agent: {
  id: string;
  handle: string;
  walletAddress: string;
  skills: string[];
}, options?: { fromQueue?: boolean }): Promise<{ tokenId: string | null; txHash: string | null }> {
  if (!isWriteReady()) return { tokenId: null, txHash: null };

  const isValidWallet = /^0x[a-fA-F0-9]{40}$/.test(agent.walletAddress);
  const isPlaceholder = !agent.walletAddress || /^0x0+$/.test(agent.walletAddress) || agent.walletAddress === "0x0000000000000000000000000000000000000000";
  if (!isValidWallet || isPlaceholder) {
    console.warn(`[Passport] Skipping mint for ${agent.handle} — invalid wallet: ${agent.walletAddress}`);
    return { tokenId: null, txHash: null };
  }

  const metadataUri = `https://clawtrust.org/api/agents/${agent.id}/metadata`;

  try {
    const txHash = await withNonceLock((nonce) =>
      (clawCardNFT as any).write.adminMintFull([
        agent.walletAddress as Address,
        agent.handle,
        metadataUri,
        agent.skills,
      ], { nonce })
    );

    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    const mintTopic = keccak256(toHex("PassportMinted(address,uint256,uint256)"));

    let tokenId: string | null = null;
    for (const log of receipt.logs) {
      if (log.topics[0]?.toLowerCase() === mintTopic.toLowerCase()) {
        tokenId = BigInt(log.topics[2] as string).toString();
        break;
      }
    }

    if (tokenId) {
      await storage.updateAgent(agent.id, {
        erc8004TokenId: tokenId,
        isVerified: true,
        autonomyStatus: "active",
      });
      console.log(`[Passport] Minted tokenId=${tokenId} for ${agent.walletAddress} tx=${txHash} — isVerified=true, status=active`);
    }

    return { tokenId, txHash };
  } catch (err: any) {
    const errMsg = err.message || "";
    console.error(`[Passport] Mint failed for ${agent.handle}:`, errMsg.slice(0, 200));

    const isPermanentFailure =
      errMsg.includes("InvalidAddress") ||
      errMsg.includes("already minted") ||
      errMsg.includes("AlreadyMinted") ||
      errMsg.includes("token already minted") ||
      errMsg.includes("ERC721: token already minted");

    if (isPermanentFailure) {
      console.warn(`[Passport] Permanent failure for ${agent.handle} — will not retry`);
      return { tokenId: null, txHash: null };
    }

    if (!options?.fromQueue) {
      await queueBlockchainAction({
        type: "MINT_PASSPORT",
        agentId: agent.id,
        payload: { handle: agent.handle, walletAddress: agent.walletAddress, skills: agent.skills },
      });
    }
    return { tokenId: null, txHash: null };
  }
}

// ─── FIX 5 — Set .molt domain on-chain ───────────────────────────────

export async function setMoltDomainOnChain(
  tokenId: string,
  moltDomain: string
): Promise<string | null> {
  if (!isWriteReady()) return null;

  try {
    const txHash = await withNonceLock((nonce) =>
      (clawCardNFT as any).write.setMoltDomain([
        BigInt(tokenId),
        moltDomain,
      ], { nonce })
    );
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`[Passport] .molt domain set: ${moltDomain} tx=${txHash}`);
    return txHash;
  } catch (err: any) {
    console.error(`[Passport] setMoltDomain failed for ${moltDomain}:`, err.message?.slice(0, 200));
    return null;
  }
}

// ─── FIX 6 — Update reputation on-chain via RepAdapter ───────────────

export async function updateReputationOnChain(opts: {
  agentWallet: string;
  onChainScore: number;
  moltbookKarma: number;
  performanceScore: number;
  bondScore: number;
}): Promise<string | null> {
  if (!isWriteReady()) return null;

  // Scale to contract raw values:
  //   onChainScore: 0-1000 raw (contract max)
  //   moltbookKarma: 0-10000 raw (contract max)
  //   performanceScore: 0-100
  //   bondScore: 0-100
  if (!isAddress(opts.agentWallet)) {
    return null;
  }

  const rawOnChain    = Math.min(Math.round(opts.onChainScore), 100);
  const rawMoltbook   = Math.min(Math.round(opts.moltbookKarma), 10000);
  const rawPerf       = Math.min(Math.round(opts.performanceScore), 100);
  const rawBond       = Math.min(Math.round(opts.bondScore), 100);
  const proofUri      = `ipfs://clawtrust/reputation/${opts.agentWallet}`;

  try {
    const txHash = await withNonceLock((nonce) =>
      (repAdapter as any).write.updateFusedScore([
        opts.agentWallet as Address,
        BigInt(rawOnChain),
        BigInt(rawMoltbook),
        BigInt(rawPerf),
        BigInt(rawBond),
        proofUri,
      ], { nonce })
    );
    // waitForTransactionReceipt is OUTSIDE the nonce lock — if it times out,
    // the tx was already broadcast so we treat it as submitted and reset the
    // local nonce so the next call fetches fresh from chain.
    await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 90_000 });
    console.log(`[Reputation] On-chain updated for ${opts.agentWallet} tx=${txHash}`);
    return txHash;
  } catch (err: any) {
    const errMsg = err.message || "";
    // Always reset the nonce manager on any error — the tx may have been
    // broadcast with the current nonce, so we must re-fetch from chain.
    _baseNonceMgr.onError(err);
    if (errMsg.includes("UpdateTooSoon")) {
      console.log(`[Reputation] Skipped ${opts.agentWallet} — UpdateTooSoon (contract cooldown)`);
    } else {
      console.error(`[Reputation] Update failed for ${opts.agentWallet}:`, errMsg.slice(0, 200));
    }
    return null;
  }
}

// ─── FIX 7 — Lock USDC in Escrow ─────────────────────────────────────

export async function lockEscrowOnChain(opts: {
  gigId: string;
  payeeWallet: string;
  amountUsdc: number;
}): Promise<string | null> {
  if (!isWriteReady()) return null;

  const gigIdBytes32 = ("0x" + Buffer.from(opts.gigId.replace(/-/g, "")).toString("hex").padStart(64, "0")) as `0x${string}`;
  const amountRaw = parseUnits(opts.amountUsdc.toString(), 6);

  try {
    const txHash = await withNonceLock((nonce) =>
      (escrowContract as any).write.lockUSDC([
        gigIdBytes32,
        opts.payeeWallet as Address,
        amountRaw,
      ], { nonce })
    );
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`[Escrow] Locked ${opts.amountUsdc} USDC for gig ${opts.gigId} tx=${txHash}`);
    return txHash;
  } catch (err: any) {
    console.error(`[Escrow] Lock failed for gig ${opts.gigId}:`, err.message?.slice(0, 200));
    return null;
  }
}

// ─── FIX 8 — Create swarm validation on-chain ────────────────────────

export async function createSwarmValidationOnChain(opts: {
  gigId: string;
  posterWallet: string;
  assigneeWallet: string;
  candidateWallets: string[];
  threshold: number;
  chain?: string | null;
}): Promise<string | null> {
  const useSkale = opts.chain === CHAIN_SKALE_TESTNET;

  if (useSkale) {
    if (!isSkaleWriteReady()) return null;
  } else {
    if (!isWriteReady()) return null;
  }

  const gigIdBytes32 = ("0x" + Buffer.from(opts.gigId.replace(/-/g, "")).toString("hex").padStart(64, "0")) as `0x${string}`;
  const usdcAddress  = (process.env.USDC_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as Address;

  const contract  = useSkale ? skaleSwarmValidator : swarmValidator;
  const waitClient = useSkale ? skaleSwarmPublicClient : publicClient;
  const lockFn    = useSkale ? withSkaleNonceLock : withNonceLock;
  const chainLabel = useSkale ? "SKALE" : "Base";

  try {
    const txHash = await lockFn((nonce) =>
      (contract as any).write.createValidation([
        gigIdBytes32,
        opts.posterWallet  as Address,
        opts.assigneeWallet as Address,
        opts.candidateWallets as Address[],
        BigInt(opts.threshold),
        BigInt(0),
        usdcAddress,
      ], { nonce })
    );
    await waitClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`[Swarm][${chainLabel}] Validation created on-chain for gig ${opts.gigId} tx=${txHash}`);
    return txHash;
  } catch (err: any) {
    console.error(`[Swarm][${chainLabel}] createValidation failed for gig ${opts.gigId}:`, err.message?.slice(0, 200));
    return null;
  }
}

// ─── FIX 8b — Cast vote on swarm validator ───────────────────────────

export async function castSwarmVoteOnChain(opts: {
  gigId: string;
  approve: boolean;
  chain?: string | null;
}): Promise<string | null> {
  const useSkale = opts.chain === CHAIN_SKALE_TESTNET;

  if (useSkale) {
    if (!isSkaleWriteReady()) return null;
  } else {
    if (!isWriteReady()) return null;
  }

  const gigIdBytes32 = ("0x" + Buffer.from(opts.gigId.replace(/-/g, "")).toString("hex").padStart(64, "0")) as `0x${string}`;
  const voteType = opts.approve ? 1 : 2; // VoteType.Approve=1, Reject=2 (None=0)

  const contract   = useSkale ? skaleSwarmValidator : swarmValidator;
  const waitClient = useSkale ? skaleSwarmPublicClient : publicClient;
  const lockFn     = useSkale ? withSkaleNonceLock : withNonceLock;
  const chainLabel = useSkale ? "SKALE" : "Base";

  try {
    const txHash = await lockFn((nonce) =>
      (contract as any).write.vote([
        gigIdBytes32,
        voteType,
      ], { nonce })
    );
    await waitClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`[Swarm][${chainLabel}] Vote ${opts.approve ? "Approve" : "Reject"} for gig ${opts.gigId} tx=${txHash}`);
    return txHash;
  } catch (err: any) {
    console.error(`[Swarm][${chainLabel}] vote failed for gig ${opts.gigId}:`, err.message?.slice(0, 200));
    return null;
  }
}

// ─── FIX 9 — Read passport from chain ────────────────────────────────

export async function readPassportByWallet(wallet: string) {
  try {
    const result = await (clawCardNFT as any).read.getPassportByWallet([wallet as Address]);
    return { passport: result[0], tokenId: result[1].toString() };
  } catch {
    return null;
  }
}

export async function readPassportByMoltDomain(domain: string) {
  try {
    const passport = await (clawCardNFT as any).read.getPassportByMoltDomain([domain]);
    return passport;
  } catch {
    return null;
  }
}

export async function readPassportById(tokenId: string) {
  try {
    const passport = await (clawCardNFT as any).read.getPassportById([BigInt(tokenId)]);
    return passport;
  } catch {
    return null;
  }
}

// ─── Read on-chain validation info (rewardPool) from SwarmValidator ──────────

export async function getValidationInfoOnChain(
  gigId: string,
  chain?: string | null,
): Promise<{ rewardPool: number } | null> {
  const gigIdBytes32 = ("0x" + Buffer.from(gigId.replace(/-/g, "")).toString("hex").padStart(64, "0")) as `0x${string}`;
  const useSkale = chain === CHAIN_SKALE_TESTNET;
  const contract = useSkale ? skaleSwarmValidator : swarmValidator;
  try {
    const info = await (contract as any).read.getValidationInfo([gigIdBytes32]);
    // info is a tuple/struct; rewardPool is typically at index 5 or via named field
    const rewardPool = info?.rewardPool ?? info?.[5] ?? info?.[4] ?? 0n;
    return { rewardPool: Number(rewardPool) / 1_000_000 }; // USDC 6 decimals
  } catch {
    return null;
  }
}

export async function readRepScore(wallet: string): Promise<number | null> {
  try {
    const score = await (repAdapter as any).read.getScore([wallet as Address]);
    return Number(score);
  } catch {
    return null;
  }
}

export async function readFusedScore(wallet: string) {
  try {
    const data = await (repAdapter as any).read.fusedScores([wallet as Address]);
    return data;
  } catch {
    return null;
  }
}

// ─── SECURITY FIX — Read swarm verdict on-chain before escrow release ──

export async function readSwarmVerdictOnChain(gigId: string, chain?: string | null): Promise<{
  exists: boolean;
  votesFor: number;
  votesAgainst: number;
  totalVotes: number;
  status: number;
  finalized: boolean;
} | null> {
  const useSkale   = chain === CHAIN_SKALE_TESTNET;
  const contract   = useSkale ? skaleSwarmValidator : swarmValidator;
  const chainLabel = useSkale ? "SKALE" : "Base";

  const gigIdBytes32 = ("0x" + Buffer.from(gigId.replace(/-/g, "")).toString("hex").padStart(64, "0")) as `0x${string}`;

  try {
    const exists = await (contract as any).read.validationExists([gigIdBytes32]);
    if (!exists) {
      return { exists: false, votesFor: 0, votesAgainst: 0, totalVotes: 0, status: 0, finalized: false };
    }

    const result = await (contract as any).read.aggregateVotes([gigIdBytes32]);
    return {
      exists: true,
      votesFor: Number(result[0]),
      votesAgainst: Number(result[1]),
      totalVotes: Number(result[2]),
      status: Number(result[3]),
      finalized: Boolean(result[4]),
    };
  } catch (err: any) {
    console.error(`[Swarm][${chainLabel}] readSwarmVerdictOnChain failed for gig ${gigId}:`, err.message?.slice(0, 200));
    return null;
  }
}

// ─── Bond contract on-chain functions ────────────────────────────────

function gigIdToBytes32(gigId: string): `0x${string}` {
  return ("0x" + Buffer.from(gigId.replace(/-/g, "")).toString("hex").padStart(64, "0")) as `0x${string}`;
}

export async function updatePerformanceScoreOnChain(opts: {
  agentWallet: string;
  score: number;
}): Promise<string | null> {
  if (!isWriteReady()) return null;
  if (!isAddress(opts.agentWallet) || /^0x0+$/.test(opts.agentWallet)) return null;

  const clampedScore = Math.min(100, Math.max(0, Math.round(opts.score)));

  try {
    const txHash = await withNonceLock((nonce) =>
      (bondContract as any).write.updatePerformanceScore(
        [opts.agentWallet as Address, BigInt(clampedScore)],
        { gas: 100000n, nonce }
      )
    );
    await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 45_000 });
    console.log(`[Bond] updatePerformanceScore ${opts.agentWallet} => ${clampedScore} tx=${txHash}`);
    return txHash;
  } catch (err: any) {
    const errMsg = err.message || "";
    _baseNonceMgr.onError(err);
    const isSoftError =
      errMsg.includes("reverted") ||
      errMsg.includes("ScoreOutOfRange") ||
      errMsg.includes("NotAuthorizedCaller") ||
      errMsg.toLowerCase().includes("missing or invalid") ||
      errMsg.toLowerCase().includes("invalid parameters") ||
      errMsg.toLowerCase().includes("timed out") ||
      errMsg.toLowerCase().includes("nonce");
    if (isSoftError) {
      console.log(`[Bond] updatePerformanceScore skipped (soft) for ${opts.agentWallet}: ${errMsg.slice(0, 120)}`);
    } else {
      console.error(`[Bond] updatePerformanceScore failed for ${opts.agentWallet}:`, errMsg.slice(0, 200));
    }
    return null;
  }
}

export async function lockBondForGigOnChain(opts: {
  agentWallet: string;
  gigId: string;
  amount: number;
}): Promise<string | null> {
  if (!isWriteReady()) return null;
  if (!isAddress(opts.agentWallet) || /^0x0+$/.test(opts.agentWallet)) return null;
  if (opts.amount <= 0) return null;

  const gigIdBytes32 = gigIdToBytes32(opts.gigId);
  const amountRaw = parseUnits(opts.amount.toFixed(6), 6);

  try {
    const txHash = await withNonceLock((nonce) =>
      (bondContract as any).write.lockBondForGig(
        [gigIdBytes32, opts.agentWallet as Address, amountRaw],
        { gas: 150000n, nonce }
      )
    );
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`[Bond] lockBondForGig gig=${opts.gigId} agent=${opts.agentWallet} amount=${opts.amount} tx=${txHash}`);
    return txHash;
  } catch (err: any) {
    const errMsg = err.message || "";
    const isPermanent =
      errMsg.includes("InsufficientBond") ||
      errMsg.includes("GigAlreadyExists") ||
      errMsg.includes("ScoreTooLow") ||
      errMsg.includes("ZeroAmount");
    if (isPermanent) {
      console.warn(`[Bond] lockBondForGig permanent skip gig=${opts.gigId}: ${errMsg.slice(0, 120)}`);
      return "SKIPPED";
    }
    console.error(`[Bond] lockBondForGig failed for gig ${opts.gigId}:`, errMsg.slice(0, 200));
    return null;
  }
}

export async function slashBondOnChain(opts: {
  gigId: string;
}): Promise<string | null> {
  if (!isWriteReady()) return null;

  const gigIdBytes32 = gigIdToBytes32(opts.gigId);

  try {
    const txHash = await withNonceLock((nonce) =>
      (bondContract as any).write.adminFinalize(
        [gigIdBytes32, false],
        { gas: 150000n, nonce }
      )
    );
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`[Bond] slashBondOnChain gig=${opts.gigId} tx=${txHash}`);
    return txHash;
  } catch (err: any) {
    const errMsg = err.message || "";
    const isPermanent =
      errMsg.includes("GigNotFound") ||
      errMsg.includes("GigAlreadyFinalized") ||
      errMsg.includes("reverted");
    if (isPermanent) {
      console.warn(`[Bond] slashBondOnChain permanent skip gig=${opts.gigId}: ${errMsg.slice(0, 120)}`);
      return "SKIPPED";
    }
    console.error(`[Bond] slashBondOnChain failed for gig ${opts.gigId}:`, errMsg.slice(0, 200));
    return null;
  }
}

export async function readOnChainBond(agentWallet: string): Promise<{
  totalDeposited: number;
  available: number;
  locked: number;
} | null> {
  if (!isAddress(agentWallet) || /^0x0+$/.test(agentWallet)) return null;
  try {
    const result = await (bondContract as any).read.getBond([agentWallet as Address]);
    return {
      totalDeposited: Number(result[0]) / 1e6,
      available: Number(result[1]) / 1e6,
      locked: Number(result[2]) / 1e6,
    };
  } catch {
    return null;
  }
}

/**
 * Deposits USDC into the bond contract on behalf of an agent wallet.
 *
 * Uses `depositFor(agent, amount)` (onlyAuthorized) so that bonds[agentWallet]
 * is credited — enabling lockBondForGig/slash to operate against the correct
 * agent address. The deployer wallet must be an authorized caller
 * (call authorizeCaller(deployerAddress) on the contract) and hold enough USDC
 * to cover the deposit (pre-approve step runs first).
 *
 * Returns: txHash on success, "SKIPPED" on permanent failure (e.g. no USDC balance),
 *          null on transient failure (retry will be attempted from queue).
 */
export async function depositBondOnChain(opts: {
  agentId: string;
  agentWallet: string;
  amount: number;
}): Promise<string | null> {
  if (!isWriteReady()) return null;
  if (!isAddress(opts.agentWallet) || /^0x0+$/.test(opts.agentWallet)) return null;
  if (opts.amount <= 0) return null;

  const amountRaw = parseUnits(opts.amount.toFixed(6), 6);
  const bondContractAddress = CONTRACT_ADDRESSES.bond;

  try {
    const approveTx = await withNonceLock((nonce) =>
      walletClient!.writeContract({
        address: USDC_ADDRESS,
        abi: USDC_ABI,
        functionName: "approve",
        args: [bondContractAddress, amountRaw],
        nonce,
      })
    );
    await publicClient.waitForTransactionReceipt({ hash: approveTx });
    console.log(`[Bond] depositOnChain: approved ${opts.amount} USDC tx=${approveTx}`);

    const depositTx = await withNonceLock((nonce) =>
      (bondContract as any).write.depositFor(
        [opts.agentWallet as Address, amountRaw],
        { gas: 150000n, nonce }
      )
    );
    await publicClient.waitForTransactionReceipt({ hash: depositTx });
    console.log(`[Bond] depositOnChain: depositFor agent=${opts.agentWallet} amount=${opts.amount} tx=${depositTx}`);
    return depositTx;
  } catch (err: any) {
    const errMsg = err.message || "";
    const isPermanent =
      errMsg.includes("BelowMinDeposit") ||
      errMsg.includes("ERC20InsufficientBalance") ||
      errMsg.includes("ERC20: transfer amount exceeds balance") ||
      errMsg.includes("InvalidAddress") ||
      errMsg.includes("insufficient funds");
    if (isPermanent) {
      console.warn(`[Bond] depositOnChain permanent skip agentId=${opts.agentId}: ${errMsg.slice(0, 120)}`);
      return "SKIPPED";
    }
    console.error(`[Bond] depositOnChain failed for agentId=${opts.agentId}:`, errMsg.slice(0, 200));
    return null;
  }
}

// ─── FIX 11 — Retry queue ────────────────────────────────────────────

// In-memory blocklist of wallet addresses that have permanently failed SKALE sync
// (error 0xc8b22310 = agent not registered on SKALE RepAdapter).
// Persists for the lifetime of the process — survives queue cycles but resets on restart.
// On restart, agents will attempt once, fail permanently, and be re-added.
export const skaleNotAuthorizedWallets = new Set<string>();

export async function queueBlockchainAction(action: {
  type: "MINT_PASSPORT" | "SET_MOLT_DOMAIN" | "UPDATE_REPUTATION" | "CREATE_VALIDATION" | "LOCK_ESCROW" | "BOND_DEPOSIT" | "BOND_LOCK" | "BOND_SLASH" | "BOND_PERF_SCORE" | "SKALE_REP_SYNC";
  agentId?: string;
  gigId?: string;
  payload: Record<string, any>;
}): Promise<number | null> {
  try {
    // Deduplication: don't enqueue a second reputation update for the same agent
    // when one is already pending — this is the main driver of nonce storms.
    if (
      action.agentId &&
      (action.type === "UPDATE_REPUTATION" || action.type === "SKALE_REP_SYNC")
    ) {
      const alreadyQueued = await storage.hasPendingBlockchainActionForAgent(
        action.type,
        action.agentId,
      );
      if (alreadyQueued) {
        console.log(`[BlockchainQueue] Skipping duplicate ${action.type} for agent ${action.agentId} — already pending`);
        return null;
      }
    }

    const row = await storage.queueBlockchainAction({
      type: action.type,
      agentId: action.agentId || null,
      gigId: action.gigId || null,
      payload: action.payload,
      retries: 0,
      status: "pending",
    });
    console.log(`[BlockchainQueue] Queued ${action.type} id=${row.id}`);
    return row.id;
  } catch (err: any) {
    console.error("[BlockchainQueue] Failed to queue action:", err.message);
    return null;
  }
}

export async function markBlockchainActionComplete(actionId: number): Promise<void> {
  try {
    await storage.updateBlockchainAction(actionId, { status: "completed" });
  } catch (err: any) {
    console.warn(`[BlockchainQueue] Failed to mark action ${actionId} complete:`, err.message?.slice(0, 80));
  }
}

// Minimum time between retry attempts for the same action (2 minutes).
// Prevents hammering a failing tx on every 5-minute queue cycle.
const QUEUE_RETRY_BACKOFF_MS = 2 * 60 * 1000;

export async function processBlockchainQueue(): Promise<void> {
  try {
    // NOTE: Do NOT reset the nonce managers here. All on-chain writes (score
    // sync + queue) go through withNonceLock / withSkaleNonceLock which chain
    // sequentially on a single promise. Resetting mid-flight causes the queue
    // processor to fetch a stale "latest" nonce while the score-sync's pending
    // txs haven't yet confirmed — producing "nonce too low" collisions.
    // Resets happen automatically via NonceMgr.onError() on any nonce error.

    const pending = await storage.getPendingBlockchainActions(10);
    if (pending.length === 0) return;

    console.log(`[BlockchainQueue] Processing ${pending.length} pending actions`);

    for (const action of pending) {
      // Backoff: skip actions that were attempted very recently to avoid
      // resubmitting a tx that is still pending/confirming in the mempool.
      if (action.lastAttempt) {
        const msSinceLast = Date.now() - new Date(action.lastAttempt).getTime();
        if (msSinceLast < QUEUE_RETRY_BACKOFF_MS) {
          continue;
        }
      }

      try {
        let success = false;
        const payload = typeof action.payload === "string"
          ? JSON.parse(action.payload)
          : (action.payload || {});

        if (action.type === "MINT_PASSPORT" && action.agentId) {
          const agent = await storage.getAgent(action.agentId);
          if (agent) {
            if (agent.erc8004TokenId) {
              console.log(`[BlockchainQueue] Agent ${agent.handle} already has tokenId=${agent.erc8004TokenId}, skipping mint`);
              success = true;
            } else if (!agent.walletAddress || /^0x0+$/.test(agent.walletAddress)) {
              console.warn(`[BlockchainQueue] Agent ${agent.handle} has zero-address wallet, marking as failed`);
              await storage.updateBlockchainAction(action.id, { status: "failed", lastAttempt: new Date() });
              continue;
            } else {
              const result = await mintPassportForAgent({
                id: agent.id,
                handle: agent.handle,
                walletAddress: agent.walletAddress,
                skills: agent.skills,
              }, { fromQueue: true });
              success = !!result.tokenId;
            }
          } else {
            console.warn(`[BlockchainQueue] Agent ${action.agentId} not found, marking as failed`);
            await storage.updateBlockchainAction(action.id, { status: "failed", lastAttempt: new Date() });
            continue;
          }
        } else if (action.type === "SET_MOLT_DOMAIN") {
          const { tokenId: rawTokenId, moltDomain } = payload as any;
          const agent = action.agentId ? await storage.getAgent(action.agentId) : null;
          const resolvedTokenId = rawTokenId || agent?.erc8004TokenId || null;
          if (resolvedTokenId && moltDomain) {
            const tx = await setMoltDomainOnChain(resolvedTokenId, moltDomain);
            success = !!tx;
          }
        } else if (action.type === "UPDATE_REPUTATION") {
          const tx = await updateReputationOnChain(payload as any);
          success = !!tx;
        } else if (action.type === "CREATE_VALIDATION") {
          const tx = await createSwarmValidationOnChain({ ...(payload as any), chain: payload.chain });
          success = !!tx;
        } else if (action.type === "LOCK_ESCROW") {
          const tx = await lockEscrowOnChain(payload as any);
          success = !!tx;
        } else if (action.type === "BOND_DEPOSIT") {
          const tx = await depositBondOnChain(payload as any);
          const depositSucceeded = tx !== null && tx !== "SKIPPED";
          success = depositSucceeded || tx === "SKIPPED";
          if (depositSucceeded && payload.agentWallet) {
            const onChain = await readOnChainBond(payload.agentWallet as string).catch(() => null);
            if (onChain !== null && typeof payload.amount === "number") {
              const agentId = action.agentId || payload.agentId;
              const dbAgent = agentId ? await storage.getAgent(agentId) : null;
              if (dbAgent) {
                const diff = Math.abs(onChain.totalDeposited - dbAgent.totalBonded);
                if (diff > 1) {
                  console.warn(`[Bond] Queue RECONCILIATION MISMATCH agent=${agentId} dbTotal=${dbAgent.totalBonded} onChainTotal=${onChain.totalDeposited} diff=${diff.toFixed(2)}`);
                } else {
                  console.log(`[Bond] Queue Reconciliation OK agent=${agentId}: db=${dbAgent.totalBonded} onChain=${onChain.totalDeposited}`);
                }
              }
            }
          }
        } else if (action.type === "BOND_LOCK") {
          const tx = await lockBondForGigOnChain(payload as any);
          success = !!tx && tx !== null;
        } else if (action.type === "BOND_SLASH") {
          const tx = await slashBondOnChain(payload as any);
          success = !!tx && tx !== null;
        } else if (action.type === "BOND_PERF_SCORE") {
          await updatePerformanceScoreOnChain(payload as any);
          success = true; // on-chain score sync is best-effort; DB is authoritative
        } else if (action.type === "SKALE_REP_SYNC") {
          const result = await syncScoreToSkale({
            walletAddress: payload.walletAddress as string,
            fusedScore:       Number(payload.fusedScore       || 0),
            onChainScore:     Number(payload.onChainScore     || 0),
            moltbookScore:    Number(payload.moltbookScore    || 0),
            performanceScore: Number(payload.performanceScore || 0),
            bondScore:        Number(payload.bondScore        || 0),
          });
          success = !("error" in result);
          if (!success) {
            const errResult = result as { error: string; permanent?: boolean };
            if (errResult.permanent) {
              // Non-retryable: agent not registered on SKALE — mark failed immediately and add to blocklist
              skaleNotAuthorizedWallets.add((payload.walletAddress as string).toLowerCase());
              console.warn(`[BlockchainQueue] SKALE_REP_SYNC permanently skipped for ${payload.walletAddress}: not registered on SKALE`);
              await storage.updateBlockchainAction(action.id, { status: "failed", lastAttempt: new Date() });
              continue;
            }
            console.error(`[BlockchainQueue] SKALE_REP_SYNC failed for ${payload.walletAddress}:`, errResult.error);
          }
        }

        if (success) {
          await storage.updateBlockchainAction(action.id, { status: "completed" });
        } else {
          const newRetries = (action.retries || 0) + 1;
          const newStatus = newRetries >= 5 ? "failed" : "pending";
          await storage.updateBlockchainAction(action.id, {
            retries: newRetries,
            status: newStatus,
            lastAttempt: new Date(),
          });
          if (newStatus === "failed") {
            console.error(`[BlockchainQueue] Action ${action.id} (${action.type}) failed after 5 retries`);
          }
        }
      } catch (err: any) {
        const errMsg = err.message || "";
        const isPermFail =
          errMsg.includes("InvalidAddress") ||
          errMsg.includes("invalid address") ||
          errMsg.includes("InvalidTokenId") ||
          errMsg.includes("PassportNotFound") ||
          errMsg.includes("0x0000000000");
        const newRetries = (action.retries || 0) + 1;
        const newStatus = (isPermFail || newRetries >= 5) ? "failed" : "pending";
        console.error(`[BlockchainQueue] Error processing ${action.type} id=${action.id} (${newStatus}):`, errMsg.slice(0, 120));
        await storage.updateBlockchainAction(action.id, {
          retries: newRetries,
          status: newStatus,
          lastAttempt: new Date(),
        }).catch(() => {});
      }
    }
  } catch (err: any) {
    console.error("[BlockchainQueue] processBlockchainQueue error:", err.message);
  }
}

export async function cleanupStuckQueueEntries(): Promise<number> {
  try {
    const pending = await storage.getPendingBlockchainActions(100);
    let cleaned = 0;
    for (const action of pending) {
      if (action.type === "MINT_PASSPORT" && action.agentId) {
        const agent = await storage.getAgent(action.agentId);
        if (!agent) {
          await storage.updateBlockchainAction(action.id, { status: "failed" });
          cleaned++;
          continue;
        }
        if (agent.erc8004TokenId) {
          await storage.updateBlockchainAction(action.id, { status: "completed" });
          cleaned++;
          continue;
        }
        if (!agent.walletAddress || /^0x0+$/.test(agent.walletAddress)) {
          await storage.updateBlockchainAction(action.id, { status: "failed" });
          cleaned++;
          continue;
        }
      }
      if (action.type === "SET_MOLT_DOMAIN" && action.agentId) {
        const agent = await storage.getAgent(action.agentId);
        if (!agent) {
          await storage.updateBlockchainAction(action.id, { status: "failed" });
          cleaned++;
          continue;
        }
        if (!agent.erc8004TokenId) {
          console.log(`[BlockchainQueue] Skipping SET_MOLT_DOMAIN for ${agent.handle} — no erc8004TokenId`);
          await storage.updateBlockchainAction(action.id, { status: "failed" });
          cleaned++;
          continue;
        }
      }
      if ((action.retries || 0) >= 5) {
        await storage.updateBlockchainAction(action.id, { status: "failed" });
        cleaned++;
      }
    }
    if (cleaned > 0) {
      console.log(`[BlockchainQueue] Cleaned up ${cleaned} stuck queue entries`);
    }
    return cleaned;
  } catch (err: any) {
    console.error("[BlockchainQueue] Cleanup error:", err.message);
    return 0;
  }
}

// ─── USDC on Base Sepolia ─────────────────────────────────────────────────────

const USDC_ADDRESS = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as Address;

const USDC_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
]);

export async function transferUSDCOnChain(toAddress: string, amountUsdc: number): Promise<string> {
  if (!walletClient) throw new Error("No wallet client — DEPLOYER_PRIVATE_KEY not set");
  const amountWei = BigInt(Math.round(amountUsdc * 1_000_000));
  const hash = await withNonceLock((nonce) =>
    walletClient!.writeContract({
      address: USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: "transfer",
      args: [toAddress as Address, amountWei],
      nonce,
    })
  );
  return hash;
}

export async function getUSDCBalance(address: string): Promise<number> {
  try {
    const raw = await publicClient.readContract({
      address: USDC_ADDRESS,
      abi: USDC_ABI,
      functionName: "balanceOf",
      args: [address as Address],
    });
    return Number(raw) / 1_000_000;
  } catch {
    return 0;
  }
}

export const ORACLE_WALLET_ADDRESS = "0x66e5046D136E82d17cbeB2FfEa5bd5205D962906" as Address;
export const USDC_CONTRACT_ADDRESS = USDC_ADDRESS;

/** Returns oracle wallet ETH balance in ether (for gas). Logs a warning if below threshold. */
export async function getOracleEthBalance(): Promise<number> {
  try {
    const balanceWei = await publicClient.getBalance({ address: ORACLE_WALLET_ADDRESS });
    const eth = Number(balanceWei) / 1e18;
    return eth;
  } catch {
    return 0;
  }
}

/** Minimum ETH balance before we warn (0.005 ETH covers ~25 typical Base Sepolia txs at 0.0002 ETH each) */
export const ORACLE_ETH_WARN_THRESHOLD = 0.005;
export const ORACLE_ETH_CRITICAL_THRESHOLD = 0.001;
export const ORACLE_USDC_WARN_THRESHOLD = 5;

/**
 * Returns oracle wallet health snapshot used by /api/system/network and the escrow release pre-flight.
 * Caches result for 60 seconds to avoid hammering the RPC.
 */
let _oracleHealthCache: { ethBalance: number; usdcBalance: number; timestamp: number } | null = null;
export async function getOracleHealth(forceRefresh = false): Promise<{
  ethBalance: number;
  usdcBalance: number;
  ethOk: boolean;
  usdcOk: boolean;
  warnings: string[];
}> {
  const now = Date.now();
  if (!forceRefresh && _oracleHealthCache && now - _oracleHealthCache.timestamp < 60_000) {
    const { ethBalance, usdcBalance } = _oracleHealthCache;
    return buildOracleHealthResult(ethBalance, usdcBalance);
  }
  const [ethBalance, usdcBalance] = await Promise.all([
    getOracleEthBalance(),
    getUSDCBalance(ORACLE_WALLET_ADDRESS),
  ]);
  _oracleHealthCache = { ethBalance, usdcBalance, timestamp: now };
  return buildOracleHealthResult(ethBalance, usdcBalance);
}

function buildOracleHealthResult(ethBalance: number, usdcBalance: number) {
  const warnings: string[] = [];
  if (ethBalance < ORACLE_ETH_CRITICAL_THRESHOLD) {
    warnings.push(`CRITICAL: Oracle ETH balance critically low (${ethBalance.toFixed(5)} ETH) — on-chain txs will fail`);
  } else if (ethBalance < ORACLE_ETH_WARN_THRESHOLD) {
    warnings.push(`LOW: Oracle ETH balance low (${ethBalance.toFixed(5)} ETH) — refill soon`);
  }
  if (usdcBalance < ORACLE_USDC_WARN_THRESHOLD) {
    warnings.push(`LOW: Oracle USDC balance low (${usdcBalance.toFixed(2)} USDC) — refill for escrow releases`);
  }
  return {
    ethBalance,
    usdcBalance,
    ethOk: ethBalance >= ORACLE_ETH_WARN_THRESHOLD,
    usdcOk: usdcBalance >= ORACLE_USDC_WARN_THRESHOLD,
    warnings,
  };
}

export async function registerDomainOnChain(
  name: string,
  tld: string,
  ownerAddress: string,
  pricePaid: number = 0,
): Promise<{ tokenId: number; txHash: string }> {
  if (!isWriteReady()) throw new Error("Oracle wallet not configured");
  try {
    const hash = await (registryContract as any).write.register([
      name,
      tld,
      ownerAddress as Address,
      BigInt(Math.round(pricePaid * 1_000_000)),
    ]);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    const log = receipt.logs?.[0];
    let tokenId = 0;
    if (log) {
      try {
        const decoded = decodeEventLog({
          abi: ABIS.registry,
          eventName: "DomainRegistered",
          topics: log.topics as any,
          data: log.data,
        });
        tokenId = Number((decoded.args as any).tokenId);
      } catch {
        tokenId = 0;
      }
    }
    return { tokenId, txHash: hash as string };
  } catch (err: any) {
    throw new Error(`registerDomainOnChain failed: ${err.message?.slice(0, 200)}`);
  }
}

export async function expireValidationOnChain(gigId: string): Promise<string | null> {
  if (!isWriteReady()) return null;

  const gigIdBytes32 = ("0x" + Buffer.from(gigId.replace(/-/g, "")).toString("hex").padStart(64, "0")) as `0x${string}`;

  try {
    const txHash = await withNonceLock((nonce) =>
      (swarmValidator as any).write.expireValidation([gigIdBytes32], { nonce })
    );
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`[Sweep] expireValidation on-chain for gig ${gigId} tx=${txHash}`);
    return txHash;
  } catch (err: any) {
    const msg: string = err.message || "";
    if (msg.includes("ValidationAlreadyResolved") || msg.includes("NotExpired") || msg.includes("ValidationNotFound")) {
      console.log(`[Sweep] expireValidation skipped for gig ${gigId}: ${msg.slice(0, 120)}`);
    } else {
      console.error(`[Sweep] expireValidation failed for gig ${gigId}:`, msg.slice(0, 200));
    }
    return null;
  }
}

export async function isDomainAvailableOnChain(name: string, tld: string): Promise<boolean> {
  try {
    const available = await publicClient.readContract({
      address: CONTRACT_ADDRESSES.registry,
      abi: ABIS.registry,
      functionName: "isAvailable",
      args: [name, tld],
    });
    return Boolean(available);
  } catch {
    return true;
  }
}

// ─── Crew on-chain registration (formCrewFor — authorized oracle call) ─────────
/**
 * Registers a crew on both Base Sepolia and SKALE by calling formCrewFor()
 * on the updated ClawTrustCrew v2 contract (oracle-authorized).
 * Returns the on-chain crewId bytes32 hash decoded from the CrewFormed event.
 * Non-blocking: errors are caught and logged; crew creation in DB is not blocked.
 */
export async function registerCrewOnChain(crew: {
  name: string;
  ownerWallet: string;
  memberCount: number;
}): Promise<{
  base: { crewId: string; txHash: string } | null;
  skale: { crewId: string; txHash: string } | null;
}> {
  const leadAddr = (isAddress(crew.ownerWallet) ? crew.ownerWallet : null) as Address | null;

  async function callOnBase() {
    if (!isWriteReady()) return null;
    if (!leadAddr) return null;
    try {
      const txHash = await withNonceLock((nonce) =>
        (crewContract as any).write.formCrewFor(
          [leadAddr, crew.name, BigInt(crew.memberCount || 1)],
          { nonce }
        )
      );
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
      const crewFormedTopic = keccak256(toHex("CrewFormed(bytes32,address,string,uint256)"));
      let crewId: string | null = null;
      for (const log of receipt.logs) {
        if (log.topics[0]?.toLowerCase() === crewFormedTopic.toLowerCase()) {
          crewId = log.topics[1] as string;
          break;
        }
      }
      if (!crewId) {
        console.warn(`[Crew] formCrewFor Base Sepolia: CrewFormed event not found in tx ${txHash} — crewId not stored`);
        return null;
      }
      console.log(`[Crew] formCrewFor on Base Sepolia: crewId=${crewId} tx=${txHash}`);
      return { crewId, txHash };
    } catch (err: any) {
      console.error("[Crew] formCrewFor Base Sepolia failed:", err.message?.slice(0, 200));
      return null;
    }
  }

  async function callOnSkale() {
    if (!isSkaleWriteReady()) return null;
    if (!leadAddr) return null;
    try {
      const txHash = await withSkaleNonceLock((nonce) =>
        (skaleCrewContract as any).write.formCrewFor(
          [leadAddr, crew.name, BigInt(crew.memberCount || 1)],
          { nonce }
        )
      );
      const receipt = await skaleSwarmPublicClient.waitForTransactionReceipt({ hash: txHash });
      const crewFormedTopic = keccak256(toHex("CrewFormed(bytes32,address,string,uint256)"));
      let crewId: string | null = null;
      for (const log of receipt.logs) {
        if (log.topics[0]?.toLowerCase() === crewFormedTopic.toLowerCase()) {
          crewId = log.topics[1] as string;
          break;
        }
      }
      if (!crewId) {
        console.warn(`[Crew] formCrewFor SKALE: CrewFormed event not found in tx ${txHash} — crewId not stored`);
        return null;
      }
      console.log(`[Crew] formCrewFor on SKALE: crewId=${crewId} tx=${txHash}`);
      return { crewId, txHash };
    } catch (err: any) {
      console.error("[Crew] formCrewFor SKALE failed:", err.message?.slice(0, 200));
      return null;
    }
  }

  const [base, skale] = await Promise.allSettled([callOnBase(), callOnSkale()]);
  return {
    base:  base.status  === "fulfilled" ? base.value  : null,
    skale: skale.status === "fulfilled" ? skale.value : null,
  };
}

/**
 * Records a gig completion for a crew on both Base Sepolia and SKALE.
 * Only works if the crew was previously registered on-chain via formCrewFor.
 * Non-blocking: errors are caught and logged.
 */
export async function recordCrewGigCompletion(opts: {
  onChainCrewId: string | null;
  onChainCrewIdSkale: string | null;
  crewDbId: string;
}): Promise<void> {
  async function callOnBase() {
    if (!opts.onChainCrewId || !isWriteReady()) return;
    try {
      const crewId = opts.onChainCrewId as `0x${string}`;
      const txHash = await withNonceLock((nonce) =>
        (crewContract as any).write.recordGigCompletion([crewId], { nonce })
      );
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      console.log(`[Crew] recordGigCompletion Base Sepolia crewDbId=${opts.crewDbId} tx=${txHash}`);
    } catch (err: any) {
      console.error("[Crew] recordGigCompletion Base Sepolia failed:", err.message?.slice(0, 200));
    }
  }

  async function callOnSkale() {
    if (!opts.onChainCrewIdSkale || !isSkaleWriteReady()) return;
    try {
      const crewId = opts.onChainCrewIdSkale as `0x${string}`;
      const txHash = await withSkaleNonceLock((nonce) =>
        (skaleCrewContract as any).write.recordGigCompletion([crewId], { nonce })
      );
      await skaleSwarmPublicClient.waitForTransactionReceipt({ hash: txHash });
      console.log(`[Crew] recordGigCompletion SKALE crewDbId=${opts.crewDbId} tx=${txHash}`);
    } catch (err: any) {
      console.error("[Crew] recordGigCompletion SKALE failed:", err.message?.slice(0, 200));
    }
  }

  await Promise.allSettled([callOnBase(), callOnSkale()]);
}
