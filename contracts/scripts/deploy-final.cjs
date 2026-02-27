const hre = require("hardhat");
const fs   = require("fs");
const path = require("path");

// Get pending nonce direct from node (bypasses hardhat's cached counter)
async function pendingNonce(provider, address) {
  return provider.getTransactionCount(address, "pending");
}

async function deployContract(factory, args = [], overrides = {}) {
  const provider = factory.runner.provider;
  const address  = await factory.runner.getAddress();
  const nonce    = await pendingNonce(provider, address);
  const tx = await factory.deploy(...args, { ...overrides, nonce });
  await tx.waitForDeployment();
  return tx;
}

async function sendTx(contract, method, args = []) {
  const provider = contract.runner.provider;
  const address  = await contract.runner.getAddress();
  const nonce    = await pendingNonce(provider, address);
  const tx = await contract[method](...args, { nonce });
  return tx.wait();
}

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network    = await hre.ethers.provider.getNetwork();
  const provider   = hre.ethers.provider;

  console.log("Deployer:", deployer.address);
  console.log("Network: baseSepolia | Chain ID:", network.chainId.toString());

  const bal = await provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(bal), "ETH\n");

  const usdcToken    = process.env.USDC_TOKEN_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const baseURI      = process.env.BASE_TOKEN_URI    || "https://clawtrust.org";
  const feeRate      = parseInt(process.env.PLATFORM_FEE_RATE || "250");
  const repRegistry  = process.env.REPUTATION_REGISTRY_ADDRESS || "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63";

  // Already live
  const REP_ADAPTER = "0x5b70dA41b1642b11E0DC648a89f9eB8024a1d647";
  // Also live from second run
  const SWARM_VALIDATOR = "0x110a2710B6806Cb5715601529bBBD9D1AFc0d398";
  console.log("ClawTrustRepAdapter   (live):", REP_ADAPTER);
  console.log("ClawTrustSwarmValidator (live):", SWARM_VALIDATOR);

  const deployed = { repAdapter: REP_ADAPTER, swarmValidator: SWARM_VALIDATOR };

  // ── Deploy remaining ────────────────────────────────────────────

  console.log("\n--- Deploying ClawTrustEscrow ---");
  const EscrowF = await hre.ethers.getContractFactory("ClawTrustEscrow");
  const escrow  = await deployContract(EscrowF, [usdcToken, SWARM_VALIDATOR, feeRate]);
  deployed.escrow = await escrow.getAddress();
  console.log("ClawTrustEscrow:", deployed.escrow);

  console.log("\n--- Deploying ClawCardNFT ---");
  const CardF = await hre.ethers.getContractFactory("ClawCardNFT");
  const card  = await deployContract(CardF, [baseURI]);
  deployed.clawCardNFT = await card.getAddress();
  console.log("ClawCardNFT:", deployed.clawCardNFT);

  console.log("\n--- Deploying ClawTrustBond ---");
  const BondF = await hre.ethers.getContractFactory("ClawTrustBond");
  const bond  = await deployContract(BondF, [usdcToken]);
  deployed.bond = await bond.getAddress();
  console.log("ClawTrustBond:", deployed.bond);

  console.log("\n--- Deploying ClawTrustCrew ---");
  const CrewF = await hre.ethers.getContractFactory("ClawTrustCrew");
  const crew  = await deployContract(CrewF, []);
  deployed.crew = await crew.getAddress();
  console.log("ClawTrustCrew:", deployed.crew);

  // ── Wire ────────────────────────────────────────────────────────

  console.log("\n=== Wiring ===");

  const swarm = await hre.ethers.getContractAt("ClawTrustSwarmValidator", SWARM_VALIDATOR, deployer);
  console.log("[SwarmValidator] Setting escrow:", deployed.escrow);
  await sendTx(swarm, "setEscrowContract", [deployed.escrow]);

  const repA = await hre.ethers.getContractAt("ClawTrustRepAdapter", REP_ADAPTER, deployer);
  console.log("[RepAdapter] Authorizing deployer as oracle...");
  await sendTx(repA, "authorizeOracle", [deployer.address]);

  console.log("[Bond] Authorizing escrow as caller...");
  await sendTx(bond, "authorizeCaller", [deployed.escrow]);

  // ── Save ────────────────────────────────────────────────────────

  const dir = path.join(__dirname, "../deployments/baseSepolia");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "addresses.json"), JSON.stringify({
    network: "baseSepolia", chainId: "84532",
    deployedAt: new Date().toISOString(),
    contracts: {
      ClawTrustRepAdapter:     deployed.repAdapter,
      ClawTrustSwarmValidator: deployed.swarmValidator,
      ClawTrustEscrow:         deployed.escrow,
      ClawCardNFT:             deployed.clawCardNFT,
      ClawTrustBond:           deployed.bond,
      ClawTrustCrew:           deployed.crew,
    }
  }, null, 2));

  console.log("\n=== ALL DEPLOYED ===");
  console.log("ClawTrustRepAdapter:     ", deployed.repAdapter);
  console.log("ClawTrustSwarmValidator: ", deployed.swarmValidator);
  console.log("ClawTrustEscrow:         ", deployed.escrow);
  console.log("ClawCardNFT:             ", deployed.clawCardNFT);
  console.log("ClawTrustBond:           ", deployed.bond);
  console.log("ClawTrustCrew:           ", deployed.crew);

  console.log("\n=== BaseScan ===");
  for (const [name, addr] of Object.entries(deployed)) {
    console.log(`${name}: https://sepolia.basescan.org/address/${addr}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
