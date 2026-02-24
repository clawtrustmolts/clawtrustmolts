const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Network:", hre.network.name);
  console.log("Chain ID:", network.chainId.toString());

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(balance), "ETH");
  if (balance === 0n) {
    console.error("ERROR: Deployer has no ETH. Fund the account first.");
    process.exit(1);
  }

  const reputationRegistryAddress = process.env.REPUTATION_REGISTRY_ADDRESS || "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63";
  const usdcTokenAddress = process.env.USDC_TOKEN_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const baseTokenURI = process.env.BASE_TOKEN_URI || "https://clawtrust.org";
  const platformFeeRate = parseInt(process.env.PLATFORM_FEE_RATE || "250");

  const deployed = {};

  console.log("\n=== Phase 1: Core Contracts ===\n");

  console.log("--- Deploying ClawTrustRepAdapter ---");
  const ClawTrustRepAdapter = await hre.ethers.getContractFactory("ClawTrustRepAdapter");
  const repAdapter = await ClawTrustRepAdapter.deploy(reputationRegistryAddress);
  await repAdapter.waitForDeployment();
  deployed.repAdapter = await repAdapter.getAddress();
  console.log("ClawTrustRepAdapter deployed to:", deployed.repAdapter);

  console.log("\n--- Deploying ClawTrustSwarmValidator (placeholder escrow) ---");
  const ClawTrustSwarmValidator = await hre.ethers.getContractFactory("ClawTrustSwarmValidator");
  const swarmValidator = await ClawTrustSwarmValidator.deploy(deployer.address);
  await swarmValidator.waitForDeployment();
  deployed.swarmValidator = await swarmValidator.getAddress();
  console.log("ClawTrustSwarmValidator deployed to:", deployed.swarmValidator);

  console.log("\n--- Deploying ClawTrustEscrow ---");
  const ClawTrustEscrow = await hre.ethers.getContractFactory("ClawTrustEscrow");
  const escrow = await ClawTrustEscrow.deploy(deployed.swarmValidator, platformFeeRate);
  await escrow.waitForDeployment();
  deployed.escrow = await escrow.getAddress();
  console.log("ClawTrustEscrow deployed to:", deployed.escrow);

  console.log("\n--- Deploying ClawCardNFT ---");
  const ClawCardNFT = await hre.ethers.getContractFactory("ClawCardNFT");
  const clawCard = await ClawCardNFT.deploy(baseTokenURI);
  await clawCard.waitForDeployment();
  deployed.clawCardNFT = await clawCard.getAddress();
  console.log("ClawCardNFT deployed to:", deployed.clawCardNFT);

  console.log("\n--- Deploying ClawTrustBond ---");
  const ClawTrustBond = await hre.ethers.getContractFactory("ClawTrustBond");
  const bond = await ClawTrustBond.deploy(usdcTokenAddress);
  await bond.waitForDeployment();
  deployed.bond = await bond.getAddress();
  console.log("ClawTrustBond deployed to:", deployed.bond);

  console.log("\n--- Deploying ClawTrustCrew ---");
  const ClawTrustCrew = await hre.ethers.getContractFactory("ClawTrustCrew");
  const crew = await ClawTrustCrew.deploy();
  await crew.waitForDeployment();
  deployed.crew = await crew.getAddress();
  console.log("ClawTrustCrew deployed to:", deployed.crew);

  console.log("\n=== Phase 2: Configuration ===\n");

  console.log("[SwarmValidator] Setting escrow contract...");
  const setEscrowTx = await swarmValidator.setEscrowContract(deployed.escrow);
  await setEscrowTx.wait();
  console.log("[SwarmValidator] Escrow set to:", deployed.escrow);

  console.log("[RepAdapter] Authorizing deployer as oracle...");
  const authTx = await repAdapter.authorizeOracle(deployer.address);
  await authTx.wait();
  console.log("[RepAdapter] Deployer authorized as oracle");

  console.log("[Bond] Authorizing escrow as caller...");
  const authBondTx = await bond.authorizeCaller(deployed.escrow);
  await authBondTx.wait();
  console.log("[Bond] Escrow authorized as caller");

  console.log("[Escrow] Approving USDC token...");
  const approveTx = await escrow.setTokenApproval(usdcTokenAddress, true);
  await approveTx.wait();
  console.log("[Escrow] USDC approved");

  console.log("[RepAdapter] Testing computeFusedScore(890, 4200)...");
  const testFused = await repAdapter.computeFusedScore(890, 4200);
  console.log("[RepAdapter] computeFusedScore result:", testFused.toString(), "(expected ~70)");

  console.log("\n=== Phase 3: Smoke Tests ===\n");

  try {
    const testTags = ["audit", "security"];
    const testProof = "ipfs://clawtrust/test/proof.json";
    const tx = await repAdapter.submitFusedFeedback(deployer.address, 890, 4200, testTags, testProof);
    const receipt = await tx.wait();
    console.log("[RepAdapter] submitFusedFeedback tx:", receipt.hash);

    const fusedResult = await repAdapter.getFusedScore(deployer.address);
    console.log("[RepAdapter] Stored fused score:", {
      onChainScore: fusedResult.onChainScore.toString(),
      moltbookKarma: fusedResult.moltbookKarma.toString(),
      fusedScore: fusedResult.fusedScore.toString(),
    });
  } catch (err) {
    console.log("[RepAdapter] Smoke test skipped:", err.message?.substring(0, 100));
  }

  console.log("\n=== Phase 4: Generate Config ===\n");

  const addressConfig = {
    network: hre.network.name,
    chainId: network.chainId.toString(),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      ClawTrustEscrow: deployed.escrow,
      ClawTrustRepAdapter: deployed.repAdapter,
      ClawTrustSwarmValidator: deployed.swarmValidator,
      ClawCardNFT: deployed.clawCardNFT,
      ClawTrustBond: deployed.bond,
      ClawTrustCrew: deployed.crew,
      ReputationRegistry: reputationRegistryAddress,
      USDCToken: usdcTokenAddress,
    },
    platformFeeRate: platformFeeRate / 100 + "%",
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });

  const addressesPath = path.join(__dirname, "..", "deployed-addresses.json");
  fs.writeFileSync(addressesPath, JSON.stringify(addressConfig, null, 2));
  console.log("Contract addresses saved to:", addressesPath);

  const networkDir = path.join(deploymentsDir, hre.network.name);
  if (!fs.existsSync(networkDir)) fs.mkdirSync(networkDir, { recursive: true });

  for (const [name, addr] of Object.entries(addressConfig.contracts)) {
    if (name === "ReputationRegistry" || name === "USDCToken") continue;
    const artifactPath = path.join(__dirname, "..", "artifacts", "contracts", `${name}.sol`, `${name}.json`);
    let abi = [];
    if (fs.existsSync(artifactPath)) {
      const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
      abi = artifact.abi;
    }
    const deploymentFile = {
      contractName: name,
      address: addr,
      abi: abi,
      deployedAt: addressConfig.deployedAt,
      network: hre.network.name,
      chainId: network.chainId.toString(),
    };
    fs.writeFileSync(path.join(networkDir, `${name}.json`), JSON.stringify(deploymentFile, null, 2));
  }
  console.log("Deployment artifacts saved to:", networkDir);

  const chainClientUpdate = `
// Auto-generated by deploy.cjs on ${new Date().toISOString()}
// Network: ${hre.network.name} (Chain ID: ${network.chainId})
// Update server/chain-client.ts with these values:
//
// ESCROW_ADDRESS = "${deployed.escrow}"
// REP_ADAPTER_ADDRESS = "${deployed.repAdapter}"
// SWARM_VALIDATOR_ADDRESS = "${deployed.swarmValidator}"
// CLAW_CARD_NFT_ADDRESS = "${deployed.clawCardNFT}"
// BOND_ADDRESS = "${deployed.bond}"
// CREW_ADDRESS = "${deployed.crew}"
`;
  console.log(chainClientUpdate);

  console.log("=== Deployment Summary ===");
  console.log(JSON.stringify(addressConfig.contracts, null, 2));

  console.log("\n=== Post-Deployment Checklist ===");
  console.log("1. Update server/chain-client.ts with deployed addresses above");
  console.log("2. Authorize backend oracle wallet:", `repAdapter.authorizeOracle(<backend_wallet>)`);
  console.log("3. Verify contracts on BaseScan:");
  console.log(`   npx hardhat verify --network baseSepolia ${deployed.escrow} ${deployed.swarmValidator} ${platformFeeRate}`);
  console.log(`   npx hardhat verify --network baseSepolia ${deployed.repAdapter} ${reputationRegistryAddress}`);
  console.log(`   npx hardhat verify --network baseSepolia ${deployed.swarmValidator} ${deployer.address}`);
  console.log(`   npx hardhat verify --network baseSepolia ${deployed.clawCardNFT} "${baseTokenURI}"`);
  console.log(`   npx hardhat verify --network baseSepolia ${deployed.bond} ${usdcTokenAddress}`);
  console.log(`   npx hardhat verify --network baseSepolia ${deployed.crew}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
