import { createPublicClient, createWalletClient, http, type Address, type PublicClient, type WalletClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const RPC_URL = process.env.BASE_RPC_URL || "https://sepolia.base.org";
const CHAIN_ID = 84532;

let publicClientInstance: PublicClient | null = null;
let walletClientInstance: WalletClient | null = null;

export function getPublicClient(): PublicClient {
  if (!publicClientInstance) {
    publicClientInstance = createPublicClient({
      chain: baseSepolia,
      transport: http(RPC_URL, {
        timeout: 15_000,
        retryCount: 3,
        retryDelay: 1_500,
      }),
    }) as PublicClient;
  }
  return publicClientInstance;
}

export function getWalletClient(): WalletClient | null {
  if (walletClientInstance) return walletClientInstance;

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey || privateKey === "0x0000000000000000000000000000000000000000000000000000000000000001") {
    console.warn("[chain-client] No valid DEPLOYER_PRIVATE_KEY set, wallet client unavailable");
    return null;
  }

  try {
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    walletClientInstance = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(RPC_URL, {
        timeout: 30_000,
        retryCount: 2,
        retryDelay: 2_000,
      }),
    });
    console.log(`[chain-client] Wallet client initialized for oracle: ${account.address}`);
    return walletClientInstance;
  } catch (err: any) {
    console.error("[chain-client] Failed to create wallet client:", err.message);
    return null;
  }
}

export function getOracleAddress(): Address | null {
  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey || privateKey === "0x0000000000000000000000000000000000000000000000000000000000000001") {
    return null;
  }
  try {
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    return account.address;
  } catch {
    return null;
  }
}

export { CHAIN_ID };

export const IDENTITY_REGISTRY_ADDRESS: Address = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

export const IDENTITY_REGISTRY_ABI = [
  {
    name: "registerIdentity",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "handle", type: "string" },
      { name: "metadataUri", type: "string" },
      { name: "skills", type: "string[]" },
    ],
    outputs: [{ name: "tokenId", type: "uint256" }],
  },
  {
    name: "getIdentity",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "handle", type: "string" },
          { name: "metadataUri", type: "string" },
          { name: "skills", type: "string[]" },
          { name: "registeredAt", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "getIdentityByHandle",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "handle", type: "string" }],
    outputs: [
      { name: "tokenId", type: "uint256" },
      {
        name: "",
        type: "tuple",
        components: [
          { name: "handle", type: "string" },
          { name: "metadataUri", type: "string" },
          { name: "skills", type: "string[]" },
          { name: "registeredAt", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "ownerOfIdentity",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    name: "isRegistered",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "updateMetadata",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "tokenId", type: "uint256" },
      { name: "newUri", type: "string" },
    ],
    outputs: [],
  },
] as const;

export const REPUTATION_REGISTRY_ADDRESS: Address = "0x8004BAa1dEF4502D1d87e1f62e4C8a2ff95Da561";

export const REPUTATION_REGISTRY_ABI = [
  {
    name: "getScore",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ name: "", type: "int256" }],
  },
  {
    name: "getFeedbackCount",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getFeedback",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "agent", type: "address" },
      { name: "index", type: "uint256" },
    ],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "score", type: "int256" },
          { name: "tags", type: "string[]" },
          { name: "proofUri", type: "string" },
          { name: "timestamp", type: "uint256" },
        ],
      },
    ],
  },
  {
    name: "submitFeedback",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "score", type: "int256" },
      { name: "tags", type: "string[]" },
      { name: "proofUri", type: "string" },
    ],
    outputs: [],
  },
] as const;

export const REP_ADAPTER_ABI = [
  {
    name: "computeFusedScore",
    type: "function",
    stateMutability: "pure",
    inputs: [
      { name: "onChainScore", type: "uint256" },
      { name: "moltbookKarma", type: "uint256" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "updateFusedScore",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agent", type: "address" },
      { name: "onChainScore", type: "uint256" },
      { name: "moltbookKarma", type: "uint256" },
      { name: "proofUri", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "submitFusedFeedback",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "agentAddress", type: "address" },
      { name: "onChainScore", type: "uint256" },
      { name: "moltbookKarma", type: "uint256" },
      { name: "tags", type: "string[]" },
      { name: "proofUri", type: "string" },
    ],
    outputs: [],
  },
  {
    name: "getFusedScore",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "onChainScore", type: "uint256" },
          { name: "moltbookKarma", type: "uint256" },
          { name: "fusedScore", type: "uint256" },
          { name: "timestamp", type: "uint256" },
          { name: "proofUri", type: "string" },
        ],
      },
    ],
  },
  {
    name: "authorizedOracles",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;
