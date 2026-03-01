import { readFileSync, writeFileSync } from "fs";

const ETHERS_PATH = new URL("../node_modules/ethers/dist/ethers.js", import.meta.url).pathname;
const { ethers } = await import(ETHERS_PATH);

const ARTIFACTS_DIR = new URL("../contracts/artifacts/contracts", import.meta.url).pathname;
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const REPUTATION_REGISTRY = "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63";
const BASE_TOKEN_URI = "https://clawtrust.org";
const PLATFORM_FEE_RATE = 250n;

function loadArtifact(sol, name) {
  const data = readFileSync(`${ARTIFACTS_DIR}/${sol}/${name}.json`, "utf8");
  const a = JSON.parse(data);
  return { abi: a.abi, bytecode: a.bytecode };
}

function normalizeKey(key) {
  if (!key) throw new Error("DEPLOYER_PRIVATE_KEY not set");
  return key.startsWith("0x") ? key : "0x" + key;
}

async function waitForTx(provider, hash, label) {
  console.log(`  tx: ${hash}`);
  for (let i = 0; i < 60; i++) {
    const receipt = await provider.getTransactionReceipt(hash);
    if (receipt) {
      if (receipt.status === 0) throw new Error(`${label} reverted`);
      return receipt;
    }
    await new Promise(r => setTimeout(r, 3000));
    if (i % 5 === 4) process.stdout.write(`  still waiting (${(i+1)*3}s)...\n`);
  }
  throw new Error(`${label} timed out after 180s`);
}

async function deployContract(wallet, provider, abi, bytecode, label, ...args) {
  console.log(`\n--- Deploying ${label} ---`);
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const deployTx = await factory.getDeployTransaction(...args);
  const nonce = await provider.getTransactionCount(wallet.address, "pending");
  const feeData = await provider.getFeeData();
  const gasEstimate = await provider.estimateGas({ ...deployTx, from: wallet.address });
  
  const tx = await wallet.sendTransaction({
    data: deployTx.data,
    nonce,
    gasLimit: gasEstimate * 12n / 10n,
    maxFeePerGas: feeData.maxFeePerGas * 2n,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas * 2n,
    chainId: 84532n,
  });
  
  console.log(`  sent: ${tx.hash}`);
  const receipt = await waitForTx(provider, tx.hash, label);
  console.log(`✅ ${label}: ${receipt.contractAddress} (block ${receipt.blockNumber})`);
  return {
    contract: new ethers.Contract(receipt.contractAddress, abi, wallet),
    addr: receipt.contractAddress,
  };
}

async function sendTx(wallet, provider, contract, method, args, label) {
  console.log(`[Config] ${label}...`);
  const tx = await contract[method](...args);
  const receipt = await waitForTx(provider, tx.hash, label);
  console.log(`✅ ${label} done (block ${receipt.blockNumber})`);
}

async function main() {
  const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");
  const wallet = new ethers.Wallet(normalizeKey(process.env.DEPLOYER_PRIVATE_KEY), provider);

  console.log("Deployer:", wallet.address);
  const bal = await provider.getBalance(wallet.address);
  console.log("Balance:", ethers.formatEther(bal), "ETH");
  if (bal === 0n) throw new Error("No ETH");

  const net = await provider.getNetwork();
  console.log("Network: chainId", net.chainId.toString());

  const addresses = {};

  // ── Phase 1: Deploy ──────────────────────────────────────────────

  console.log("\n=== Phase 1: Deploy All Contracts ===");

  const { abi: repABI, bytecode: repBC } = loadArtifact("ClawTrustRepAdapter.sol", "ClawTrustRepAdapter");
  const { contract: repAdapter, addr: repAddr } = await deployContract(wallet, provider, repABI, repBC, "ClawTrustRepAdapter", REPUTATION_REGISTRY);
  addresses.ClawTrustRepAdapter = repAddr;

  const { abi: swarmABI, bytecode: swarmBC } = loadArtifact("ClawTrustSwarmValidator.sol", "ClawTrustSwarmValidator");
  const { contract: swarmValidator, addr: swarmAddr } = await deployContract(wallet, provider, swarmABI, swarmBC, "ClawTrustSwarmValidator", wallet.address);
  addresses.ClawTrustSwarmValidator = swarmAddr;

  const { abi: escrowABI, bytecode: escrowBC } = loadArtifact("ClawTrustEscrow.sol", "ClawTrustEscrow");
  const { contract: escrow, addr: escrowAddr } = await deployContract(wallet, provider, escrowABI, escrowBC, "ClawTrustEscrow", USDC, swarmAddr, PLATFORM_FEE_RATE);
  addresses.ClawTrustEscrow = escrowAddr;

  const { abi: nftABI, bytecode: nftBC } = loadArtifact("ClawCardNFT.sol", "ClawCardNFT");
  const { contract: clawCardNFT, addr: nftAddr } = await deployContract(wallet, provider, nftABI, nftBC, "ClawCardNFT", BASE_TOKEN_URI);
  addresses.ClawCardNFT = nftAddr;

  const { abi: bondABI, bytecode: bondBC } = loadArtifact("ClawTrustBond.sol", "ClawTrustBond");
  const { contract: bond, addr: bondAddr } = await deployContract(wallet, provider, bondABI, bondBC, "ClawTrustBond", USDC);
  addresses.ClawTrustBond = bondAddr;

  const { abi: crewABI, bytecode: crewBC } = loadArtifact("ClawTrustCrew.sol", "ClawTrustCrew");
  const { addr: crewAddr } = await deployContract(wallet, provider, crewABI, crewBC, "ClawTrustCrew");
  addresses.ClawTrustCrew = crewAddr;

  // ── Phase 2: Configure ───────────────────────────────────────────

  console.log("\n=== Phase 2: Configure Contracts ===");

  await sendTx(wallet, provider, swarmValidator, "setEscrowContract", [escrowAddr], "SwarmValidator.setEscrowContract");
  await sendTx(wallet, provider, repAdapter, "authorizeOracle", [wallet.address], "RepAdapter.authorizeOracle");
  await sendTx(wallet, provider, bond, "authorizeCaller", [escrowAddr], "Bond.authorizeCaller");
  await sendTx(wallet, provider, escrow, "setTokenApproval", [USDC, true], "Escrow.setTokenApproval(USDC)");

  // ── Phase 3: x402 Facilitator ────────────────────────────────────

  console.log("\n=== Phase 3: x402 Facilitator ===");
  try {
    await sendTx(wallet, provider, escrow, "setX402Facilitator", [wallet.address], "Escrow.setX402Facilitator");
  } catch (e) {
    console.log("⚠️  setX402Facilitator:", e.message?.slice(0, 120));
  }

  // ── Save ─────────────────────────────────────────────────────────

  const deployment = {
    network: "baseSepolia",
    chainId: "84532",
    deployedAt: new Date().toISOString(),
    deployer: wallet.address,
    contracts: addresses,
    usdc: USDC,
  };

  const outPath = new URL("../contracts/deployments/baseSepolia/latest.json", import.meta.url).pathname;
  writeFileSync(outPath, JSON.stringify(deployment, null, 2));

  console.log("\n=== ✅ All Contracts Deployed ===");
  console.log(JSON.stringify(addresses, null, 2));
  console.log("\nSaved to contracts/deployments/baseSepolia/latest.json");
  console.log("\nNow run: node scripts/verify-on-basescan.mjs");
}

main().catch(err => {
  console.error("\n❌ DEPLOY FAILED:", err.message || err);
  process.exit(1);
});
