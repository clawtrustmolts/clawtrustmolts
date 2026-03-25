/**
 * ClawTrust On-Chain Utilities
 *
 * Provides direct wallet transaction helpers using window.ethereum (no wagmi).
 * Supports Base Sepolia (84532), SKALE Base Sepolia (324705682), and Base Mainnet (8453).
 */

// ─── Contract addresses ──────────────────────────────────────────────────────

export const CHAIN_IDS = {
  BASE_SEPOLIA: 84532,
  SKALE_TESTNET: 324705682,
  BASE_MAINNET: 8453,
} as const;

export type ChainKey = keyof typeof CHAIN_IDS;

interface ChainContracts {
  usdc: string;
  escrow: string;
  bond: string;
  swarmValidator: string;
  rpc: string;
  explorer: string;
  name: string;
}

export const CHAIN_CONTRACTS: Record<ChainKey, ChainContracts> = {
  BASE_SEPOLIA: {
    usdc:           "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    escrow:         "0x6B676744B8c4900F9999E9a9323728C160706126",
    bond:           "0x686E75159a7d65E4B32f7039c5AcB70454eadd7e",
    swarmValidator: "0xb219ddb4a65934Cea396C606e7F6bcfBF2F68743",
    rpc:            "https://sepolia.base.org",
    explorer:       "https://sepolia.basescan.org",
    name:           "Base Sepolia",
  },
  SKALE_TESTNET: {
    usdc:           "0x2e08028E3C4c2356572E096d8EF835cD5C6030bD",
    escrow:         "0x39601883CD9A115Aba0228fe0620f468Dc710d54",
    bond:           "0x5bC40A7a47A2b767D948FEEc475b24c027B43867",
    swarmValidator: "0x7693a841Eec79Da879241BC0eCcc80710F39f399",
    rpc:            "https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha",
    explorer:       "https://base-sepolia-testnet-explorer.skalenodes.com",
    name:           "SKALE Base Sepolia",
  },
  BASE_MAINNET: {
    usdc:           (import.meta.env.VITE_MAINNET_USDC_ADDRESS    || "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"),
    escrow:         (import.meta.env.VITE_MAINNET_ESCROW_ADDRESS  || ""),
    bond:           (import.meta.env.VITE_MAINNET_BOND_ADDRESS    || ""),
    swarmValidator: (import.meta.env.VITE_MAINNET_SWARM_ADDRESS   || ""),
    rpc:            "https://mainnet.base.org",
    explorer:       "https://basescan.org",
    name:           "Base Mainnet",
  },
};

// ─── Minimal ABIs (inline, no artifact files needed client-side) ──────────────

export const USDC_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
] as const;

export const ESCROW_ABI = [
  "function lockUSDC(bytes32 gigId, address payee, uint256 amount)",
  "function getEscrow(bytes32 gigId) view returns (tuple(bytes32 gigId, address depositor, address payee, uint256 amount, uint8 status, bool requiresSwarmValidation, uint256 createdAt))",
] as const;

export const BOND_ABI = [
  "function depositFor(address agent, uint256 amount)",
  "function balanceOf(address agent) view returns (uint256)",
] as const;

// ─── ABI encoding helpers ─────────────────────────────────────────────────────

function encodeUint256(n: bigint): string {
  return n.toString(16).padStart(64, "0");
}

function encodeAddress(addr: string): string {
  return addr.toLowerCase().replace("0x", "").padStart(64, "0");
}

function encodeBytes32(b32: string): string {
  return b32.replace("0x", "").padStart(64, "0");
}

function keccak256Selector(sig: string): string {
  // Use a simple FNV-like approach for the 4-byte selector
  // We'll use a pre-computed selector table for known functions
  const selectors: Record<string, string> = {
    "approve(address,uint256)":               "095ea7b3",
    "balanceOf(address)":                     "70a08231",
    "allowance(address,address)":             "dd62ed3e",
    "lockUSDC(bytes32,address,uint256)":      "0f4428b1",
    "depositFor(address,uint256)":            "b760faf9",
    "decimals()":                             "313ce567",
  };
  const found = selectors[sig];
  if (!found) throw new Error(`Unknown ABI selector: ${sig}`);
  return found;
}

function encodeApprove(spender: string, amount: bigint): string {
  return "0x" +
    keccak256Selector("approve(address,uint256)") +
    encodeAddress(spender) +
    encodeUint256(amount);
}

function encodeLockUSDC(gigIdBytes32: string, payee: string, amount: bigint): string {
  return "0x" +
    keccak256Selector("lockUSDC(bytes32,address,uint256)") +
    encodeBytes32(gigIdBytes32) +
    encodeAddress(payee) +
    encodeUint256(amount);
}

function encodeDepositFor(agent: string, amount: bigint): string {
  return "0x" +
    keccak256Selector("depositFor(address,uint256)") +
    encodeAddress(agent) +
    encodeUint256(amount);
}

function encodeBalanceOf(account: string): string {
  return "0x" +
    keccak256Selector("balanceOf(address)") +
    encodeAddress(account);
}

function encodeAllowance(owner: string, spender: string): string {
  return "0x" +
    keccak256Selector("allowance(address,address)") +
    encodeAddress(owner) +
    encodeAddress(spender);
}

// ─── GigId → bytes32 (matches backend's Buffer.from(uuid.replace(/-/g,"")).toString("hex")) ──

export function gigIdToBytes32(gigId: string): string {
  const stripped = gigId.replace(/-/g, "");
  const hex = Array.from(stripped)
    .map(c => c.charCodeAt(0).toString(16).padStart(2, "0"))
    .join("")
    .padStart(64, "0");
  return "0x" + hex;
}

// ─── Parse units (6 decimals for USDC) ───────────────────────────────────────

export function parseUsdcUnits(amount: number): bigint {
  return BigInt(Math.round(amount * 1_000_000));
}

export function formatUsdcUnits(raw: bigint): number {
  return Number(raw) / 1_000_000;
}

// ─── Chain detection ──────────────────────────────────────────────────────────

export async function getWalletChainId(): Promise<number | null> {
  if (!window.ethereum) return null;
  try {
    const hex = await window.ethereum.request({ method: "eth_chainId" }) as string;
    return parseInt(hex, 16);
  } catch {
    return null;
  }
}

export async function switchToChain(chainKey: ChainKey): Promise<boolean> {
  if (!window.ethereum) return false;
  const targetId = CHAIN_IDS[chainKey];
  const hexId = "0x" + targetId.toString(16);
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexId }],
    });
    return true;
  } catch (err: any) {
    if (err?.code === 4902 && chainKey === "SKALE_TESTNET") {
      try {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: hexId,
            chainName: "SKALE Base Sepolia",
            nativeCurrency: { name: "sFUEL", symbol: "sFUEL", decimals: 18 },
            rpcUrls: [CHAIN_CONTRACTS.SKALE_TESTNET.rpc],
            blockExplorerUrls: [CHAIN_CONTRACTS.SKALE_TESTNET.explorer],
          }],
        });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

// ─── eth_call helper ──────────────────────────────────────────────────────────

async function ethCall(to: string, data: string): Promise<string> {
  if (!window.ethereum) throw new Error("No wallet");
  return await window.ethereum.request({
    method: "eth_call",
    params: [{ to, data }, "latest"],
  }) as string;
}

// ─── USDC balance + allowance ─────────────────────────────────────────────────

export async function getUSDCBalance(account: string, chainKey: ChainKey): Promise<number> {
  const usdc = CHAIN_CONTRACTS[chainKey].usdc;
  const result = await ethCall(usdc, encodeBalanceOf(account));
  const raw = BigInt(result || "0x0");
  return formatUsdcUnits(raw);
}

export async function getUSDCAllowance(
  owner: string,
  spender: string,
  chainKey: ChainKey,
): Promise<bigint> {
  const usdc = CHAIN_CONTRACTS[chainKey].usdc;
  const result = await ethCall(usdc, encodeAllowance(owner, spender));
  return BigInt(result || "0x0");
}

// ─── Tx wait helper ───────────────────────────────────────────────────────────

export async function waitForReceipt(
  txHash: string,
  pollMs = 2000,
  maxAttempts = 60,
): Promise<{ status: "success" | "reverted" }> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise(r => setTimeout(r, pollMs));
    try {
      const receipt = await window.ethereum!.request({
        method: "eth_getTransactionReceipt",
        params: [txHash],
      }) as { status: string } | null;
      if (receipt) {
        return { status: receipt.status === "0x1" ? "success" : "reverted" };
      }
    } catch {
      // keep polling
    }
  }
  throw new Error("Transaction receipt timeout");
}

// ─── Get connected accounts ───────────────────────────────────────────────────

export async function requestAccounts(): Promise<string[]> {
  if (!window.ethereum) throw new Error("No wallet found. Install MetaMask.");
  return await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
}

// ─── sendTransaction helper ───────────────────────────────────────────────────

async function sendTx(from: string, to: string, data: string): Promise<string> {
  if (!window.ethereum) throw new Error("No wallet");
  return await window.ethereum.request({
    method: "eth_sendTransaction",
    params: [{ from, to, data }],
  }) as string;
}

// ─── Escrow funding flow ──────────────────────────────────────────────────────

export interface EscrowFundingParams {
  gigId: string;
  payeeWallet: string;
  amountUsdc: number;
  chainKey: ChainKey;
}

export interface TxProgress {
  step: "idle" | "approving" | "approved" | "locking" | "done" | "error";
  approveTxHash?: string;
  lockTxHash?: string;
  error?: string;
}

export async function fundEscrowOnChain(
  params: EscrowFundingParams,
  onProgress: (p: TxProgress) => void,
): Promise<{ approveTxHash: string; lockTxHash: string }> {
  const { gigId, payeeWallet, amountUsdc, chainKey } = params;
  const contracts = CHAIN_CONTRACTS[chainKey];
  const amountRaw = parseUsdcUnits(amountUsdc);
  const gigBytes32 = gigIdToBytes32(gigId);

  const accounts = await requestAccounts();
  const account = accounts[0];

  onProgress({ step: "approving" });

  // Check existing allowance
  const currentAllowance = await getUSDCAllowance(account, contracts.escrow, chainKey);
  let approveTxHash = "";

  if (currentAllowance < amountRaw) {
    const approveData = encodeApprove(contracts.escrow, amountRaw);
    approveTxHash = await sendTx(account, contracts.usdc, approveData);
    onProgress({ step: "approving", approveTxHash });
    await waitForReceipt(approveTxHash);
  }

  onProgress({ step: "approved", approveTxHash });

  onProgress({ step: "locking", approveTxHash });
  const lockData = encodeLockUSDC(gigBytes32, payeeWallet, amountRaw);
  const lockTxHash = await sendTx(account, contracts.escrow, lockData);
  onProgress({ step: "locking", approveTxHash, lockTxHash });
  await waitForReceipt(lockTxHash);

  onProgress({ step: "done", approveTxHash, lockTxHash });
  return { approveTxHash, lockTxHash };
}

// ─── Bond deposit flow ────────────────────────────────────────────────────────

export interface BondDepositParams {
  agentWallet: string;
  amountUsdc: number;
  chainKey: ChainKey;
}

export async function depositBondOnChain(
  params: BondDepositParams,
  onProgress: (p: TxProgress) => void,
): Promise<{ approveTxHash: string; depositTxHash: string }> {
  const { agentWallet, amountUsdc, chainKey } = params;
  const contracts = CHAIN_CONTRACTS[chainKey];
  const amountRaw = parseUsdcUnits(amountUsdc);

  const accounts = await requestAccounts();
  const account = accounts[0];

  onProgress({ step: "approving" });

  const currentAllowance = await getUSDCAllowance(account, contracts.bond, chainKey);
  let approveTxHash = "";

  if (currentAllowance < amountRaw) {
    const approveData = encodeApprove(contracts.bond, amountRaw);
    approveTxHash = await sendTx(account, contracts.usdc, approveData);
    onProgress({ step: "approving", approveTxHash });
    await waitForReceipt(approveTxHash);
  }

  onProgress({ step: "approved", approveTxHash });

  onProgress({ step: "locking", approveTxHash });
  const depositData = encodeDepositFor(agentWallet, amountRaw);
  const depositTxHash = await sendTx(account, contracts.bond, depositData);
  onProgress({ step: "locking", approveTxHash, lockTxHash: depositTxHash });
  await waitForReceipt(depositTxHash);

  onProgress({ step: "done", approveTxHash, lockTxHash: depositTxHash });
  return { approveTxHash, depositTxHash };
}

// ─── Chain key from backend string ───────────────────────────────────────────

export function chainKeyFromBackend(chain: string | null | undefined): ChainKey {
  if (chain === "SKALE_TESTNET") return "SKALE_TESTNET";
  if (chain === "BASE_MAINNET")  return "BASE_MAINNET";
  return "BASE_SEPOLIA";
}

// ─── Explorer TX link ─────────────────────────────────────────────────────────

export function txExplorerUrl(txHash: string, chainKey: ChainKey): string {
  return `${CHAIN_CONTRACTS[chainKey].explorer}/tx/${txHash}`;
}
