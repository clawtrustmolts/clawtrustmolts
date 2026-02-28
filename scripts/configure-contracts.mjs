import { readFileSync } from "fs";

const ETHERS_PATH = new URL("../node_modules/ethers/dist/ethers.js", import.meta.url).pathname;
const { ethers } = await import(ETHERS_PATH);

const ARTIFACTS = new URL("../contracts/artifacts/contracts", import.meta.url).pathname;
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const ADDRS = {
  ClawTrustRepAdapter:    "0xecc00bbE268Fa4D0330180e0fB445f64d824d818",
  ClawTrustSwarmValidator:"0x101F37D9bf445E92A237F8721CA7D12205D61Fe6",
  ClawTrustEscrow:        "0x4300AbD703dae7641ec096d8ac03684fB4103CDe",
  ClawCardNFT:            "0xf24e41980ed48576Eb379D2116C1AaD075B342C4",
  ClawTrustBond:          "0x23a1E1e958C932639906d0650A13283f6E60132c",
  ClawTrustCrew:          "0xFF9B75BD080F6D2FAe7Ffa500451716b78fde5F3",
};

function loadABI(sol, name) {
  return JSON.parse(readFileSync(`${ARTIFACTS}/${sol}/${name}.json`, "utf8")).abi;
}

async function sendAndConfirm(wallet, provider, to, data, label) {
  const nonce = await provider.getTransactionCount(wallet.address, "pending");
  const feeData = await provider.getFeeData();
  const gasEst = await provider.estimateGas({ to, data, from: wallet.address });
  const tx = await wallet.sendTransaction({
    to, data, nonce,
    gasLimit: gasEst * 15n / 10n,
    maxFeePerGas: feeData.maxFeePerGas * 2n,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas * 2n,
    chainId: 84532n,
  });
  console.log(`  [${label}] tx: ${tx.hash}`);
  for (let i = 0; i < 60; i++) {
    const r = await provider.getTransactionReceipt(tx.hash);
    if (r) {
      if (r.status === 0) throw new Error(`${label} REVERTED`);
      console.log(`  ✅ ${label} confirmed block ${r.blockNumber}`);
      return r;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`${label} timed out`);
}

async function main() {
  const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");
  const key = process.env.DEPLOYER_PRIVATE_KEY.startsWith("0x") ? process.env.DEPLOYER_PRIVATE_KEY : "0x" + process.env.DEPLOYER_PRIVATE_KEY;
  const wallet = new ethers.Wallet(key, provider);

  console.log("Wallet:", wallet.address);
  const bal = await provider.getBalance(wallet.address);
  console.log("Balance:", ethers.formatEther(bal), "ETH");

  const swarmABI = loadABI("ClawTrustSwarmValidator.sol", "ClawTrustSwarmValidator");
  const repABI = loadABI("ClawTrustRepAdapter.sol", "ClawTrustRepAdapter");
  const bondABI = loadABI("ClawTrustBond.sol", "ClawTrustBond");
  const escrowABI = loadABI("ClawTrustEscrow.sol", "ClawTrustEscrow");
  const nftABI = loadABI("ClawCardNFT.sol", "ClawCardNFT");

  const iface = {
    swarm: new ethers.Interface(swarmABI),
    rep: new ethers.Interface(repABI),
    bond: new ethers.Interface(bondABI),
    escrow: new ethers.Interface(escrowABI),
    nft: new ethers.Interface(nftABI),
  };

  // Check which configs are already done before submitting
  const swarm = new ethers.Contract(ADDRS.ClawTrustSwarmValidator, swarmABI, provider);
  const rep = new ethers.Contract(ADDRS.ClawTrustRepAdapter, repABI, provider);

  console.log("\n=== Checking existing config ===");

  // Check SwarmValidator escrow address
  let needSwarmEscrow = false;
  try {
    const currentEscrow = await swarm.escrowContract();
    needSwarmEscrow = currentEscrow.toLowerCase() !== ADDRS.ClawTrustEscrow.toLowerCase();
    console.log("SwarmValidator.escrowContract:", currentEscrow, needSwarmEscrow ? "(needs update)" : "(✅ already set)");
  } catch { needSwarmEscrow = true; }

  // Check RepAdapter oracle
  let needRepOracle = false;
  try {
    const isAuth = await rep.authorizedOracles(wallet.address);
    needRepOracle = !isAuth;
    console.log("RepAdapter.authorizedOracles[deployer]:", isAuth, needRepOracle ? "(needs auth)" : "(✅ already auth)");
  } catch { needRepOracle = true; }

  console.log("\n=== Running Configuration ===");

  const steps = [];

  if (needSwarmEscrow) {
    steps.push(() => sendAndConfirm(wallet, provider, ADDRS.ClawTrustSwarmValidator,
      iface.swarm.encodeFunctionData("setEscrowContract", [ADDRS.ClawTrustEscrow]),
      "SwarmValidator.setEscrowContract"));
  }

  if (needRepOracle) {
    steps.push(() => sendAndConfirm(wallet, provider, ADDRS.ClawTrustRepAdapter,
      iface.rep.encodeFunctionData("authorizeOracle", [wallet.address]),
      "RepAdapter.authorizeOracle"));
  }

  steps.push(() => sendAndConfirm(wallet, provider, ADDRS.ClawTrustBond,
    iface.bond.encodeFunctionData("authorizeCaller", [ADDRS.ClawTrustEscrow]),
    "Bond.authorizeCaller(escrow)"));

  steps.push(() => sendAndConfirm(wallet, provider, ADDRS.ClawTrustEscrow,
    iface.escrow.encodeFunctionData("setTokenApproval", [USDC, true]),
    "Escrow.setTokenApproval(USDC)"));

  steps.push(() => sendAndConfirm(wallet, provider, ADDRS.ClawTrustEscrow,
    iface.escrow.encodeFunctionData("setX402Facilitator", [wallet.address]),
    "Escrow.setX402Facilitator"));

  for (const step of steps) {
    await step();
    await new Promise(r => setTimeout(r, 500));
  }

  console.log("\n✅ All configuration complete!");
  console.log("\nFinal contract addresses:");
  console.log(JSON.stringify(ADDRS, null, 2));
}

main().catch(err => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
