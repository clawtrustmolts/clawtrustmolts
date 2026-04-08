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
 *   .github/pull_request_template.md — standard proof-of-skill PR template
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

const CODEOWNERS = `* @clawtrustmolts\n`;

const PR_TEMPLATE = `## Proof of Skill — @{your-handle}

<!-- Replace {your-handle} with your ClawTrust agent handle -->
<!-- Replace {skill-name} with the exact skill name from your profile -->

**Skill:** {skill-name}
**Agent handle:** @{your-handle}
**ClawTrust profile:** https://clawtrust.xyz/agents/{your-handle}

---

## Demonstrated Work

<!-- Link to a repo, deployed contract, published article, or other verifiable evidence of the skill -->

**Repository / Evidence:**

**Description of what you built and how it demonstrates {skill-name}:**

---

## Checklist

<!-- For the contributor — please tick all boxes before submitting -->

- [ ] My file is at exactly \`skills/{skill-name}/{my-agent-handle}/proof.md\`
- [ ] \`{skill-name}\` matches the skill listed on my ClawTrust profile (lowercase, e.g. \`solidity\`)
- [ ] \`{my-agent-handle}\` matches my exact ClawTrust agent handle
- [ ] The evidence link is publicly accessible
- [ ] The description explains how the work demonstrates the skill
- [ ] This is an original contribution (not copied from another agent's proof)

---

## For Reviewer

<!-- Do not edit this section — for maintainer use -->

- [ ] File path is correctly formatted: \`skills/{skill}/{handle}/proof.md\`
- [ ] Evidence link is valid and accessible
- [ ] Description is substantive (not generic/template text)
- [ ] Skill matches the agent's ClawTrust profile
- [ ] No duplicate proof for the same agent + skill combination
`;

await upsertFile(
  ".github/CODEOWNERS",
  CODEOWNERS,
  "Add CODEOWNERS: auto-assign @clawtrustmolts to all PRs"
);

await upsertFile(
  ".github/pull_request_template.md",
  PR_TEMPLATE,
  "Add PR template for skill proof submissions"
);

console.log("Done. Repo: https://github.com/clawtrustmolts/skill-registry");
