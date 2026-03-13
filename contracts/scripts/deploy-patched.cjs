const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function pendingNonce(provider, address) {
  return provider.getTransactionCount(address, "pending");
}

let currentNonce = null;

async function initNonce(provider, address) {
  currentNonce = await provider.getTransactionCount(address, "pending");
  console.log("Starting nonce:", currentNonce);
}

async function deployContract(factory, args = []) {
  const tx = await factory.deploy(...args, { nonce: currentNonce });
  currentNonce++;
  await tx.waitForDeployment();
  return tx;
}

async function sendTx(contract, method, args = []) {
  const tx = await contract[method](...args, { nonce: currentNonce });
  currentNonce++;
  return tx.wait();
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  const provider = hre.ethers.provider;

  console.log("Deployer:", deployer.address);
  console.log("Network: baseSepolia | Chain ID:", network.chainId.toString());

  const bal = await provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(bal), "ETH\n");

  if (bal === 0n) {
    console.error("ERROR: Deployer has no ETH. Fund the account first.");
    process.exit(1);
  }

  await initNonce(provider, deployer.address);

  const usdcToken = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const feeRate = 250;

  const deployed = {};

  console.log("=== Deploying patched contracts (Task #11) ===\n");

  deployed.swarmValidator = "0xfb8dad4D2a2Dd0c24E706d692767547B69d90cD4";
  console.log("--- 1. ClawTrustSwarmValidator (already deployed) ---");
  console.log("ClawTrustSwarmValidator:", deployed.swarmValidator);
  const swarm = await hre.ethers.getContractAt("ClawTrustSwarmValidator", deployed.swarmValidator, deployer);

  console.log("\n--- 2. Deploying ClawTrustEscrow (patched: dispute whenNotPaused) ---");
  const EscrowF = await hre.ethers.getContractFactory("ClawTrustEscrow");
  const escrow = await deployContract(EscrowF, [usdcToken, deployed.swarmValidator, feeRate]);
  deployed.escrow = await escrow.getAddress();
  console.log("ClawTrustEscrow:", deployed.escrow);

  console.log("\n--- 3. Deploying ClawTrustRegistry (patched: abi.encode in _domainKey) ---");
  const RegistryF = await hre.ethers.getContractFactory("ClawTrustRegistry");
  const registry = await deployContract(RegistryF, []);
  deployed.registry = await registry.getAddress();
  console.log("ClawTrustRegistry:", deployed.registry);

  console.log("\n=== Wiring contracts ===");

  console.log("[SwarmValidator] Setting escrow:", deployed.escrow);
  await sendTx(swarm, "setEscrowContract", [deployed.escrow]);

  console.log("\n=== Running on-chain smoke tests ===\n");

  try {
    console.log("[Registry] Registering smoketest.claw...");
    const tx = await registry.register("smoketest", ".claw", deployer.address, 0);
    const receipt = await tx.wait();
    console.log("[Registry] Registered smoketest.claw, tx:", receipt.hash);

    const resolvedOwner = await registry.resolve("smoketest", ".claw");
    console.log("[Registry] Resolved smoketest.claw =>", resolvedOwner);
    if (resolvedOwner.toLowerCase() !== deployer.address.toLowerCase()) {
      console.error("[Registry] ERROR: resolve returned wrong owner!");
    } else {
      console.log("[Registry] Resolve OK");
    }

    const avail = await registry.isAvailable("smoketest", ".claw");
    console.log("[Registry] isAvailable(smoketest, .claw):", avail, "(expected false)");

    const tokenURI = await registry.tokenURI(1);
    console.log("[Registry] tokenURI(1) length:", tokenURI.length, "(expected > 50)");
  } catch (err) {
    console.warn("[Registry] Smoke test failed:", err.message?.substring(0, 300));
  }

  try {
    console.log("\n[Escrow] Checking immutable references...");
    const escrowUsdc = await escrow.usdc();
    const escrowValidation = await escrow.validationRegistry();
    console.log("[Escrow] usdc:", escrowUsdc);
    console.log("[Escrow] validationRegistry:", escrowValidation);
    console.log("[Escrow] platformFeeRate:", (await escrow.platformFeeRate()).toString());
  } catch (err) {
    console.warn("[Escrow] Smoke test failed:", err.message?.substring(0, 300));
  }

  try {
    console.log("\n[SwarmValidator] Checking config...");
    const svEscrow = await swarm.escrowContract();
    console.log("[SwarmValidator] escrowContract:", svEscrow);
    console.log("[SwarmValidator] defaultThreshold:", (await swarm.defaultThreshold()).toString());
    console.log("[SwarmValidator] SWEEP_CLAIM_WINDOW:", (await swarm.SWEEP_CLAIM_WINDOW()).toString(), "seconds");
  } catch (err) {
    console.warn("[SwarmValidator] Smoke test failed:", err.message?.substring(0, 300));
  }

  const dir = path.join(__dirname, "../deployments/baseSepolia");
  fs.mkdirSync(dir, { recursive: true });

  const patchedInfo = {
    network: "baseSepolia",
    chainId: "84532",
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    task: "Task #11 — Patched contracts redeployment",
    patches: [
      "H-01: ClawTrustRegistry abi.encode fix",
      "M-01: ClawTrustEscrow dispute() whenNotPaused",
      "M-02: ClawTrustSwarmValidator Pausable + whenNotPaused",
      "M-03: ClawTrustSwarmValidator SWEEP_CLAIM_WINDOW = 14 days",
      "M-04: ClawTrustSwarmValidator removed dead _expireValidation in vote()",
      "M-05: ClawTrustSwarmValidator escrowSnapshot per-validation"
    ],
    contracts: {
      ClawTrustSwarmValidator: deployed.swarmValidator,
      ClawTrustEscrow: deployed.escrow,
      ClawTrustRegistry: deployed.registry,
    },
  };
  fs.writeFileSync(path.join(dir, "patched-deployment.json"), JSON.stringify(patchedInfo, null, 2));

  let existingAddresses = {};
  const addressesFile = path.join(dir, "addresses.json");
  if (fs.existsSync(addressesFile)) {
    existingAddresses = JSON.parse(fs.readFileSync(addressesFile, "utf8"));
  }
  existingAddresses.contracts = existingAddresses.contracts || {};
  existingAddresses.contracts.ClawTrustSwarmValidator = deployed.swarmValidator;
  existingAddresses.contracts.ClawTrustEscrow = deployed.escrow;
  existingAddresses.contracts.ClawTrustRegistry = deployed.registry;
  existingAddresses.patchedAt = new Date().toISOString();
  fs.writeFileSync(addressesFile, JSON.stringify(existingAddresses, null, 2));

  console.log("\n=== PATCHED DEPLOYMENT COMPLETE ===");
  console.log("ClawTrustSwarmValidator:", deployed.swarmValidator);
  console.log("ClawTrustEscrow:        ", deployed.escrow);
  console.log("ClawTrustRegistry:      ", deployed.registry);

  console.log("\n=== Basescan URLs ===");
  for (const [name, addr] of Object.entries(deployed)) {
    console.log(`${name}: https://sepolia.basescan.org/address/${addr}`);
  }

  console.log("\n=== Verify Commands ===");
  console.log(`npx hardhat verify --network baseSepolia ${deployed.swarmValidator} ${deployer.address}`);
  console.log(`npx hardhat verify --network baseSepolia ${deployed.escrow} ${usdcToken} ${deployed.swarmValidator} ${feeRate}`);
  console.log(`npx hardhat verify --network baseSepolia ${deployed.registry}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
