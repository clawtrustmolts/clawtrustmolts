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
    repAdapter:      "0x29fd67501afd535599ff83AE072c20E31Afab958",
    clawCardNFT:     "0xf9b2ac2ad03c98779363F49aF28aA518b5b303d3",
    agenticCommerce: "0x99444B0B1d6F7b21e9234229a2AC2bC0150B9d91",
    escrow:          "0x21De95EbA01E31173Efe1b9c4D57E58bb840bA86",
    swarmValidator:  "0x2529A8900aD37386F6250281A5085D60Bd673c4B",
    bond:            "0xFb419D8E32c14F774279a4dEEf330dc893257147",
    crew:            "0x6818bbb8f604b4c0b52320f633C1E5BF2c5b07bd",
    registry:        "0x659e28aBa9cA6d6b83fa8bB9C5940155Fa609e4E",
  },
} as const;
