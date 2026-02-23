import { readFileSync } from "fs";

const TOKEN = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
const UPSTREAM = "openclaw/openclaw";
const BRANCH = "feat/add-clawtrust-skill";
const FILE_PATH = "skills/clawtrust/SKILL.md";

async function gh(endpoint, opts = {}) {
  const url = endpoint.startsWith("http") ? endpoint : `https://api.github.com${endpoint}`;
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: "application/vnd.github.v3+json",
      "Content-Type": "application/json",
      ...opts.headers,
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok && res.status !== 422) {
    console.error(`GitHub API error ${res.status}:`, data);
    throw new Error(`GitHub API ${res.status}`);
  }
  return { status: res.status, data };
}

async function main() {
  console.log("1. Forking openclaw/openclaw...");
  const forkRes = await gh(`/repos/${UPSTREAM}/forks`, { method: "POST", body: JSON.stringify({}) });
  const forkOwner = forkRes.data.owner?.login || forkRes.data.full_name?.split("/")[0];
  console.log(`   Fork: ${forkOwner}/openclaw (status: ${forkRes.status})`);

  console.log("2. Waiting for fork to be ready...");
  await new Promise(r => setTimeout(r, 5000));

  console.log("3. Getting default branch ref...");
  const mainRef = await gh(`/repos/${forkOwner}/openclaw/git/ref/heads/main`);
  const baseSha = mainRef.data.object.sha;
  console.log(`   Base SHA: ${baseSha}`);

  console.log("4. Creating branch...");
  try {
    await gh(`/repos/${forkOwner}/openclaw/git/refs`, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${BRANCH}`, sha: baseSha }),
    });
    console.log(`   Branch created: ${BRANCH}`);
  } catch (e) {
    console.log("   Branch may already exist, updating...");
    await gh(`/repos/${forkOwner}/openclaw/git/refs/heads/${BRANCH}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: baseSha, force: true }),
    });
  }

  console.log("5. Creating file on branch...");
  const content = readFileSync("openclaw-skill-submission/clawtrust/SKILL.md", "utf8");
  const b64 = Buffer.from(content).toString("base64");

  let existingSha;
  try {
    const existing = await gh(`/repos/${forkOwner}/openclaw/contents/${FILE_PATH}?ref=${BRANCH}`);
    existingSha = existing.data.sha;
  } catch {}

  const fileBody = {
    message: "feat(skills): add ClawTrust — the trust layer for the agent economy",
    content: b64,
    branch: BRANCH,
  };
  if (existingSha) fileBody.sha = existingSha;

  await gh(`/repos/${forkOwner}/openclaw/contents/${FILE_PATH}`, {
    method: "PUT",
    body: JSON.stringify(fileBody),
  });
  console.log("   File created/updated");

  console.log("6. Creating Pull Request...");
  const prBody = `## Add ClawTrust Skill — The Trust Layer for the Agent Economy

### What this adds

A new skill that enables OpenClaw agents to autonomously interact with [ClawTrust](https://clawtrust.org), the trust layer for the agent economy — where AI agents earn their name.

### What agents can do with this skill

- **Register** an on-chain identity (ERC-8004 on Base Sepolia)
- **Discover gigs** matching their skills with multi-filter search
- **Apply for and complete work** with deliverable submission
- **Build verifiable reputation** via FusedScore (on-chain + performance + bond reliability)
- **Get paid in USDC** through secure escrow with swarm validation

### Technical details

- API Base: \`https://clawtrust.org/api\`
- Auth: \`x-agent-id\` header (UUID from registration)
- Chains: Base Sepolia, Solana Devnet
- Install: Downloads extended integration guide from GitHub

### Links

- Platform: [clawtrust.org](https://clawtrust.org)
- GitHub: [github.com/clawtrustmolts/clawtrustmolts](https://github.com/clawtrustmolts/clawtrustmolts)
- Full integration docs: [clawtrust-skill repo](https://github.com/clawtrustmolts/clawtrust-skill)
`;

  const prRes = await gh(`/repos/${UPSTREAM}/pulls`, {
    method: "POST",
    body: JSON.stringify({
      title: "feat(skills): add ClawTrust — the trust layer for the agent economy",
      body: prBody,
      head: `${forkOwner}:${BRANCH}`,
      base: "main",
    }),
  });

  if (prRes.status === 422) {
    console.log("   PR may already exist:", prRes.data.errors?.[0]?.message || "already exists");
  } else {
    console.log(`   PR created: ${prRes.data.html_url}`);
  }

  console.log("\nDone!");
}

main().catch(console.error);
