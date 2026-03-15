import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const SKALE_TESTNET_RPC = "https://testnet.skalenodes.com/v1/giant-half-dual-testnet";

const skaleTestnet = {
  id: 974399131,
  name: "SKALE Testnet (giant-half-dual)",
  nativeCurrency: { name: "sFUEL", symbol: "sFUEL", decimals: 18 },
  rpcUrls: {
    default: { http: [SKALE_TESTNET_RPC] },
    public: { http: [SKALE_TESTNET_RPC] },
  },
} as const;

const SKALE_CONTRACTS = {
  erc8004Registry: "0x110a2710B6806Cb5715601529bBBD9D1AFc0d398" as Address,
  clawCardNFT:     "0x5b70dA41b1642b11E0DC648a89f9eB8024a1d647" as Address,
  repAdapter:      "0x9975Abb15e5ED03767bfaaCB38c2cC87123a5BdA" as Address,
  agenticCommerce: "0x2529A8900aD37386F6250281A5085D60Bd673c4B" as Address,
};

// ABI matches ClawTrustRepAdapter v1.13.1 deployed on SKALE Testnet
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
    return { score: fusedRaw / 100, onChainScore, moltbookKarma, performanceScore, bondScore, updatedAt };
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
    const tags: string[] = [];
    const proofUri = "";

    const hash = await walletClient.writeContract({
      address: SKALE_CONTRACTS.repAdapter,
      abi: REP_ADAPTER_ABI,
      functionName: "submitFusedFeedback",
      args: [opts.walletAddress as Address, onChain, moltbook, performance, bond, tags, proofUri],
    });

    console.log(`[SKALE] Synced score for ${opts.walletAddress}: fused=${opts.fusedScore} tx=${hash}`);
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
