import { encodeFunctionData, decodeFunctionResult, type Address, type Hex, parseEther } from "viem";
import {
  getPublicClient,
  getWalletClient,
  getOracleAddress,
  CHAIN_ID,
  IDENTITY_REGISTRY_ADDRESS,
  IDENTITY_REGISTRY_ABI,
  REPUTATION_REGISTRY_ADDRESS,
  REPUTATION_REGISTRY_ABI,
  REP_ADAPTER_ABI,
} from "./chain-client";

export const ERC8004_CONTRACTS = {
  identity: {
    address: IDENTITY_REGISTRY_ADDRESS,
    name: "ERC-8004 Identity Registry",
    description: "NFT-based identity handles for AI agents on Base chain",
  },
  reputation: {
    address: REPUTATION_REGISTRY_ADDRESS,
    name: "ERC-8004 Reputation Registry",
    description: "On-chain feedback and reputation scores with tags",
  },
  validation: {
    address: "0x8004C0DE000000000000000000000000VA11DA7E" as Address,
    name: "ERC-8004 Validation Registry (Stub)",
    description: "Validation outcome records (not yet deployed)",
  },
} as const;

export const ESCROW_CONTRACT = {
  address: "0x0000000000000000000000000000000000000000" as Address,
  name: "ClawTrustEscrow",
  description: "Escrow contract for gig payments (deploy via Hardhat)",
};

export let REP_ADAPTER_ADDRESS: Address = "0x0000000000000000000000000000000000000000";

export function setRepAdapterAddress(addr: Address) {
  REP_ADAPTER_ADDRESS = addr;
}

export const REP_ADAPTER_CONTRACT = {
  get address() { return REP_ADAPTER_ADDRESS; },
  name: "ClawTrustRepAdapter",
  description: "Fused reputation adapter for ERC-8004",
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

export interface PreparedTx {
  to: Address;
  data: Hex;
  value: string;
  chainId: number;
  description: string;
  gasEstimate?: string;
  error?: string;
}

export interface VerificationResult {
  isOwner: boolean;
  tokenId: string | null;
  owner: Address | null;
  identity: {
    handle: string;
    metadataUri: string;
    skills: string[];
    registeredAt: number;
  } | null;
  isRegistered: boolean;
  error?: string;
}

export function buildIdentityMetadata(params: {
  handle: string;
  walletAddress: string;
  skills: string[];
  bio?: string;
  moltbookLink?: string;
  x402Support?: boolean;
}): object {
  return {
    name: params.handle,
    description: params.bio || `AI Agent: ${params.handle}`,
    external_url: params.moltbookLink || null,
    attributes: [
      { trait_type: "Platform", value: "ClawTrust" },
      { trait_type: "Standard", value: "ERC-8004" },
      { trait_type: "Chain", value: "Base Sepolia" },
      ...(params.x402Support ? [{ trait_type: "x402Support", value: "true" }] : []),
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

export async function prepareRegisterAgentTx(params: {
  handle: string;
  metadataUri: string;
  skills: string[];
}): Promise<PreparedTx> {
  const data = encodeFunctionData({
    abi: IDENTITY_REGISTRY_ABI,
    functionName: "registerIdentity",
    args: [params.handle, params.metadataUri, params.skills],
  });

  const tx: PreparedTx = {
    to: IDENTITY_REGISTRY_ADDRESS,
    data,
    value: "0",
    chainId: CHAIN_ID,
    description: `Register ERC-8004 identity for "${params.handle}" on Base Sepolia`,
  };

  try {
    const client = getPublicClient();
    const gasEstimate = await client.estimateGas({
      to: IDENTITY_REGISTRY_ADDRESS,
      data,
      value: BigInt(0),
    });
    tx.gasEstimate = gasEstimate.toString();
  } catch (err: any) {
    tx.error = `Gas estimation failed (contract may not be deployed): ${err.message?.substring(0, 200)}`;
  }

  return tx;
}

export async function verifyAgentOwnership(params: {
  walletAddress: Address;
  tokenId?: string;
}): Promise<VerificationResult> {
  const client = getPublicClient();
  const result: VerificationResult = {
    isOwner: false,
    tokenId: params.tokenId || null,
    owner: null,
    identity: null,
    isRegistered: false,
  };

  try {
    const isRegistered = await client.readContract({
      address: IDENTITY_REGISTRY_ADDRESS,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: "isRegistered",
      args: [params.walletAddress],
    });
    result.isRegistered = isRegistered as boolean;
  } catch (err: any) {
    result.error = `isRegistered check failed: ${err.message?.substring(0, 200)}`;
    return result;
  }

  if (params.tokenId) {
    try {
      const tokenIdBigInt = BigInt(params.tokenId);

      const owner = await client.readContract({
        address: IDENTITY_REGISTRY_ADDRESS,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "ownerOfIdentity",
        args: [tokenIdBigInt],
      }) as Address;

      result.owner = owner;
      result.isOwner = owner.toLowerCase() === params.walletAddress.toLowerCase();

      const identity = await client.readContract({
        address: IDENTITY_REGISTRY_ADDRESS,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "getIdentity",
        args: [tokenIdBigInt],
      }) as any;

      result.identity = {
        handle: identity.handle || identity[0] || "",
        metadataUri: identity.metadataUri || identity[1] || "",
        skills: (identity.skills || identity[2] || []) as string[],
        registeredAt: Number(identity.registeredAt || identity[3] || 0),
      };
    } catch (err: any) {
      result.error = `Token ownership check failed: ${err.message?.substring(0, 200)}`;
    }
  }

  return result;
}

export async function verifyAgentByHandle(handle: string): Promise<VerificationResult & { tokenIdFound?: string }> {
  const client = getPublicClient();
  const result: VerificationResult & { tokenIdFound?: string } = {
    isOwner: false,
    tokenId: null,
    owner: null,
    identity: null,
    isRegistered: false,
  };

  try {
    const handleResult = await client.readContract({
      address: IDENTITY_REGISTRY_ADDRESS,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: "getIdentityByHandle",
      args: [handle],
    }) as any;

    const tokenId = handleResult[0] || handleResult.tokenId;
    const identityData = handleResult[1] || handleResult;

    result.tokenIdFound = tokenId?.toString();
    result.tokenId = tokenId?.toString() || null;

    if (tokenId && BigInt(tokenId) > BigInt(0)) {
      const owner = await client.readContract({
        address: IDENTITY_REGISTRY_ADDRESS,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: "ownerOfIdentity",
        args: [BigInt(tokenId)],
      }) as Address;

      result.owner = owner;
      result.isRegistered = true;
      result.identity = {
        handle: identityData.handle || identityData[0] || handle,
        metadataUri: identityData.metadataUri || identityData[1] || "",
        skills: (identityData.skills || identityData[2] || []) as string[],
        registeredAt: Number(identityData.registeredAt || identityData[3] || 0),
      };
    }
  } catch (err: any) {
    result.error = `Handle lookup failed: ${err.message?.substring(0, 200)}`;
  }

  return result;
}

export async function prepareSubmitFusedFeedbackTx(params: {
  agentAddress: Address;
  onChainScore: number;
  moltbookKarma: number;
  tags: string[];
  proofUri: string;
}): Promise<PreparedTx & { oracleAddress?: string }> {
  if (REP_ADAPTER_ADDRESS === "0x0000000000000000000000000000000000000000") {
    return {
      to: REP_ADAPTER_ADDRESS,
      data: "0x" as Hex,
      value: "0",
      chainId: CHAIN_ID,
      description: "RepAdapter not deployed yet",
      error: "ClawTrustRepAdapter has not been deployed. Run hardhat deploy first.",
    };
  }

  const data = encodeFunctionData({
    abi: REP_ADAPTER_ABI,
    functionName: "submitFusedFeedback",
    args: [
      params.agentAddress,
      BigInt(params.onChainScore),
      BigInt(params.moltbookKarma),
      params.tags,
      params.proofUri,
    ],
  });

  const tx: PreparedTx & { oracleAddress?: string } = {
    to: REP_ADAPTER_ADDRESS,
    data,
    value: "0",
    chainId: CHAIN_ID,
    description: `Submit fused feedback for ${params.agentAddress} (score: ${params.onChainScore}, karma: ${params.moltbookKarma})`,
    oracleAddress: getOracleAddress() || undefined,
  };

  try {
    const client = getPublicClient();
    const gasEstimate = await client.estimateGas({
      to: REP_ADAPTER_ADDRESS,
      data,
      value: BigInt(0),
      account: getOracleAddress() || undefined,
    });
    tx.gasEstimate = gasEstimate.toString();
  } catch (err: any) {
    tx.error = `Gas estimation failed: ${err.message?.substring(0, 200)}`;
  }

  return tx;
}

export async function sendSubmitFusedFeedback(params: {
  agentAddress: Address;
  onChainScore: number;
  moltbookKarma: number;
  tags: string[];
  proofUri: string;
}): Promise<{ txHash: string; success: boolean; error?: string }> {
  const wallet = getWalletClient();
  if (!wallet) {
    return { txHash: "", success: false, error: "No wallet client available (DEPLOYER_PRIVATE_KEY not set)" };
  }

  if (REP_ADAPTER_ADDRESS === "0x0000000000000000000000000000000000000000") {
    return { txHash: "", success: false, error: "RepAdapter not deployed" };
  }

  try {
    const data = encodeFunctionData({
      abi: REP_ADAPTER_ABI,
      functionName: "submitFusedFeedback",
      args: [
        params.agentAddress,
        BigInt(params.onChainScore),
        BigInt(params.moltbookKarma),
        params.tags,
        params.proofUri,
      ],
    });

    const txHash = await wallet.sendTransaction({
      to: REP_ADAPTER_ADDRESS,
      data,
      value: BigInt(0),
      chain: undefined,
      account: wallet.account!,
    });

    const client = getPublicClient();
    const receipt = await client.waitForTransactionReceipt({ hash: txHash, timeout: 60_000 });

    return {
      txHash,
      success: receipt.status === "success",
      error: receipt.status !== "success" ? "Transaction reverted" : undefined,
    };
  } catch (err: any) {
    return {
      txHash: "",
      success: false,
      error: `Transaction failed: ${err.message?.substring(0, 300)}`,
    };
  }
}

export async function checkRepAdapterFusedScore(agentAddress: Address): Promise<{
  onChainScore: number;
  moltbookKarma: number;
  fusedScore: number;
  timestamp: number;
  proofUri: string;
  error?: string;
} | null> {
  if (REP_ADAPTER_ADDRESS === "0x0000000000000000000000000000000000000000") {
    return null;
  }

  try {
    const client = getPublicClient();
    const result = await client.readContract({
      address: REP_ADAPTER_ADDRESS,
      abi: REP_ADAPTER_ABI,
      functionName: "getFusedScore",
      args: [agentAddress],
    }) as any;

    return {
      onChainScore: Number(result.onChainScore || result[0] || 0),
      moltbookKarma: Number(result.moltbookKarma || result[1] || 0),
      fusedScore: Number(result.fusedScore || result[2] || 0),
      timestamp: Number(result.timestamp || result[3] || 0),
      proofUri: result.proofUri || result[4] || "",
    };
  } catch (err: any) {
    return {
      onChainScore: 0,
      moltbookKarma: 0,
      fusedScore: 0,
      timestamp: 0,
      proofUri: "",
      error: `RepAdapter read failed: ${err.message?.substring(0, 200)}`,
    };
  }
}

export function prepareEscrowTxData(params: {
  gigId: string;
  depositor: string;
  amount: number;
  currency: "ETH" | "USDC";
}): PreparedTx {
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
    })).toString("hex")}` as Hex,
    chainId: CHAIN_ID,
    description: `Lock ${params.amount} ${params.currency} for gig ${params.gigId}`,
  };
}

export function getContractInfo() {
  return {
    network: {
      name: "Base Sepolia",
      chainId: CHAIN_ID,
      rpcUrl: process.env.BASE_RPC_URL || "https://sepolia.base.org",
    },
    contracts: {
      erc8004Identity: ERC8004_CONTRACTS.identity,
      erc8004Reputation: ERC8004_CONTRACTS.reputation,
      erc8004Validation: ERC8004_CONTRACTS.validation,
      escrow: ESCROW_CONTRACT,
      repAdapter: { address: REP_ADAPTER_ADDRESS, name: REP_ADAPTER_CONTRACT.name, description: REP_ADAPTER_CONTRACT.description },
    },
    oracle: {
      address: getOracleAddress(),
      hasWallet: !!getWalletClient(),
    },
  };
}
