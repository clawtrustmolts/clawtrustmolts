import { publicClient, walletClient } from "./blockchain";
import { createWalletClient, http, parseAbi, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import fs from "fs";
import path from "path";

const CLAWTRUST_AC_ADDRESS = "0x1933D67CDB911653765e84758f47c60A1E868bC0" as Address;

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

export function getClawTrustACAddress(): string {
  return CLAWTRUST_AC_ADDRESS;
}

async function readContract(functionName: string, args: unknown[] = []): Promise<unknown> {
  const abi = loadAbi();
  return publicClient.readContract({
    address: CLAWTRUST_AC_ADDRESS,
    abi,
    functionName,
    args,
  } as Parameters<typeof publicClient.readContract>[0]);
}

async function writeContractAsOracle(functionName: string, args: unknown[]): Promise<string> {
  if (!walletClient) throw new Error("Oracle wallet not configured — DEPLOYER_PRIVATE_KEY required");
  const abi = loadAbi();
  const hash = await walletClient.writeContract({
    address: CLAWTRUST_AC_ADDRESS,
    abi,
    functionName,
    args,
  } as Parameters<typeof walletClient.writeContract>[0]);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  return receipt.transactionHash;
}

export async function getERC8183Stats() {
  try {
    const stats = await readContract("getStats") as [bigint, bigint, bigint, bigint];
    const jobCount = await readContract("jobCount") as bigint;
    return {
      totalJobsCreated: Number(stats[0]),
      totalJobsCompleted: Number(stats[1]),
      totalVolumeUSDC: Number(stats[2]) / 1e6,
      completionRate: Number(stats[3]),
      activeJobCount: Number(jobCount),
      contractAddress: CLAWTRUST_AC_ADDRESS,
      standard: "ERC-8183",
      chain: "base-sepolia",
      basescanUrl: `https://sepolia.basescan.org/address/${CLAWTRUST_AC_ADDRESS}`,
    };
  } catch (err: any) {
    console.error("[ERC8183] getStats error:", err.message);
    return {
      totalJobsCreated: 0,
      totalJobsCompleted: 0,
      totalVolumeUSDC: 0,
      completionRate: 0,
      activeJobCount: 0,
      contractAddress: CLAWTRUST_AC_ADDRESS,
      standard: "ERC-8183",
      chain: "base-sepolia",
      basescanUrl: `https://sepolia.basescan.org/address/${CLAWTRUST_AC_ADDRESS}`,
    };
  }
}

export async function getERC8183Job(jobId: string) {
  const rawJobId = jobId.startsWith("0x") ? jobId : `0x${jobId}`;
  const raw = await readContract("getJob", [rawJobId as `0x${string}`]) as any[];

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
    basescanUrl: `https://sepolia.basescan.org/address/${CLAWTRUST_AC_ADDRESS}`,
  };
}

export async function getJobLogs() {
  const abi = loadAbi();
  try {
    const logs = await publicClient.getLogs({
      address: CLAWTRUST_AC_ADDRESS,
      fromBlock: "earliest",
      toBlock: "latest",
    });
    return logs;
  } catch {
    return [];
  }
}

export async function oracleCompleteJob(jobId: string, reasonHex: string): Promise<string> {
  const rawJobId = jobId.startsWith("0x") ? jobId : `0x${jobId}`;
  const rawReason = reasonHex.startsWith("0x") ? reasonHex : `0x${reasonHex}`;
  return writeContractAsOracle("complete", [rawJobId as `0x${string}`, rawReason as `0x${string}`]);
}

export async function oracleRejectJob(jobId: string, reasonHex: string): Promise<string> {
  const rawJobId = jobId.startsWith("0x") ? jobId : `0x${jobId}`;
  const rawReason = reasonHex.startsWith("0x") ? reasonHex : `0x${reasonHex}`;
  return writeContractAsOracle("reject", [rawJobId as `0x${string}`, rawReason as `0x${string}`]);
}

export async function isRegisteredAgent(wallet: string): Promise<boolean> {
  try {
    return await readContract("isRegisteredAgent", [wallet as Address]) as boolean;
  } catch {
    return false;
  }
}
