const { ethers } = require("ethers");
const fs   = require("fs");
const path = require("path");

const ARTIFACTS = path.join(__dirname, "../artifacts/contracts");

function loadArtifact(name) {
  const p = path.join(ARTIFACTS, `${name}.sol/${name}.json`);
  const a = JSON.parse(fs.readFileSync(p));
  return { abi: a.abi, bytecode: a.bytecode };
}

async function deploy(wallet, name, args = []) {
  const { abi, bytecode } = loadArtifact(name);
  const factory = new ethers.ContractFactory(abi, bytecode, wallet);
  const nonce = await wallet.provider.getTransactionCount(wallet.address, "pending");
  console.log(`  [nonce=${nonce}] Deploying ${name}...`);
  const contract = await factory.deploy(...args, { nonce });
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log(`  ✓ ${name}: ${addr}`);
  return { contract, address: addr };
}

async function send(wallet, contractAddress, abi, method, args = []) {
  const c = new ethers.Contract(contractAddress, abi, wallet);
  const nonce = await wallet.provider.getTransactionCount(wallet.address, "pending");
  const tx = await c[method](...args, { nonce });
  await tx.wait();
  console.log(`  ✓ ${method}(${args.join(", ")})`);
}

async function main() {
  const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");
  const wallet   = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);

  console.log("Deployer:", wallet.address);
  const bal = await provider.getBalance(wallet.address);
  console.log("Balance:", ethers.formatEther(bal), "ETH");
  const nonce = await provider.getTransactionCount(wallet.address, "pending");
  console.log("Current nonce:", nonce, "\n");

  const usdcToken = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const baseURI   = "https://clawtrust.org";
  const feeRate   = 250;

  // Already deployed
  const REP_ADAPTER     = "0x5b70dA41b1642b11E0DC648a89f9eB8024a1d647";
  const SWARM_VALIDATOR = "0x110a2710B6806Cb5715601529bBBD9D1AFc0d398";
  const ESCROW          = "0x9975Abb15e5ED03767bfaaCB38c2cC87123a5BdA";

  console.log("Already deployed:");
  console.log("  ClawTrustRepAdapter:     ", REP_ADAPTER);
  console.log("  ClawTrustSwarmValidator: ", SWARM_VALIDATOR);
  console.log("  ClawTrustEscrow:         ", ESCROW);
  console.log("\nDeploying remaining contracts...\n");

  const { address: CARD } = await deploy(wallet, "ClawCardNFT", [baseURI]);
  const { address: BOND } = await deploy(wallet, "ClawTrustBond", [usdcToken]);
  const { address: CREW } = await deploy(wallet, "ClawTrustCrew", []);

  console.log("\nWiring contracts...");

  const swarmABI = loadArtifact("ClawTrustSwarmValidator").abi;
  await send(wallet, SWARM_VALIDATOR, swarmABI, "setEscrowContract", [ESCROW]);

  const repABI   = loadArtifact("ClawTrustRepAdapter").abi;
  await send(wallet, REP_ADAPTER, repABI, "authorizeOracle", [wallet.address]);

  const bondABI  = loadArtifact("ClawTrustBond").abi;
  await send(wallet, BOND, bondABI, "authorizeCaller", [ESCROW]);

  // Save addresses
  const dir = path.join(__dirname, "../deployments/baseSepolia");
  fs.mkdirSync(dir, { recursive: true });
  const result = {
    ClawTrustRepAdapter:     REP_ADAPTER,
    ClawTrustSwarmValidator: SWARM_VALIDATOR,
    ClawTrustEscrow:         ESCROW,
    ClawCardNFT:             CARD,
    ClawTrustBond:           BOND,
    ClawTrustCrew:           CREW,
  };
  fs.writeFileSync(path.join(dir, "addresses.json"), JSON.stringify({
    network: "baseSepolia", chainId: "84532",
    deployedAt: new Date().toISOString(),
    contracts: result
  }, null, 2));

  console.log("\n════════════════════════════════════════");
  console.log("DEPLOYMENT COMPLETE — ALL CONTRACTS LIVE");
  console.log("════════════════════════════════════════\n");
  for (const [name, addr] of Object.entries(result)) {
    console.log(`${name.padEnd(26)}: ${addr}`);
  }
  console.log("\n═══ BaseScan Links ═══");
  for (const [name, addr] of Object.entries(result)) {
    console.log(`${name}: https://sepolia.basescan.org/address/${addr}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
