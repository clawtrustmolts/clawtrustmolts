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

async function main() {
  console.log("ClawTrust File Sync");
  console.log("===================");

  const user = await apiCall(`${API}/user`);
  console.log(`Authenticated as: ${user.login}`);

  await syncContractsRepo();
  await syncSdkRepo();
  await syncSkillRepo();
  await syncDocsRepo();

  console.log("\nFile sync complete.");
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
