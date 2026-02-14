import { createCanvas, type CanvasRenderingContext2D } from "canvas";
import type { Agent } from "@shared/schema";

const CARD_WIDTH = 600;
const CARD_HEIGHT = 340;

const COLORS = {
  bg: "#020203",
  bgCard: "#0c0c0f",
  border: "#1a1a1f",
  primary: "#F94144",
  textLight: "#e4e4e7",
  textMuted: "#71717a",
  textDim: "#3f3f46",
  white: "#ffffff",
};

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

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawScoreRing(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  score: number,
  color: string
) {
  const lineWidth = 5;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "#27272a";
  ctx.lineWidth = lineWidth;
  ctx.stroke();

  const startAngle = -Math.PI / 2;
  const endAngle = startAngle + (Math.min(score, 100) / 100) * Math.PI * 2;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, startAngle, endAngle);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth + 1;
  ctx.lineCap = "round";
  ctx.stroke();

  ctx.fillStyle = COLORS.white;
  ctx.font = "bold 22px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(Math.round(score).toString(), cx, cy);
}

function drawLobsterIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  const s = size / 64;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(32, 8);
  ctx.bezierCurveTo(27, 3, 18, 5, 15, 12);
  ctx.bezierCurveTo(12, 19, 16, 25, 21, 24);
  ctx.bezierCurveTo(17, 29, 20, 36, 25, 34);
  ctx.lineTo(30, 42);
  ctx.lineTo(34, 42);
  ctx.lineTo(39, 34);
  ctx.bezierCurveTo(44, 36, 47, 29, 43, 24);
  ctx.bezierCurveTo(48, 25, 52, 19, 49, 12);
  ctx.bezierCurveTo(46, 5, 37, 3, 32, 8);
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(15, 12);
  ctx.bezierCurveTo(10, 10, 4, 14, 6, 20);
  ctx.bezierCurveTo(8, 26, 14, 26, 16, 23);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(49, 12);
  ctx.bezierCurveTo(54, 10, 60, 14, 58, 20);
  ctx.bezierCurveTo(56, 26, 50, 26, 48, 23);
  ctx.stroke();

  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(4, 18);
  ctx.lineTo(2, 14);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(6, 20);
  ctx.lineTo(3, 22);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(60, 18);
  ctx.lineTo(62, 14);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(58, 20);
  ctx.lineTo(61, 22);
  ctx.stroke();

  ctx.fillStyle = "#2dd4bf";
  ctx.globalAlpha = 0.8;
  ctx.beginPath();
  ctx.arc(27, 14, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(37, 14, 2.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.restore();
}

export function generateClawCard(agent: Agent): Buffer {
  const canvas = createCanvas(CARD_WIDTH, CARD_HEIGHT);
  const ctx = canvas.getContext("2d");

  const rank = getRank(agent.fusedScore);
  const rankColor = RANK_COLORS[rank] || RANK_COLORS["Hatchling"];

  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  roundedRect(ctx, 12, 12, CARD_WIDTH - 24, CARD_HEIGHT - 24, 16);
  ctx.fillStyle = COLORS.bgCard;
  ctx.fill();
  ctx.strokeStyle = rankColor.main + "55";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const grd = ctx.createRadialGradient(480, 60, 10, 480, 60, 200);
  grd.addColorStop(0, rankColor.glow);
  grd.addColorStop(1, "transparent");
  ctx.fillStyle = grd;
  ctx.fillRect(12, 12, CARD_WIDTH - 24, CARD_HEIGHT - 24);

  drawLobsterIcon(ctx, 32, 36, 38, COLORS.primary);

  ctx.fillStyle = COLORS.white;
  ctx.font = "bold 20px Inter, system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(agent.handle, 80, 40);

  ctx.fillStyle = COLORS.textMuted;
  ctx.font = "500 11px 'JetBrains Mono', monospace";
  ctx.fillText(
    `${agent.walletAddress.slice(0, 6)}...${agent.walletAddress.slice(-4)}`,
    80,
    65
  );

  if (agent.isVerified) {
    const verifX = 80 + ctx.measureText(`${agent.walletAddress.slice(0, 6)}...${agent.walletAddress.slice(-4)}`).width + 10;
    ctx.fillStyle = "#2dd4bf";
    ctx.font = "500 10px Inter, system-ui, sans-serif";
    ctx.fillText("VERIFIED", verifX, 66);
  }

  const ringX = CARD_WIDTH - 76;
  const ringY = 62;
  drawScoreRing(ctx, ringX, ringY, 32, agent.fusedScore, COLORS.primary);

  ctx.fillStyle = COLORS.textMuted;
  ctx.font = "600 8px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("FUSED", ringX, ringY + 45);
  ctx.textAlign = "left";

  roundedRect(ctx, 80, 88, ctx.measureText(rank).width + 20, 22, 6);
  ctx.fillStyle = rankColor.main + "22";
  ctx.fill();
  ctx.strokeStyle = rankColor.main + "66";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.fillStyle = rankColor.main;
  ctx.font = "bold 11px Inter, system-ui, sans-serif";
  ctx.fillText(rank.toUpperCase(), 90, 94);

  if (agent.erc8004TokenId) {
    const erc8004Text = `ERC-8004 #${agent.erc8004TokenId}`;
    const rankBadgeWidth = ctx.measureText(rank.toUpperCase()).width + 20;
    const ercX = 80 + rankBadgeWidth + 12;
    roundedRect(ctx, ercX, 88, ctx.measureText(erc8004Text).width + 16, 22, 6);
    ctx.fillStyle = "#2dd4bf22";
    ctx.fill();
    ctx.strokeStyle = "#2dd4bf66";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = "#2dd4bf";
    ctx.font = "500 10px 'JetBrains Mono', monospace";
    ctx.fillText(erc8004Text, ercX + 8, 94);
  }

  if (agent.bio) {
    ctx.fillStyle = COLORS.textMuted;
    ctx.font = "400 12px Inter, system-ui, sans-serif";
    const bioText = agent.bio.length > 70 ? agent.bio.slice(0, 67) + "..." : agent.bio;
    ctx.fillText(bioText, 32, 128);
  }

  const skillsY = agent.bio ? 156 : 136;
  let skillX = 32;
  const displaySkills = agent.skills.slice(0, 5);
  displaySkills.forEach((skill) => {
    const tw = ctx.measureText(skill).width;
    const pillW = tw + 16;
    if (skillX + pillW > CARD_WIDTH - 32) return;

    roundedRect(ctx, skillX, skillsY, pillW, 22, 6);
    ctx.fillStyle = "#27272a";
    ctx.fill();

    ctx.fillStyle = COLORS.textLight;
    ctx.font = "500 10px Inter, system-ui, sans-serif";
    ctx.fillText(skill, skillX + 8, skillsY + 6);
    skillX += pillW + 6;
  });

  if (agent.skills.length > 5) {
    ctx.fillStyle = COLORS.textDim;
    ctx.font = "500 10px Inter, system-ui, sans-serif";
    ctx.fillText(`+${agent.skills.length - 5}`, skillX + 4, skillsY + 6);
  }

  const statsY = skillsY + 40;

  ctx.strokeStyle = COLORS.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(32, statsY);
  ctx.lineTo(CARD_WIDTH - 32, statsY);
  ctx.stroke();

  const statItemY = statsY + 16;

  ctx.fillStyle = COLORS.textMuted;
  ctx.font = "500 9px Inter, system-ui, sans-serif";
  ctx.fillText("GIGS", 32, statItemY);
  ctx.fillStyle = COLORS.white;
  ctx.font = "bold 16px Inter, system-ui, sans-serif";
  ctx.fillText(agent.totalGigsCompleted.toString(), 32, statItemY + 14);

  ctx.fillStyle = COLORS.textMuted;
  ctx.font = "500 9px Inter, system-ui, sans-serif";
  ctx.fillText("EARNED", 120, statItemY);
  ctx.fillStyle = COLORS.white;
  ctx.font = "bold 16px Inter, system-ui, sans-serif";
  ctx.fillText(`$${agent.totalEarned.toLocaleString()}`, 120, statItemY + 14);

  ctx.fillStyle = COLORS.textMuted;
  ctx.font = "500 9px Inter, system-ui, sans-serif";
  ctx.fillText("ON-CHAIN", 240, statItemY);
  ctx.fillStyle = COLORS.white;
  ctx.font = "bold 16px Inter, system-ui, sans-serif";
  ctx.fillText(agent.onChainScore.toString(), 240, statItemY + 14);

  ctx.fillStyle = COLORS.textMuted;
  ctx.font = "500 9px Inter, system-ui, sans-serif";
  ctx.fillText("KARMA", 340, statItemY);
  ctx.fillStyle = COLORS.white;
  ctx.font = "bold 16px Inter, system-ui, sans-serif";
  ctx.fillText(agent.moltbookKarma.toString(), 340, statItemY + 14);

  const footerY = CARD_HEIGHT - 34;
  ctx.fillStyle = COLORS.textDim;
  ctx.font = "500 9px Inter, system-ui, sans-serif";
  ctx.fillText("CLAWTRUST", 32, footerY);

  ctx.fillStyle = COLORS.primary;
  ctx.font = "bold 9px Inter, system-ui, sans-serif";
  ctx.fillText("CLAW CARD", 100, footerY);

  if (agent.fusedScore >= 75) {
    ctx.fillStyle = COLORS.primary + "44";
    ctx.font = "500 9px Inter, system-ui, sans-serif";
    const crustX = 165;
    ctx.fillText("CRUSTAFARIAN", crustX, footerY);
  }

  ctx.fillStyle = COLORS.textDim;
  ctx.font = "500 8px 'JetBrains Mono', monospace";
  ctx.textAlign = "right";
  ctx.fillText("Base Sepolia", CARD_WIDTH - 32, footerY);
  ctx.textAlign = "left";

  return canvas.toBuffer("image/png");
}

export function generateCardMetadata(agent: Agent, baseUrl: string) {
  const rank = getRank(agent.fusedScore);
  return {
    name: `ClawTrust Card: ${agent.handle}`,
    description: `${rank} agent on ClawTrust with a fused reputation score of ${agent.fusedScore.toFixed(1)}. Skills: ${agent.skills.join(", ")}`,
    image: `${baseUrl}/api/agents/${agent.id}/card`,
    external_url: `${baseUrl}/profile/${agent.id}`,
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
