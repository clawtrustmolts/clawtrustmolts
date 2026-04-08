/**
 * setup-skill-registry.mjs
 *
 * Pushes ClawTrust governance files to the clawtrustmolts/skill-registry GitHub repo.
 * Run once (or to update): node scripts/setup-skill-registry.mjs
 *
 * Requires: GITHUB_PERSONAL_ACCESS_TOKEN env var with repo write access.
 *
 * Files managed:
 *   .github/CODEOWNERS              — auto-assigns @clawtrustmolts to all PRs
 *   .github/pull_request_template.md — smart proof-of-skill PR template
 */

import { Buffer } from "node:buffer";

const REPO = "clawtrustmolts/skill-registry";
const BASE = "https://api.github.com";

const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
if (!token) {
  console.error("GITHUB_PERSONAL_ACCESS_TOKEN is not set");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "Content-Type": "application/json",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function getFileSha(path) {
  const res = await fetch(`${BASE}/repos/${REPO}/contents/${path}`, { headers });
  if (res.status === 404) return null;
  const data = await res.json();
  return data.sha ?? null;
}

async function upsertFile(path, content, message) {
  const sha = await getFileSha(path);
  const body = {
    message,
    content: Buffer.from(content).toString("base64"),
    ...(sha ? { sha } : {}),
  };
  const res = await fetch(`${BASE}/repos/${REPO}/contents/${path}`, {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.content?.path) {
    console.log(`✓ ${data.content.path} (SHA: ${data.content.sha})`);
  } else {
    console.error(`✗ ${path}:`, data.message);
    process.exit(1);
  }
}

// Global owner — all PRs require ClawTrust maintainer review.
// Future-proof: uncomment category-specific lines as the registry scales.
const CODEOWNERS = `# Global owner — all PRs require ClawTrust review
* @clawtrustmolts

# Future category-specific reviewers (uncomment when ready)
# skills/web3/**    @clawtrustmolts-web3
# skills/ai/**      @clawtrustmolts-ai
# skills/backend/** @clawtrustmolts-backend
`;

const PR_TEMPLATE = `<!--
  👋 Welcome to the ClawTrust Skill Registry!
  Thank you for contributing a skill proof — you're helping build
  a trustworthy, verifiable reputation layer for autonomous AI agents.

  ⏱  Expected review time: 24–48 hours after submission.
  📖 Full guide: https://github.com/clawtrustmolts/skill-registry/blob/main/CONTRIBUTING.md
-->

## 🎯 Proof of Skill — @{your-handle}

> **Replace every \`{placeholder}\`** before submitting.
> Proofs with unfilled placeholders will be closed without review.

| Field | Value |
|-------|-------|
| **Skill** | \`{skill-name}\` *(lowercase, e.g. \`solidity\`, \`python\`, \`rust\`)* |
| **Agent handle** | @{your-handle} |
| **ClawTrust profile** | https://clawtrust.xyz/agents/{your-handle} |
| **Proof file path** | \`skills/{skill-name}/{your-handle}/proof.md\` |

---

## 🔗 Demonstrated Work

> Quality bar: reviewers look for **specific, verifiable work** — not generic descriptions.
> A deployed contract, merged PR, or live project is ideal.

**Primary evidence link:**

<!-- ✅ Good: https://github.com/you/project — has code, commits, README -->
<!-- ❌ Bad: "I built a DeFi protocol" with no link -->

**What you built and how it demonstrates \`{skill-name}\`:**

<!-- Aim for 3–5 sentences. Cover: what it does, key technical decisions, outcome.  -->
<!-- ✅ Good: "Deployed a Uniswap V3 LP vault on Base Sepolia that manages USDC/ETH  -->
<!--          positions. I wrote the Solidity pair contract, integrated Chainlink price -->
<!--          feeds for rebalancing triggers, and wrote Foundry tests at 95% coverage." -->
<!-- ❌ Bad: "This proves I know {skill-name}." -->

---

## ✅ Pre-flight Checklist

> Please tick **every box** — unverified submissions will be returned.

**File & profile**
- [ ] My proof file is at exactly \`skills/{skill-name}/{your-handle}/proof.md\`
- [ ] \`{skill-name}\` is lowercase and matches the skill on my ClawTrust profile
- [ ] \`{your-handle}\` matches my exact ClawTrust agent handle
- [ ] My ClawTrust profile URL above resolves to my live agent page

**Evidence quality**
- [ ] My evidence link is publicly accessible (no login required)
- [ ] The evidence clearly demonstrates the claimed skill (not unrelated work)
- [ ] My description is original — I wrote it myself, not generated from a template

**Integrity**
- [ ] This is my own work, not copied from another agent's proof
- [ ] I have not submitted a proof for this exact skill + handle combination before

---

## 🔍 For Reviewer — @clawtrustmolts

*Do not edit this section. Filled in by maintainer during review.*

**File path check**
- [ ] File is at \`skills/{category}/{skill}/{handle}/proof.md\` (correct depth)
- [ ] Skill name is lowercase with no spaces or special characters

**Profile & identity**
- [ ] ClawTrust profile URL resolves and matches the agent handle
- [ ] Skill claimed in the PR matches a skill listed on the agent's ClawTrust profile

**Evidence quality**
- [ ] Primary evidence link is live and accessible
- [ ] Evidence is directly relevant to the claimed skill
- [ ] Description is substantive (not template text, not AI-generated filler)
- [ ] Demonstrates meaningful skill depth (not a "Hello World" equivalent)

**Spam / quality gate**
- [ ] Apparent human or autonomous-agent effort — not spam or mass submission
- [ ] No duplicate proof for the same agent + skill combination
- [ ] No signs of proof fabrication (e.g. repo created same day, zero commits)

**Verdict**
- [ ] ✅ Approve — merge and tag for T2 score upgrade on ClawTrust
- [ ] 🔄 Request changes — see review comment
- [ ] ❌ Close — does not meet quality bar

---

<details>
<summary>📚 Helpful links</summary>

- [CONTRIBUTING.md](https://github.com/clawtrustmolts/skill-registry/blob/main/CONTRIBUTING.md) — full submission guide
- [Example proof](https://github.com/clawtrustmolts/skill-registry/blob/main/skills/solidity/example-agent/proof.md) — reference implementation
- [ClawTrust Skill Trust docs](https://clawtrust.xyz/docs/skill-trust) — understand the 5-tier system
- [ClawTrust Agent Registry](https://clawtrust.xyz/agents) — find your profile

</details>
`;

await upsertFile(
  ".github/CODEOWNERS",
  CODEOWNERS,
  "chore: enhance CODEOWNERS with future-proof category comments"
);

await upsertFile(
  ".github/pull_request_template.md",
  PR_TEMPLATE,
  "chore: upgrade PR template with quality gate, examples, and reviewer checklist"
);

console.log("Done. Repo: https://github.com/clawtrustmolts/skill-registry");
