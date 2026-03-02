/**
 * blockchain.ts — viem contract clients for all 6 deployed ClawTrust contracts.
 * Loaded once at startup; all on-chain calls go through here.
 */

import { createPublicClient, createWalletClient, http, getContract, parseUnits, type Address, keccak256, toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync } from "fs";
import { join } from "path";
import { storage } from "./storage";

// ─── Config ──────────────────────────────────────────────────────────

const RPC_URL = process.env.BASE_RPC_URL || "https://sepolia.base.org";

// ─── Fresh redeploy 2026-02-28 — all contracts verified and configured ────
const CONTRACT_ADDRESSES = {
  clawCardNFT:             (process.env.CLAW_CARD_NFT_ADDRESS             || "0xf24e41980ed48576Eb379D2116C1AaD075B342C4") as Address,
  escrow:                  (process.env.CLAW_TRUST_ESCROW_ADDRESS         || "0x4300AbD703dae7641ec096d8ac03684fB4103CDe") as Address,
  swarmValidator:          (process.env.CLAW_TRUST_SWARM_VALIDATOR_ADDRESS|| "0x101F37D9bf445E92A237F8721CA7D12205D61Fe6") as Address,
  repAdapter:              (process.env.CLAW_TRUST_REP_ADAPTER_ADDRESS    || "0xecc00bbE268Fa4D0330180e0fB445f64d824d818") as Address,
  bond:                    (process.env.CLAW_TRUST_BOND_ADDRESS           || "0x23a1E1e958C932639906d0650A13283f6E60132c") as Address,
  crew:                    (process.env.CLAW_TRUST_CREW_ADDRESS           || "0xFF9B75BD080F6D2FAe7Ffa500451716b78fde5F3") as Address,
};

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

export const clawCardNFT    = makeContract("clawCardNFT",    "clawCardNFT");
export const escrowContract = makeContract("escrow",         "escrow");
export const swarmValidator = makeContract("swarmValidator", "swarmValidator");
export const repAdapter     = makeContract("repAdapter",     "repAdapter");
export const bondContract   = makeContract("bond",           "bond");
export const crewContract   = makeContract("crew",           "crew");

// ─── Utility ─────────────────────────────────────────────────────────

function isWriteReady(): boolean {
  if (!walletClient) {
    console.warn("[blockchain] walletClient not available — skipping on-chain write");
    return false;
  }
  return true;
}

// ─── FIX 4 — Mint passport on agent registration ─────────────────────

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
    const txHash = await (clawCardNFT as any).write.adminMintFull([
      agent.walletAddress as Address,
      agent.handle,
      metadataUri,
      agent.skills,
    ]);

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
      });
      console.log(`[Passport] Minted tokenId=${tokenId} for ${agent.walletAddress} tx=${txHash}`);
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
    const txHash = await (clawCardNFT as any).write.setMoltDomain([
      BigInt(tokenId),
      moltDomain,
    ]);
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
  const rawOnChain    = Math.min(Math.round(opts.onChainScore), 1000);
  const rawMoltbook   = Math.min(Math.round(opts.moltbookKarma), 10000);
  const rawPerf       = Math.min(Math.round(opts.performanceScore), 100);
  const rawBond       = Math.min(Math.round(opts.bondScore), 100);
  const proofHash     = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;

  try {
    const txHash = await (repAdapter as any).write.updateFusedScore([
      opts.agentWallet as Address,
      BigInt(rawOnChain),
      BigInt(rawMoltbook),
      BigInt(rawPerf),
      BigInt(rawBond),
      proofHash,
    ]);
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`[Reputation] On-chain updated for ${opts.agentWallet} tx=${txHash}`);
    return txHash;
  } catch (err: any) {
    const errMsg = err.message || "";
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
    const txHash = await (escrowContract as any).write.lockUSDC([
      gigIdBytes32,
      opts.payeeWallet as Address,
      amountRaw,
    ]);
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
}): Promise<string | null> {
  if (!isWriteReady()) return null;

  const gigIdBytes32 = ("0x" + Buffer.from(opts.gigId.replace(/-/g, "")).toString("hex").padStart(64, "0")) as `0x${string}`;
  const usdcAddress  = (process.env.USDC_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e") as Address;

  try {
    const txHash = await (swarmValidator as any).write.createValidation([
      gigIdBytes32,
      opts.posterWallet  as Address,
      opts.assigneeWallet as Address,
      opts.candidateWallets as Address[],
      BigInt(opts.threshold),
      BigInt(0),
      usdcAddress,
    ]);
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`[Swarm] Validation created on-chain for gig ${opts.gigId} tx=${txHash}`);
    return txHash;
  } catch (err: any) {
    console.error(`[Swarm] createValidation failed for gig ${opts.gigId}:`, err.message?.slice(0, 200));
    return null;
  }
}

// ─── FIX 8b — Cast vote on swarm validator ───────────────────────────

export async function castSwarmVoteOnChain(opts: {
  gigId: string;
  approve: boolean;
}): Promise<string | null> {
  if (!isWriteReady()) return null;

  const gigIdBytes32 = ("0x" + Buffer.from(opts.gigId.replace(/-/g, "")).toString("hex").padStart(64, "0")) as `0x${string}`;
  const voteType = opts.approve ? 1 : 2; // VoteType.Approve=1, Reject=2 (None=0)

  try {
    const txHash = await (swarmValidator as any).write.vote([
      gigIdBytes32,
      voteType,
    ]);
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`[Swarm] Vote ${opts.approve ? "Approve" : "Reject"} for gig ${opts.gigId} tx=${txHash}`);
    return txHash;
  } catch (err: any) {
    console.error(`[Swarm] vote failed for gig ${opts.gigId}:`, err.message?.slice(0, 200));
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

// ─── FIX 11 — Retry queue ────────────────────────────────────────────

export async function queueBlockchainAction(action: {
  type: "MINT_PASSPORT" | "SET_MOLT_DOMAIN" | "UPDATE_REPUTATION" | "CREATE_VALIDATION" | "LOCK_ESCROW";
  agentId?: string;
  gigId?: string;
  payload: Record<string, any>;
}): Promise<void> {
  try {
    await storage.queueBlockchainAction({
      type: action.type,
      agentId: action.agentId || null,
      gigId: action.gigId || null,
      payload: action.payload,
      retries: 0,
      status: "pending",
    });
    console.log(`[BlockchainQueue] Queued ${action.type} for retry`);
  } catch (err: any) {
    console.error("[BlockchainQueue] Failed to queue action:", err.message);
  }
}

export async function processBlockchainQueue(): Promise<void> {
  try {
    const pending = await storage.getPendingBlockchainActions(10);
    if (pending.length === 0) return;

    console.log(`[BlockchainQueue] Processing ${pending.length} pending actions`);

    for (const action of pending) {
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
          const resolvedTokenId = rawTokenId || (action.agentId
            ? (await storage.getAgent(action.agentId))?.erc8004TokenId
            : null);
          if (resolvedTokenId && moltDomain) {
            const tx = await setMoltDomainOnChain(resolvedTokenId, moltDomain);
            success = !!tx;
          }
        } else if (action.type === "UPDATE_REPUTATION") {
          const tx = await updateReputationOnChain(payload as any);
          success = !!tx;
        } else if (action.type === "CREATE_VALIDATION") {
          const tx = await createSwarmValidationOnChain(payload as any);
          success = !!tx;
        } else if (action.type === "LOCK_ESCROW") {
          const tx = await lockEscrowOnChain(payload as any);
          success = !!tx;
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
