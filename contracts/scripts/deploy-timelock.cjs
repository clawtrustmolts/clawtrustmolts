/**
 * deploy-timelock.cjs
 *
 * Deploys ClawTrustTimelock with the supplied Safe address as PROPOSER.
 * After deployment, call transferOwnership() on each contract, then
 * route acceptOwnership() through the timelock to complete the handover.
 *
 * Usage:
 *   SAFE=0xYOUR_SAFE npx hardhat run scripts/deploy-timelock.cjs --network baseSepolia
 *   SAFE=0xYOUR_SAFE DELAY=172800 npx hardhat run scripts/deploy-timelock.cjs --network baseMainnet
 */

const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  const safe = process.env.SAFE;
  const delaySeconds = parseInt(process.env.DELAY || "300"); // default 5 min for testnet

  if (!safe || !ethers.isAddress(safe)) {
    throw new Error("SAFE env var must be a valid address. e.g. SAFE=0xYourGnosisSafe");
  }

  console.log("Deployer     :", deployer.address);
  console.log("Safe (proposer):", safe);
  console.log("Delay (seconds):", delaySeconds, `(${(delaySeconds / 3600).toFixed(1)}h)`);

  const Timelock = await ethers.getContractFactory("ClawTrustTimelock");
  console.log("\nDeploying ClawTrustTimelock...");
  const timelock = await Timelock.deploy(delaySeconds, safe);
  await timelock.waitForDeployment();
  const timelockAddress = await timelock.getAddress();
  console.log("ClawTrustTimelock deployed to:", timelockAddress);

  // Verify roles
  const PROPOSER = await timelock.PROPOSER_ROLE();
  const EXECUTOR = await timelock.EXECUTOR_ROLE();
  const CANCELLER = await timelock.CANCELLER_ROLE();
  const ADMIN = await timelock.DEFAULT_ADMIN_ROLE();

  console.log("\n--- Role verification ---");
  console.log("Safe has PROPOSER :", await timelock.hasRole(PROPOSER, safe));
  console.log("Safe has CANCELLER:", await timelock.hasRole(CANCELLER, safe));
  console.log("Open executor (0x0):", await timelock.hasRole(EXECUTOR, ethers.ZeroAddress));
  console.log("Safe has ADMIN    :", await timelock.hasRole(ADMIN, safe), "(should be false)");
  console.log("Self has ADMIN    :", await timelock.hasRole(ADMIN, timelockAddress), "(should be true)");
  console.log("Min delay         :", (await timelock.getMinDelay()).toString(), "seconds");

  console.log(`
=== NEXT STEPS ===

1. Set guardian on all contracts (call from current deployer wallet):
   await escrow.setGuardian("${safe}");
   await swarmValidator.setGuardian("${safe}");
   await repAdapter.setGuardian("${safe}");
   await ac.setGuardian("${safe}");
   await bond.setGuardian("${safe}");

2. Propose ownership transfer on all contracts:
   await escrow.transferOwnership("${timelockAddress}");
   (repeat for swarmValidator, repAdapter, ac, bond)

3. Via Gnosis Safe → schedule acceptOwnership() through the Timelock
   (see MULTISIG_SETUP.md for the full flow)

4. After delay, execute to complete handover.

Timelock address to record: ${timelockAddress}
`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
