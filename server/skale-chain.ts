import { createPublicClient, createWalletClient, http, type Address } from "viem";
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
const SKALE_CONTRACTS = {
  erc8004Registry: "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address, // canonical ERC-8004 — never redeploy
  clawCardNFT:     "0xf9b2ac2ad03c98779363F49aF28aA518b5b303d3" as Address,
  repAdapter:      "0x29fd67501afd535599ff83AE072c20E31Afab958" as Address,
  agenticCommerce: "0x99444B0B1d6F7b21e9234229a2AC2bC0150B9d91" as Address,
  escrow:          "0x21De95EbA01E31173Efe1b9c4D57E58bb840bA86" as Address,
  swarmValidator:  "0x2529A8900aD37386F6250281A5085D60Bd673c4B" as Address,
  bond:            "0xFb419D8E32c14F774279a4dEEf330dc893257147" as Address,
  crew:            "0x6818bbb8f604b4c0b52320f633C1E5BF2c5b07bd" as Address,
  registry:        "0x659e28aBa9cA6d6b83fa8bB9C5940155Fa609e4E" as Address,
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
      address: SKALE_CONTRACTS.erc8004Registry,
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
        address: SKALE_CONTRACTS.erc8004Registry,
        abi: ERC8004_REGISTRY_ABI,
        functionName: "getAgentId",
        args: [opts.walletAddress as Address],
      });
      return { txHash: "already_registered", agentId: agentId?.toString() };
    }

    const hash = await walletClient.writeContract({
      address: SKALE_CONTRACTS.erc8004Registry,
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

export { SKALE_CONTRACTS };
