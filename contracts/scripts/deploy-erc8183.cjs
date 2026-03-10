const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const ADDRESSES = {
  baseSepolia: {
    clawCard:    "0xf24e41980ed48576Eb379D2116C1AaD075B342C4",
    repAdapter:  "0xecc00bbE268Fa4D0330180e0fB445f64d824d818",
    bond:        "0x23a1E1e958C932639906d0650A13283f6E60132c",
    usdc:        "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    treasury:    "0x66e5046D136E82d17cbeB2FfEa5bd5205D962906",
    evaluator:   "0x66e5046D136E82d17cbeB2FfEa5bd5205D962906",
  }
};

async function main() {
  const [deployer] = await ethers.getSigners();
  const netName = network.name;
  console.log(`\n[ClawTrustAC] Deploying on ${netName}`);
  console.log(`[ClawTrustAC] Deployer: ${deployer.address}`);

  const addrs = ADDRESSES[netName];
  if (!addrs) throw new Error(`No address config for network: ${netName}`);

  console.log(`\n[ClawTrustAC] Constructor args:`);
  console.log(`  ClawCardNFT:      ${addrs.clawCard}`);
  console.log(`  ClawTrustRepAdapter: ${addrs.repAdapter}`);
  console.log(`  ClawTrustBond:    ${addrs.bond}`);
  console.log(`  USDC:             ${addrs.usdc}`);
  console.log(`  Treasury:         ${addrs.treasury}`);
  console.log(`  Evaluator:        ${addrs.evaluator}`);

  const ClawTrustAC = await ethers.getContractFactory("ClawTrustAC");
  const contract = await ClawTrustAC.deploy(
    addrs.clawCard,
    addrs.repAdapter,
    addrs.bond,
    addrs.usdc,
    addrs.treasury,
    addrs.evaluator
  );
  await contract.waitForDeployment();

  const contractAddress = await contract.getAddress();
  console.log(`\n[ClawTrustAC] Deployed at: ${contractAddress}`);
  console.log(`[ClawTrustAC] Basescan: https://sepolia.basescan.org/address/${contractAddress}`);

  const deploymentDir = path.join(__dirname, `../deployments/${netName}`);
  if (!fs.existsSync(deploymentDir)) fs.mkdirSync(deploymentDir, { recursive: true });

  const addressesFile = path.join(deploymentDir, "addresses.json");
  let existing = {};
  if (fs.existsSync(addressesFile)) {
    existing = JSON.parse(fs.readFileSync(addressesFile, "utf8"));
  }

  existing.contracts = existing.contracts || {};
  existing.contracts.ClawTrustAC = contractAddress;
  existing.erc8183 = {
    ClawTrustAC: contractAddress,
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    constructorArgs: [addrs.clawCard, addrs.repAdapter, addrs.bond, addrs.usdc, addrs.treasury, addrs.evaluator],
    basescanUrl: `https://sepolia.basescan.org/address/${contractAddress}`,
    standard: "ERC-8183",
  };
  fs.writeFileSync(addressesFile, JSON.stringify(existing, null, 2));
  console.log(`\n[ClawTrustAC] Addresses updated at: ${addressesFile}`);

  const artifactFile = path.join(deploymentDir, "ClawTrustAC.json");
  fs.writeFileSync(artifactFile, JSON.stringify({
    address: contractAddress,
    network: netName,
    chainId: 84532,
    deployedAt: new Date().toISOString(),
    standard: "ERC-8183",
    wrapsContracts: addrs,
    constructorArgs: [addrs.clawCard, addrs.repAdapter, addrs.bond, addrs.usdc, addrs.treasury, addrs.evaluator],
  }, null, 2));

  console.log(`\n[ClawTrustAC] ✓ Deployment complete`);
  console.log(`\nTo verify on Basescan run:`);
  console.log(`  npx hardhat verify --network baseSepolia ${contractAddress} \\`);
  console.log(`    ${addrs.clawCard} \\`);
  console.log(`    ${addrs.repAdapter} \\`);
  console.log(`    ${addrs.bond} \\`);
  console.log(`    ${addrs.usdc} \\`);
  console.log(`    ${addrs.treasury} \\`);
  console.log(`    ${addrs.evaluator}`);

  return contractAddress;
}

main()
  .then((addr) => {
    console.log(`\nAddress: ${addr}`);
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
