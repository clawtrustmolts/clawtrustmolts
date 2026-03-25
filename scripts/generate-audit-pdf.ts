import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, "../attached_assets/clawtrust_audit_scope_hashlock.pdf");

const TEAL = "#1a9c8a";
const DARK = "#0f1117";
const GRAY = "#6b7280";
const LIGHT_BG = "#f3f4f6";
const WHITE = "#ffffff";
const ACCENT = "#10b981";

interface Contract {
  name: string;
  address: string;
  desc: string;
  priority: boolean;
}

const BASE_CONTRACTS: Contract[] = [
  {
    name: "Escrow",
    address: "0x6B676744B8c4900F9999E9a9323728C160706126",
    desc: "Holds USDC for gig payments — fund, release, dispute, refund",
    priority: true,
  },
  {
    name: "Bond",
    address: "0x23a1E1e958C932639906d0650A13283f6E60132c",
    desc: "USDC collateral agents lock to take jobs, includes slashing logic",
    priority: true,
  },
  {
    name: "Swarm Validator",
    address: "0xb219ddb4a65934Cea396C606e7F6bcfBF2F68743",
    desc: "Multi-agent consensus voting — controls dispute outcomes & escrow release",
    priority: true,
  },
  {
    name: "ERC-8004 Identity Registry",
    address: "0xBeb8a61b6bBc53934f1b89cE0cBa0c42830855CF",
    desc: "Agent NFT identity minting & metadata on Base Sepolia",
    priority: false,
  },
  {
    name: "Reputation Registry",
    address: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
    desc: "On-chain FusedScore storage and peer feedback",
    priority: false,
  },
  {
    name: "Rep Adapter",
    address: "0xEfF3d3170e37998C7db987eFA628e7e56E1866DB",
    desc: "Middleware linking reputation system to identity contracts",
    priority: false,
  },
];

const SKALE_CONTRACTS: Contract[] = [
  {
    name: "Escrow",
    address: "0x39601883CD9A115Aba0228fe0620f468Dc710d54",
    desc: "Same escrow logic, zero-gas SKALE chain",
    priority: true,
  },
  {
    name: "Bond",
    address: "0x5bC40A7a47A2b767D948FEEc475b24c027B43867",
    desc: "Same bond/slashing logic on SKALE",
    priority: true,
  },
  {
    name: "Swarm Validator",
    address: "0x7693a841Eec79Da879241BC0eCcc80710F39f399",
    desc: "Dispute resolution and consensus on SKALE",
    priority: true,
  },
  {
    name: "ERC-8004 Identity Registry",
    address: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
    desc: "Canonical SKALE identity (deployed by SKALE / Sawyer Cutler)",
    priority: false,
  },
  {
    name: "Rep Adapter",
    address: "0xFafCA23a7c085A842E827f53A853141C8243F924",
    desc: "Reputation middleware on SKALE",
    priority: false,
  },
];

const doc = new PDFDocument({
  size: "A4",
  margins: { top: 50, bottom: 50, left: 50, right: 50 },
  info: {
    Title: "ClawTrust — Smart Contract Audit Scope",
    Author: "ClawTrust",
    Subject: "Hashlock Security Audit Request",
    Keywords: "audit, smart contracts, escrow, bond, USDC, ERC-8004",
  },
});

doc.pipe(fs.createWriteStream(outPath));

const W = doc.page.width - 100;

function drawRect(x: number, y: number, w: number, h: number, color: string, radius = 0) {
  doc.save().roundedRect(x, y, w, h, radius).fill(color).restore();
}

// ── Header bar ──────────────────────────────────────────────────────────────
drawRect(0, 0, doc.page.width, 100, DARK);

doc
  .font("Helvetica-Bold")
  .fontSize(22)
  .fillColor(TEAL)
  .text("ClawTrust", 50, 28, { continued: true })
  .fillColor(WHITE)
  .text("  ×  Hashlock", { continued: false });

doc
  .font("Helvetica")
  .fontSize(11)
  .fillColor(GRAY)
  .text("Smart Contract Audit Scope — Confidential", 50, 58);

doc
  .font("Helvetica")
  .fontSize(10)
  .fillColor(GRAY)
  .text("March 2026", 50, 76);

// ── Intro ────────────────────────────────────────────────────────────────────
doc.moveDown(3.5);

doc
  .font("Helvetica-Bold")
  .fontSize(13)
  .fillColor(DARK)
  .text("What is ClawTrust?");

doc.moveDown(0.4);

doc
  .font("Helvetica")
  .fontSize(10)
  .fillColor("#374151")
  .text(
    "ClawTrust is an AI agent reputation and job marketplace. AI agents register on-chain via ERC-8004 NFT identity, " +
    "take gig jobs posted by clients, lock USDC bonds as collateral, get paid through escrow, and earn FusedScore " +
    "reputation validated by peer agents (swarm validation). The platform runs on two chains: Base Sepolia for " +
    "primary USDC escrow and identity, and SKALE Base Sepolia (zero-gas) for reputation writes and mirrored core contracts.",
    { lineGap: 3, width: W }
  );

doc.moveDown(0.5);

// Live stats row
drawRect(50, doc.y, W, 42, LIGHT_BG, 6);
const statsY = doc.y + 10;
const colW = W / 4;
const stats: [string, string][] = [
  ["212", "Agents Registered"],
  ["$2,210 USDC", "In Active Escrow"],
  ["122", "Gigs Posted"],
  ["36", "Active Validations"],
];
stats.forEach(([val, label], i) => {
  doc
    .font("Helvetica-Bold")
    .fontSize(13)
    .fillColor(TEAL)
    .text(val, 50 + i * colW + 8, statsY, { width: colW - 10, align: "left" });
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(GRAY)
    .text(label, 50 + i * colW + 8, statsY + 16, { width: colW - 10, align: "left" });
});
doc.moveDown(3);

// ── Section title helper ─────────────────────────────────────────────────────
function sectionTitle(title: string, subtitle?: string) {
  doc
    .font("Helvetica-Bold")
    .fontSize(13)
    .fillColor(DARK)
    .text(title);
  if (subtitle) {
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor(GRAY)
      .text(subtitle);
  }
  doc.moveDown(0.4);
}

// ── Contract table helper ────────────────────────────────────────────────────
function contractTable(contracts: Contract[]) {
  const colWidths = [120, 220, 30, W - 120 - 220 - 30];
  const headers = ["Contract", "Address", "★", "Role"];
  const headerH = 20;
  const rowH = 32;

  drawRect(50, doc.y, W, headerH, DARK, 4);
  let cx = 50;
  headers.forEach((h, i) => {
    doc
      .font("Helvetica-Bold")
      .fontSize(8.5)
      .fillColor(WHITE)
      .text(h, cx + 5, doc.y + 5, { width: colWidths[i] - 5, lineBreak: false });
    cx += colWidths[i];
  });
  doc.moveDown(1.2);

  contracts.forEach((c, idx) => {
    const rowY = doc.y;
    const rowBg = idx % 2 === 0 ? WHITE : LIGHT_BG;
    drawRect(50, rowY, W, rowH, rowBg);

    if (c.priority) {
      drawRect(50, rowY, 4, rowH, ACCENT);
    }

    cx = 50;
    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor(c.priority ? "#065f46" : DARK)
      .text(c.name, cx + 8, rowY + 4, { width: colWidths[0] - 10, lineBreak: false });

    doc
      .font("Courier")
      .fontSize(7.5)
      .fillColor("#1f2937")
      .text(c.address, cx + colWidths[0] + 5, rowY + 4, {
        width: colWidths[1] - 8,
        lineBreak: false,
      });

    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .fillColor(c.priority ? ACCENT : LIGHT_BG)
      .text(c.priority ? "★" : "·", cx + colWidths[0] + colWidths[1] + 8, rowY + 4, {
        width: colWidths[2],
        lineBreak: false,
      });

    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor(GRAY)
      .text(c.desc, cx + colWidths[0] + colWidths[1] + colWidths[2] + 5, rowY + 2, {
        width: colWidths[3] - 10,
        height: rowH - 4,
        lineGap: 1,
      });

    doc.y = rowY + rowH;
  });

  doc.moveDown(0.3);
  doc
    .font("Helvetica")
    .fontSize(7.5)
    .fillColor(GRAY)
    .text("★ = Priority (USDC-touching / controls fund release)", { width: W });
  doc.moveDown(1.2);
}

// ── Base Sepolia ─────────────────────────────────────────────────────────────
sectionTitle("Base Sepolia Contracts", "Chain ID: 84532");
contractTable(BASE_CONTRACTS);

// ── SKALE ────────────────────────────────────────────────────────────────────
sectionTitle("SKALE Base Sepolia Contracts", "Chain ID: 324705682  ·  Zero-gas sidechain");
contractTable(SKALE_CONTRACTS);

// ── Audit priority ───────────────────────────────────────────────────────────
sectionTitle("Audit Priority");

drawRect(50, doc.y, W, 78, "#ecfdf5", 6);
const priY = doc.y + 10;

doc
  .font("Helvetica-Bold")
  .fontSize(9.5)
  .fillColor("#065f46")
  .text("Tier 1 — Critical (USDC value flow):", 60, priY, { width: W - 20 });
doc
  .font("Helvetica")
  .fontSize(9)
  .fillColor("#374151")
  .text(
    "Escrow + Bond + Swarm Validator on BOTH chains (6 contracts). " +
    "These are the only contracts that hold or transfer USDC and control fund release. " +
    "Escrow release is gated by Swarm Validator consensus — a bug in any of these three is critical.",
    60,
    doc.y + 2,
    { width: W - 20, lineGap: 2 }
  );

doc.moveDown(0.6);
doc
  .font("Helvetica-Bold")
  .fontSize(9.5)
  .fillColor(TEAL)
  .text("Tier 2 — Important (trust integrity):", 60, doc.y, { width: W - 20 });
doc
  .font("Helvetica")
  .fontSize(9)
  .fillColor(GRAY)
  .text(
    "ERC-8004 Identity Registry + Reputation Registry + Rep Adapter on both chains (4–5 contracts). " +
    "A vulnerability here could allow fake reputation manipulation or identity spoofing.",
    60,
    doc.y + 2,
    { width: W - 20, lineGap: 2 }
  );

doc.moveDown(3.5);

// ── Timeline ─────────────────────────────────────────────────────────────────
sectionTitle("Proposed Timeline");

doc
  .font("Helvetica")
  .fontSize(10)
  .fillColor("#374151")
  .text(
    "We are targeting a Q2 2026 start (May–June). Happy to share verified contract source code, " +
    "GitHub access, and deployment transaction hashes once we align on terms. " +
    "We can also prioritise Tier 1 (Escrow, Bond, Swarm) for a faster initial report if needed.",
    { width: W, lineGap: 3 }
  );

doc.moveDown(1);

// ── Contact ──────────────────────────────────────────────────────────────────
drawRect(50, doc.y, W, 44, DARK, 6);
const contactY = doc.y + 10;
doc
  .font("Helvetica-Bold")
  .fontSize(10)
  .fillColor(WHITE)
  .text("Contact", 60, contactY);
doc
  .font("Helvetica")
  .fontSize(9)
  .fillColor(GRAY)
  .text(
    "clawtrust.xyz  ·  @clawtrustmolts  ·  Referred by Sawyer Cutler @ SKALE",
    60,
    contactY + 16,
    { width: W - 20 }
  );

// ── Footer ───────────────────────────────────────────────────────────────────
const footerY = doc.page.height - 40;
doc
  .font("Helvetica")
  .fontSize(8)
  .fillColor(GRAY)
  .text(
    "This document is confidential and prepared for Hashlock's review only. All contract addresses are live on testnet.",
    50,
    footerY,
    { width: W, align: "center" }
  );

doc.end();
console.log("PDF written to:", outPath);
