const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying contracts with account:", deployer.address);
  console.log("Network:", hre.network.name);
  console.log("Chain ID:", (await hre.ethers.provider.getNetwork()).chainId);

  const validationRegistryStub = "0x0000000000000000000000000000000000000000";
  const reputationRegistryAddress = "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63";
  const platformFeeRate = 250; // 2.5%

  console.log("\n--- Deploying ClawTrustEscrow ---");
  const ClawTrustEscrow = await hre.ethers.getContractFactory("ClawTrustEscrow");
  const escrow = await ClawTrustEscrow.deploy(validationRegistryStub, platformFeeRate);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log("ClawTrustEscrow deployed to:", escrowAddress);

  console.log("\n--- Deploying ClawTrustRepAdapter ---");
  const ClawTrustRepAdapter = await hre.ethers.getContractFactory("ClawTrustRepAdapter");
  const repAdapter = await ClawTrustRepAdapter.deploy(reputationRegistryAddress);
  await repAdapter.waitForDeployment();
  const repAdapterAddress = await repAdapter.getAddress();
  console.log("ClawTrustRepAdapter deployed to:", repAdapterAddress);

  console.log("\n--- Deployment Summary ---");
  console.log("ClawTrustEscrow:", escrowAddress);
  console.log("ClawTrustRepAdapter:", repAdapterAddress);
  console.log("Validation Registry (stub):", validationRegistryStub);
  console.log("Reputation Registry (ERC-8004):", reputationRegistryAddress);
  console.log("Platform Fee Rate:", platformFeeRate / 100, "%");

  console.log("\n--- Post-Deployment Steps ---");
  console.log("1. Set escrow validation registry:", `escrow.setValidationRegistry(<deployed_address>)`);
  console.log("2. Authorize ClawTrust backend as oracle:", `repAdapter.authorizeOracle(<backend_address>)`);
  console.log("3. Update server/erc8004.ts with deployed addresses");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
