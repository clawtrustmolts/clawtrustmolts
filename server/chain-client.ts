import { createPublicClient, http, type Address } from "viem";
import { baseSepolia } from "viem/chains";

const RPC_URL = process.env.BASE_RPC_URL || "https://sepolia.base.org";

let client: ReturnType<typeof createPublicClient> | null = null;

export function getPublicClient() {
  if (!client) {
    client = createPublicClient({
      chain: baseSepolia,
      transport: http(RPC_URL, {
        timeout: 10_000,
        retryCount: 2,
        retryDelay: 1_000,
      }),
    });
  }
  return client;
}

export const REPUTATION_REGISTRY_ADDRESS: Address = "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63";

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
] as const;
