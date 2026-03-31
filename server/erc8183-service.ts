import { publicClient, walletClient } from "./blockchain";
import { createPublicClient, createWalletClient, http, parseAbi, type Address, type Chain } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import fs from "fs";
import path from "path";

export type ERC8183Chain = "BASE_SEPOLIA" | "SKALE_TESTNET";

export function toERC8183Chain(value: string | null | undefined): ERC8183Chain {
  return value === "SKALE_TESTNET" ? "SKALE_TESTNET" : "BASE_SEPOLIA";
}

const CLAWTRUST_AC_BASE = "0x1933D67CDB911653765e84758f47c60A1E868bC0" as Address;
const CLAWTRUST_AC_SKALE = "0x101F37D9bf445E92A237F8721CA7D12205D61Fe6" as Address;

const SKALE_RPC = "https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha";
const skaleChainDef = {
  id: 324705682,
  name: "SKALE Base Sepolia",
  nativeCurrency: { name: "sFUEL", symbol: "sFUEL", decimals: 18 },
  rpcUrls: { default: { http: [SKALE_RPC] }, public: { http: [SKALE_RPC] } },
} as const;

const skalePublicClient = createPublicClient({
  chain: skaleChainDef as Chain,
  transport: http(SKALE_RPC, { timeout: 15_000, retryCount: 2, retryDelay: 1500 }),
});

function buildSkaleWalletClient() {
  const raw = process.env.DEPLOYER_PRIVATE_KEY;
  if (!raw || raw.trim() === "") return null;
  try {
    const pk = (raw.trim().startsWith("0x") ? raw.trim() : `0x${raw.trim()}`) as `0x${string}`;
    const account = privateKeyToAccount(pk);
    return createWalletClient({
      account,
      chain: skaleChainDef as Chain,
      transport: http(SKALE_RPC, { timeout: 15_000, retryCount: 2, retryDelay: 1500 }),
    });
  } catch {
    return null;
  }
}

const skaleWalletClient = buildSkaleWalletClient();

function getChainClients(chain?: ERC8183Chain) {
  if (chain === "SKALE_TESTNET") {
    return {
      address: CLAWTRUST_AC_SKALE,
      pubClient: skalePublicClient,
      walClient: skaleWalletClient,
    };
  }
  return {
    address: CLAWTRUST_AC_BASE,
    pubClient: publicClient,
    walClient: walletClient,
  };
}

function loadAbi() {
  const artifactPath = path.join(process.cwd(), "contracts/artifacts/contracts/ClawTrustAC.sol/ClawTrustAC.json");
  if (!fs.existsSync(artifactPath)) {
    console.warn("[ERC8183] ClawTrustAC artifact not found, using embedded ABI");
    return FALLBACK_ABI;
  }
  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  return artifact.abi;
}

const FALLBACK_ABI = parseAbi([
  "function createJob(string description, uint256 budget, uint256 durationSeconds) returns (bytes32 jobId)",
  "function fund(bytes32 jobId)",
  "function assignProvider(bytes32 jobId, address provider)",
  "function submit(bytes32 jobId, bytes32 deliverableHash)",
  "function complete(bytes32 jobId, bytes32 reason)",
  "function reject(bytes32 jobId, bytes32 reason)",
  "function cancel(bytes32 jobId)",
  "function expireJob(bytes32 jobId)",
  "function getJobStatus(bytes32 jobId) view returns (uint8)",
  "function getJob(bytes32 jobId) view returns (address client, address provider, address evaluator, uint256 budget, uint256 expiredAt, uint8 status, string description, bytes32 deliverableHash, bytes32 outcomeReason, uint256 createdAt)",
  "function jobCount() view returns (uint256)",
  "function getStats() view returns (uint256 created, uint256 completed, uint256 volumeUSDC, uint256 completionRate)",
  "function isRegisteredAgent(address wallet) view returns (bool)",
  "event JobCreated(bytes32 indexed jobId, address indexed client, uint256 budget, uint256 expiredAt)",
  "event JobFunded(bytes32 indexed jobId, address indexed client, uint256 amount)",
  "event JobProviderAssigned(bytes32 indexed jobId, address indexed provider)",
  "event JobSubmitted(bytes32 indexed jobId, address indexed provider, bytes32 deliverableHash)",
  "event JobCompleted(bytes32 indexed jobId, address indexed provider, bytes32 reason)",
  "event JobRejected(bytes32 indexed jobId, address indexed client, bytes32 reason)",
  "event JobCancelled(bytes32 indexed jobId, address indexed client)",
  "event JobExpired(bytes32 indexed jobId)",
]);

const STATUS_LABELS = ["Open", "Funded", "Submitted", "Completed", "Rejected", "Cancelled", "Expired"];

export function getClawTrustACAddress(chain?: ERC8183Chain): string {
  return chain === "SKALE_TESTNET" ? CLAWTRUST_AC_SKALE : CLAWTRUST_AC_BASE;
}

export function getExplorerUrl(chain?: ERC8183Chain): string {
  if (chain === "SKALE_TESTNET") return "https://base-sepolia-testnet-explorer.skalenodes.com";
  return "https://sepolia.basescan.org";
}

async function readChainContract(functionName: string, args: unknown[] = [], chain?: ERC8183Chain): Promise<unknown> {
  const { address, pubClient } = getChainClients(chain);
  const abi = loadAbi();
  return pubClient.readContract({
    address,
    abi,
    functionName,
    args,
  } as Parameters<typeof pubClient.readContract>[0]);
}

const SKALE_CHAIN_NAME = "jubilant-horrible-ancha";
const SFUEL_FAUCET_URL = "https://sfuel.skale.network/api";
const SFUEL_LOW_THRESHOLD = BigInt("1000000000000000"); // 0.001 sFUEL

export async function getSkaleOracleFuelBalance(): Promise<{ raw: bigint; ether: number }> {
  const address = skaleWalletClient?.account?.address as Address | undefined;
  if (!address) return { raw: 0n, ether: 0 };
  try {
    const raw = await skalePublicClient.getBalance({ address });
    return { raw, ether: Number(raw) / 1e18 };
  } catch {
    return { raw: 0n, ether: 0 };
  }
}

export async function topUpSkaleFuel(targetAddress: string): Promise<{ success: boolean; message: string }> {
  try {
    const resp = await fetch(SFUEL_FAUCET_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: targetAddress, schainName: SKALE_CHAIN_NAME }),
      signal: AbortSignal.timeout(15_000),
    });
    if (resp.ok) {
      const body = await resp.json().catch(() => ({})) as any;
      console.log(`[sFUEL] Auto-funded oracle ${targetAddress} — response:`, body);
      return { success: true, message: `sFUEL distributed to ${targetAddress}` };
    }
    const text = await resp.text().catch(() => resp.statusText);
    console.warn(`[sFUEL] Faucet responded ${resp.status}: ${text.slice(0, 200)}`);
    return { success: false, message: `Faucet returned ${resp.status}: ${text.slice(0, 100)}` };
  } catch (err: any) {
    console.warn("[sFUEL] Faucet request failed:", err.message?.slice(0, 200));
    return { success: false, message: `Faucet request failed: ${err.message?.slice(0, 100)}` };
  }
}

async function assertSkaleOracleFunded(oracleAddress: Address): Promise<void> {
  const balance = await skalePublicClient.getBalance({ address: oracleAddress });
  if (balance > 0n) return; // funded — proceed

  // Balance is 0: attempt auto-top-up from the SKALE sFUEL faucet
  console.warn(`[sFUEL] Oracle ${oracleAddress} has 0 sFUEL — attempting auto-fund via SKALE faucet...`);
  const result = await topUpSkaleFuel(oracleAddress);
  if (!result.success) {
    throw new Error(
      `SKALE oracle wallet has 0 sFUEL and auto-funding failed (${result.message}). ` +
      `Fund manually at https://sfuel.skale.network/ for address: ${oracleAddress}`
    );
  }

  // Give the faucet tx a moment to land, then re-check
  await new Promise(r => setTimeout(r, 3_000));
  const recheck = await skalePublicClient.getBalance({ address: oracleAddress });
  if (recheck === 0n) {
    throw new Error(
      `SKALE oracle wallet still has 0 sFUEL after auto-fund attempt. ` +
      `Fund manually at https://sfuel.skale.network/ for address: ${oracleAddress}`
    );
  }
  console.log(`[sFUEL] Auto-fund succeeded — oracle ${oracleAddress} balance: ${Number(recheck) / 1e18} sFUEL`);
}

export async function checkAndTopUpSkaleFuel(): Promise<{ wasFunded: boolean; balanceEther: number; message: string }> {
  const address = skaleWalletClient?.account?.address as Address | undefined;
  if (!address) return { wasFunded: false, balanceEther: 0, message: "Oracle wallet not configured" };

  const { raw, ether } = await getSkaleOracleFuelBalance();

  if (raw > SFUEL_LOW_THRESHOLD) {
    return { wasFunded: false, balanceEther: ether, message: `sFUEL OK (${ether.toFixed(6)} sFUEL)` };
  }

  console.warn(`[sFUEL] Oracle sFUEL low (${ether.toFixed(6)}) — auto-topping up...`);
  const result = await topUpSkaleFuel(address);
  if (result.success) {
    await new Promise(r => setTimeout(r, 3_000));
    const { ether: newEther } = await getSkaleOracleFuelBalance();
    return { wasFunded: true, balanceEther: newEther, message: `Auto-funded. New balance: ${newEther.toFixed(6)} sFUEL` };
  }
  return { wasFunded: false, balanceEther: ether, message: `Auto-fund failed: ${result.message}` };
}

export async function forceTopUpSkaleFuel(): Promise<{ success: boolean; balanceEther: number; message: string }> {
  const address = skaleWalletClient?.account?.address as Address | undefined;
  if (!address) return { success: false, balanceEther: 0, message: "Oracle wallet not configured" };

  const result = await topUpSkaleFuel(address);
  await new Promise(r => setTimeout(r, 3_000));
  const { ether } = await getSkaleOracleFuelBalance();
  return {
    success: result.success,
    balanceEther: ether,
    message: result.success
      ? `Force-funded. New balance: ${ether.toFixed(6)} sFUEL`
      : `Force-fund failed: ${result.message}`,
  };
}

async function writeContractAsOracle(functionName: string, args: unknown[], chain?: ERC8183Chain): Promise<string> {
  const { address, pubClient, walClient } = getChainClients(chain);
  if (!walClient) throw new Error(`Oracle wallet not configured for chain ${chain ?? "BASE_SEPOLIA"} — DEPLOYER_PRIVATE_KEY required`);
  if (chain === "SKALE_TESTNET" && walClient.account) {
    await assertSkaleOracleFunded(walClient.account.address as Address);
  }
  const abi = loadAbi();
  const hash = await walClient.writeContract({
    address,
    abi,
    functionName,
    args,
  } as Parameters<typeof walClient.writeContract>[0]);
  const receipt = await pubClient.waitForTransactionReceipt({ hash });
  return receipt.transactionHash;
}

export async function getERC8183Stats(chain?: ERC8183Chain) {
  const contractAddress = getChainClients(chain).address;
  const explorerBase = getExplorerUrl(chain);
  try {
    const stats = await readChainContract("getStats", [], chain) as [bigint, bigint, bigint, bigint];
    const jobCount = await readChainContract("jobCount", [], chain) as bigint;
    return {
      totalJobsCreated: Number(stats[0]),
      totalJobsCompleted: Number(stats[1]),
      totalVolumeUSDC: Number(stats[2]) / 1e6,
      completionRate: Number(stats[3]),
      activeJobCount: Number(jobCount),
      contractAddress,
      standard: "ERC-8183",
      chain: chain === "SKALE_TESTNET" ? "skale-base-sepolia" : "base-sepolia",
      basescanUrl: `${explorerBase}/address/${contractAddress}`,
    };
  } catch (err: any) {
    console.error("[ERC8183] getStats error:", err.message);
    return {
      totalJobsCreated: 0,
      totalJobsCompleted: 0,
      totalVolumeUSDC: 0,
      completionRate: 0,
      activeJobCount: 0,
      contractAddress,
      standard: "ERC-8183",
      chain: chain === "SKALE_TESTNET" ? "skale-base-sepolia" : "base-sepolia",
      basescanUrl: `${explorerBase}/address/${contractAddress}`,
    };
  }
}

export async function getERC8183Job(jobId: string, chain?: ERC8183Chain) {
  const contractAddress = getChainClients(chain).address;
  const explorerBase = getExplorerUrl(chain);
  const rawJobId = jobId.startsWith("0x") ? jobId : `0x${jobId}`;
  type RawJob = [string, string, string, bigint, bigint, bigint, string, `0x${string}`, `0x${string}`, bigint];
  const raw = await readChainContract("getJob", [rawJobId as `0x${string}`], chain) as RawJob;

  const statusIndex = Number(raw[5]);
  return {
    jobId: rawJobId,
    client: raw[0] as string,
    provider: raw[1] as string,
    evaluator: raw[2] as string,
    budget: Number(raw[3]) / 1e6,
    budgetRaw: raw[3].toString(),
    expiredAt: new Date(Number(raw[4]) * 1000).toISOString(),
    expiredAtTs: Number(raw[4]),
    status: STATUS_LABELS[statusIndex] ?? "Unknown",
    statusIndex,
    description: raw[6] as string,
    deliverableHash: raw[7] as string,
    outcomeReason: raw[8] as string,
    createdAt: new Date(Number(raw[9]) * 1000).toISOString(),
    createdAtTs: Number(raw[9]),
    basescanUrl: `${explorerBase}/address/${contractAddress}`,
  };
}

export async function getJobLogs(chain?: ERC8183Chain) {
  const { address, pubClient } = getChainClients(chain);
  try {
    const logs = await pubClient.getLogs({
      address,
      fromBlock: "earliest",
      toBlock: "latest",
    });
    return logs;
  } catch {
    return [];
  }
}

export async function oracleCompleteJob(jobId: string, reasonHex: string, chain?: ERC8183Chain): Promise<string> {
  const rawJobId = jobId.startsWith("0x") ? jobId : `0x${jobId}`;
  const rawReason = reasonHex.startsWith("0x") ? reasonHex : `0x${reasonHex}`;
  return writeContractAsOracle("complete", [rawJobId as `0x${string}`, rawReason as `0x${string}`], chain);
}

export async function oracleRejectJob(jobId: string, reasonHex: string, chain?: ERC8183Chain): Promise<string> {
  const rawJobId = jobId.startsWith("0x") ? jobId : `0x${jobId}`;
  const rawReason = reasonHex.startsWith("0x") ? reasonHex : `0x${reasonHex}`;
  return writeContractAsOracle("reject", [rawJobId as `0x${string}`, rawReason as `0x${string}`], chain);
}

export async function isRegisteredAgent(wallet: string, chain?: ERC8183Chain): Promise<boolean> {
  try {
    return await readChainContract("isRegisteredAgent", [wallet as Address], chain) as boolean;
  } catch {
    return false;
  }
}

export async function oracleCreateJob(
  description: string,
  budgetUsdc: number,
  deadlineHours: number,
  chain?: ERC8183Chain
): Promise<{ jobId: string; txHash: string }> {
  const { address, pubClient, walClient } = getChainClients(chain);
  const budgetRaw = BigInt(Math.round(budgetUsdc * 1e6));
  const durationSecs = BigInt(deadlineHours * 3600);
  if (!walClient) throw new Error("Oracle wallet not configured");
  if (chain === "SKALE_TESTNET" && walClient.account) {
    await assertSkaleOracleFunded(walClient.account.address as Address);
  }
  const abi = loadAbi();
  const hash = await walClient.writeContract({
    address,
    abi,
    functionName: "createJob",
    args: [description, budgetRaw, durationSecs],
  } as Parameters<typeof walClient.writeContract>[0]);
  const receipt = await pubClient.waitForTransactionReceipt({ hash });
  const jobIdLog = receipt.logs.find((l) => l.topics.length > 1);
  const jobId = jobIdLog?.topics[1] ?? `0x${Date.now().toString(16).padStart(64, "0")}`;
  return { jobId: jobId as string, txHash: receipt.transactionHash };
}

export async function oracleFundJob(jobId: string, chain?: ERC8183Chain): Promise<string> {
  const rawJobId = jobId.startsWith("0x") ? jobId : `0x${jobId}`;
  return writeContractAsOracle("fund", [rawJobId as `0x${string}`], chain);
}

export async function oracleAssignProvider(jobId: string, providerWallet: string, chain?: ERC8183Chain): Promise<string> {
  const rawJobId = jobId.startsWith("0x") ? jobId : `0x${jobId}`;
  return writeContractAsOracle("assignProvider", [rawJobId as `0x${string}`, providerWallet as Address], chain);
}

export async function oracleSubmitDeliverable(jobId: string, deliverableHash: string, chain?: ERC8183Chain): Promise<string> {
  const rawJobId = jobId.startsWith("0x") ? jobId : `0x${jobId}`;
  const rawHash = deliverableHash.startsWith("0x")
    ? deliverableHash
    : `0x${Buffer.from(deliverableHash).toString("hex").slice(0, 64).padEnd(64, "0")}`;
  return writeContractAsOracle("submit", [rawJobId as `0x${string}`, rawHash as `0x${string}`], chain);
}

export async function oracleCancelJob(jobId: string, chain?: ERC8183Chain): Promise<string> {
  const rawJobId = jobId.startsWith("0x") ? jobId : `0x${jobId}`;
  return writeContractAsOracle("cancel", [rawJobId as `0x${string}`], chain);
}

export function textToBytes32(text: string): `0x${string}` {
  const hex = Buffer.from(text.slice(0, 31), "utf8").toString("hex").padEnd(64, "0");
  return `0x${hex}`;
}
