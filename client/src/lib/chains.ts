export type FeatureRow =
  | { label: string; base: true; skale: true }
  | { label: string; base: true; skale: false }
  | { label: string; base: false; skale: true }
  | { label: string; base: string; skale: string };

export type ChainFeatureRow =
  | { kind: "bool"; label: string; base: boolean; skale: boolean }
  | { kind: "value"; label: string; base: string; skale: string }
  | { kind: "skale-only"; label: string };

export const CHAIN_FEATURE_MATRIX: ChainFeatureRow[] = [
  { kind: "bool",  label: "ERC-8004 Identity",      base: true,  skale: true },
  { kind: "bool",  label: "Reputation Oracle",       base: true,  skale: true },
  { kind: "bool",  label: "Bond / Escrow (USDC)",    base: true,  skale: true },
  { kind: "bool",  label: "Gig Market",              base: true,  skale: true },
  { kind: "bool",  label: "Swarm Validation",        base: true,  skale: true },
  { kind: "bool",  label: "x402 Payments",           base: true,  skale: true },
  { kind: "value", label: "Gas Token",               base: "ETH", skale: "sFUEL (free)" },
  { kind: "skale-only", label: "Zero Gas Fees" },
  { kind: "skale-only", label: "Encrypted Execution" },
  { kind: "skale-only", label: "Sub-second Finality" },
];

export const BASE_SEPOLIA = {
  chainId: 84532,
  name: "Base Sepolia",
  rpc: "https://sepolia.base.org",
  explorer: "https://sepolia.basescan.org",
  contracts: {
    erc8004Registry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    repAdapter:      "0xEfF3d3170e37998C7db987eFA628e7e56E1866DB",
    bond:            "0x23a1E1e958C932639906d0650A13283f6E60132c",
    escrow:          "0x6B676744B8c4900F9999E9a9323728C160706126",
    swarmValidator:  "0xb219ddb4a65934Cea396C606e7F6bcfBF2F68743",
    clawCardNFT:     "0xf24e41980ed48576Eb379D2116C1AaD075B342C4",
    usdc:            "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    crew:            "0x33D0f79974C383dc374C888774eB52b0fca41BA2",
  },
} as const;

// Base Mainnet — deploy contracts and set env vars to activate
export const BASE_MAINNET = {
  chainId: 8453,
  name: "Base Mainnet",
  rpc: "https://mainnet.base.org",
  explorer: "https://basescan.org",
  contracts: {
    usdc:            "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    escrow:          (import.meta.env.VITE_MAINNET_ESCROW_ADDRESS  || ""),
    bond:            (import.meta.env.VITE_MAINNET_BOND_ADDRESS    || ""),
    swarmValidator:  (import.meta.env.VITE_MAINNET_SWARM_ADDRESS   || ""),
    erc8004Registry: (import.meta.env.VITE_MAINNET_REGISTRY_ADDRESS|| ""),
    repAdapter:      (import.meta.env.VITE_MAINNET_REP_ADAPTER_ADDRESS || ""),
    clawCardNFT:     (import.meta.env.VITE_MAINNET_CLAW_CARD_NFT_ADDRESS || ""),
  },
} as const;

// Deployed 2026-03-18 via scripts/deploy-skale-base.mjs to SKALE Base Sepolia (324705682)
export const SKALE_TESTNET = {
  chainId: 324705682,
  name: "SKALE Base Sepolia",
  rpc: "https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha",
  explorer: "https://base-sepolia-testnet-explorer.skalenodes.com",
  contracts: {
    erc8004IdentityRegistry:    "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    erc8004ReputationRegistry:  "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    repAdapter:      "0xFafCA23a7c085A842E827f53A853141C8243F924",
    clawCardNFT:     "0xdB7F6cCf57D6c6AA90ccCC1a510589513f28cb83",
    agenticCommerce: "0x101F37D9bf445E92A237F8721CA7D12205D61Fe6",
    escrow:          "0x39601883CD9A115Aba0228fe0620f468Dc710d54",
    swarmValidator:  "0x7693a841Eec79Da879241BC0eCcc80710F39f399",
    bond:            "0x5bC40A7a47A2b767D948FEEc475b24c027B43867",
    crew:            "0x427d0D6481bC708979Bdc2F80f659549BdB27f96",
    registry:        "0xED668f205eC9Ba9DA0c1D74B5866428b8e270084",
  },
} as const;
