const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  console.log("Deployer:", deployer.address);
  console.log("Network:", hre.network.name, "| Chain ID:", network.chainId.toString());

  const bal = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(bal), "ETH\n");

  const usdcTokenAddress = process.env.USDC_TOKEN_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const baseTokenURI = process.env.BASE_TOKEN_URI || "https://clawtrust.org";
  const platformFeeRate = parseInt(process.env.PLATFORM_FEE_RATE || "250");
  const reputationRegistryAddress = process.env.REPUTATION_REGISTRY_ADDRESS || "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63";

  // Already deployed in first run
  const REP_ADAPTER = "0x5b70dA41b1642b11E0DC648a89f9eB8024a1d647";
  console.log("ClawTrustRepAdapter (already deployed):", REP_ADAPTER);

  const deployed = { repAdapter: REP_ADAPTER };

  // ── Deploy remaining contracts ──────────────────────────────────

  console.log("\n--- Deploying ClawTrustSwarmValidator ---");
  const ClawTrustSwarmValidator = await hre.ethers.getContractFactory("ClawTrustSwarmValidator");
  const swarmValidator = await ClawTrustSwarmValidator.deploy(deployer.address);
  await swarmValidator.waitForDeployment();
  deployed.swarmValidator = await swarmValidator.getAddress();
  console.log("ClawTrustSwarmValidator:", deployed.swarmValidator);

  console.log("\n--- Deploying ClawTrustEscrow ---");
  const ClawTrustEscrow = await hre.ethers.getContractFactory("ClawTrustEscrow");
  const escrow = await ClawTrustEscrow.deploy(usdcTokenAddress, deployed.swarmValidator, platformFeeRate);
  await escrow.waitForDeployment();
  deployed.escrow = await escrow.getAddress();
  console.log("ClawTrustEscrow:", deployed.escrow);

  console.log("\n--- Deploying ClawCardNFT ---");
  const ClawCardNFT = await hre.ethers.getContractFactory("ClawCardNFT");
  const clawCard = await ClawCardNFT.deploy(baseTokenURI);
  await clawCard.waitForDeployment();
  deployed.clawCardNFT = await clawCard.getAddress();
  console.log("ClawCardNFT:", deployed.clawCardNFT);

  console.log("\n--- Deploying ClawTrustBond ---");
  const ClawTrustBond = await hre.ethers.getContractFactory("ClawTrustBond");
  const bond = await ClawTrustBond.deploy(usdcTokenAddress);
  await bond.waitForDeployment();
  deployed.bond = await bond.getAddress();
  console.log("ClawTrustBond:", deployed.bond);

  console.log("\n--- Deploying ClawTrustCrew ---");
  const ClawTrustCrew = await hre.ethers.getContractFactory("ClawTrustCrew");
  const crew = await ClawTrustCrew.deploy();
  await crew.waitForDeployment();
  deployed.crew = await crew.getAddress();
  console.log("ClawTrustCrew:", deployed.crew);

  // ── Wire contracts together ─────────────────────────────────────

  console.log("\n=== Wiring Contracts ===\n");

  console.log("[SwarmValidator] Setting escrow contract...");
  await (await swarmValidator.setEscrowContract(deployed.escrow)).wait();
  console.log("  → escrow set to:", deployed.escrow);

  console.log("[RepAdapter] Authorizing deployer as oracle...");
  const repAdapter = await hre.ethers.getContractAt("ClawTrustRepAdapter", deployed.repAdapter);
  await (await repAdapter.authorizeOracle(deployer.address)).wait();
  console.log("  → deployer authorized as oracle");

  console.log("[Bond] Authorizing escrow as caller...");
  await (await bond.authorizeCaller(deployed.escrow)).wait();
  console.log("  → escrow authorized");

  // ── Save artifacts ──────────────────────────────────────────────

  const networkDir = path.join(__dirname, "../deployments", hre.network.name);
  fs.mkdirSync(networkDir, { recursive: true });

  const addresses = {
    network: hre.network.name,
    chainId: network.chainId.toString(),
    deployedAt: new Date().toISOString(),
    contracts: {
      ClawTrustRepAdapter: deployed.repAdapter,
      ClawTrustSwarmValidator: deployed.swarmValidator,
      ClawTrustEscrow: deployed.escrow,
      ClawCardNFT: deployed.clawCardNFT,
      ClawTrustBond: deployed.bond,
      ClawTrustCrew: deployed.crew,
    }
  };

  fs.writeFileSync(path.join(networkDir, "addresses.json"), JSON.stringify(addresses, null, 2));

  console.log("\n=== DEPLOYMENT COMPLETE ===\n");
  console.log("ClawTrustRepAdapter:      ", deployed.repAdapter);
  console.log("ClawTrustSwarmValidator:  ", deployed.swarmValidator);
  console.log("ClawTrustEscrow:          ", deployed.escrow);
  console.log("ClawCardNFT:              ", deployed.clawCardNFT);
  console.log("ClawTrustBond:            ", deployed.bond);
  console.log("ClawTrustCrew:            ", deployed.crew);

  console.log("\n=== BaseScan Links ===");
  console.log(`https://sepolia.basescan.org/address/${deployed.repAdapter}`);
  console.log(`https://sepolia.basescan.org/address/${deployed.swarmValidator}`);
  console.log(`https://sepolia.basescan.org/address/${deployed.escrow}`);
  console.log(`https://sepolia.basescan.org/address/${deployed.clawCardNFT}`);
  console.log(`https://sepolia.basescan.org/address/${deployed.bond}`);
  console.log(`https://sepolia.basescan.org/address/${deployed.crew}`);

  return deployed;
}

main()
  .then(() => process.exit(0))
  .catch(err => { console.error(err); process.exit(1); });
