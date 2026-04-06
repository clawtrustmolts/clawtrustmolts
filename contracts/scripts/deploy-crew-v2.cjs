/**
 * deploy-crew-v2.cjs
 * Deploys the updated ClawTrustCrew contract (with formCrewFor()) to both
 * Base Sepolia and SKALE Base Sepolia, then authorizes the oracle wallet.
 *
 * Usage:
 *   node contracts/scripts/deploy-crew-v2.cjs
 *
 * Env vars required:
 *   DEPLOYER_PRIVATE_KEY
 */
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error("ERROR: DEPLOYER_PRIVATE_KEY not set");
  process.exit(1);
}

const pk = PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`;

const BASE_RPC   = process.env.BASE_RPC_URL || "https://sepolia.base.org";
const SKALE_RPC  = "https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha";

function loadArtifact() {
  const p = path.join(__dirname, "..", "artifacts", "contracts", "ClawTrustCrew.sol", "ClawTrustCrew.json");
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

async function deployTo(rpcUrl, chainId, label) {
  console.log(`\n[${label}] Connecting to ${rpcUrl}...`);
  const provider = new ethers.JsonRpcProvider(rpcUrl, chainId);
  const wallet   = new ethers.Wallet(pk, provider);
  const artifact = loadArtifact();
  const factory  = new ethers.ContractFactory(artifact.abi, artifact.bytecode, wallet);

  const network = await provider.getNetwork();
  const balance = await provider.getBalance(wallet.address);
  console.log(`[${label}] ChainId: ${network.chainId}, Deployer: ${wallet.address}, Balance: ${ethers.formatEther(balance)}`);

  if (balance === 0n) {
    console.warn(`[${label}] WARNING: zero balance — deployment may fail`);
  }

  console.log(`[${label}] Deploying ClawTrustCrew...`);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const txHash  = contract.deploymentTransaction()?.hash || "unknown";
  console.log(`[${label}] Deployed at: ${address}  tx: ${txHash}`);

  // Authorize oracle (same as deployer key in this setup)
  console.log(`[${label}] Authorizing oracle (deployer) as caller...`);
  const authTx = await contract.authorizeCaller(wallet.address);
  await authTx.wait();
  console.log(`[${label}] Oracle authorized. tx: ${authTx.hash}`);

  return { address, txHash };
}

async function main() {
  console.log("=== ClawTrustCrew v2 (formCrewFor) Deployment ===\n");

  const [base, skale] = await Promise.allSettled([
    deployTo(BASE_RPC,  84532,     "Base Sepolia"),
    deployTo(SKALE_RPC, 324705682, "SKALE Testnet"),
  ]);

  console.log("\n=== Results ===");
  if (base.status === "fulfilled") {
    console.log("Base Sepolia  :", base.value.address);
  } else {
    console.error("Base Sepolia  FAILED:", base.reason?.message || base.reason);
  }
  if (skale.status === "fulfilled") {
    console.log("SKALE Testnet :", skale.value.address);
  } else {
    console.error("SKALE Testnet FAILED:", skale.reason?.message || skale.reason);
  }

  console.log("\nAdd these to .env or Replit Secrets:");
  if (base.status  === "fulfilled") console.log(`CLAW_TRUST_CREW_ADDRESS=${base.value.address}`);
  if (skale.status === "fulfilled") console.log(`SKALE_MAINNET_CREW_ADDRESS=${skale.value.address}`);
}

main().catch(e => { console.error(e); process.exit(1); });
