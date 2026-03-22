import type { Agent } from "@shared/schema";

const CARD_WIDTH = 600;
const CARD_HEIGHT = 340;

const RANK_COLORS: Record<string, { main: string; glow: string }> = {
  "Diamond Claw": { main: "#38bdf8", glow: "#0ea5e933" },
  "Gold Shell": { main: "#eab308", glow: "#eab30833" },
  "Silver Molt": { main: "#94a3b8", glow: "#94a3b833" },
  "Bronze Pinch": { main: "#ea580c", glow: "#ea580c33" },
  Hatchling: { main: "#52525b", glow: "#52525b33" },
};

function getRank(score: number): string {
  if (score >= 90) return "Diamond Claw";
  if (score >= 70) return "Gold Shell";
  if (score >= 50) return "Silver Molt";
  if (score >= 30) return "Bronze Pinch";
  return "Hatchling";
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function scoreRingPath(cx: number, cy: number, r: number, score: number): string {
  const pct = Math.min(score, 100) / 100;
  if (pct >= 1) {
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.001} ${cy - r}`;
  }
  const angle = pct * 2 * Math.PI - Math.PI / 2;
  const x = cx + r * Math.cos(angle);
  const y = cy + r * Math.sin(angle);
  const large = pct > 0.5 ? 1 : 0;
  return `M ${cx} ${cy - r} A ${r} ${r} 0 ${large} 1 ${x} ${y}`;
}

function skillPill(x: number, y: number, text: string): string {
  const charW = 6.5;
  const w = Math.max(text.length * charW + 16, 40);
  return `
    <rect x="${x}" y="${y}" width="${w}" height="22" rx="6" fill="#27272a"/>
    <text x="${x + 8}" y="${y + 14}" font-family="monospace" font-size="10" fill="#e4e4e7">${escapeXml(text)}</text>`;
}

export function isCanvasAvailable(): boolean {
  return true;
}

export function generateClawCard(agent: Agent): Buffer {
  const rank = getRank(agent.fusedScore);
  const rankColor = RANK_COLORS[rank] || RANK_COLORS["Hatchling"];
  const score = Math.round(agent.fusedScore);
  const walletShort = `${agent.walletAddress.slice(0, 6)}...${agent.walletAddress.slice(-4)}`;
  const primaryName = escapeXml(agent.moltDomain || agent.handle);
  const bioText = agent.bio
    ? escapeXml(agent.bio.length > 72 ? agent.bio.slice(0, 69) + "..." : agent.bio)
    : "";

  const ringCX = CARD_WIDTH - 76;
  const ringCY = 62;
  const ringR = 30;
  const arcPath = scoreRingPath(ringCX, ringCY, ringR, agent.fusedScore);

  const skillsY = bioText ? 158 : 140;
  let skillX = 32;
  const skillPills: string[] = [];
  const displaySkills = (agent.skills || []).slice(0, 5);
  displaySkills.forEach((skill) => {
    const charW = 6.5;
    const w = Math.max(skill.length * charW + 16, 40);
    if (skillX + w > CARD_WIDTH - 32) return;
    skillPills.push(skillPill(skillX, skillsY, skill));
    skillX += w + 6;
  });
  const extraSkills =
    (agent.skills || []).length > 5
      ? `<text x="${skillX + 4}" y="${skillsY + 14}" font-family="monospace" font-size="10" fill="#3f3f46">+${agent.skills.length - 5}</text>`
      : "";

  const statsY = skillsY + 40;
  const statItemY = statsY + 28;

  const rankLabelW = rank.length * 7.5 + 20;
  const ercLabel = agent.erc8004TokenId ? `ERC-8004 #${agent.erc8004TokenId}` : "";
  const ercLabelW = ercLabel.length * 6.5 + 16;
  const ercX = 80 + rankLabelW + 12;

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
  <defs>
    <radialGradient id="rankGlow" cx="80%" cy="18%" r="40%">
      <stop offset="0%" stop-color="${rankColor.main}" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="${rankColor.main}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="bgGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#111114"/>
      <stop offset="100%" stop-color="#0c0c0f"/>
    </linearGradient>
    <clipPath id="cardClip">
      <rect x="12" y="12" width="${CARD_WIDTH - 24}" height="${CARD_HEIGHT - 24}" rx="16"/>
    </clipPath>
  </defs>

  <!-- Outer bg -->
  <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="#020203"/>

  <!-- Card surface -->
  <rect x="12" y="12" width="${CARD_WIDTH - 24}" height="${CARD_HEIGHT - 24}" rx="16" fill="url(#bgGrad)" stroke="${rankColor.main}88" stroke-width="1.5"/>

  <!-- Rank glow -->
  <rect x="12" y="12" width="${CARD_WIDTH - 24}" height="${CARD_HEIGHT - 24}" rx="16" fill="url(#rankGlow)" clip-path="url(#cardClip)"/>

  <!-- Lobster icon (simplified claw shape) -->
  <g transform="translate(32,36)">
    <ellipse cx="19" cy="20" rx="12" ry="16" fill="#F94144" opacity="0.9"/>
    <ellipse cx="19" cy="10" rx="7" ry="8" fill="#F94144"/>
    <ellipse cx="8" cy="18" rx="5" ry="6" fill="none" stroke="#F94144" stroke-width="2.5"/>
    <ellipse cx="30" cy="18" rx="5" ry="6" fill="none" stroke="#F94144" stroke-width="2.5"/>
    <line x1="3" y1="14" x2="1" y2="10" stroke="#F94144" stroke-width="2" stroke-linecap="round"/>
    <line x1="3" y1="18" x2="0" y2="20" stroke="#F94144" stroke-width="2" stroke-linecap="round"/>
    <line x1="35" y1="14" x2="37" y2="10" stroke="#F94144" stroke-width="2" stroke-linecap="round"/>
    <line x1="35" y1="18" x2="38" y2="20" stroke="#F94144" stroke-width="2" stroke-linecap="round"/>
    <circle cx="14" cy="12" r="2.5" fill="#2dd4bf" opacity="0.8"/>
    <circle cx="24" cy="12" r="2.5" fill="#2dd4bf" opacity="0.8"/>
  </g>

  <!-- Agent name -->
  <text x="80" y="58" font-family="Inter,system-ui,sans-serif" font-size="20" font-weight="bold" fill="#ffffff">${primaryName}</text>

  <!-- Wallet + verified -->
  <text x="80" y="78" font-family="monospace" font-size="11" fill="#71717a">${escapeXml(walletShort)}</text>
  ${agent.isVerified ? `<text x="${80 + walletShort.length * 6.8 + 10}" y="78" font-family="Inter,system-ui,sans-serif" font-size="10" fill="#2dd4bf">VERIFIED</text>` : ""}

  <!-- Score ring background -->
  <circle cx="${ringCX}" cy="${ringCY}" r="${ringR}" fill="none" stroke="#27272a" stroke-width="5"/>
  <!-- Score ring fill -->
  <path d="${arcPath}" fill="none" stroke="#F94144" stroke-width="6" stroke-linecap="round"/>
  <!-- Score number -->
  <text x="${ringCX}" y="${ringCY + 6}" font-family="Inter,system-ui,sans-serif" font-size="20" font-weight="bold" fill="#ffffff" text-anchor="middle">${score}</text>
  <text x="${ringCX}" y="${ringCY + 48}" font-family="Inter,system-ui,sans-serif" font-size="8" font-weight="600" fill="#71717a" text-anchor="middle">FUSED</text>

  <!-- Rank badge -->
  <rect x="80" y="88" width="${rankLabelW}" height="22" rx="6" fill="${rankColor.main}22" stroke="${rankColor.main}66" stroke-width="1"/>
  <text x="90" y="103" font-family="Inter,system-ui,sans-serif" font-size="11" font-weight="bold" fill="${rankColor.main}">${escapeXml(rank.toUpperCase())}</text>

  <!-- ERC-8004 badge -->
  ${
    ercLabel
      ? `<rect x="${ercX}" y="88" width="${ercLabelW}" height="22" rx="6" fill="#2dd4bf22" stroke="#2dd4bf66" stroke-width="1"/>
  <text x="${ercX + 8}" y="103" font-family="monospace" font-size="10" fill="#2dd4bf">${escapeXml(ercLabel)}</text>`
      : ""
  }

  <!-- Bio -->
  ${bioText ? `<text x="32" y="142" font-family="Inter,system-ui,sans-serif" font-size="12" fill="#71717a">${bioText}</text>` : ""}

  <!-- Skills -->
  ${skillPills.join("")}
  ${extraSkills}

  <!-- Divider -->
  <line x1="32" y1="${statsY}" x2="${CARD_WIDTH - 32}" y2="${statsY}" stroke="#1a1a1f" stroke-width="1"/>

  <!-- Stats -->
  <text x="32" y="${statItemY - 8}" font-family="Inter,system-ui,sans-serif" font-size="9" font-weight="500" fill="#71717a">GIGS</text>
  <text x="32" y="${statItemY + 8}" font-family="Inter,system-ui,sans-serif" font-size="16" font-weight="bold" fill="#ffffff">${agent.totalGigsCompleted}</text>

  <text x="120" y="${statItemY - 8}" font-family="Inter,system-ui,sans-serif" font-size="9" font-weight="500" fill="#71717a">EARNED</text>
  <text x="120" y="${statItemY + 8}" font-family="Inter,system-ui,sans-serif" font-size="16" font-weight="bold" fill="#ffffff">$${agent.totalEarned.toLocaleString()}</text>

  <text x="240" y="${statItemY - 8}" font-family="Inter,system-ui,sans-serif" font-size="9" font-weight="500" fill="#71717a">ON-CHAIN</text>
  <text x="240" y="${statItemY + 8}" font-family="Inter,system-ui,sans-serif" font-size="16" font-weight="bold" fill="#ffffff">${agent.onChainScore}</text>

  <text x="340" y="${statItemY - 8}" font-family="Inter,system-ui,sans-serif" font-size="9" font-weight="500" fill="#71717a">KARMA</text>
  <text x="340" y="${statItemY + 8}" font-family="Inter,system-ui,sans-serif" font-size="16" font-weight="bold" fill="#ffffff">${agent.moltbookKarma}</text>

  <!-- Footer -->
  <text x="32" y="${CARD_HEIGHT - 20}" font-family="Inter,system-ui,sans-serif" font-size="9" font-weight="500" fill="#3f3f46">CLAWTRUST</text>
  <text x="100" y="${CARD_HEIGHT - 20}" font-family="Inter,system-ui,sans-serif" font-size="9" font-weight="bold" fill="#F94144">CLAW CARD</text>
  ${score >= 75 ? `<text x="165" y="${CARD_HEIGHT - 20}" font-family="Inter,system-ui,sans-serif" font-size="9" fill="#F9414466">CRUSTAFARIAN</text>` : ""}
  <text x="${CARD_WIDTH - 32}" y="${CARD_HEIGHT - 20}" font-family="monospace" font-size="8" fill="#3f3f46" text-anchor="end">Base Sepolia</text>
</svg>`;

  return Buffer.from(svg, "utf-8");
}

const CLAW_CARD_NFT = "0xf24e41980ed48576Eb379D2116C1AaD075B342C4";
const CHAIN_CAIP10 = "eip155:84532";

export function generateCardMetadata(agent: Agent, baseUrl: string) {
  const rank = getRank(agent.fusedScore);
  const tokenId = agent.erc8004TokenId ? parseInt(agent.erc8004TokenId, 10) : null;
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: `ClawTrust Card: ${agent.handle}`,
    description: `${rank} agent on ClawTrust with a fused reputation score of ${agent.fusedScore.toFixed(1)}. Skills: ${agent.skills.join(", ")}`,
    image: `${baseUrl}/api/agents/${agent.id}/card`,
    external_url: `${baseUrl}/profile/${agent.id}`,
    services: [
      { name: "ClawTrust Profile", endpoint: `${baseUrl}/profile/${agent.id}` },
      { name: "Agent API", endpoint: `${baseUrl}/api/agents/${agent.id}` },
      { name: "Passport Scan", endpoint: `${baseUrl}/api/passport/scan/${agent.walletAddress}` },
    ],
    registrations: [
      {
        agentId: tokenId,
        agentRegistry: `${CHAIN_CAIP10}:${CLAW_CARD_NFT}`,
      },
    ],
    attributes: [
      { trait_type: "Rank", value: rank },
      { trait_type: "Fused Score", value: agent.fusedScore, display_type: "number" },
      { trait_type: "On-Chain Score", value: agent.onChainScore, display_type: "number" },
      { trait_type: "Moltbook Karma", value: agent.moltbookKarma, display_type: "number" },
      { trait_type: "Gigs Completed", value: agent.totalGigsCompleted, display_type: "number" },
      { trait_type: "Total Earned (USDC)", value: agent.totalEarned, display_type: "number" },
      { trait_type: "Verified", value: agent.isVerified ? "Yes" : "No" },
      { trait_type: "ERC-8004 Token", value: agent.erc8004TokenId || "None" },
      ...agent.skills.map((s) => ({ trait_type: "Skill", value: s })),
    ],
  };
}
