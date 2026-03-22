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
    console.log("[chain-client] Wallet client initialized for oracle");
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

export const IDENTITY_REGISTRY_ADDRESS: Address = (process.env.ERC8004_IDENTITY_REGISTRY_ADDRESS || "0xBeb8a61b6bBc53934f1b89cE0cBa0c42830855CF") as Address;

export const OFFICIAL_ERC8004_REGISTRY_ADDRESS: Address = (process.env.ERC8004_IDENTITY_REGISTRY_ADDRESS || "0xBeb8a61b6bBc53934f1b89cE0cBa0c42830855CF") as Address;

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

// ─── Deployed ClawTrust Contracts (Base Sepolia) ─────────────────────────────
// SKALE Base Sepolia (324705682) addresses: ClawCardNFT=0xdB7F6cCf57D6c6AA90ccCC1a510589513f28cb83
//   ERC8004Registry=0x8004A818BFB912233c491871b3d84c89A494BD9e (canonical)
//   RepAdapter=0xFafCA23a7c085A842E827f53A853141C8243F924
//   AC=0x101F37D9bf445E92A237F8721CA7D12205D61Fe6  chainId=324705682
export const CLAW_CARD_NFT_ADDRESS:             Address = (process.env.CLAW_CARD_NFT_ADDRESS             || "0xf24e41980ed48576Eb379D2116C1AaD075B342C4") as Address;
export const CLAW_TRUST_ESCROW_ADDRESS:         Address = (process.env.CLAW_TRUST_ESCROW_ADDRESS         || "0x6B676744B8c4900F9999E9a9323728C160706126") as Address;
export const CLAW_TRUST_BOND_ADDRESS:           Address = (process.env.CLAW_TRUST_BOND_ADDRESS           || "0x23a1E1e958C932639906d0650A13283f6E60132c") as Address;
export const CLAW_TRUST_SWARM_VALIDATOR_ADDRESS:Address = (process.env.CLAW_TRUST_SWARM_VALIDATOR_ADDRESS|| "0xb219ddb4a65934Cea396C606e7F6bcfBF2F68743") as Address;
export const CLAW_TRUST_REP_ADAPTER_ADDRESS:    Address = (process.env.CLAW_TRUST_REP_ADAPTER_ADDRESS    || "0xEfF3d3170e37998C7db987eFA628e7e56E1866DB") as Address;
export const CLAW_TRUST_CREW_ADDRESS:           Address = (process.env.CLAW_TRUST_CREW_ADDRESS           || "0xFF9B75BD080F6D2FAe7Ffa500451716b78fde5F3") as Address;

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

// Canonical ERC-8004 ReputationRegistry — SKALE Base Sepolia (PR #56 by TheGreatAxios/Sawyer Cutler)
export const REPUTATION_REGISTRY_ADDRESS: Address = "0x8004B663056A597Dffe9eCcC1965A193B7388713";

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
      { name: "performanceScore", type: "uint256" },
      { name: "bondScore", type: "uint256" },
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
      { name: "performanceScore", type: "uint256" },
      { name: "bondScore", type: "uint256" },
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
          { name: "performanceScore", type: "uint256" },
          { name: "bondScore", type: "uint256" },
          { name: "fusedScore", type: "uint256" },
          { name: "timestamp", type: "uint256" },
          { name: "proofHash", type: "bytes32" },
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
  {
    name: "updateCooldown",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "setUpdateCooldown",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [{ name: "_cooldown", type: "uint256" }],
    outputs: [],
  },
] as const;
