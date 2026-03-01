import { readFileSync, writeFileSync } from "fs";

const ETHERS_PATH = new URL("../node_modules/ethers/dist/ethers.js", import.meta.url).pathname;
const { ethers } = await import(ETHERS_PATH);

const ARTIFACTS = new URL("../contracts/artifacts/contracts", import.meta.url).pathname;
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const BASE_TOKEN_URI = "https://clawtrust.org";

// All fresh contracts confirmed on Base Sepolia
const DEPLOYED = {
  ClawTrustRepAdapter:    "0xecc00bbE268Fa4D0330180e0fB445f64d824d818",
  ClawTrustSwarmValidator:"0x101F37D9bf445E92A237F8721CA7D12205D61Fe6",
  ClawTrustEscrow:        "0x4300AbD703dae7641ec096d8ac03684fB4103CDe",
  ClawCardNFT:            "0xf24e41980ed48576Eb379D2116C1AaD075B342C4",
  ClawTrustBond:          "0x23a1E1e958C932639906d0650A13283f6E60132c",
  ClawTrustCrew:          "0xFF9B75BD080F6D2FAe7Ffa500451716b78fde5F3",
};

function loadArtifact(sol, name) {
  return JSON.parse(readFileSync(`${ARTIFACTS}/${sol}/${name}.json`, "utf8"));
}

function normalizeKey(k) {
  return k.startsWith("0x") ? k : "0x" + k;
}

async function waitConfirmed(provider, hash, label, maxWaitMs = 120000) {
  console.log(`  submitted: ${hash}`);
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const r = await provider.getTransactionReceipt(hash);
    if (r) {
      if (r.status === 0) throw new Error(`${label} REVERTED`);
      console.log(`  ✅ confirmed block ${r.blockNumber}`);
      return r;
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  throw new Error(`${label} timed out`);
}

async function deployOne(wallet, provider, sol, name, label, ...ctorArgs) {
  console.log(`\n--- ${label} ---`);
  const a = loadArtifact(sol, name);
  const factory = new ethers.ContractFactory(a.abi, a.bytecode, wallet);
  const deployTx = await factory.getDeployTransaction(...ctorArgs);
  const nonce = await provider.getTransactionCount(wallet.address, "pending");
  const feeData = await provider.getFeeData();
  const gasEst = await provider.estimateGas({ ...deployTx, from: wallet.address });
  console.log(`  nonce=${nonce}, gasEst=${gasEst}`);
  const tx = await wallet.sendTransaction({
    data: deployTx.data,
    nonce,
    gasLimit: gasEst * 15n / 10n,
    maxFeePerGas: feeData.maxFeePerGas * 2n,
    maxPriorityFeePerGas: feeData.maxPriorityFeePerGas * 2n,
    chainId: 84532n,
  });
  const receipt = await waitConfirmed(provider, tx.hash, label);
  console.log(`  address: ${receipt.contractAddress}`);
  return { contract: new ethers.Contract(receipt.contractAddress, a.abi, wallet), addr: receipt.contractAddress };
}

async function callTx(contract, method, args, label) {
  console.log(`\n[Config] ${label}...`);
  const tx = await contract[method](...args);
  const provider = contract.runner.provider;
  const r = await waitConfirmed(provider, tx.hash, label);
  return r;
}

async function main() {
  const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");
  const wallet = new ethers.Wallet(normalizeKey(process.env.DEPLOYER_PRIVATE_KEY), provider);
  console.log("Deployer:", wallet.address);
  const bal = await provider.getBalance(wallet.address);
  console.log("Balance:", ethers.formatEther(bal), "ETH");

  const step = process.argv[2] || "all";
  console.log("Running step:", step);

  const a = { ...DEPLOYED };

  if (step === "nft" || step === "all") {
    if (a.ClawCardNFT) {
      console.log("ClawCardNFT already deployed at", a.ClawCardNFT);
    } else {
      const { addr } = await deployOne(wallet, provider, "ClawCardNFT.sol", "ClawCardNFT", "ClawCardNFT", BASE_TOKEN_URI);
      a.ClawCardNFT = addr;
    }
  }

  if (step === "bond" || step === "all") {
    if (!a.ClawCardNFT) throw new Error("Deploy NFT first");
    const { addr } = await deployOne(wallet, provider, "ClawTrustBond.sol", "ClawTrustBond", "ClawTrustBond", USDC);
    a.ClawTrustBond = addr;
  }

  if (step === "crew" || step === "all") {
    const { addr } = await deployOne(wallet, provider, "ClawTrustCrew.sol", "ClawTrustCrew", "ClawTrustCrew");
    a.ClawTrustCrew = addr;
  }

  if (step === "config" || step === "all") {
    if (!a.ClawCardNFT || !a.ClawTrustBond || !a.ClawTrustCrew) {
      throw new Error("Run deployment steps first");
    }
    console.log("\n=== Configuring Contracts ===");

    const swarmArt = loadArtifact("ClawTrustSwarmValidator.sol", "ClawTrustSwarmValidator");
    const swarm = new ethers.Contract(a.ClawTrustSwarmValidator, swarmArt.abi, wallet);
    await callTx(swarm, "setEscrowContract", [a.ClawTrustEscrow], "SwarmValidator.setEscrowContract");

    const repArt = loadArtifact("ClawTrustRepAdapter.sol", "ClawTrustRepAdapter");
    const rep = new ethers.Contract(a.ClawTrustRepAdapter, repArt.abi, wallet);
    await callTx(rep, "authorizeOracle", [wallet.address], "RepAdapter.authorizeOracle");

    const bondArt = loadArtifact("ClawTrustBond.sol", "ClawTrustBond");
    const bond = new ethers.Contract(a.ClawTrustBond, bondArt.abi, wallet);
    await callTx(bond, "authorizeCaller", [a.ClawTrustEscrow], "Bond.authorizeCaller");

    const escrowArt = loadArtifact("ClawTrustEscrow.sol", "ClawTrustEscrow");
    const escrow = new ethers.Contract(a.ClawTrustEscrow, escrowArt.abi, wallet);
    await callTx(escrow, "setTokenApproval", [USDC, true], "Escrow.setTokenApproval");
    await callTx(escrow, "setX402Facilitator", [wallet.address], "Escrow.setX402Facilitator");
  }

  // Save final addresses
  const finalPath = new URL("../contracts/deployments/baseSepolia/addresses.json", import.meta.url).pathname;
  const merged = {
    network: "baseSepolia",
    chainId: "84532",
    deployedAt: new Date().toISOString(),
    deployer: wallet.address,
    usdc: USDC,
    contracts: a,
  };
  writeFileSync(finalPath, JSON.stringify(merged, null, 2));

  console.log("\n=== Deployment Progress ===");
  console.log(JSON.stringify(a, null, 2));
  console.log("\nSaved to latest.json");
}

main().catch(err => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
