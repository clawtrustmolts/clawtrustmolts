const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const SKALE_RPC_URL = process.env.SKALE_RPC_URL || "https://mainnet.skalenodes.com/v1/honorable-steel-rasalhague";
const SKALE_CHAIN_ID = parseInt(process.env.SKALE_CHAIN_ID || "1564830818");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  console.log("=== ClawTrust SKALE on Base Deployment ===\n");
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Network:", hre.network.name);
  console.log("Chain ID:", network.chainId.toString());

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(balance), "ETH\n");
  if (balance === 0n) {
    console.error("ERROR: Deployer has no ETH/sFUEL. Fund the account first.");
    process.exit(1);
  }

  const reputationRegistryAddress = process.env.SKALE_REPUTATION_REGISTRY_ADDRESS || process.env.REPUTATION_REGISTRY_ADDRESS || "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63";
  const usdcTokenAddress = process.env.SKALE_USDC_TOKEN_ADDRESS || process.env.USDC_TOKEN_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const baseTokenURI = process.env.BASE_TOKEN_URI || "https://clawtrust.org";
  const platformFeeRate = parseInt(process.env.PLATFORM_FEE_RATE || "250");

  const deployed = {};
  const txHashes = {};
  const timestamps = {};

  console.log("=== Phase 1: Deploy Contracts (Dependency Order) ===\n");

  console.log("1/9 Deploying ClawCardNFT...");
  const ClawCardNFT = await hre.ethers.getContractFactory("ClawCardNFT");
  const clawCard = await ClawCardNFT.deploy(baseTokenURI);
  await clawCard.waitForDeployment();
  deployed.ClawCardNFT = await clawCard.getAddress();
  txHashes.ClawCardNFT = clawCard.deploymentTransaction()?.hash || "unknown";
  timestamps.ClawCardNFT = new Date().toISOString();
  console.log("   ClawCardNFT:", deployed.ClawCardNFT);

  console.log("2/9 Deploying ERC8004IdentityRegistry...");
  let identityRegistryAddress = reputationRegistryAddress;
  try {
    const ERC8004IdentityRegistry = await hre.ethers.getContractFactory("ERC8004IdentityRegistry");
    const identityRegistry = await ERC8004IdentityRegistry.deploy();
    await identityRegistry.waitForDeployment();
    identityRegistryAddress = await identityRegistry.getAddress();
    txHashes.ERC8004IdentityRegistry = identityRegistry.deploymentTransaction()?.hash || "unknown";
  } catch (err) {
    console.log("   ERC8004IdentityRegistry not found in artifacts, using registry address:", reputationRegistryAddress);
    txHashes.ERC8004IdentityRegistry = "uses-existing-registry";
  }
  deployed.ERC8004IdentityRegistry = identityRegistryAddress;
  timestamps.ERC8004IdentityRegistry = new Date().toISOString();
  console.log("   ERC8004IdentityRegistry:", deployed.ERC8004IdentityRegistry);

  console.log("3/9 Deploying ClawTrustRepAdapter...");
  const ClawTrustRepAdapter = await hre.ethers.getContractFactory("ClawTrustRepAdapter");
  const repAdapter = await ClawTrustRepAdapter.deploy(identityRegistryAddress);
  await repAdapter.waitForDeployment();
  deployed.ClawTrustRepAdapter = await repAdapter.getAddress();
  txHashes.ClawTrustRepAdapter = repAdapter.deploymentTransaction()?.hash || "unknown";
  timestamps.ClawTrustRepAdapter = new Date().toISOString();
  console.log("   ClawTrustRepAdapter:", deployed.ClawTrustRepAdapter);

  console.log("4/9 Deploying ClawTrustBond...");
  const ClawTrustBond = await hre.ethers.getContractFactory("ClawTrustBond");
  const bond = await ClawTrustBond.deploy(usdcTokenAddress);
  await bond.waitForDeployment();
  deployed.ClawTrustBond = await bond.getAddress();
  txHashes.ClawTrustBond = bond.deploymentTransaction()?.hash || "unknown";
  timestamps.ClawTrustBond = new Date().toISOString();
  console.log("   ClawTrustBond:", deployed.ClawTrustBond);

  console.log("5/9 Deploying ClawTrustSwarmValidator...");
  const ClawTrustSwarmValidator = await hre.ethers.getContractFactory("ClawTrustSwarmValidator");
  const swarmValidator = await ClawTrustSwarmValidator.deploy(deployer.address);
  await swarmValidator.waitForDeployment();
  deployed.ClawTrustSwarmValidator = await swarmValidator.getAddress();
  txHashes.ClawTrustSwarmValidator = swarmValidator.deploymentTransaction()?.hash || "unknown";
  timestamps.ClawTrustSwarmValidator = new Date().toISOString();
  console.log("   ClawTrustSwarmValidator:", deployed.ClawTrustSwarmValidator);

  console.log("6/9 Deploying ClawTrustRegistry...");
  let registryAddress;
  try {
    const ClawTrustRegistry = await hre.ethers.getContractFactory("ClawTrustRegistry");
    const registry = await ClawTrustRegistry.deploy();
    await registry.waitForDeployment();
    registryAddress = await registry.getAddress();
    txHashes.ClawTrustRegistry = registry.deploymentTransaction()?.hash || "unknown";
  } catch (err) {
    console.log("   ClawTrustRegistry deployment error, using placeholder:", err.message?.substring(0, 80));
    registryAddress = "0x0000000000000000000000000000000000000000";
    txHashes.ClawTrustRegistry = "failed";
  }
  deployed.ClawTrustRegistry = registryAddress;
  timestamps.ClawTrustRegistry = new Date().toISOString();
  console.log("   ClawTrustRegistry:", deployed.ClawTrustRegistry);

  console.log("7/9 Deploying ClawTrustCrew...");
  const ClawTrustCrew = await hre.ethers.getContractFactory("ClawTrustCrew");
  const crew = await ClawTrustCrew.deploy();
  await crew.waitForDeployment();
  deployed.ClawTrustCrew = await crew.getAddress();
  txHashes.ClawTrustCrew = crew.deploymentTransaction()?.hash || "unknown";
  timestamps.ClawTrustCrew = new Date().toISOString();
  console.log("   ClawTrustCrew:", deployed.ClawTrustCrew);

  console.log("8/9 Deploying ClawTrustEscrow...");
  const ClawTrustEscrow = await hre.ethers.getContractFactory("ClawTrustEscrow");
  const escrow = await ClawTrustEscrow.deploy(usdcTokenAddress, deployed.ClawTrustSwarmValidator, platformFeeRate);
  await escrow.waitForDeployment();
  deployed.ClawTrustEscrow = await escrow.getAddress();
  txHashes.ClawTrustEscrow = escrow.deploymentTransaction()?.hash || "unknown";
  timestamps.ClawTrustEscrow = new Date().toISOString();
  console.log("   ClawTrustEscrow:", deployed.ClawTrustEscrow);

  console.log("9/9 Deploying ClawTrustAC (ERC-8183)...");
  try {
    const ClawTrustAC = await hre.ethers.getContractFactory("ClawTrustAC");
    const ac = await ClawTrustAC.deploy(
      deployed.ClawCardNFT,
      deployed.ClawTrustRepAdapter,
      deployed.ClawTrustBond,
      usdcTokenAddress,
      deployer.address,
      deployer.address
    );
    await ac.waitForDeployment();
    deployed.ClawTrustAC = await ac.getAddress();
    txHashes.ClawTrustAC = ac.deploymentTransaction()?.hash || "unknown";
  } catch (err) {
    console.log("   ClawTrustAC deployment error:", err.message?.substring(0, 80));
    deployed.ClawTrustAC = "0x0000000000000000000000000000000000000000";
    txHashes.ClawTrustAC = "failed";
  }
  timestamps.ClawTrustAC = new Date().toISOString();
  console.log("   ClawTrustAC:", deployed.ClawTrustAC);

  console.log("\n=== Phase 2: Configuration ===\n");

  console.log("[SwarmValidator] Setting escrow contract...");
  try {
    const setEscrowTx = await swarmValidator.setEscrowContract(deployed.ClawTrustEscrow);
    await setEscrowTx.wait();
    console.log("[SwarmValidator] Escrow set to:", deployed.ClawTrustEscrow);
  } catch (err) {
    console.log("[SwarmValidator] setEscrowContract failed:", err.message?.substring(0, 80));
  }

  console.log("[RepAdapter] Authorizing deployer as oracle...");
  try {
    const authTx = await repAdapter.authorizeOracle(deployer.address);
    await authTx.wait();
    console.log("[RepAdapter] Deployer authorized as oracle");
  } catch (err) {
    console.log("[RepAdapter] authorizeOracle failed:", err.message?.substring(0, 80));
  }

  console.log("[Bond] Authorizing escrow as caller...");
  try {
    const authBondTx = await bond.authorizeCaller(deployed.ClawTrustEscrow);
    await authBondTx.wait();
    console.log("[Bond] Escrow authorized as caller");
  } catch (err) {
    console.log("[Bond] authorizeCaller failed:", err.message?.substring(0, 80));
  }

  console.log("[Escrow] Approving USDC token...");
  try {
    const approveTx = await escrow.setTokenApproval(usdcTokenAddress, true);
    await approveTx.wait();
    console.log("[Escrow] USDC approved");
  } catch (err) {
    console.log("[Escrow] setTokenApproval failed:", err.message?.substring(0, 80));
  }

  console.log("\n=== Phase 3: Save Deployment Artifacts ===\n");

  const deploymentLog = {
    network: "skaleBase",
    chainId: network.chainId.toString(),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    rpcUrl: SKALE_RPC_URL,
    usdc: usdcTokenAddress,
    contracts: deployed,
    txHashes: txHashes,
    timestamps: timestamps,
    configuration: {
      reputationRegistry: identityRegistryAddress,
      usdcToken: usdcTokenAddress,
      platformFeeRate: platformFeeRate / 100 + "%",
      baseTokenURI: baseTokenURI,
    },
  };

  const deploymentsDir = path.join(__dirname, "..", "deployments");
  if (!fs.existsSync(deploymentsDir)) fs.mkdirSync(deploymentsDir, { recursive: true });

  const deploymentPath = path.join(deploymentsDir, "skale-deployment.json");
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentLog, null, 2));
  console.log("Deployment log saved to:", deploymentPath);

  const networkDir = path.join(deploymentsDir, "skaleBase");
  if (!fs.existsSync(networkDir)) fs.mkdirSync(networkDir, { recursive: true });

  const addressesPath = path.join(networkDir, "addresses.json");
  fs.writeFileSync(addressesPath, JSON.stringify({
    network: "skaleBase",
    chainId: network.chainId.toString(),
    deployedAt: deploymentLog.deployedAt,
    deployer: deployer.address,
    usdc: usdcTokenAddress,
    contracts: deployed,
  }, null, 2));
  console.log("Addresses saved to:", addressesPath);

  console.log("\n=== Phase 4: Update SDK chains.ts ===\n");

  const sdkChainsPath = path.resolve(__dirname, "../../openclaw-skill-submission/clawtrust/src/config/chains.ts");
  if (fs.existsSync(sdkChainsPath)) {
    let chainsContent = fs.readFileSync(sdkChainsPath, "utf-8");
    for (const [name, addr] of Object.entries(deployed)) {
      const placeholder = `SKALE_PLACEHOLDER_${name}`;
      chainsContent = chainsContent.replace(new RegExp(placeholder, "g"), addr);
    }
    chainsContent = chainsContent.replace(/SKALE_PLACEHOLDER_USDC/g, usdcTokenAddress);
    fs.writeFileSync(sdkChainsPath, chainsContent);
    console.log("SDK chains.ts updated with deployed SKALE addresses");
  } else {
    console.log("WARNING: SDK chains.ts not found at:", sdkChainsPath);
    console.log("Manually update SKALE_PLACEHOLDER_* values in src/config/chains.ts");
  }

  console.log("\n╔══════════════════════════════════════════════════════════════╗");
  console.log("║              SKALE on Base — Deployment Summary             ║");
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║ Chain ID:     " + network.chainId.toString().padEnd(46) + "║");
  console.log("║ Deployer:     " + deployer.address.substring(0, 42).padEnd(46) + "║");
  console.log("╠══════════════════════════════════════════════════════════════╣");

  const contractNames = Object.keys(deployed);
  for (const name of contractNames) {
    const addr = deployed[name];
    const status = txHashes[name] === "failed" ? "FAILED" : "OK";
    const line = ` ${name.padEnd(28)} ${addr.substring(0, 42)} ${status}`;
    console.log("║" + line.padEnd(62) + "║");
  }

  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║ Deployment log: deployments/skale-deployment.json          ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  console.log("\n=== Post-Deployment Checklist ===");
  console.log("1. Verify SDK chains.ts has real addresses (not SKALE_PLACEHOLDER_*)");
  console.log("2. Authorize backend oracle wallet: repAdapter.authorizeOracle(<backend_wallet>)");
  console.log("3. Test contract interactions on SKALE");
  console.log("4. Update server chain-client.ts if needed for SKALE support");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
