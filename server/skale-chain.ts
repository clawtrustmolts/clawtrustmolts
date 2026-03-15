import { createPublicClient, createWalletClient, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import path from "path";
import fs from "fs";

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
  repAdapter: "0x9975Abb15e5ED03767bfaaCB38c2cC87123a5BdA" as Address,
};

function loadSkaleAbi(contractName: string): any[] {
  try {
    const base = path.resolve("contracts/artifacts/contracts");
    const dirs = fs.readdirSync(base);
    for (const dir of dirs) {
      const candidate = path.join(base, dir, `${contractName}.sol`, `${contractName}.json`);
      if (fs.existsSync(candidate)) {
        return JSON.parse(fs.readFileSync(candidate, "utf-8")).abi;
      }
    }
  } catch {
  }
  return [];
}

const repAdapterAbi = loadSkaleAbi("ClawTrustRepAdapter");

export const skalePublicClient = createPublicClient({
  chain: skaleTestnet as any,
  transport: http(SKALE_TESTNET_RPC),
});

export async function readSkaleFusedScore(
  walletAddress: string
): Promise<{ score: number; updatedAt: number } | null> {
  try {
    if (!repAdapterAbi.length) return null;
    const data = (await skalePublicClient.readContract({
      address: SKALE_CONTRACTS.repAdapter,
      abi: repAdapterAbi,
      functionName: "fusedScores",
      args: [walletAddress as Address],
    })) as any;

    const raw = Array.isArray(data) ? data : Object.values(data);
    const score = Number(raw[0]) / 100;
    const updatedAt = Number(raw[6] ?? raw[1] ?? 0);
    if (score === 0 && updatedAt === 0) return null;
    return { score, updatedAt };
  } catch {
    return null;
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
    if (!repAdapterAbi.length) return { error: "RepAdapter ABI not found" };

    const account = privateKeyToAccount(
      (privKey.startsWith("0x") ? privKey : `0x${privKey}`) as `0x${string}`
    );

    const walletClient = createWalletClient({
      account,
      chain: skaleTestnet as any,
      transport: http(SKALE_TESTNET_RPC),
    });

    const score = BigInt(Math.round(opts.fusedScore * 100));
    const onChain = BigInt(Math.round(opts.onChainScore * 100));
    const moltbook = BigInt(Math.round(opts.moltbookScore * 100));
    const performance = BigInt(Math.round(opts.performanceScore * 100));
    const bond = BigInt(Math.round(opts.bondScore * 100));

    const hash = await walletClient.writeContract({
      address: SKALE_CONTRACTS.repAdapter,
      abi: repAdapterAbi,
      functionName: "submitFusedFeedback",
      args: [opts.walletAddress as Address, score, onChain, moltbook, performance, bond],
    });

    return { txHash: hash };
  } catch (err: any) {
    return { error: err?.message || "Sync failed" };
  }
}
