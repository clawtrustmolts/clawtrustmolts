import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";
import crypto from "crypto";
import fs from "fs";
import path from "path";

const CIRCLE_API_KEY = process.env.CIRCLE_API_KEY || "";

const CHAIN_MAP: Record<string, string> = {
  BASE_SEPOLIA: "ETH-SEPOLIA",
  SOL_DEVNET: "SOL-DEVNET",
};

let circleClient: ReturnType<typeof initiateDeveloperControlledWalletsClient> | null = null;
let walletSetId: string | null = null;
let usdcTokenCache: Record<string, string> = {};

const ENTITY_SECRET_PATH = path.join(process.cwd(), ".circle-entity-secret");

function getEntitySecret(): string {
  if (process.env.CIRCLE_ENTITY_SECRET) {
    return process.env.CIRCLE_ENTITY_SECRET;
  }

  try {
    if (fs.existsSync(ENTITY_SECRET_PATH)) {
      const secret = fs.readFileSync(ENTITY_SECRET_PATH, "utf-8").trim();
      if (secret.length === 64) {
        process.env.CIRCLE_ENTITY_SECRET = secret;
        console.log("[Circle] Loaded persisted entity secret");
        return secret;
      }
    }
  } catch {}

  const secret = crypto.randomBytes(32).toString("hex");
  try {
    fs.writeFileSync(ENTITY_SECRET_PATH, secret, { mode: 0o600 });
    console.log("[Circle] Generated and persisted new entity secret");
  } catch {
    console.warn("[Circle] Could not persist entity secret to disk");
  }
  process.env.CIRCLE_ENTITY_SECRET = secret;
  return secret;
}

async function getClient() {
  if (!CIRCLE_API_KEY) {
    throw new Error("CIRCLE_API_KEY is not configured");
  }

  if (circleClient) return circleClient;

  circleClient = initiateDeveloperControlledWalletsClient({
    apiKey: CIRCLE_API_KEY,
    entitySecret: getEntitySecret(),
  });

  return circleClient;
}

async function ensureWalletSet(): Promise<string> {
  if (walletSetId) return walletSetId;

  const client = await getClient();

  try {
    const response = await client.listWalletSets({});
    const sets = response.data?.walletSets;
    if (sets && sets.length > 0) {
      const clawSet = sets.find((s: any) => s.name === "ClawTrust Escrow");
      if (clawSet) {
        walletSetId = clawSet.id!;
        console.log("[Circle] Using existing wallet set:", walletSetId);
        return walletSetId;
      }
    }
  } catch (err: any) {
    console.log("[Circle] Could not list wallet sets:", err.message);
  }

  try {
    const response = await client.createWalletSet({
      name: "ClawTrust Escrow",
    });
    walletSetId = response.data?.walletSet?.id!;
    console.log("[Circle] Created wallet set:", walletSetId);
    return walletSetId;
  } catch (err: any) {
    console.error("[Circle] Failed to create wallet set:", err.message);
    throw new Error(`Failed to create Circle wallet set: ${err.message}`);
  }
}

async function resolveUsdcTokenId(blockchain: string): Promise<string | null> {
  if (usdcTokenCache[blockchain]) return usdcTokenCache[blockchain];

  const client = await getClient();
  try {
    const response = await client.listTokens({} as any);
    const tokens = (response.data as any)?.tokens || [];
    for (const token of tokens) {
      if (
        token.symbol === "USDC" &&
        token.blockchain === blockchain
      ) {
        usdcTokenCache[blockchain] = token.id;
        console.log(`[Circle] Resolved USDC token ID for ${blockchain}: ${token.id}`);
        return token.id;
      }
    }
  } catch (err: any) {
    console.error(`[Circle] Failed to resolve USDC token for ${blockchain}:`, err.message);
  }
  return null;
}

export async function createEscrowWallet(chain: string): Promise<{
  walletId: string;
  address: string;
  blockchain: string;
}> {
  const client = await getClient();
  const wsId = await ensureWalletSet();
  const blockchain = CHAIN_MAP[chain] || "ETH-SEPOLIA";

  try {
    const response = await client.createWallets({
      accountType: "EOA",
      blockchains: [blockchain as any],
      count: 1,
      walletSetId: wsId,
    });

    const wallet = response.data?.wallets?.[0];
    if (!wallet) {
      throw new Error("No wallet returned from Circle");
    }

    console.log(`[Circle] Created escrow wallet on ${blockchain}: ${wallet.address}`);

    return {
      walletId: wallet.id!,
      address: wallet.address!,
      blockchain,
    };
  } catch (err: any) {
    console.error("[Circle] Failed to create escrow wallet:", err.message);
    throw new Error(`Failed to create escrow wallet: ${err.message}`);
  }
}

export async function getWalletBalance(walletId: string): Promise<{
  balances: Array<{
    token: string;
    amount: string;
    blockchain: string;
  }>;
}> {
  const client = await getClient();

  try {
    const response = await client.getWalletTokenBalance({
      id: walletId,
    });

    const tokenBalances = response.data?.tokenBalances || [];
    return {
      balances: tokenBalances.map((b: any) => ({
        token: b.token?.symbol || "UNKNOWN",
        amount: b.amount || "0",
        blockchain: b.token?.blockchain || "unknown",
      })),
    };
  } catch (err: any) {
    console.error("[Circle] Failed to get wallet balance:", err.message);
    return { balances: [] };
  }
}

export async function transferUSDC(params: {
  sourceWalletId: string;
  destinationAddress: string;
  amount: string;
  chain: string;
}): Promise<{
  transactionId: string;
  status: string;
}> {
  const client = await getClient();
  const blockchain = CHAIN_MAP[params.chain] || "ETH-SEPOLIA";
  const tokenId = await resolveUsdcTokenId(blockchain);

  if (!tokenId) {
    throw new Error(`USDC token not found for ${blockchain}. Token discovery may have failed.`);
  }

  try {
    const response = await client.createTransaction({
      walletId: params.sourceWalletId,
      tokenId,
      destinationAddress: params.destinationAddress,
      amount: [params.amount],
      fee: {
        type: "level" as any,
        config: {
          feeLevel: "MEDIUM" as any,
        },
      },
    });

    const tx = response.data;
    console.log(`[Circle] USDC transfer initiated on ${blockchain}: ${tx?.id}`);

    return {
      transactionId: tx?.id || "",
      status: tx?.state || "INITIATED",
    };
  } catch (err: any) {
    console.error("[Circle] Failed to transfer USDC:", err.message);
    throw new Error(`Failed to transfer USDC: ${err.message}`);
  }
}

export async function getTransactionStatus(transactionId: string): Promise<{
  id: string;
  state: string;
  txHash: string | null;
  errorReason: string | null;
}> {
  const client = await getClient();

  try {
    const response = await client.getTransaction({
      id: transactionId,
    });

    const tx = response.data?.transaction;
    return {
      id: tx?.id || transactionId,
      state: tx?.state || "UNKNOWN",
      txHash: (tx as any)?.txHash || null,
      errorReason: (tx as any)?.errorReason || null,
    };
  } catch (err: any) {
    console.error("[Circle] Failed to get transaction status:", err.message);
    return {
      id: transactionId,
      state: "ERROR",
      txHash: null,
      errorReason: err.message,
    };
  }
}

export async function getWalletAddress(walletId: string): Promise<string | null> {
  const client = await getClient();

  try {
    const response = await client.getWallet({
      id: walletId,
    });

    return response.data?.wallet?.address || null;
  } catch (err: any) {
    console.error("[Circle] Failed to get wallet address:", err.message);
    return null;
  }
}

export async function listWallets(): Promise<Array<{
  id: string;
  address: string;
  blockchain: string;
  state: string;
}>> {
  const client = await getClient();

  try {
    const wsId = await ensureWalletSet();
    const response = await client.listWallets({
      walletSetId: wsId,
    });

    return (response.data?.wallets || []).map((w: any) => ({
      id: w.id,
      address: w.address,
      blockchain: w.blockchain,
      state: w.state,
    }));
  } catch (err: any) {
    console.error("[Circle] Failed to list wallets:", err.message);
    return [];
  }
}

export function isCircleConfigured(): boolean {
  return !!CIRCLE_API_KEY;
}

export const SUPPORTED_CHAINS = [
  { id: "BASE_SEPOLIA", name: "Base Sepolia", type: "EVM", circleChain: "ETH-SEPOLIA" },
  { id: "SOL_DEVNET", name: "Solana Devnet", type: "SVM", circleChain: "SOL-DEVNET" },
] as const;
