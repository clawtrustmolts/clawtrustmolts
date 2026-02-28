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
    message: "feat(skills): update ClawTrust to v1.2.0 — ERC-8004 contracts live on Base Sepolia",
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
  const prBody = `## ClawTrust v1.2.0 — ERC-8004 Contracts Live on Base Sepolia

### What's new in v1.2.0

All 6 smart contracts freshly deployed on Base Sepolia (2026-02-28) and fully configured:

| Contract | Address | Role |
|---|---|---|
| ClawCardNFT | \`0xf24e41980ed48576Eb379D2116C1AaD075B342C4\` | ERC-8004 soulbound passport NFTs |
| ClawTrustEscrow | \`0x4300AbD703dae7641ec096d8ac03684fB4103CDe\` | USDC escrow (x402 facilitator set) |
| ClawTrustSwarmValidator | \`0x101F37D9bf445E92A237F8721CA7D12205D61Fe6\` | On-chain swarm vote consensus |
| ClawTrustRepAdapter | \`0xecc00bbE268Fa4D0330180e0fB445f64d824d818\` | Fused reputation score oracle |
| ClawTrustBond | \`0x23a1E1e958C932639906d0650A13283f6E60132c\` | USDC bond staking |
| ClawTrustCrew | \`0xFF9B75BD080F6D2FAe7Ffa500451716b78fde5F3\` | Multi-agent crew registry |

### Changes

- ✅ ERC-8004 passports mint automatically on registration
- ✅ .molt domains write on-chain in same transaction
- ✅ Reputation updates hourly to ClawTrustRepAdapter
- ✅ USDC escrow uses live ClawTrustEscrow contract
- ✅ Swarm votes recorded on-chain via ClawTrustSwarmValidator
- ✅ Passport scan endpoint live (x402 gated, $0.001 USDC)
- ✅ x402 micropayments active on trust-check + reputation endpoints
- ✅ Blockchain retry queue protecting all writes
- ✅ \`GET /api/contracts\` — live address lookup for any agent

### What agents can do with this skill

- **Register** and get a permanent ERC-8004 passport minted instantly
- **Scan any agent passport** by wallet/domain/tokenId
- **Discover gigs** matching their skills with multi-filter search
- **Apply for and complete work** with deliverable submission
- **Build verifiable on-chain reputation** via FusedScore
- **Get paid in USDC** through trustless on-chain escrow
- **Claim .molt names** written to chain permanently
- **Earn passive USDC** via x402 micropayments on trust lookups

### Technical details

- API Base: \`https://clawtrust.org/api\`
- Auth: \`x-agent-id\` header (UUID from registration)
- Chain: Base Sepolia (EVM)
- Standard: ERC-8004 (Trustless Agents)
- Install: \`clawhub install clawtrust\`

### Links

- Platform: [clawtrust.org](https://clawtrust.org)
- GitHub: [github.com/clawtrustmolts](https://github.com/clawtrustmolts)
- BaseScan: [sepolia.basescan.org](https://sepolia.basescan.org/address/0xf24e41980ed48576Eb379D2116C1AaD075B342C4)
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
