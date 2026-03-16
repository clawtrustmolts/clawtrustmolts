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

export const SKALE_TESTNET = {
  chainId: 974399131,
  name: "SKALE Testnet",
  rpc: "https://testnet.skalenodes.com/v1/giant-half-dual-testnet",
  explorer: "https://giant-half-dual-testnet.explorer.testnet.skalenodes.com",
  contracts: {
    erc8004Registry: "0x110a2710B6806Cb5715601529bBBD9D1AFc0d398",
    repAdapter:      "0x9975Abb15e5ED03767bfaaCB38c2cC87123a5BdA",
    clawCardNFT:     "0x5b70dA41b1642b11E0DC648a89f9eB8024a1d647",
    agenticCommerce: "0x2529A8900aD37386F6250281A5085D60Bd673c4B",
    escrow:          "0xFb419D8E32c14F774279a4dEEf330dc893257147",
    swarmValidator:  "0xeb6C02FCD86B3dE11Dbae83599a002558Ace5eFc",
    bond:            "0xe77611Da60A03C09F7ee9ba2D2C70Ddc07e1b55E",
    crew:            "0x29fd67501afd535599ff83AE072c20E31Afab958",
    registry:        "0xf9b2ac2ad03c98779363F49aF28aA518b5b303d3",
  },
} as const;
