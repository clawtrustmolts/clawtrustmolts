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

function normalizePrivateKey(raw: string): `0x${string}` {
  const stripped = raw.trim().replace(/^0x/i, "");
  return `0x${stripped}`;
}

export function getWalletClient(): WalletClient | null {
  if (walletClientInstance) return walletClientInstance;

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    console.warn("[chain-client] No valid DEPLOYER_PRIVATE_KEY set, wallet client unavailable");
    return null;
  }

  const normalized = normalizePrivateKey(privateKey);
  if (normalized === "0x0000000000000000000000000000000000000000000000000000000000000001") {
    console.warn("[chain-client] Placeholder DEPLOYER_PRIVATE_KEY detected, wallet client unavailable");
    return null;
  }

  try {
    const account = privateKeyToAccount(normalized);
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
  if (!privateKey) return null;
  try {
    const account = privateKeyToAccount(normalizePrivateKey(privateKey));
    return account.address;
  } catch {
    return null;
  }
}

export { CHAIN_ID };

export const IDENTITY_REGISTRY_ADDRESS: Address = "0x8004A818BFB912233c491871b3d84c89A494BD9e";

export const OFFICIAL_ERC8004_REGISTRY_ADDRESS: Address = "0x8004A818BFB912233c491871b3d84c89A494BD9e";

export const OFFICIAL_ERC8004_REGISTRY_ABI = [
  {
    name: "register",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "agentURI", type: "string" }],
    outputs: [{ name: "agentId", type: "uint256" }],
  },
  {
    name: "setAgentURI",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "newURI", type: "string" }],
    outputs: [],
  },
  {
    name: "tokenURI",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "ownerOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

// ─── Deployed ClawTrust Contracts (Base Sepolia) ─────────────────
export const CLAW_CARD_NFT_ADDRESS:             Address = (process.env.CLAW_CARD_NFT_ADDRESS             || "0xe77611Da60A03C09F7ee9ba2D2C70Ddc07e1b55E") as Address;
export const CLAW_TRUST_ESCROW_ADDRESS:         Address = (process.env.CLAW_TRUST_ESCROW_ADDRESS         || "0x9975Abb15e5ED03767bfaaCB38c2cC87123a5BdA") as Address;
export const CLAW_TRUST_BOND_ADDRESS:           Address = (process.env.CLAW_TRUST_BOND_ADDRESS           || "0xeb6C02FCD86B3dE11Dbae83599a002558Ace5eFc") as Address;
export const CLAW_TRUST_SWARM_VALIDATOR_ADDRESS:Address = (process.env.CLAW_TRUST_SWARM_VALIDATOR_ADDRESS|| "0x110a2710B6806Cb5715601529bBBD9D1AFc0d398") as Address;
export const CLAW_TRUST_REP_ADAPTER_ADDRESS:    Address = (process.env.CLAW_TRUST_REP_ADAPTER_ADDRESS    || "0x5b70dA41b1642b11E0DC648a89f9eB8024a1d647") as Address;
export const CLAW_TRUST_CREW_ADDRESS:           Address = (process.env.CLAW_TRUST_CREW_ADDRESS           || "0xf9b2ac2ad03c98779363F49aF28aA518b5b303d3") as Address;

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

export const REPUTATION_REGISTRY_ADDRESS: Address = "0xecc00bbE268Fa4D0330180e0fB445f64d824d818";

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
