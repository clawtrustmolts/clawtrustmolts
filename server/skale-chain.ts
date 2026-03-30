import { createPublicClient, createWalletClient, http, type Address, parseAbiItem } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const SKALE_TESTNET_RPC = "https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha";

const skaleTestnet = {
  id: 324705682,
  name: "SKALE Base Sepolia",
  nativeCurrency: { name: "sFUEL", symbol: "sFUEL", decimals: 18 },
  rpcUrls: {
    default: { http: [SKALE_TESTNET_RPC] },
    public: { http: [SKALE_TESTNET_RPC] },
  },
} as const;

// Deployed to SKALE Base Sepolia (324705682) — 2026-03-18 via scripts/deploy-skale-base.mjs
// x402Facilitator deployed as address(0) then set via setX402Facilitator (secure-by-default)
const SKALE_CONTRACTS = {
  // Canonical ERC-8004 contracts — SKALE Base Sepolia testnet
  // Source: erc-8004-contracts PR #56 (TheGreatAxios / Sawyer Cutler, 2026-02-24) — never redeploy
  erc8004IdentityRegistry:    "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address,
  erc8004ReputationRegistry:  "0x8004B663056A597Dffe9eCcC1965A193B7388713" as Address,
  // Canonical ERC-8004 contracts — SKALE Base Mainnet (activate when graduating from testnet)
  // erc8004IdentityRegistryMainnet:   "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"
  // erc8004ReputationRegistryMainnet: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63"
  clawCardNFT:     "0xdB7F6cCf57D6c6AA90ccCC1a510589513f28cb83" as Address,
  repAdapter:      "0xFafCA23a7c085A842E827f53A853141C8243F924" as Address,
  agenticCommerce: "0x101F37D9bf445E92A237F8721CA7D12205D61Fe6" as Address,
  escrow:          "0x39601883CD9A115Aba0228fe0620f468Dc710d54" as Address,
  swarmValidator:  "0x7693a841Eec79Da879241BC0eCcc80710F39f399" as Address,
  bond:            "0x5bC40A7a47A2b767D948FEEc475b24c027B43867" as Address,
  crew:            "0x00d02550f2a8Fd2CeCa0d6b7882f05Beead1E5d0" as Address,
  registry:        "0xecc00bbE268Fa4D0330180e0fB445f64d824d818" as Address,
};

// ABI matches ClawTrustRepAdapter v1.14.0 deployed on SKALE Base Sepolia (324705682)
const REP_ADAPTER_ABI = [
  {
    name: "submitFusedFeedback",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentAddress",    type: "address" },
      { name: "onChainScore",    type: "uint256" },
      { name: "moltbookKarma",  type: "uint256" },
      { name: "performanceScore",type: "uint256" },
      { name: "bondScore",       type: "uint256" },
      { name: "tags",            type: "string[]" },
      { name: "proofUri",        type: "string" },
    ],
    outputs: [],
  },
  {
    name: "updateFusedScore",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agent",           type: "address" },
      { name: "onChainScore",    type: "uint256" },
      { name: "moltbookKarma",  type: "uint256" },
      { name: "performanceScore",type: "uint256" },
      { name: "bondScore",       type: "uint256" },
      { name: "proofUri",        type: "string" },
    ],
    outputs: [],
  },
  {
    // Returns: [onChainScore, moltbookKarma, performanceScore, bondScore, fusedScore, timestamp, proofHash]
    name: "fusedScores",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [
      { name: "onChainScore",    type: "uint256" },
      { name: "moltbookKarma",  type: "uint256" },
      { name: "performanceScore",type: "uint256" },
      { name: "bondScore",       type: "uint256" },
      { name: "fusedScore",      type: "uint256" },
      { name: "timestamp",       type: "uint256" },
      { name: "proofHash",       type: "bytes32" },
    ],
  },
  {
    name: "getScore",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ name: "", type: "int256" }],
  },
] as const;

const ERC8004_REGISTRY_ABI = [
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    name: "getAgentId",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    name: "isRegistered",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export const skalePublicClient = createPublicClient({
  chain: skaleTestnet as any,
  transport: http(SKALE_TESTNET_RPC, { timeout: 15_000, retryCount: 2, retryDelay: 1500 }),
});

export async function readSkaleFusedScore(
  walletAddress: string
): Promise<{ score: number; onChainScore: number; moltbookKarma: number; performanceScore: number; bondScore: number; updatedAt: number } | null> {
  try {
    const data = (await skalePublicClient.readContract({
      address: SKALE_CONTRACTS.repAdapter,
      abi: REP_ADAPTER_ABI,
      functionName: "fusedScores",
      args: [walletAddress as Address],
    })) as any;

    // Output: [onChainScore, moltbookKarma, performanceScore, bondScore, fusedScore, timestamp, proofHash]
    const raw = Array.isArray(data) ? data : Object.values(data);
    const onChainScore    = Number(raw[0]);
    const moltbookKarma  = Number(raw[1]);
    const performanceScore= Number(raw[2]);
    const bondScore       = Number(raw[3]);
    const fusedRaw        = Number(raw[4]);
    const updatedAt       = Number(raw[5] ?? 0);

    if (fusedRaw === 0 && updatedAt === 0 && onChainScore === 0) return null;
    // fusedScore is stored 0-100 by the SKALE RepAdapter (same scale as inputs)
    return { score: fusedRaw, onChainScore, moltbookKarma, performanceScore, bondScore, updatedAt };
  } catch {
    return null;
  }
}

export async function readSkaleIsRegistered(walletAddress: string): Promise<boolean> {
  try {
    const result = await skalePublicClient.readContract({
      address: SKALE_CONTRACTS.erc8004IdentityRegistry,
      abi: ERC8004_REGISTRY_ABI,
      functionName: "isRegistered",
      args: [walletAddress as Address],
    });
    return Boolean(result);
  } catch {
    return false;
  }
}

export async function syncScoreToSkale(opts: {
  walletAddress: string;
  fusedScore: number;
  onChainScore: number;
  moltbookScore: number;
  performanceScore: number;
  bondScore: number;
}): Promise<{ txHash: string } | { error: string }> {
  const privKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privKey) return { error: "Deployer key not configured" };

  try {
    const account = privateKeyToAccount(
      (privKey.startsWith("0x") ? privKey : `0x${privKey}`) as `0x${string}`
    );

    const walletClient = createWalletClient({
      account,
      chain: skaleTestnet as any,
      transport: http(SKALE_TESTNET_RPC, { timeout: 30_000, retryCount: 2, retryDelay: 2000 }),
    });

    const onChain     = BigInt(Math.round(opts.onChainScore));
    const moltbook    = BigInt(Math.round(opts.moltbookScore));
    const performance = BigInt(Math.round(opts.performanceScore));
    const bond        = BigInt(Math.round(opts.bondScore));
    const proofUri = `ipfs://clawtrust/reputation/${opts.walletAddress}`;

    // Try updateFusedScore first (6-arg, oracle role) — falls back to submitFusedFeedback (7-arg, submitter role)
    let hash: string;
    try {
      hash = await walletClient.writeContract({
        address: SKALE_CONTRACTS.repAdapter,
        abi: REP_ADAPTER_ABI,
        functionName: "updateFusedScore",
        args: [opts.walletAddress as Address, onChain, moltbook, performance, bond, proofUri],
      });
      console.log(`[SKALE] updateFusedScore for ${opts.walletAddress}: fused=${opts.fusedScore} tx=${hash}`);
    } catch (primaryErr: any) {
      const primaryMsg = primaryErr?.shortMessage || primaryErr?.message || "";
      console.warn(`[SKALE] updateFusedScore failed (${primaryMsg.substring(0, 80)}), trying submitFusedFeedback...`);
      hash = await walletClient.writeContract({
        address: SKALE_CONTRACTS.repAdapter,
        abi: REP_ADAPTER_ABI,
        functionName: "submitFusedFeedback",
        args: [opts.walletAddress as Address, onChain, moltbook, performance, bond, [], proofUri],
      });
      console.log(`[SKALE] submitFusedFeedback for ${opts.walletAddress}: fused=${opts.fusedScore} tx=${hash}`);
    }

    return { txHash: hash };
  } catch (err: any) {
    const msg = err?.shortMessage || err?.message || "Sync failed";
    console.error(`[SKALE] syncScoreToSkale error for ${opts.walletAddress}:`, msg);
    return { error: msg };
  }
}

export async function registerAgentOnSkale(opts: {
  walletAddress: string;
  agentURI: string;
}): Promise<{ txHash: string; agentId?: string } | { error: string }> {
  const privKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privKey) return { error: "Deployer key not configured" };

  try {
    const account = privateKeyToAccount(
      (privKey.startsWith("0x") ? privKey : `0x${privKey}`) as `0x${string}`
    );

    const walletClient = createWalletClient({
      account,
      chain: skaleTestnet as any,
      transport: http(SKALE_TESTNET_RPC, { timeout: 30_000, retryCount: 2, retryDelay: 2000 }),
    });

    const isAlreadyRegistered = await readSkaleIsRegistered(opts.walletAddress);
    if (isAlreadyRegistered) {
      const agentId = await skalePublicClient.readContract({
        address: SKALE_CONTRACTS.erc8004IdentityRegistry,
        abi: ERC8004_REGISTRY_ABI,
        functionName: "getAgentId",
        args: [opts.walletAddress as Address],
      });
      return { txHash: "already_registered", agentId: agentId?.toString() };
    }

    const hash = await walletClient.writeContract({
      address: SKALE_CONTRACTS.erc8004IdentityRegistry,
      abi: ERC8004_REGISTRY_ABI,
      functionName: "register",
      args: [opts.agentURI],
    });

    console.log(`[SKALE] Registered agent ${opts.walletAddress} on SKALE: tx=${hash}`);
    return { txHash: hash };
  } catch (err: any) {
    const msg = err?.shortMessage || err?.message || "SKALE registration failed";
    console.error(`[SKALE] registerAgentOnSkale error:`, msg);
    return { error: msg };
  }
}

// ─── On-chain grant metrics reads ────────────────────────────────────────────

const CLAW_CARD_NFT_ABI = [
  {
    name: "totalSupply",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

/**
 * Read the total number of ClawCardNFT tokens minted on SKALE via totalSupply().
 * Returns null on RPC failure so the caller can fall back to DB count.
 */
export async function readSkalePassportTotalSupply(): Promise<number | null> {
  try {
    const supply = await skalePublicClient.readContract({
      address: SKALE_CONTRACTS.clawCardNFT,
      abi: CLAW_CARD_NFT_ABI,
      functionName: "totalSupply",
    });
    return Number(supply);
  } catch {
    return null;
  }
}

/**
 * Read completed-gig stats from on-chain FundsReleased events on the SKALE ClawTrustEscrow contract.
 * FundsReleased fires only when a gig is fully completed and payment released to the worker.
 * Returns { count, usdcVolume } — count = completed gigs, usdcVolume = USDC paid out (6-decimal).
 * Returns null on RPC timeout/failure so callers fall back to DB values.
 */
export async function readSkaleEscrowStats(): Promise<{ count: number; usdcVolume: number } | null> {
  try {
    const logs = await Promise.race([
      skalePublicClient.getLogs({
        address: SKALE_CONTRACTS.escrow,
        event: parseAbiItem(
          "event FundsReleased(bytes32 indexed gigId, address indexed payee, uint256 amount)"
        ),
        fromBlock: 0n,
        toBlock: "latest",
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("getLogs timeout")), 8000)
      ),
    ]);
    const usdcVolume = logs.reduce((sum, log) => {
      const amount = (log.args as { amount?: bigint }).amount ?? 0n;
      return sum + Number(amount) / 1e6;
    }, 0);
    return { count: logs.length, usdcVolume };
  } catch {
    return null;
  }
}

/**
 * Read the count of finalized swarm validations on the SKALE ClawTrustSwarmValidator contract.
 * Counts ValidationResolved events (or falls back to null on failure/timeout).
 */
export async function readSkaleSwarmValidationCount(): Promise<number | null> {
  try {
    const logs = await Promise.race([
      skalePublicClient.getLogs({
        address: SKALE_CONTRACTS.swarmValidator,
        event: parseAbiItem(
          "event ValidationResolved(bytes32 indexed gigId, bool approved, uint256 votesFor, uint256 votesAgainst)"
        ),
        fromBlock: 0n,
        toBlock: "latest",
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("getLogs timeout")), 8000)
      ),
    ]);
    return logs.filter(l => (l.args as { approved?: boolean }).approved === true).length;
  } catch {
    return null;
  }
}

export { SKALE_CONTRACTS };
