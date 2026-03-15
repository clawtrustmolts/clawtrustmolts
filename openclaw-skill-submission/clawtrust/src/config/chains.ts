export enum ChainId {
  BASE = "base",
  SKALE = "skale",
}

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  blockExplorerUrl: string;
  contracts: {
    ClawCardNFT: string;
    ERC8004IdentityRegistry: string;
    ClawTrustEscrow: string;
    ClawTrustRepAdapter: string;
    ClawTrustSwarmValidator: string;
    ClawTrustBond: string;
    ClawTrustCrew: string;
    ClawTrustRegistry: string;
    ClawTrustAC: string;
  };
  usdc: string;
}

export const BASE_CONFIG: ChainConfig = {
  chainId: 84532,
  name: "Base Sepolia",
  rpcUrl: "https://sepolia.base.org",
  blockExplorerUrl: "https://sepolia.basescan.org",
  contracts: {
    ClawCardNFT: "0xf24e41980ed48576Eb379D2116C1AaD075B342C4",
    ERC8004IdentityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    ClawTrustEscrow: "0xc9F6cd333147F84b249fdbf2Af49D45FD72f2302",
    ClawTrustRepAdapter: "0xecc00bbE268Fa4D0330180e0fB445f64d824d818",
    ClawTrustSwarmValidator: "0x7e1388226dCebe674acB45310D73ddA51b9C4A06",
    ClawTrustBond: "0x23a1E1e958C932639906d0650A13283f6E60132c",
    ClawTrustCrew: "0xFF9B75BD080F6D2FAe7Ffa500451716b78fde5F3",
    ClawTrustRegistry: "0x53ddb120f05Aa21ccF3f47F3Ed79219E3a3D94e4",
    ClawTrustAC: "0x1933D67CDB911653765e84758f47c60A1E868bC0",
  },
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

// SKALE Testnet (giant-half-dual-testnet) — deployed 2026-03-15
// Switch chainId/rpcUrl/blockExplorerUrl to mainnet values after audit
export const SKALE_CONFIG: ChainConfig = {
  chainId: 974399131,
  name: "SKALE Testnet (giant-half-dual)",
  rpcUrl: "https://testnet.skalenodes.com/v1/giant-half-dual-testnet",
  blockExplorerUrl: "https://giant-half-dual-testnet.explorer.testnet.skalenodes.com",
  contracts: {
    ClawCardNFT: "0x5b70dA41b1642b11E0DC648a89f9eB8024a1d647",
    ERC8004IdentityRegistry: "0x110a2710B6806Cb5715601529bBBD9D1AFc0d398",
    ClawTrustEscrow: "0xFb419D8E32c14F774279a4dEEf330dc893257147",
    ClawTrustRepAdapter: "0x9975Abb15e5ED03767bfaaCB38c2cC87123a5BdA",
    ClawTrustSwarmValidator: "0xeb6C02FCD86B3dE11Dbae83599a002558Ace5eFc",
    ClawTrustBond: "0xe77611Da60A03C09F7ee9ba2D2C70Ddc07e1b55E",
    ClawTrustCrew: "0x29fd67501afd535599ff83AE072c20E31Afab958",
    ClawTrustRegistry: "0xf9b2ac2ad03c98779363F49aF28aA518b5b303d3",
    ClawTrustAC: "0x2529A8900aD37386F6250281A5085D60Bd673c4B",
  },
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

const CHAIN_CONFIGS: Record<ChainId, ChainConfig> = {
  [ChainId.BASE]: BASE_CONFIG,
  [ChainId.SKALE]: SKALE_CONFIG,
};

const CHAIN_ID_MAP: Record<number, ChainId> = {
  [BASE_CONFIG.chainId]: ChainId.BASE,
  [SKALE_CONFIG.chainId]: ChainId.SKALE,
};

export function getChainConfig(chain: ChainId): ChainConfig {
  const config = CHAIN_CONFIGS[chain];
  if (!config) {
    throw new Error(`Unknown chain: ${chain}. Supported chains: ${Object.values(ChainId).join(", ")}`);
  }
  return config;
}

export function chainIdToChain(numericChainId: number): ChainId | undefined {
  return CHAIN_ID_MAP[numericChainId];
}

export function getSupportedChainIds(): number[] {
  return Object.keys(CHAIN_ID_MAP).map(Number);
}
