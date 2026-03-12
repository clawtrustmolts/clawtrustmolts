#!/usr/bin/env node
// Sync source files from Replit workspace to ClawTrust GitHub repos
// Handles: contracts, tests, deploy scripts, SDK, skill files
const fs = require("fs");
const path = require("path");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) {
  console.error("Set GITHUB_TOKEN env var");
  process.exit(1);
}

const OWNER = "clawtrustmolts";
const API = "https://api.github.com";
const ROOT = path.resolve(__dirname, "..");

const headers = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  Accept: "application/vnd.github.v3+json",
  "Content-Type": "application/json",
  "User-Agent": "clawtrust-sync",
};

async function apiCall(url, method = "GET", body = null) {
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status}: ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : null;
}

async function getFileSha(repo, filePath) {
  try {
    const existing = await apiCall(`${API}/repos/${OWNER}/${repo}/contents/${filePath}`);
    return existing.sha;
  } catch (e) {
    return null;
  }
}

async function pushFile(repo, repoPath, localPath, commitMsg) {
  const fullLocal = path.join(ROOT, localPath);
  if (!fs.existsSync(fullLocal)) {
    console.log(`  SKIP (not found): ${localPath}`);
    return false;
  }
  const content = fs.readFileSync(fullLocal);
  const encoded = content.toString("base64");
  const sha = await getFileSha(repo, repoPath);

  const body = {
    message: commitMsg,
    content: encoded,
    branch: "main",
  };
  if (sha) body.sha = sha;

  await apiCall(`${API}/repos/${OWNER}/${repo}/contents/${repoPath}`, "PUT", body);
  console.log(`  ✓ ${repoPath}`);
  return true;
}

async function syncContractsRepo() {
  console.log("\n=== clawtrust-contracts ===");
  const contractFiles = [
    "ClawCardNFT.sol",
    "ClawTrustAC.sol",
    "ClawTrustBond.sol",
    "ClawTrustCrew.sol",
    "ClawTrustEscrow.sol",
    "ClawTrustRegistry.sol",
    "ClawTrustRepAdapter.sol",
    "ClawTrustSwarmValidator.sol",
  ];
  for (const f of contractFiles) {
    await pushFile("clawtrust-contracts", `contracts/${f}`, `contracts/contracts/${f}`, `chore: sync ${f} from main repo`);
  }

  const scriptFiles = fs.readdirSync(path.join(ROOT, "contracts/scripts")).filter(f => f.endsWith(".cjs") || f.endsWith(".js"));
  for (const f of scriptFiles) {
    await pushFile("clawtrust-contracts", `scripts/${f}`, `contracts/scripts/${f}`, `chore: sync script ${f}`);
  }

  await pushFile("clawtrust-contracts", "hardhat.config.cjs", "contracts/hardhat.config.cjs", "chore: sync hardhat config");
  await pushFile("clawtrust-contracts", "package.json", "contracts/package.json", "chore: sync package.json");

  const testFiles = fs.readdirSync(path.join(ROOT, "contracts/test")).filter(f => f.endsWith(".cjs") || f.endsWith(".js"));
  for (const f of testFiles) {
    await pushFile("clawtrust-contracts", `test/${f}`, `contracts/test/${f}`, `chore: sync test ${f}`);
  }
}

async function syncSdkRepo() {
  console.log("\n=== clawtrust-sdk ===");
  const sdkFiles = ["index.ts", "types.ts", "README_SDK.md"];
  for (const f of sdkFiles) {
    await pushFile("clawtrust-sdk", f, `shared/clawtrust-sdk/${f}`, `chore: sync ${f} from main repo`);
  }

  if (fs.existsSync(path.join(ROOT, "shared/clawtrust-sdk/src"))) {
    const srcFiles = fs.readdirSync(path.join(ROOT, "shared/clawtrust-sdk/src"));
    for (const f of srcFiles) {
      await pushFile("clawtrust-sdk", `src/${f}`, `shared/clawtrust-sdk/src/${f}`, `chore: sync src/${f}`);
    }
  }
}

async function syncSkillRepo() {
  console.log("\n=== clawtrust-skill ===");
  await pushFile("clawtrust-skill", "clawtrust-integration.md", "skills/clawtrust-integration.md", "chore: sync skill file from main repo");

  if (fs.existsSync(path.join(ROOT, "shared/clawtrust-sdk/index.ts"))) {
    await pushFile("clawtrust-skill", "src/client.ts", "shared/clawtrust-sdk/index.ts", "chore: sync SDK client from main repo");
  }
  if (fs.existsSync(path.join(ROOT, "shared/clawtrust-sdk/types.ts"))) {
    await pushFile("clawtrust-skill", "src/types.ts", "shared/clawtrust-sdk/types.ts", "chore: sync SDK types from main repo");
  }
}

async function syncDocsRepo() {
  console.log("\n=== clawtrust-docs ===");
  await pushFile("clawtrust-docs", "skills/clawtrust-integration.md", "skills/clawtrust-integration.md", "chore: sync skill doc from main repo");
}

async function syncMainRepo() {
  console.log("\n=== clawtrustmolts (main app) ===");

  const clientPages = fs.readdirSync(path.join(ROOT, "client/src/pages")).filter(f => f.endsWith(".tsx"));
  for (const f of clientPages) {
    await pushFile("clawtrustmolts", `client/src/pages/${f}`, `client/src/pages/${f}`, `chore: sync client page ${f}`);
  }

  const clientComponents = fs.readdirSync(path.join(ROOT, "client/src/components/ui")).filter(f => f.endsWith(".tsx"));
  for (const f of clientComponents) {
    await pushFile("clawtrustmolts", `client/src/components/ui/${f}`, `client/src/components/ui/${f}`, `chore: sync ui component ${f}`);
  }

  const clientLibDir = path.join(ROOT, "client/src/lib");
  if (fs.existsSync(clientLibDir)) {
    const clientLibFiles = fs.readdirSync(clientLibDir).filter(f => f.endsWith(".ts") || f.endsWith(".tsx"));
    for (const f of clientLibFiles) {
      await pushFile("clawtrustmolts", `client/src/lib/${f}`, `client/src/lib/${f}`, `chore: sync client lib ${f}`);
    }
  }

  const clientContextDir = path.join(ROOT, "client/src/context");
  if (fs.existsSync(clientContextDir)) {
    const ctxFiles = fs.readdirSync(clientContextDir).filter(f => f.endsWith(".tsx") || f.endsWith(".ts"));
    for (const f of ctxFiles) {
      await pushFile("clawtrustmolts", `client/src/context/${f}`, `client/src/context/${f}`, `chore: sync context ${f}`);
    }
  }

  const clientHooksDir = path.join(ROOT, "client/src/hooks");
  if (fs.existsSync(clientHooksDir)) {
    const hookFiles = fs.readdirSync(clientHooksDir).filter(f => f.endsWith(".ts") || f.endsWith(".tsx"));
    for (const f of hookFiles) {
      await pushFile("clawtrustmolts", `client/src/hooks/${f}`, `client/src/hooks/${f}`, `chore: sync hook ${f}`);
    }
  }

  await pushFile("clawtrustmolts", "client/src/App.tsx", "client/src/App.tsx", "chore: sync App.tsx");
  await pushFile("clawtrustmolts", "client/src/main.tsx", "client/src/main.tsx", "chore: sync main.tsx");
  await pushFile("clawtrustmolts", "client/src/index.css", "client/src/index.css", "chore: sync index.css");

  const serverFiles = fs.readdirSync(path.join(ROOT, "server")).filter(f => f.endsWith(".ts"));
  for (const f of serverFiles) {
    await pushFile("clawtrustmolts", `server/${f}`, `server/${f}`, `chore: sync server ${f}`);
  }

  const sharedFiles = fs.readdirSync(path.join(ROOT, "shared")).filter(f => f.endsWith(".ts"));
  for (const f of sharedFiles) {
    await pushFile("clawtrustmolts", `shared/${f}`, `shared/${f}`, `chore: sync shared ${f}`);
  }

  const sdkFiles = ["index.ts", "types.ts", "README_SDK.md"];
  for (const f of sdkFiles) {
    await pushFile("clawtrustmolts", `shared/clawtrust-sdk/${f}`, `shared/clawtrust-sdk/${f}`, `chore: sync SDK ${f}`);
  }

  await pushFile("clawtrustmolts", "skills/clawtrust-integration.md", "skills/clawtrust-integration.md", "chore: sync skill file");
  await pushFile("clawtrustmolts", "drizzle.config.ts", "drizzle.config.ts", "chore: sync drizzle config");
  await pushFile("clawtrustmolts", "vite.config.ts", "vite.config.ts", "chore: sync vite config");
  await pushFile("clawtrustmolts", "tsconfig.json", "tsconfig.json", "chore: sync tsconfig");
  await pushFile("clawtrustmolts", "tailwind.config.ts", "tailwind.config.ts", "chore: sync tailwind config");
}

async function main() {
  console.log("ClawTrust File Sync");
  console.log("===================");

  const user = await apiCall(`${API}/user`);
  console.log(`Authenticated as: ${user.login}`);

  await syncContractsRepo();
  await syncSdkRepo();
  await syncSkillRepo();
  await syncDocsRepo();
  await syncMainRepo();

  console.log("\nFile sync complete.");
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
