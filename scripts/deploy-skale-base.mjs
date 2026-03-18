import { readFileSync, writeFileSync, mkdirSync } from "fs";

const ETHERS_PATH = new URL("../node_modules/ethers/dist/ethers.js", import.meta.url).pathname;
const { ethers } = await import(ETHERS_PATH);

const ARTIFACTS_DIR = new URL("../contracts/artifacts/contracts", import.meta.url).pathname;

const SKALE_RPC   = "https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha";
const CHAIN_ID    = 324705682n;
const USDC        = "0x2e08028E3C4c2356572E096d8EF835cD5C6030bD";
const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";
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
  for (let i = 0; i < 90; i++) {
    const receipt = await provider.getTransactionReceipt(hash);
    if (receipt) {
      if (receipt.status === 0) throw new Error(`${label} reverted`);
      return receipt;
    }
    await new Promise(r => setTimeout(r, 2000));
    if (i % 10 === 9) process.stdout.write(`  still waiting (${(i+1)*2}s)...\n`);
  }
  throw new Error(`${label} timed out after 180s`);
}

async function getSkaleGasPrice(provider) {
  try {
    const raw = await provider.send("eth_gasPrice", []);
    const price = BigInt(raw);
    return price > 0n ? price : 100000n;
  } catch {
    return 100000n;
  }
}

async function deployContract(wallet, provider, abi, bytecode, label, ...args) {
  console.log(`\n--- Deploying ${label} ---`);
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const deployTx = await factory.getDeployTransaction(...args);
  const nonce = await provider.getTransactionCount(wallet.address, "pending");
  const gasPrice = await getSkaleGasPrice(provider);

  let gasLimit;
  try {
    const est = await provider.estimateGas({ ...deployTx, from: wallet.address });
    gasLimit = est * 13n / 10n;
  } catch {
    gasLimit = 5000000n;
  }

  const tx = await wallet.sendTransaction({
    data: deployTx.data,
    nonce,
    gasLimit,
    gasPrice,
    chainId: CHAIN_ID,
    type: 0,
  });

  console.log(`  sent: ${tx.hash}`);
  const receipt = await waitForTx(provider, tx.hash, label);
  console.log(`✅ ${label}: ${receipt.contractAddress} (block ${receipt.blockNumber})`);
  return {
    contract: new ethers.Contract(receipt.contractAddress, abi, wallet),
    addr: receipt.contractAddress,
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
  };
}

async function sendTx(wallet, provider, contract, method, args, label) {
  console.log(`[Config] ${label}...`);
  const gasPrice = await getSkaleGasPrice(provider);
  const nonce = await provider.getTransactionCount(wallet.address, "pending");
  const txReq = await contract[method].populateTransaction(...args);
  let gasLimit;
  try {
    gasLimit = (await provider.estimateGas({ ...txReq, from: wallet.address })) * 13n / 10n;
  } catch {
    gasLimit = 500000n;
  }
  const tx = await wallet.sendTransaction({ ...txReq, gasPrice, gasLimit, nonce, type: 0 });
  const receipt = await waitForTx(provider, tx.hash, label);
  console.log(`✅ ${label} done (block ${receipt.blockNumber}) tx=${tx.hash}`);
  return tx.hash;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(SKALE_RPC);
  const wallet = new ethers.Wallet(normalizeKey(process.env.DEPLOYER_PRIVATE_KEY), provider);

  console.log("=== ClawTrust SKALE Base Sepolia Deployment ===");
  console.log("Deployer:", wallet.address);
  const bal = await provider.getBalance(wallet.address);
  console.log("Balance:", ethers.formatEther(bal), "sFUEL/CREDIT");

  const net = await provider.getNetwork();
  console.log("Network: chainId", net.chainId.toString());
  if (net.chainId !== CHAIN_ID) {
    throw new Error(`Wrong network! Expected ${CHAIN_ID}, got ${net.chainId}`);
  }

  const addresses = {};
  const txHashes = {};

  console.log("\n=== Phase 1: Deploy 8 Contracts ===");

  const { abi: nftABI, bytecode: nftBC } = loadArtifact("ClawCardNFT.sol", "ClawCardNFT");
  const { contract: clawCard, addr: nftAddr, txHash: nftTx } = await deployContract(
    wallet, provider, nftABI, nftBC, "ClawCardNFT", BASE_TOKEN_URI
  );
  addresses.ClawCardNFT = nftAddr;
  txHashes.ClawCardNFT = nftTx;

  const { abi: repABI, bytecode: repBC } = loadArtifact("ClawTrustRepAdapter.sol", "ClawTrustRepAdapter");
  const { contract: repAdapter, addr: repAddr, txHash: repTx } = await deployContract(
    wallet, provider, repABI, repBC, "ClawTrustRepAdapter", IDENTITY_REGISTRY
  );
  addresses.ClawTrustRepAdapter = repAddr;
  txHashes.ClawTrustRepAdapter = repTx;

  const { abi: bondABI, bytecode: bondBC } = loadArtifact("ClawTrustBond.sol", "ClawTrustBond");
  const { contract: bond, addr: bondAddr, txHash: bondTx } = await deployContract(
    wallet, provider, bondABI, bondBC, "ClawTrustBond", USDC
  );
  addresses.ClawTrustBond = bondAddr;
  txHashes.ClawTrustBond = bondTx;

  // SwarmValidator must have a non-zero escrow address in constructor (zero-address check).
  // Deploy with deployer EOA as placeholder; wire real Escrow via setEscrowContract after.
  const { abi: swarmABI, bytecode: swarmBC } = loadArtifact("ClawTrustSwarmValidator.sol", "ClawTrustSwarmValidator");
  const { contract: swarmValidator, addr: swarmAddr, txHash: swarmTx } = await deployContract(
    wallet, provider, swarmABI, swarmBC, "ClawTrustSwarmValidator", wallet.address
  );
  addresses.ClawTrustSwarmValidator = swarmAddr;
  txHashes.ClawTrustSwarmValidator = swarmTx;

  // Escrow takes swarmValidator as _validationRegistry (also non-zero check)
  const { abi: escrowABI, bytecode: escrowBC } = loadArtifact("ClawTrustEscrow.sol", "ClawTrustEscrow");
  const { contract: escrow, addr: escrowAddr, txHash: escrowTx } = await deployContract(
    wallet, provider, escrowABI, escrowBC, "ClawTrustEscrow",
    USDC, swarmAddr, PLATFORM_FEE_RATE, IDENTITY_REGISTRY, wallet.address
  );
  addresses.ClawTrustEscrow = escrowAddr;
  txHashes.ClawTrustEscrow = escrowTx;

  const { abi: crewABI, bytecode: crewBC } = loadArtifact("ClawTrustCrew.sol", "ClawTrustCrew");
  const { addr: crewAddr, txHash: crewTx } = await deployContract(
    wallet, provider, crewABI, crewBC, "ClawTrustCrew"
  );
  addresses.ClawTrustCrew = crewAddr;
  txHashes.ClawTrustCrew = crewTx;

  const { abi: regABI, bytecode: regBC } = loadArtifact("ClawTrustRegistry.sol", "ClawTrustRegistry");
  const { addr: registryAddr, txHash: registryTx } = await deployContract(
    wallet, provider, regABI, regBC, "ClawTrustRegistry"
  );
  addresses.ClawTrustRegistry = registryAddr;
  txHashes.ClawTrustRegistry = registryTx;

  const { abi: acABI, bytecode: acBC } = loadArtifact("ClawTrustAC.sol", "ClawTrustAC");
  const { addr: acAddr, txHash: acTx } = await deployContract(
    wallet, provider, acABI, acBC, "ClawTrustAC",
    nftAddr, repAddr, bondAddr, USDC, wallet.address, wallet.address
  );
  addresses.ClawTrustAC = acAddr;
  txHashes.ClawTrustAC = acTx;

  console.log("\n=== Phase 2: Post-Deploy Config ===");

  await sendTx(wallet, provider, swarmValidator, "setEscrowContract", [escrowAddr], "SwarmValidator.setEscrowContract");

  try {
    await sendTx(wallet, provider, repAdapter, "authorizeOracle", [wallet.address], "RepAdapter.authorizeOracle");
  } catch (e) {
    console.log("⚠️  authorizeOracle:", e.message?.slice(0, 80));
  }

  try {
    await sendTx(wallet, provider, bond, "authorizeCaller", [escrowAddr], "Bond.authorizeCaller");
  } catch (e) {
    console.log("⚠️  authorizeCaller:", e.message?.slice(0, 80));
  }

  console.log("\n=== Phase 3: Save Results ===");

  const deployment = {
    network: "skalBaseSepolia",
    chainId: "324705682",
    rpc: SKALE_RPC,
    explorer: "https://base-sepolia-testnet-explorer.skalenodes.com",
    deployedAt: new Date().toISOString(),
    deployer: wallet.address,
    usdc: USDC,
    erc8004Registry: IDENTITY_REGISTRY,
    contracts: addresses,
    txHashes,
  };

  mkdirSync(new URL("../deployments", import.meta.url).pathname, { recursive: true });
  const outPath = new URL("../deployments/skale-base-sepolia.json", import.meta.url).pathname;
  writeFileSync(outPath, JSON.stringify(deployment, null, 2));

  console.log("\n=== ✅ All 8 Contracts Deployed to SKALE Base Sepolia ===");
  console.log("\nAddresses:");
  for (const [name, addr] of Object.entries(addresses)) {
    console.log(`  ${name.padEnd(24)}: ${addr}`);
  }
  console.log("\nSaved to deployments/skale-base-sepolia.json");

  console.log("\n=== SUMMARY ===");
  console.log("Chain: SKALE Base Sepolia (324705682)");
  console.log("Deployer:", wallet.address);
  console.log("Explorer: https://base-sepolia-testnet-explorer.skalenodes.com");
  console.log("Files to update: server/skale-chain.ts, client/src/lib/chains.ts, client/src/pages/contracts.tsx, SKILL.md, clawhub.json");
  console.log("READY: YES");
}

main().catch(err => {
  console.error("\n❌ DEPLOY FAILED:", err.message || err);
  process.exit(1);
});
