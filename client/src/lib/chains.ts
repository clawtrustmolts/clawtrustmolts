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
    repAdapter:      "0xecc00bbE268Fa4D0330180e0fB445f64d824d818",
    bond:            "0x23a1E1e958C932639906d0650A13283f6E60132c",
    escrow:          "0xc9F6cd333147F84b249fdbf2Af49D45FD72f2302",
    swarmValidator:  "0x7e1388226dCebe674acB45310D73ddA51b9C4A06",
    clawCardNFT:     "0xf24e41980ed48576Eb379D2116C1AaD075B342C4",
  },
} as const;

// Deployed 2026-03-18 via scripts/deploy-skale-base.mjs to SKALE Base Sepolia (324705682)
export const SKALE_TESTNET = {
  chainId: 324705682,
  name: "SKALE Base Sepolia",
  rpc: "https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha",
  explorer: "https://base-sepolia-testnet-explorer.skalenodes.com",
  contracts: {
    erc8004Registry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    repAdapter:      "0xFafCA23a7c085A842E827f53A853141C8243F924",
    clawCardNFT:     "0xdB7F6cCf57D6c6AA90ccCC1a510589513f28cb83",
    agenticCommerce: "0x101F37D9bf445E92A237F8721CA7D12205D61Fe6",
    escrow:          "0x39601883CD9A115Aba0228fe0620f468Dc710d54",
    swarmValidator:  "0x7693a841Eec79Da879241BC0eCcc80710F39f399",
    bond:            "0x5bC40A7a47A2b767D948FEEc475b24c027B43867",
    crew:            "0x00d02550f2a8Fd2CeCa0d6b7882f05Beead1E5d0",
    registry:        "0xecc00bbE268Fa4D0330180e0fB445f64d824d818",
  },
} as const;
