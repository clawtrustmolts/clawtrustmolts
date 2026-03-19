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
    ERC8004ReputationRegistry: string;
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
    ClawCardNFT:                "0xf24e41980ed48576Eb379D2116C1AaD075B342C4",
    ERC8004IdentityRegistry:    "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    ERC8004ReputationRegistry:  "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    ClawTrustEscrow:            "0xc9F6cd333147F84b249fdbf2Af49D45FD72f2302",
    ClawTrustRepAdapter:        "0xecc00bbE268Fa4D0330180e0fB445f64d824d818",
    ClawTrustSwarmValidator:    "0x7e1388226dCebe674acB45310D73ddA51b9C4A06",
    ClawTrustBond:              "0x23a1E1e958C932639906d0650A13283f6E60132c",
    ClawTrustCrew:              "0xFF9B75BD080F6D2FAe7Ffa500451716b78fde5F3",
    ClawTrustRegistry:          "0x53ddb120f05Aa21ccF3f47F3Ed79219E3a3D94e4",
    ClawTrustAC:                "0x1933D67CDB911653765e84758f47c60A1E868bC0",
  },
  usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

// SKALE Base Sepolia — deployed 2026-03-18 via scripts/deploy-skale-base.mjs
// Canonical ERC-8004 addresses from erc-8004-contracts PR #56 (TheGreatAxios / Sawyer Cutler)
export const SKALE_CONFIG: ChainConfig = {
  chainId: 324705682,
  name: "SKALE Base Sepolia",
  rpcUrl: "https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha",
  blockExplorerUrl: "https://base-sepolia-testnet-explorer.skalenodes.com",
  contracts: {
    ClawCardNFT:                "0xdB7F6cCf57D6c6AA90ccCC1a510589513f28cb83",
    ERC8004IdentityRegistry:    "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    ERC8004ReputationRegistry:  "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    ClawTrustEscrow:            "0x39601883CD9A115Aba0228fe0620f468Dc710d54",
    ClawTrustRepAdapter:        "0xFafCA23a7c085A842E827f53A853141C8243F924",
    ClawTrustSwarmValidator:    "0x7693a841Eec79Da879241BC0eCcc80710F39f399",
    ClawTrustBond:              "0x5bC40A7a47A2b767D948FEEc475b24c027B43867",
    ClawTrustCrew:              "0x00d02550f2a8Fd2CeCa0d6b7882f05Beead1E5d0",
    ClawTrustRegistry:          "0xecc00bbE268Fa4D0330180e0fB445f64d824d818",
    ClawTrustAC:                "0x101F37D9bf445E92A237F8721CA7D12205D61Fe6",
  },
  usdc: "0x2e08028E3C4c2356572E096d8EF835cD5C6030bD",
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
