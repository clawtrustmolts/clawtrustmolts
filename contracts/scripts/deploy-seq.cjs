const { ethers } = require("ethers");
const fs   = require("fs");
const path = require("path");

const ARTIFACTS = path.join(__dirname, "../artifacts/contracts");

function loadArtifact(name) {
  const p = path.join(ARTIFACTS, `${name}.sol/${name}.json`);
  return JSON.parse(fs.readFileSync(p));
}

// single shared nonce counter — never re-fetches, always increments
let NONCE;

async function deploy(wallet, name, args = []) {
  const art = loadArtifact(name);
  const factory = new ethers.ContractFactory(art.abi, art.bytecode, wallet);
  const n = NONCE++;
  console.log(`  [nonce=${n}] deploying ${name}...`);
  const c = await factory.deploy(...args, { nonce: n });
  await c.waitForDeployment();
  const addr = await c.getAddress();
  console.log(`  ✓ ${name}: ${addr}`);
  return { contract: c, address: addr, abi: art.abi };
}

async function tx(wallet, addr, abi, method, args = []) {
  const c = new ethers.Contract(addr, abi, wallet);
  const n = NONCE++;
  console.log(`  [nonce=${n}] ${method}(${args})`);
  const t = await c[method](...args, { nonce: n });
  await t.wait();
  console.log(`  ✓ done`);
}

async function main() {
  const provider = new ethers.JsonRpcProvider("https://sepolia.base.org");
  const wallet   = new ethers.Wallet(process.env.DEPLOYER_PRIVATE_KEY, provider);

  console.log("Deployer:", wallet.address);
  console.log("Balance:", ethers.formatEther(await provider.getBalance(wallet.address)), "ETH");

  // Seed nonce from chain (confirmed+pending)
  NONCE = await provider.getTransactionCount(wallet.address, "pending");
  console.log("Starting nonce:", NONCE, "\n");

  const usdcToken = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
  const baseURI   = "https://clawtrust.org";

  // Already live
  const REP_ADAPTER     = "0x5b70dA41b1642b11E0DC648a89f9eB8024a1d647";
  const SWARM_VALIDATOR = "0x110a2710B6806Cb5715601529bBBD9D1AFc0d398";
  const ESCROW          = "0x9975Abb15e5ED03767bfaaCB38c2cC87123a5BdA";

  // Check if ClawCardNFT is already deployed (nonce 3 might have gone through)
  // If nonce is 4+ it means ClawCardNFT tx went through already — we need to know the address
  // Compute CREATE address for nonce 3:
  const CARD_EXPECTED = ethers.getCreateAddress({ from: wallet.address, nonce: 3 });
  const BOND_EXPECTED = ethers.getCreateAddress({ from: wallet.address, nonce: 4 });
  const CREW_EXPECTED = ethers.getCreateAddress({ from: wallet.address, nonce: 5 });

  console.log("Expected addresses (if those nonces were used):");
  console.log("  ClawCardNFT (nonce 3):", CARD_EXPECTED);
  console.log("  ClawTrustBond (nonce 4):", BOND_EXPECTED);
  console.log("  ClawTrustCrew (nonce 5):", CREW_EXPECTED);
  console.log("");

  // Check which are already deployed (have code)
  const cardCode = await provider.getCode(CARD_EXPECTED);
  const bondCode = await provider.getCode(BOND_EXPECTED);
  const crewCode = await provider.getCode(CREW_EXPECTED);

  const CARD_LIVE = cardCode !== "0x";
  const BOND_LIVE = bondCode !== "0x";
  const CREW_LIVE = crewCode !== "0x";

  const CARD = CARD_LIVE ? CARD_EXPECTED : null;
  const BOND = BOND_LIVE ? BOND_EXPECTED : null;
  const CREW = CREW_LIVE ? CREW_EXPECTED : null;

  if (CARD_LIVE) console.log("  ClawCardNFT already live at:", CARD);
  if (BOND_LIVE) console.log("  ClawTrustBond already live at:", BOND);
  if (CREW_LIVE) console.log("  ClawTrustCrew already live at:", CREW);

  // Deploy any that aren't live yet
  let cardAddr = CARD, cardABI;
  let bondAddr = BOND, bondABI;
  let crewAddr = CREW, crewABI;

  if (!CARD_LIVE) {
    const r = await deploy(wallet, "ClawCardNFT", [baseURI]);
    cardAddr = r.address; cardABI = r.abi;
  } else {
    cardABI = loadArtifact("ClawCardNFT").abi;
  }
  if (!BOND_LIVE) {
    const r = await deploy(wallet, "ClawTrustBond", [usdcToken]);
    bondAddr = r.address; bondABI = r.abi;
  } else {
    bondABI = loadArtifact("ClawTrustBond").abi;
  }
  if (!CREW_LIVE) {
    const r = await deploy(wallet, "ClawTrustCrew", []);
    crewAddr = r.address; crewABI = r.abi;
  } else {
    crewABI = loadArtifact("ClawTrustCrew").abi;
  }

  // Check if wiring txns already went through
  console.log("\nChecking wiring...");
  const swarmArt = loadArtifact("ClawTrustSwarmValidator");
  const swarm = new ethers.Contract(SWARM_VALIDATOR, swarmArt.abi, provider);
  const currentEscrow = await swarm.escrowContract();
  if (currentEscrow.toLowerCase() !== ESCROW.toLowerCase()) {
    await tx(wallet, SWARM_VALIDATOR, swarmArt.abi, "setEscrowContract", [ESCROW]);
  } else {
    console.log("  SwarmValidator already wired to escrow ✓");
  }

  const repArt = loadArtifact("ClawTrustRepAdapter");
  const repContract = new ethers.Contract(REP_ADAPTER, repArt.abi, provider);
  const alreadyOracle = await repContract.authorizedOracles(wallet.address);
  if (!alreadyOracle) {
    await tx(wallet, REP_ADAPTER, repArt.abi, "authorizeOracle", [wallet.address]);
  } else {
    console.log("  RepAdapter oracle already authorized ✓");
  }

  const bondArt = loadArtifact("ClawTrustBond");
  const bondContract = new ethers.Contract(bondAddr, bondArt.abi, provider);
  const alreadyCaller = await bondContract.authorizedCallers(ESCROW);
  if (!alreadyCaller) {
    await tx(wallet, bondAddr, bondArt.abi, "authorizeCaller", [ESCROW]);
  } else {
    console.log("  Bond escrow caller already authorized ✓");
  }

  const result = {
    ClawTrustRepAdapter:     REP_ADAPTER,
    ClawTrustSwarmValidator: SWARM_VALIDATOR,
    ClawTrustEscrow:         ESCROW,
    ClawCardNFT:             cardAddr,
    ClawTrustBond:           bondAddr,
    ClawTrustCrew:           crewAddr,
  };

  const dir = path.join(__dirname, "../deployments/baseSepolia");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "addresses.json"), JSON.stringify({
    network: "baseSepolia", chainId: "84532",
    deployedAt: new Date().toISOString(),
    contracts: result
  }, null, 2));

  console.log("\n════════════════════════════════════════");
  console.log("ALL 6 CONTRACTS LIVE ON BASE SEPOLIA");
  console.log("════════════════════════════════════════\n");
  for (const [name, addr] of Object.entries(result)) {
    console.log(`${name.padEnd(26)}: ${addr}`);
  }
  console.log("\nBaseScan:");
  for (const [name, addr] of Object.entries(result)) {
    console.log(`  ${name}: https://sepolia.basescan.org/address/${addr}`);
  }
}

main().catch(e => { console.error(e.message || e); process.exit(1); });
