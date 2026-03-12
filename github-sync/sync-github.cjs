#!/usr/bin/env node
// Sync all 6 ClawTrust GitHub repos: descriptions, topics, and READMEs
// Repos: clawtrust-contracts, clawtrust-docs, clawtrust-sdk, clawtrust-skill, clawtrustmolts, openclaw
const fs = require("fs");
const path = require("path");

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
if (!GITHUB_TOKEN) {
  console.error("ERROR: Set GITHUB_TOKEN environment variable to a GitHub Personal Access Token with repo scope.");
  console.error("Usage: GITHUB_TOKEN=ghp_xxx node github-sync/sync-github.cjs");
  process.exit(1);
}

const OWNER = "clawtrustmolts";
const API = "https://api.github.com";

const headers = {
  Authorization: `Bearer ${GITHUB_TOKEN}`,
  Accept: "application/vnd.github.v3+json",
  "Content-Type": "application/json",
  "User-Agent": "clawtrust-sync",
};

const REPO_UPDATES = {
  "clawtrust-contracts": {
    description: "Solidity smart contracts for ClawTrust — ERC-8004 identity, ERC-8183 agentic commerce, reputation, escrow, swarm validation on Base.",
    topics: ["ai-agents", "agentic-commerce", "base", "base-sepolia", "clawtrust", "erc-8004", "erc-8183", "hardhat", "openclaw", "reputation", "smart-contracts", "solidity", "typescript", "usdc", "web3"],
    note: "README already up-to-date on GitHub (9 contracts, ERC-8183, all addresses)",
  },
  "clawtrust-docs": {
    description: "Documentation for ClawTrust — the developer bible for the agent economy. ERC-8004, ERC-8183, SDK v1.10.0.",
    topics: ["ai-agents", "agentic-commerce", "base", "base-sepolia", "clawtrust", "developer-docs", "documentation", "erc-8004", "erc-8183", "openclaw", "reputation", "typescript", "usdc", "web3"],
    readme: "README-clawtrust-docs.md",
  },
  "clawtrust-sdk": {
    description: "Trust verification SDK v1.10.0 for the agent economy. ERC-8004/ERC-8183. Check agent reputation in one line.",
    topics: ["ai-agents", "agentic-commerce", "base", "base-sepolia", "clawtrust", "erc-8004", "erc-8183", "npm-package", "openclaw", "reputation", "sdk", "typescript", "usdc", "web3"],
    readme: "README-clawtrust-sdk.md",
  },
  "clawtrust-skill": {
    description: "ClawTrust integration skill v1.10.0 for OpenClaw AI agents. ERC-8004/ERC-8183, escrow, gig marketplace.",
    topics: ["ai-agents", "agentic-commerce", "base", "base-sepolia", "clawtrust", "erc-8004", "erc-8183", "openclaw", "openclaw-skill", "reputation", "typescript", "usdc", "web3"],
    note: "README already up-to-date on GitHub (v1.10.0, ERC-8183 changelog)",
  },
  clawtrustmolts: {
    description: "ClawTrust — Reputation Engine & Autonomous Gig Marketplace for AI Agents. ERC-8004, ERC-8183, Circle USDC Escrow, Swarm Validation, Claw Card NFTs.",
    topics: ["ai-agents", "agentic-commerce", "base", "base-sepolia", "clawtrust", "erc-8004", "erc-8183", "expressjs", "fullstack", "openclaw", "react", "reputation", "typescript", "usdc", "web3"],
    readme: "README-clawtrustmolts.md",
  },
  openclaw: {
    description: "Your own personal AI assistant. Any OS. Any Platform. The lobster way.",
    topics: [],
    skipTopics: true,
    note: "OpenClaw is a separate project (personal AI assistant), not ClawTrust-specific. Topics/README managed independently.",
  },
};

async function apiCall(url, method = "GET", body = null) {
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(url, opts);
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${url} → ${res.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

async function updateRepoMeta(repo, config) {
  console.log(`\n--- ${repo} ---`);
  if (config.note) console.log(`  Note: ${config.note}`);
  console.log(`  Updating description...`);
  await apiCall(`${API}/repos/${OWNER}/${repo}`, "PATCH", { description: config.description });
  if (!config.skipTopics && config.topics.length > 0) {
    console.log(`  Updating topics (${config.topics.length})...`);
    await apiCall(`${API}/repos/${OWNER}/${repo}/topics`, "PUT", { names: config.topics });
  }
  console.log(`  Done.`);
}

async function updateReadme(repo, localFile) {
  const filePath = path.join(__dirname, localFile);
  if (!fs.existsSync(filePath)) {
    console.log(`  README file not found: ${filePath}, skipping.`);
    return;
  }

  const content = fs.readFileSync(filePath, "utf8");
  const encoded = Buffer.from(content).toString("base64");

  let sha;
  try {
    const existing = await apiCall(`${API}/repos/${OWNER}/${repo}/contents/README.md`);
    sha = existing.sha;
  } catch (e) {
    console.log(`  No existing README found, creating new.`);
  }

  const body = {
    message: "docs: update README with ERC-8183, SDK v1.10.0, 9 contracts",
    content: encoded,
    branch: "main",
  };
  if (sha) body.sha = sha;

  console.log(`  Pushing README.md...`);
  await apiCall(`${API}/repos/${OWNER}/${repo}/contents/README.md`, "PUT", body);
  console.log(`  README updated.`);
}

async function main() {
  console.log("ClawTrust GitHub Sync");
  console.log("=====================");
  console.log(`Owner: ${OWNER}`);

  const user = await apiCall(`${API}/user`);
  console.log(`Authenticated as: ${user.login}`);

  for (const [repo, config] of Object.entries(REPO_UPDATES)) {
    try {
      await updateRepoMeta(repo, config);
      if (config.readme) {
        await updateReadme(repo, config.readme);
      }
    } catch (e) {
      console.error(`  ERROR on ${repo}: ${e.message}`);
    }
  }

  console.log("\nSync complete.");
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
