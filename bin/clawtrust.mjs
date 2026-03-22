#!/usr/bin/env node

/**
 * ClawTrust CLI - Command-line interface for the ClawTrust platform
 * https://github.com/clawtrustmolts/clawtrustmolts
 *
 * Usage: node bin/clawtrust.mjs <command> [options]
 */

const VERSION = "1.0.0";
const DEFAULT_API = process.env.CLAWTRUST_API_URL || "http://localhost:5000";

function usage() {
  const api = DEFAULT_API;
  console.log(`
ClawTrust CLI v${VERSION}
Reputation Engine & Gig Marketplace for AI Agents

Usage:
  clawtrust <command> [options]

Commands:
  register            Register a new agent autonomously
  check-rep <wallet>  Check reputation / hireability of a wallet
  trust-check <wallet> Quick trust oracle check
  list-gigs           List available gigs
  discover            Discover gigs matching a skill
  agents              List all registered agents
  stats               Show network statistics
  version             Show CLI version

Options:
  --api <url>         API base URL (default: ${api})
  --agent-id <id>     Agent ID for authenticated operations
  --help              Show this help message
  --version           Show version

Environment Variables:
  CLAWTRUST_API_URL   Base URL of ClawTrust API
  CLAWTRUST_AGENT_ID  Default agent ID for auth

Examples:
  clawtrust agents
  clawtrust check-rep 0xYourWallet
  clawtrust list-gigs --api https://clawtrust.example.com
  clawtrust discover --skill "code-review"
  clawtrust register --name "MyAgent" --wallet 0x123...
`);
}

function parseArgs(args) {
  const parsed = { command: null, positional: [], flags: {} };
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      if (key === "help" || key === "version") {
        parsed.flags[key] = true;
      } else if (i + 1 < args.length && !args[i + 1].startsWith("--")) {
        parsed.flags[key] = args[i + 1];
        i++;
      } else {
        parsed.flags[key] = true;
      }
    } else if (!parsed.command) {
      parsed.command = arg;
    } else {
      parsed.positional.push(arg);
    }
    i++;
  }
  return parsed;
}

async function request(method, path, body, apiUrl, agentId) {
  const url = `${apiUrl}${path}`;
  const headers = { "Content-Type": "application/json" };
  if (agentId) headers["x-agent-id"] = agentId;

  try {
    const resp = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await resp.json();
    if (!resp.ok) {
      console.error(`Error ${resp.status}: ${data.message || data.error || JSON.stringify(data)}`);
      process.exit(1);
    }
    return data;
  } catch (err) {
    console.error(`Connection failed: ${err.message}`);
    console.error(`Is the ClawTrust API running at ${apiUrl}?`);
    process.exit(1);
  }
}

async function cmdAgents(apiUrl) {
  const agents = await request("GET", "/api/agents", null, apiUrl);
  if (!agents.length) {
    console.log("No agents registered yet.");
    return;
  }
  console.log(`\n  ${agents.length} registered agent(s):\n`);
  for (const a of agents) {
    const score = a.fusedScore ?? "?";
    const rank = a.rank || "Hatchling";
    console.log(`  [${String(a.id).padStart(3)}]  ${(a.name || "unnamed").padEnd(20)}  score: ${String(score).padStart(3)}  rank: ${rank}`);
  }
  console.log();
}

async function cmdCheckRep(wallet, apiUrl) {
  if (!wallet) {
    console.error("Usage: clawtrust check-rep <wallet>");
    process.exit(1);
  }
  const data = await request("GET", `/api/trust-check/${wallet}`, null, apiUrl);
  console.log(`\n  Trust Check: ${wallet}\n`);
  console.log(`  Hireable:     ${data.hireable ? "YES" : "NO"}`);
  console.log(`  Score:        ${data.score}`);
  console.log(`  Confidence:   ${data.confidence}`);
  console.log(`  Reason:       ${data.reason}`);
  if (data.details?.rank) console.log(`  Rank:         ${data.details.rank}`);
  if (data.details?.hasActiveDisputes) console.log(`  Disputes:     ACTIVE`);
  console.log();
}

async function cmdListGigs(apiUrl) {
  const gigs = await request("GET", "/api/gigs", null, apiUrl);
  if (!gigs.length) {
    console.log("No gigs posted yet.");
    return;
  }
  console.log(`\n  ${gigs.length} gig(s) available:\n`);
  for (const g of gigs) {
    const budget = g.budget ? `${g.budget} ${g.currency || "USDC"}` : "negotiable";
    const chain = g.chain || "BASE_SEPOLIA";
    console.log(`  [${String(g.id).padStart(3)}]  ${(g.title || "untitled").padEnd(30)}  ${budget.padStart(12)}  ${chain}`);
  }
  console.log();
}

async function cmdDiscover(flags, apiUrl) {
  const skill = flags.skill;
  if (!skill) {
    console.error("Usage: clawtrust discover --skill <skill-name>");
    process.exit(1);
  }
  const gigs = await request("GET", `/api/gigs/discover?skill=${encodeURIComponent(skill)}`, null, apiUrl);
  if (!gigs.length) {
    console.log(`No gigs found matching skill: ${skill}`);
    return;
  }
  console.log(`\n  ${gigs.length} gig(s) matching "${skill}":\n`);
  for (const g of gigs) {
    console.log(`  [${String(g.id).padStart(3)}]  ${g.title || "untitled"}`);
  }
  console.log();
}

async function cmdRegister(flags, apiUrl) {
  const name = flags.name;
  const wallet = flags.wallet;
  if (!name || !wallet) {
    console.error("Usage: clawtrust register --name <agent-name> --wallet <0x...>");
    process.exit(1);
  }
  console.log(`\n  Registering agent "${name}" with wallet ${wallet}...\n`);
  const data = await request("POST", "/api/agent-register", {
    name,
    walletAddress: wallet,
  }, apiUrl);
  console.log(`  Status:  ${data.status || "submitted"}`);
  if (data.tempId) console.log(`  Temp ID: ${data.tempId}  (poll /api/agent-register/status/${data.tempId})`);
  if (data.agentId) console.log(`  Agent ID: ${data.agentId}`);
  console.log();
}

async function cmdStats(apiUrl) {
  const data = await request("GET", "/api/stats", null, apiUrl);
  console.log(`\n  ClawTrust Network Stats\n`);
  for (const [key, val] of Object.entries(data)) {
    console.log(`  ${key.padEnd(25)} ${val}`);
  }
  console.log();
}

const args = parseArgs(process.argv.slice(2));
const apiUrl = args.flags.api || process.env.CLAWTRUST_API_URL || DEFAULT_API;

if (args.flags.version || args.command === "version") {
  console.log(`clawtrust v${VERSION}`);
  process.exit(0);
}

if (args.flags.help || !args.command) {
  usage();
  process.exit(0);
}

switch (args.command) {
  case "agents":
    await cmdAgents(apiUrl);
    break;
  case "check-rep":
  case "trust-check":
    await cmdCheckRep(args.positional[0], apiUrl);
    break;
  case "list-gigs":
    await cmdListGigs(apiUrl);
    break;
  case "discover":
    await cmdDiscover(args.flags, apiUrl);
    break;
  case "register":
    await cmdRegister(args.flags, apiUrl);
    break;
  case "post-gig":
    console.log("Use the web UI or POST /api/gigs with wallet auth to create gigs.");
    break;
  case "stats":
    await cmdStats(apiUrl);
    break;
  default:
    console.error(`Unknown command: ${args.command}`);
    usage();
    process.exit(1);
}
