export const ERC8004_CONTRACTS = {
  identity: {
    address: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    name: "ERC-8004 Identity Registry",
    description: "NFT-based identity handles for AI agents on Base chain",
  },
  reputation: {
    address: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
    name: "ERC-8004 Reputation Registry",
    description: "On-chain feedback and reputation scores with tags",
  },
  validation: {
    address: "0x8004C0DE000000000000000000000000VA11DA7E",
    name: "ERC-8004 Validation Registry (Stub)",
    description: "Validation outcome records (not yet deployed)",
  },
} as const;

export const ESCROW_CONTRACT = {
  address: "0x0000000000000000000000000000000000000000",
  name: "ClawTrustEscrow",
  description: "Escrow contract for gig payments (deploy via Hardhat)",
};

export const REP_ADAPTER_CONTRACT = {
  address: "0x0000000000000000000000000000000000000000",
  name: "ClawTrustRepAdapter",
  description: "Fused reputation adapter for ERC-8004 (deploy via Hardhat)",
};

export interface ERC8004Identity {
  tokenId: string;
  handle: string;
  owner: string;
  metadataUri: string;
  skills: string[];
  registeredAt: number;
}

export interface ERC8004ReputationFeedback {
  from: string;
  to: string;
  score: number;
  tags: string[];
  proofUri: string;
  timestamp: number;
}

export interface ERC8004ValidationRecord {
  gigId: string;
  validatorAddresses: string[];
  outcome: "approved" | "rejected";
  voteTally: { for: number; against: number };
  timestamp: number;
}

export function buildIdentityMetadata(params: {
  handle: string;
  walletAddress: string;
  skills: string[];
  bio?: string;
  moltbookLink?: string;
}): object {
  return {
    name: params.handle,
    description: params.bio || `AI Agent: ${params.handle}`,
    external_url: params.moltbookLink || null,
    attributes: [
      { trait_type: "Platform", value: "ClawTrust" },
      { trait_type: "Standard", value: "ERC-8004" },
      { trait_type: "Chain", value: "Base Sepolia" },
      ...params.skills.map(skill => ({
        trait_type: "Skill",
        value: skill,
      })),
    ],
  };
}

export function buildReputationFeedback(params: {
  fromAgent: string;
  toAgent: string;
  score: number;
  tags: string[];
  proofUri?: string;
}): ERC8004ReputationFeedback {
  return {
    from: params.fromAgent,
    to: params.toAgent,
    score: params.score,
    tags: params.tags,
    proofUri: params.proofUri || "",
    timestamp: Math.floor(Date.now() / 1000),
  };
}

export function prepareEscrowTxData(params: {
  gigId: string;
  depositor: string;
  amount: number;
  currency: "ETH" | "USDC";
}): {
  to: string;
  value: string;
  data: string;
  chainId: number;
  description: string;
} {
  const isETH = params.currency === "ETH";
  return {
    to: ESCROW_CONTRACT.address,
    value: isETH ? String(params.amount) : "0",
    data: `0x${Buffer.from(JSON.stringify({
      method: "lockFunds",
      params: {
        gigId: params.gigId,
        amount: params.amount,
        currency: params.currency,
      },
    })).toString("hex")}`,
    chainId: 84532,
    description: `Lock ${params.amount} ${params.currency} for gig ${params.gigId}`,
  };
}

export function getContractInfo() {
  return {
    network: {
      name: "Base Sepolia",
      chainId: 84532,
      rpcUrl: process.env.BASE_RPC_URL || "https://sepolia.base.org",
    },
    contracts: {
      erc8004Identity: ERC8004_CONTRACTS.identity,
      erc8004Reputation: ERC8004_CONTRACTS.reputation,
      erc8004Validation: ERC8004_CONTRACTS.validation,
      escrow: ESCROW_CONTRACT,
      repAdapter: REP_ADAPTER_CONTRACT,
    },
  };
}
