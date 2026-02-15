const fs = require("fs");
const path = require("path");

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function checkDeployment() {
  console.log("=== ClawTrust Deployment Verification ===\n");

  const addressesPath = path.join(__dirname, "..", "deployed-addresses.json");
  let addresses = null;

  if (fs.existsSync(addressesPath)) {
    addresses = JSON.parse(fs.readFileSync(addressesPath, "utf-8"));
    console.log("Deployed addresses found:", addressesPath);
    console.log("Network:", addresses.network);
    console.log("Chain ID:", addresses.chainId);
    console.log("Deployed at:", addresses.deployedAt);
    console.log("Deployer:", addresses.deployer);
    console.log();
  } else {
    console.log("WARNING: No deployed-addresses.json found.");
    console.log("Run: cd contracts && npx hardhat run scripts/deploy.cjs --network baseSepolia\n");
  }

  const checks = [];

  const chainClientPath = path.join(__dirname, "..", "..", "server", "chain-client.ts");
  if (fs.existsSync(chainClientPath)) {
    const content = fs.readFileSync(chainClientPath, "utf-8");

    const patterns = [
      { name: "IDENTITY_REGISTRY_ADDRESS", pattern: /IDENTITY_REGISTRY_ADDRESS.*=.*"(0x[a-fA-F0-9]+)"/ },
      { name: "REPUTATION_REGISTRY_ADDRESS", pattern: /REPUTATION_REGISTRY_ADDRESS.*=.*"(0x[a-fA-F0-9]+)"/ },
    ];

    for (const p of patterns) {
      const match = content.match(p.pattern);
      if (match) {
        const addr = match[1];
        const isPlaceholder = addr === ZERO_ADDRESS || addr.includes("0000000000000000");
        checks.push({
          name: p.name,
          address: addr,
          status: isPlaceholder ? "PLACEHOLDER" : "CONFIGURED",
        });
      }
    }
  }

  if (addresses?.contracts) {
    for (const [name, addr] of Object.entries(addresses.contracts)) {
      const isPlaceholder = addr === ZERO_ADDRESS;
      checks.push({
        name: `deployed:${name}`,
        address: addr,
        status: isPlaceholder ? "PLACEHOLDER" : "DEPLOYED",
      });
    }
  }

  const envVars = [
    "CIRCLE_API_KEY",
    "CIRCLE_CLIENT_KEY",
    "SESSION_SECRET",
    "DEPLOYER_PRIVATE_KEY",
    "BASE_RPC_URL",
    "PRIVY_APP_ID",
    "TURNSTILE_SECRET_KEY",
    "ADMIN_WALLETS",
  ];

  console.log("--- Contract Addresses ---");
  let hasIssues = false;
  for (const check of checks) {
    const icon = check.status === "PLACEHOLDER" ? "!!" : "OK";
    console.log(`[${icon}] ${check.name}: ${check.address.slice(0, 20)}... (${check.status})`);
    if (check.status === "PLACEHOLDER") hasIssues = true;
  }

  console.log("\n--- Environment Variables ---");
  for (const v of envVars) {
    const val = process.env[v];
    const status = val ? "SET" : "MISSING";
    const icon = val ? "OK" : "!!";
    console.log(`[${icon}] ${v}: ${status}`);
    if (!val) hasIssues = true;
  }

  console.log("\n--- Result ---");
  if (hasIssues) {
    console.log("WARNINGS FOUND: Some addresses are placeholders or env vars are missing.");
    console.log("The app will run but some features may not work correctly.");
    process.exit(1);
  } else {
    console.log("All checks passed. Deployment looks good!");
    process.exit(0);
  }
}

checkDeployment();
