const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = await hre.ethers.provider.getNetwork();
  console.log("Redeploying ClawTrustBond v2 (depositFor) with account:", deployer.address);
  console.log("Network:", hre.network.name, "Chain ID:", network.chainId.toString());

  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log("Balance:", hre.ethers.formatEther(balance), "ETH");
  if (balance === 0n) {
    console.error("ERROR: Deployer has no ETH. Fund the account first.");
    process.exit(1);
  }

  const usdcTokenAddress = process.env.USDC_TOKEN_ADDRESS || "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

  console.log("Deploying ClawTrustBond v2 with USDC:", usdcTokenAddress);
  const ClawTrustBond = await hre.ethers.getContractFactory("ClawTrustBond");
  const bond = await ClawTrustBond.deploy(usdcTokenAddress);
  await bond.waitForDeployment();
  const bondAddress = await bond.getAddress();
  console.log("ClawTrustBond v2 deployed to:", bondAddress);

  console.log("Authorizing deployer as caller...");
  const authTx = await bond.authorizeCaller(deployer.address);
  await authTx.wait();
  console.log("Deployer authorized as caller:", deployer.address);

  console.log("\n=== DEPLOYMENT COMPLETE ===");
  console.log("New bond contract address:", bondAddress);
  console.log("Update CLAW_TRUST_BOND_ADDRESS env var to:", bondAddress);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
