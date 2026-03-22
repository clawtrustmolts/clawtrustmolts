/**
 * deploy-task27.cjs
 * Task #27 — Smart contract security patches + redeploy
 *
 * Deploys (fresh):
 *   1. ERC8004IdentityRegistry  — CRITICAL-3 fix: onlyOwner on submitFeedback + score clamping
 *   2. ClawTrustRepAdapter      — CRITICAL-4 fix: updateCooldown owner-settable (was constant 1h)
 *   3. ClawTrustSwarmValidator  — bonus: getGigVerdict view function added
 *   4. ClawTrustEscrow          — redeployed to wire new SwarmValidator
 *   5. ClawTrustRegistry        — HIGH-1 fix: getOwnerTokenIds already filtered in source; redeploy applies it
 *
 * Post-deploy:
 *   - Wire SwarmValidator ↔ Escrow
 *   - Set updateCooldown = 300s (5 min) on new RepAdapter
 *   - Update addresses.json
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

let currentNonce = null;

async function initNonce(provider, address) {
  currentNonce = await provider.getTransactionCount(address, "pending");
  console.log("Starting nonce:", currentNonce);
}

async function deployContract(factory, args = []) {
  const tx = await factory.deploy(...args, { nonce: currentNonce });
  currentNonce++;
  await tx.waitForDeployment();
  const deployTx = tx.deploymentTransaction();
  return { contract: tx, txHash: deployTx ? deployTx.hash : null };
}

async function sendTx(contract, method, args = []) {
  const tx = await contract[method](...args, { nonce: currentNonce });
  currentNonce++;
  const receipt = await tx.wait();
  return receipt;
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
  const txHashes = {};

  console.log("=== Task #27: Deploying patched contracts ===\n");

  // ── 1. ERC8004IdentityRegistry ─────────────────────────────────────
  console.log("--- 1. ERC8004IdentityRegistry (CRITICAL-3: onlyOwner + score clamp) ---");
  const IdentityF = await hre.ethers.getContractFactory("ERC8004IdentityRegistry");
  const { contract: identityRegistry, txHash: identityTxHash } = await deployContract(IdentityF, []);
  deployed.identityRegistry = await identityRegistry.getAddress();
  txHashes.identityRegistry = identityTxHash;
  console.log("ERC8004IdentityRegistry:", deployed.identityRegistry);
  console.log("  tx:", identityTxHash);

  // ── 2. ClawTrustRepAdapter ─────────────────────────────────────────
  console.log("\n--- 2. ClawTrustRepAdapter (CRITICAL-4: updateCooldown owner-settable) ---");
  const RepAdapterF = await hre.ethers.getContractFactory("ClawTrustRepAdapter");
  const { contract: repAdapter, txHash: repAdapterTxHash } = await deployContract(RepAdapterF, [deployed.identityRegistry]);
  deployed.repAdapter = await repAdapter.getAddress();
  txHashes.repAdapter = repAdapterTxHash;
  console.log("ClawTrustRepAdapter:", deployed.repAdapter);
  console.log("  tx:", repAdapterTxHash);

  // ── 3. ClawTrustSwarmValidator ─────────────────────────────────────
  console.log("\n--- 3. ClawTrustSwarmValidator (bonus: getGigVerdict view) ---");
  const SwarmF = await hre.ethers.getContractFactory("ClawTrustSwarmValidator");
  // Placeholder escrow — will wire correctly after Escrow is deployed
  const { contract: swarm, txHash: swarmTxHash } = await deployContract(SwarmF, [deployer.address]);
  deployed.swarmValidator = await swarm.getAddress();
  txHashes.swarmValidator = swarmTxHash;
  console.log("ClawTrustSwarmValidator:", deployed.swarmValidator);
  console.log("  tx:", swarmTxHash);

  // ── 4. ClawTrustEscrow ─────────────────────────────────────────────
  console.log("\n--- 4. ClawTrustEscrow (wired to new SwarmValidator + IdentityRegistry) ---");
  const EscrowF = await hre.ethers.getContractFactory("ClawTrustEscrow");
  // constructor(usdcToken, validationRegistry, platformFeeRate, identityRegistry, x402Facilitator)
  const x402Facilitator = deployer.address; // same as in previous deployment
  const { contract: escrow, txHash: escrowTxHash } = await deployContract(EscrowF, [
    usdcToken,
    deployed.swarmValidator,
    feeRate,
    deployed.identityRegistry,
    x402Facilitator,
  ]);
  deployed.escrow = await escrow.getAddress();
  txHashes.escrow = escrowTxHash;
  console.log("ClawTrustEscrow:", deployed.escrow);
  console.log("  tx:", escrowTxHash);

  // ── 5. ClawTrustRegistry ───────────────────────────────────────────
  console.log("\n--- 5. ClawTrustRegistry (HIGH-1: getOwnerTokenIds filtering applied) ---");
  const RegistryF = await hre.ethers.getContractFactory("ClawTrustRegistry");
  const { contract: registry, txHash: registryTxHash } = await deployContract(RegistryF, []);
  deployed.registry = await registry.getAddress();
  txHashes.registry = registryTxHash;
  console.log("ClawTrustRegistry:", deployed.registry);
  console.log("  tx:", registryTxHash);

  // ── Wiring ─────────────────────────────────────────────────────────
  console.log("\n=== Wiring contracts ===");

  console.log("[SwarmValidator] setEscrowContract →", deployed.escrow);
  const wireReceipt = await sendTx(swarm, "setEscrowContract", [deployed.escrow]);
  console.log("  tx:", wireReceipt.hash);

  console.log("[RepAdapter] setUpdateCooldown(300) — 5 minutes");
  const cooldownReceipt = await sendTx(repAdapter, "setUpdateCooldown", [300]);
  console.log("  tx:", cooldownReceipt.hash);

  // ── Smoke tests ────────────────────────────────────────────────────
  console.log("\n=== Smoke tests ===\n");

  const smokeTestData = {};

  try {
    const cooldown = await repAdapter.updateCooldown();
    console.log("[RepAdapter] updateCooldown:", cooldown.toString(), "(expected 300)");
    smokeTestData.repAdapterCooldown = Number(cooldown);
  } catch (err) {
    console.warn("[RepAdapter] smoke test failed:", err.message?.substring(0, 200));
  }

  try {
    const svEscrow = await swarm.escrowContract();
    console.log("[SwarmValidator] escrowContract:", svEscrow);
    if (svEscrow.toLowerCase() !== deployed.escrow.toLowerCase()) {
      console.error("[SwarmValidator] ERROR: escrowContract mismatch!");
    }
    smokeTestData.swarmEscrow = svEscrow;
  } catch (err) {
    console.warn("[SwarmValidator] smoke test failed:", err.message?.substring(0, 200));
  }

  try {
    console.log("[Registry] Registering smoketest27.claw...");
    const tx = await registry.register("smoketest27", ".claw", deployer.address, 0, { nonce: currentNonce });
    currentNonce++;
    const receipt = await tx.wait();
    smokeTestData.registrySmokeTestTx = receipt.hash;
    console.log("[Registry] Registered smoketest27.claw, tx:", receipt.hash);
    const resolvedOwner = await registry.resolve("smoketest27", ".claw");
    console.log("[Registry] Resolved smoketest27.claw =>", resolvedOwner);
    smokeTestData.registryResolvedOwner = resolvedOwner;
  } catch (err) {
    console.warn("[Registry] smoke test failed:", err.message?.substring(0, 300));
  }

  // ── Persist ────────────────────────────────────────────────────────
  const dir = path.join(__dirname, "../deployments/baseSepolia");
  fs.mkdirSync(dir, { recursive: true });

  const deploymentInfo = {
    network: "baseSepolia",
    chainId: "84532",
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    task: "Task #27 — Smart contract security patches (CRITICAL-3, CRITICAL-4, HIGH-1, bonus getGigVerdict)",
    patches: [
      "CRITICAL-3: ERC8004IdentityRegistry.submitFeedback — onlyOwner + score clamped to [-10000, 10000]",
      "CRITICAL-4: ClawTrustRepAdapter.updateCooldown — owner-settable (was constant 1h; set to 5min post-deploy)",
      "HIGH-1: ClawTrustRegistry.getOwnerTokenIds — filters stale/expired entries (was already in source, now deployed)",
      "bonus: ClawTrustSwarmValidator.getGigVerdict — convenience view returning string status",
    ],
    contracts: {
      ERC8004IdentityRegistry: {
        address: deployed.identityRegistry,
        deploymentTxHash: txHashes.identityRegistry,
        constructorArgs: [],
        basescanUrl: `https://sepolia.basescan.org/address/${deployed.identityRegistry}#code`,
      },
      ClawTrustRepAdapter: {
        address: deployed.repAdapter,
        deploymentTxHash: txHashes.repAdapter,
        constructorArgs: [deployed.identityRegistry],
        basescanUrl: `https://sepolia.basescan.org/address/${deployed.repAdapter}#code`,
      },
      ClawTrustSwarmValidator: {
        address: deployed.swarmValidator,
        deploymentTxHash: txHashes.swarmValidator,
        constructorArgs: [deployer.address],
        basescanUrl: `https://sepolia.basescan.org/address/${deployed.swarmValidator}#code`,
      },
      ClawTrustEscrow: {
        address: deployed.escrow,
        deploymentTxHash: txHashes.escrow,
        constructorArgs: [usdcToken, deployed.swarmValidator, feeRate, deployed.identityRegistry, x402Facilitator],
        basescanUrl: `https://sepolia.basescan.org/address/${deployed.escrow}#code`,
      },
      ClawTrustRegistry: {
        address: deployed.registry,
        deploymentTxHash: txHashes.registry,
        constructorArgs: [],
        basescanUrl: `https://sepolia.basescan.org/address/${deployed.registry}#code`,
      },
    },
    wiring: {
      "SwarmValidator.setEscrowContract": deployed.escrow,
      wireReceipt: wireReceipt.hash,
      "RepAdapter.setUpdateCooldown(300)": "5 minutes",
      cooldownReceipt: cooldownReceipt.hash,
    },
    smokeTests: smokeTestData,
  };
  fs.writeFileSync(path.join(dir, "task27-deployment.json"), JSON.stringify(deploymentInfo, null, 2));

  // Merge into addresses.json
  let existingAddresses = {};
  const addressesFile = path.join(dir, "addresses.json");
  if (fs.existsSync(addressesFile)) {
    existingAddresses = JSON.parse(fs.readFileSync(addressesFile, "utf8"));
  }
  existingAddresses.contracts = existingAddresses.contracts || {};
  existingAddresses.contracts.ERC8004IdentityRegistry   = deployed.identityRegistry;
  existingAddresses.contracts.ClawTrustRepAdapter        = deployed.repAdapter;
  existingAddresses.contracts.ClawTrustSwarmValidator    = deployed.swarmValidator;
  existingAddresses.contracts.ClawTrustEscrow            = deployed.escrow;
  existingAddresses.contracts.ClawTrustRegistry          = deployed.registry;
  existingAddresses.task27PatchedAt = new Date().toISOString();
  existingAddresses.task27DeploymentTxHashes = {
    ERC8004IdentityRegistry: txHashes.identityRegistry,
    ClawTrustRepAdapter: txHashes.repAdapter,
    ClawTrustSwarmValidator: txHashes.swarmValidator,
    ClawTrustEscrow: txHashes.escrow,
    ClawTrustRegistry: txHashes.registry,
  };
  fs.writeFileSync(addressesFile, JSON.stringify(existingAddresses, null, 2));

  console.log("\n=== TASK #27 DEPLOYMENT COMPLETE ===");
  console.log("ERC8004IdentityRegistry:  ", deployed.identityRegistry);
  console.log("ClawTrustRepAdapter:      ", deployed.repAdapter);
  console.log("ClawTrustSwarmValidator:  ", deployed.swarmValidator);
  console.log("ClawTrustEscrow:          ", deployed.escrow);
  console.log("ClawTrustRegistry:        ", deployed.registry);

  console.log("\n=== Verify Commands ===");
  console.log(`npx hardhat verify --network baseSepolia ${deployed.identityRegistry}`);
  console.log(`npx hardhat verify --network baseSepolia ${deployed.repAdapter} "${deployed.identityRegistry}"`);
  console.log(`npx hardhat verify --network baseSepolia ${deployed.swarmValidator} "${deployer.address}"`);
  console.log(`npx hardhat verify --network baseSepolia ${deployed.escrow} "${usdcToken}" "${deployed.swarmValidator}" ${feeRate}`);
  console.log(`npx hardhat verify --network baseSepolia ${deployed.registry}`);

  console.log("\n=== Next steps ===");
  console.log("1. Update CLAW_TRUST_REP_ADAPTER_ADDRESS, CLAW_TRUST_SWARM_VALIDATOR_ADDRESS,");
  console.log("   CLAW_TRUST_ESCROW_ADDRESS, CLAW_TRUST_REGISTRY_ADDRESS env vars (or hardcoded fallbacks)");
  console.log("   to new addresses above.");
  console.log("2. No additional setUpdateCooldown tx needed — already set to 300s during this deploy.");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
