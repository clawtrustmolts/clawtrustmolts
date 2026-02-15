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

  console.log("\n--- Registry Interactions ---");

  console.log("[RepAdapter] Linked to ReputationRegistry:", reputationRegistryAddress);
  const storedRegistry = await repAdapter.reputationRegistry();
  console.log("[RepAdapter] Stored reputationRegistry:", storedRegistry);

  const isDeployerOracle = await repAdapter.authorizedOracles(deployer.address);
  console.log("[RepAdapter] Deployer is authorized oracle:", isDeployerOracle);

  console.log("[RepAdapter] Testing computeFusedScore(890, 4200)...");
  const testFused = await repAdapter.computeFusedScore(890, 4200);
  console.log("[RepAdapter] computeFusedScore result:", testFused.toString(), "(expected ~70)");

  console.log("\n[RepAdapter] Submitting fused feedback for deployer as test agent...");
  try {
    const testTags = ["audit", "security"];
    const testProof = "ipfs://clawtrust/test/proof.json";
    const tx = await repAdapter.submitFusedFeedback(
      deployer.address,
      890,
      4200,
      testTags,
      testProof
    );
    const receipt = await tx.wait();
    console.log("[RepAdapter] submitFusedFeedback tx:", receipt.hash);

    const fusedResult = await repAdapter.getFusedScore(deployer.address);
    console.log("[RepAdapter] Stored fused score for deployer:", {
      onChainScore: fusedResult.onChainScore.toString(),
      moltbookKarma: fusedResult.moltbookKarma.toString(),
      fusedScore: fusedResult.fusedScore.toString(),
      timestamp: fusedResult.timestamp.toString(),
      proofUri: fusedResult.proofUri,
    });
  } catch (err) {
    console.log("[RepAdapter] submitFusedFeedback skipped (registry may not accept calls):", err.message?.substring(0, 100));
  }

  console.log("\n[RepAdapter] Querying ReputationRegistry for deployer score...");
  try {
    const registryContract = await hre.ethers.getContractAt(
      ["function getScore(address) view returns (int256)", "function getFeedbackCount(address) view returns (uint256)"],
      reputationRegistryAddress
    );
    const score = await registryContract.getScore(deployer.address);
    const feedbackCount = await registryContract.getFeedbackCount(deployer.address);
    console.log("[Registry] Score for deployer:", score.toString());
    console.log("[Registry] Feedback count for deployer:", feedbackCount.toString());
  } catch (err) {
    console.log("[Registry] Query failed (contract may not be deployed at this address):", err.message?.substring(0, 100));
  }

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
  console.log("4. Use submitFusedFeedback(agentAddr, onChainScore, moltKarma, tags, proofUri) to push fused scores on-chain");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
