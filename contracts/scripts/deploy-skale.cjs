const hre = require("hardhat");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

// ─── SKALE Network Config ──────────────────────────────────────────────────
// TESTNET (active — use until audit is complete and mainnet sFUEL received)
const SKALE_NETWORK_NAME = "skaleTestnet";
const SKALE_RPC_URL = process.env.SKALE_RPC_URL || "https://testnet.skalenodes.com/v1/giant-half-dual-testnet";
const SKALE_CHAIN_ID = parseInt(process.env.SKALE_CHAIN_ID || "974399131");
const SKALE_IS_TESTNET = true;

// MAINNET — uncomment after audit and comment out the testnet block above
// const SKALE_NETWORK_NAME = "skaleBase";
// const SKALE_RPC_URL = process.env.SKALE_RPC_URL || "https://mainnet.skalenodes.com/v1/honorable-steel-rasalhague";
// const SKALE_CHAIN_ID = parseInt(process.env.SKALE_CHAIN_ID || "1564830818");
// const SKALE_IS_TESTNET = false;
// ──────────────────────────────────────────────────────────────────────────

const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;

if (!PRIVATE_KEY) {
  console.error("ERROR: DEPLOYER_PRIVATE_KEY environment variable is required.");
  console.error(`Usage: DEPLOYER_PRIVATE_KEY=<key> npx hardhat run contracts/scripts/deploy-skale.cjs --network ${SKALE_NETWORK_NAME}`);
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
  const envLabel = SKALE_IS_TESTNET ? "TESTNET" : "MAINNET";
  console.log(`=== ClawTrust SKALE Deployment [${envLabel}] ===\n`);
  console.log("Network:          ", SKALE_NETWORK_NAME);
  console.log("RPC URL:          ", SKALE_RPC_URL);
  console.log("Expected Chain ID:", SKALE_CHAIN_ID);

  console.log("Compiling contracts via Hardhat...");
  await hre.run("compile");
  console.log("Compilation complete.\n");

  const provider = new ethers.JsonRpcProvider(SKALE_RPC_URL, SKALE_CHAIN_ID);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

  const network = await provider.getNetwork();
  console.log("Connected Chain ID:", network.chainId.toString());
  console.log("Deployer:", wallet.address);

  const balance = await provider.getBalance(wallet.address);
  console.log("sFUEL Balance:", ethers.formatEther(balance), "\n");
  if (balance === 0n) {
    console.error("─────────────────────────────────────────────────────────────");
    console.error("Deployer wallet has no sFUEL. Get free sFUEL at:");
    console.error("  https://www.sfuelstation.com — then run this script again.");
    console.error(`Deployer address: ${wallet.address}`);
    console.error("─────────────────────────────────────────────────────────────");
    process.exit(1);
  }

  const usdcTokenAddress = process.env.SKALE_USDC_TOKEN_ADDRESS || process.env.USDC_TOKEN_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const baseTokenURI = process.env.BASE_TOKEN_URI || "https://clawtrust.org";
  const platformFeeRate = parseInt(process.env.PLATFORM_FEE_RATE || "250");

  const deployed = {};
  const txHashes = {};
  const timestamps = {};

  console.log("=== Phase 1: Deploy All 9 Contracts (Dependency Order) ===\n");

  console.log("1/9 Deploying ClawCardNFT...");
  const clawCard = await deployContract(wallet, "ClawCardNFT", [baseTokenURI]);
  deployed.ClawCardNFT = clawCard.address;
  txHashes.ClawCardNFT = clawCard.txHash;
  timestamps.ClawCardNFT = new Date().toISOString();
  console.log("   ClawCardNFT:", deployed.ClawCardNFT);

  console.log("2/9 Deploying ERC8004IdentityRegistry...");
  const identityRegistry = await deployContract(wallet, "ERC8004IdentityRegistry", []);
  deployed.ERC8004IdentityRegistry = identityRegistry.address;
  txHashes.ERC8004IdentityRegistry = identityRegistry.txHash;
  timestamps.ERC8004IdentityRegistry = new Date().toISOString();
  console.log("   ERC8004IdentityRegistry:", deployed.ERC8004IdentityRegistry);

  console.log("3/9 Deploying ClawTrustRepAdapter...");
  const repAdapter = await deployContract(wallet, "ClawTrustRepAdapter", [deployed.ERC8004IdentityRegistry]);
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
  const registry = await deployContract(wallet, "ClawTrustRegistry", []);
  deployed.ClawTrustRegistry = registry.address;
  txHashes.ClawTrustRegistry = registry.txHash;
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
  timestamps.ClawTrustAC = new Date().toISOString();
  console.log("   ClawTrustAC:", deployed.ClawTrustAC);

  console.log("\n=== Phase 2: Configuration ===\n");

  console.log("[SwarmValidator] Setting escrow contract...");
  const svAbi = loadArtifact("ClawTrustSwarmValidator").abi;
  const svContract = new ethers.Contract(deployed.ClawTrustSwarmValidator, svAbi, wallet);
  const setEscrowTx = await svContract.setEscrowContract(deployed.ClawTrustEscrow);
  await setEscrowTx.wait();
  console.log("[SwarmValidator] Escrow set to:", deployed.ClawTrustEscrow);

  console.log("[RepAdapter] Authorizing deployer as oracle...");
  const raAbi = loadArtifact("ClawTrustRepAdapter").abi;
  const raContract = new ethers.Contract(deployed.ClawTrustRepAdapter, raAbi, wallet);
  const authTx = await raContract.authorizeOracle(wallet.address);
  await authTx.wait();
  console.log("[RepAdapter] Deployer authorized as oracle");

  console.log("[Bond] Authorizing escrow as caller...");
  const bondAbi = loadArtifact("ClawTrustBond").abi;
  const bondContract = new ethers.Contract(deployed.ClawTrustBond, bondAbi, wallet);
  const authBondTx = await bondContract.authorizeCaller(deployed.ClawTrustEscrow);
  await authBondTx.wait();
  console.log("[Bond] Escrow authorized as caller");

  console.log("[Escrow] USDC token set in constructor — no further approval needed.");

  console.log("\n=== Phase 3: Save Deployment Artifacts ===\n");

  const deploymentLog = {
    network: SKALE_NETWORK_NAME,
    environment: SKALE_IS_TESTNET ? "testnet" : "mainnet",
    chainId: network.chainId.toString(),
    rpcUrl: SKALE_RPC_URL,
    deployedAt: new Date().toISOString(),
    deployer: wallet.address,
    usdc: usdcTokenAddress,
    contracts: deployed,
    txHashes: txHashes,
    timestamps: timestamps,
    configuration: {
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

  const networkDir = path.join(deploymentsDir, SKALE_NETWORK_NAME);
  if (!fs.existsSync(networkDir)) fs.mkdirSync(networkDir, { recursive: true });

  const addressesPath = path.join(networkDir, "addresses.json");
  fs.writeFileSync(addressesPath, JSON.stringify({
    network: SKALE_NETWORK_NAME,
    environment: deploymentLog.environment,
    chainId: network.chainId.toString(),
    rpcUrl: SKALE_RPC_URL,
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
  console.log(`║          SKALE Deployment Summary [${envLabel.padEnd(7)}]              ║`);
  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║ Network:      " + SKALE_NETWORK_NAME.padEnd(46) + "║");
  console.log("║ Chain ID:     " + network.chainId.toString().padEnd(46) + "║");
  console.log("║ Deployer:     " + wallet.address.substring(0, 42).padEnd(46) + "║");
  console.log("╠══════════════════════════════════════════════════════════════╣");

  for (const name of Object.keys(deployed)) {
    const addr = deployed[name];
    const line = ` ${name.padEnd(28)} ${addr.substring(0, 42)} OK`;
    console.log("║" + line.padEnd(62) + "║");
  }

  console.log("╠══════════════════════════════════════════════════════════════╣");
  console.log("║ All 9 contracts deployed successfully.                     ║");
  console.log("║ Deployment log: deployments/skale-deployment.json          ║");
  console.log("╚══════════════════════════════════════════════════════════════╝");

  console.log("\n=== Post-Deployment Checklist ===");
  console.log("1. Verify SDK chains.ts has real addresses (not SKALE_PLACEHOLDER_*)");
  console.log("2. Authorize backend oracle wallet: repAdapter.authorizeOracle(<backend_wallet>)");
  console.log("3. Test contract interactions on SKALE");
  console.log("4. Update server chain-client.ts if needed for SKALE support");
  console.log(`\nUsage: DEPLOYER_PRIVATE_KEY=<key> npx hardhat run contracts/scripts/deploy-skale.cjs --network ${SKALE_NETWORK_NAME}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nFATAL DEPLOYMENT ERROR:", error.message || error);
    console.error("\nDeployment aborted. No partial artifacts saved.");
    process.exit(1);
  });
