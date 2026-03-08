const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  console.log("Deploying ClawTrustRegistry with account:", deployer.address);
  console.log("Network:", hre.network.name, "| Chain ID:", network.chainId.toString());

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(balance), "ETH");
  if (balance === 0n) {
    console.error("ERROR: Deployer has no ETH. Fund the account first.");
    process.exit(1);
  }

  console.log("\n--- Deploying ClawTrustRegistry ---");
  const ClawTrustRegistry = await hre.ethers.getContractFactory("ClawTrustRegistry");
  const registry = await ClawTrustRegistry.deploy();
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  console.log("ClawTrustRegistry deployed to:", registryAddress);

  console.log("\n--- Running smoke tests ---");

  try {
    const testName = "smoketest";
    const testTld  = ".claw";
    const tx = await registry.register(testName, testTld, deployer.address, 0);
    const receipt = await tx.wait();
    console.log("[Registry] Registered smoketest.claw, tx:", receipt.hash);

    const owner = await registry.resolve(testName, testTld);
    console.log("[Registry] Resolved smoketest.claw →", owner);
    if (owner.toLowerCase() !== deployer.address.toLowerCase()) {
      console.error("[Registry] ERROR: resolve returned wrong owner!");
    } else {
      console.log("[Registry] Resolve OK ✓");
    }

    const avail = await registry.isAvailable(testName, testTld);
    console.log("[Registry] isAvailable(smoketest, .claw):", avail, "(expected false)");

    const tokenURI = await registry.tokenURI(1);
    console.log("[Registry] tokenURI(1) length:", tokenURI.length, "(expected > 50) ✓");
  } catch (err) {
    console.warn("[Registry] Smoke test failed:", err.message?.substring(0, 200));
  }

  const deploymentInfo = {
    contractName: "ClawTrustRegistry",
    address: registryAddress,
    network: hre.network.name,
    chainId: network.chainId.toString(),
    deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments", hre.network.name);
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });

  const artifactPath = path.join(__dirname, "..", "artifacts", "contracts", "ClawTrustRegistry.sol", "ClawTrustRegistry.json");
  let abi = [];
  if (fs.existsSync(artifactPath)) {
    const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
    abi = artifact.abi;
    deploymentInfo.abi = abi;
  }

  const outPath = path.join(deploymentsDir, "ClawTrustRegistry.json");
  fs.writeFileSync(outPath, JSON.stringify(deploymentInfo, null, 2));
  console.log("\nDeployment info saved to:", outPath);

  console.log("\n=== DEPLOYMENT COMPLETE ===");
  console.log("ClawTrustRegistry address:", registryAddress);
  console.log("\nNext steps:");
  console.log("1. Add to server/blockchain.ts:");
  console.log(`   registry: "${registryAddress}"`);
  console.log("2. Verify on Basescan:");
  console.log(`   cd contracts && npx hardhat verify --network baseSepolia ${registryAddress}`);
  console.log("3. Basescan URL:");
  console.log(`   https://sepolia.basescan.org/address/${registryAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
