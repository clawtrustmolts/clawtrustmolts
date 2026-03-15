const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const SKALE_RPC_URL = process.env.SKALE_RPC_URL || "https://mainnet.skalenodes.com/v1/honorable-steel-rasalhague";
const SKALE_CHAIN_ID = parseInt(process.env.SKALE_CHAIN_ID || "1564830818");
const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error("ERROR: DEPLOYER_PRIVATE_KEY environment variable is required.");
  process.exit(1);
}

function loadArtifact(contractName) {
  const artifactPath = path.join(__dirname, "..", "artifacts", "contracts", `${contractName}.sol`, `${contractName}.json`);
  if (!fs.existsSync(artifactPath)) {
    throw new Error(`Artifact not found: ${artifactPath}. Run 'npx hardhat compile' first.`);
  }
  return JSON.parse(fs.readFileSync(artifactPath, "utf-8"));
}

async function deployContract(wallet, contractName, constructorArgs = []) {
  const artifact = loadArtifact(contractName);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);
  const contract = await factory.deploy(...constructorArgs);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const txHash = contract.deploymentTransaction()?.hash || "unknown";
  return { contract, address, txHash };
}

async function main() {
  console.log("=== ClawTrust SKALE on Base Deployment ===\n");
  console.log("RPC URL:", SKALE_RPC_URL);
  console.log("Expected Chain ID:", SKALE_CHAIN_ID);

  const provider = new ethers.JsonRpcProvider(SKALE_RPC_URL, SKALE_CHAIN_ID);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  const network = await provider.getNetwork();
  console.log("Connected Chain ID:", network.chainId.toString());
  console.log("Deployer:", wallet.address);

  const balance = await provider.getBalance(wallet.address);
  console.log("Balance:", ethers.formatEther(balance), "ETH/sFUEL\n");
  if (balance === 0n) {
    console.error("ERROR: Deployer has no ETH/sFUEL. Fund the account first.");
    process.exit(1);
  }

  console.log("Compiling contracts via Hardhat...");
  await hre.run("compile");
  console.log("Compilation complete.\n");

  const reputationRegistryAddress = process.env.SKALE_REPUTATION_REGISTRY_ADDRESS || process.env.REPUTATION_REGISTRY_ADDRESS || "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63";
  const usdcTokenAddress = process.env.SKALE_USDC_TOKEN_ADDRESS || process.env.USDC_TOKEN_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const baseTokenURI = process.env.BASE_TOKEN_URI || "https://clawtrust.org";
  const platformFeeRate = parseInt(process.env.PLATFORM_FEE_RATE || "250");

  const deployed = {};
  const txHashes = {};
  const timestamps = {};

  console.log("=== Phase 1: Deploy Contracts (Dependency Order) ===\n");

  console.log("1/9 Deploying ClawCardNFT...");
  const clawCard = await deployContract(wallet, "ClawCardNFT", [baseTokenURI]);
  deployed.ClawCardNFT = clawCard.address;
  txHashes.ClawCardNFT = clawCard.txHash;
  timestamps.ClawCardNFT = new Date().toISOString();
  console.log("   ClawCardNFT:", deployed.ClawCardNFT);

  console.log("2/9 Deploying ERC8004IdentityRegistry...");
  let identityRegistryAddress = reputationRegistryAddress;
  try {
    const identityRegistry = await deployContract(wallet, "ERC8004IdentityRegistry", []);
    identityRegistryAddress = identityRegistry.address;
    txHashes.ERC8004IdentityRegistry = identityRegistry.txHash;
  } catch (err) {
    console.log("   ERC8004IdentityRegistry not found in artifacts, using registry address:", reputationRegistryAddress);
    txHashes.ERC8004IdentityRegistry = "uses-existing-registry";
  }
  deployed.ERC8004IdentityRegistry = identityRegistryAddress;
  timestamps.ERC8004IdentityRegistry = new Date().toISOString();
  console.log("   ERC8004IdentityRegistry:", deployed.ERC8004IdentityRegistry);

  console.log("3/9 Deploying ClawTrustRepAdapter...");
  const repAdapter = await deployContract(wallet, "ClawTrustRepAdapter", [identityRegistryAddress]);
  deployed.ClawTrustRepAdapter = repAdapter.address;
  txHashes.ClawTrustRepAdapter = repAdapter.txHash;
  timestamps.ClawTrustRepAdapter = new Date().toISOString();
  console.log("   ClawTrustRepAdapter:", deployed.ClawTrustRepAdapter);

  console.log("4/9 Deploying ClawTrustBond...");
  const bond = await deployContract(wallet, "ClawTrustBond", [usdcTokenAddress]);
  deployed.ClawTrustBond = bond.address;
  txHashes.ClawTrustBond = bond.txHash;
  timestamps.ClawTrustBond = new Date().toISOString();
  console.log("   ClawTrustBond:", deployed.ClawTrustBond);

  console.log("5/9 Deploying ClawTrustSwarmValidator...");
  const swarmValidator = await deployContract(wallet, "ClawTrustSwarmValidator", [wallet.address]);
  deployed.ClawTrustSwarmValidator = swarmValidator.address;
  txHashes.ClawTrustSwarmValidator = swarmValidator.txHash;
  timestamps.ClawTrustSwarmValidator = new Date().toISOString();
  console.log("   ClawTrustSwarmValidator:", deployed.ClawTrustSwarmValidator);

  console.log("6/9 Deploying ClawTrustRegistry...");
  try {
    const registry = await deployContract(wallet, "ClawTrustRegistry", []);
    deployed.ClawTrustRegistry = registry.address;
    txHashes.ClawTrustRegistry = registry.txHash;
  } catch (err) {
    console.log("   ClawTrustRegistry deployment error:", err.message?.substring(0, 80));
    deployed.ClawTrustRegistry = "0x0000000000000000000000000000000000000000";
    txHashes.ClawTrustRegistry = "failed";
  }
  timestamps.ClawTrustRegistry = new Date().toISOString();
  console.log("   ClawTrustRegistry:", deployed.ClawTrustRegistry);

  console.log("7/9 Deploying ClawTrustCrew...");
  const crew = await deployContract(wallet, "ClawTrustCrew", []);
  deployed.ClawTrustCrew = crew.address;
  txHashes.ClawTrustCrew = crew.txHash;
  timestamps.ClawTrustCrew = new Date().toISOString();
  console.log("   ClawTrustCrew:", deployed.ClawTrustCrew);

  console.log("8/9 Deploying ClawTrustEscrow...");
  const escrow = await deployContract(wallet, "ClawTrustEscrow", [usdcTokenAddress, deployed.ClawTrustSwarmValidator, platformFeeRate]);
  deployed.ClawTrustEscrow = escrow.address;
  txHashes.ClawTrustEscrow = escrow.txHash;
  timestamps.ClawTrustEscrow = new Date().toISOString();
  console.log("   ClawTrustEscrow:", deployed.ClawTrustEscrow);

  console.log("9/9 Deploying ClawTrustAC (ERC-8183)...");
  try {
    const ac = await deployContract(wallet, "ClawTrustAC", [
      deployed.ClawCardNFT,
      deployed.ClawTrustRepAdapter,
      deployed.ClawTrustBond,
      usdcTokenAddress,
      wallet.address,
      wallet.address,
    ]);
    deployed.ClawTrustAC = ac.address;
    txHashes.ClawTrustAC = ac.txHash;
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
    const svAbi = loadArtifact("ClawTrustSwarmValidator").abi;
    const svContract = new ethers.Contract(deployed.ClawTrustSwarmValidator, svAbi, wallet);
    const setEscrowTx = await svContract.setEscrowContract(deployed.ClawTrustEscrow);
    await setEscrowTx.wait();
    console.log("[SwarmValidator] Escrow set to:", deployed.ClawTrustEscrow);
  } catch (err) {
    console.log("[SwarmValidator] setEscrowContract failed:", err.message?.substring(0, 80));
  }

  console.log("[RepAdapter] Authorizing deployer as oracle...");
  try {
    const raAbi = loadArtifact("ClawTrustRepAdapter").abi;
    const raContract = new ethers.Contract(deployed.ClawTrustRepAdapter, raAbi, wallet);
    const authTx = await raContract.authorizeOracle(wallet.address);
    await authTx.wait();
    console.log("[RepAdapter] Deployer authorized as oracle");
  } catch (err) {
    console.log("[RepAdapter] authorizeOracle failed:", err.message?.substring(0, 80));
  }

  console.log("[Bond] Authorizing escrow as caller...");
  try {
    const bondAbi = loadArtifact("ClawTrustBond").abi;
    const bondContract = new ethers.Contract(deployed.ClawTrustBond, bondAbi, wallet);
    const authBondTx = await bondContract.authorizeCaller(deployed.ClawTrustEscrow);
    await authBondTx.wait();
    console.log("[Bond] Escrow authorized as caller");
  } catch (err) {
    console.log("[Bond] authorizeCaller failed:", err.message?.substring(0, 80));
  }

  console.log("[Escrow] Approving USDC token...");
  try {
    const escrowAbi = loadArtifact("ClawTrustEscrow").abi;
    const escrowContract = new ethers.Contract(deployed.ClawTrustEscrow, escrowAbi, wallet);
    const approveTx = await escrowContract.setTokenApproval(usdcTokenAddress, true);
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
    deployer: wallet.address,
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
    deployer: wallet.address,
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
  console.log("║ Deployer:     " + wallet.address.substring(0, 42).padEnd(46) + "║");
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
  console.log("\nUsage: DEPLOYER_PRIVATE_KEY=<key> node contracts/scripts/deploy-skale.cjs");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
