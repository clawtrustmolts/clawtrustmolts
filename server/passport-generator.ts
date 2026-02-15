import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import type { Agent } from "@shared/schema";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const PASSPORT_WIDTH = 800;
const PASSPORT_HEIGHT = 500;

function getRank(score: number): string {
  if (score >= 90) return "Diamond Claw";
  if (score >= 70) return "Gold Shell";
  if (score >= 50) return "Silver Molt";
  if (score >= 30) return "Bronze Pinch";
  return "Hatchling";
}

function getRankColor(rank: string): string {
  switch (rank) {
    case "Diamond Claw": return "#38bdf8";
    case "Gold Shell": return "#eab308";
    case "Silver Molt": return "#94a3b8";
    case "Bronze Pinch": return "#ea580c";
    default: return "#52525b";
  }
}

function getConfidence(agent: Agent): number {
  let confidence = 0.7;
  if (agent.isVerified) confidence += 0.1;
  if (agent.totalGigsCompleted > 5) confidence += 0.1;
  if (agent.fusedScore >= 50) confidence += 0.05;
  if (agent.moltbookKarma > 100) confidence += 0.05;
  return Math.round(Math.min(1, confidence) * 100) / 100;
}

let cachedFont: ArrayBuffer | null = null;

async function loadFont(): Promise<ArrayBuffer> {
  if (cachedFont) return cachedFont;

  const fontPaths = [
    join(process.cwd(), "node_modules", "@fontsource", "inter", "files", "inter-latin-400-normal.woff"),
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  ];

  for (const fp of fontPaths) {
    if (existsSync(fp)) {
      cachedFont = readFileSync(fp).buffer as ArrayBuffer;
      return cachedFont;
    }
  }

  const resp = await fetch("https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfAZ9hiA.woff2");
  cachedFont = await resp.arrayBuffer();
  return cachedFont;
}

function buildScoreRingPath(radius: number, score: number): string {
  const cx = radius + 10;
  const cy = radius + 10;
  const pct = Math.min(score, 100) / 100;
  const angle = pct * 2 * Math.PI;
  const startX = cx;
  const startY = cy - radius;
  const endX = cx + radius * Math.sin(angle);
  const endY = cy - radius * Math.cos(angle);
  const largeArc = pct > 0.5 ? 1 : 0;
  if (pct >= 1) {
    return `M ${cx} ${cy - radius} A ${radius} ${radius} 0 1 1 ${cx - 0.01} ${cy - radius}`;
  }
  if (pct <= 0) {
    return `M ${cx} ${cy - radius} A ${radius} ${radius} 0 0 1 ${cx} ${cy - radius}`;
  }
  return `M ${startX} ${startY} A ${radius} ${radius} 0 ${largeArc} 1 ${endX} ${endY}`;
}

function makeStat(label: string, value: string) {
  return {
    type: "div",
    props: {
      style: { display: "flex", flexDirection: "column" },
      children: [
        { type: "div", props: { style: { fontSize: "11px", color: "#71717a", letterSpacing: "1px" }, children: label } },
        { type: "div", props: { style: { fontSize: "22px", fontWeight: "bold" }, children: value } },
      ],
    },
  };
}

export async function generatePassportImage(agent: Agent): Promise<Buffer> {
  const rank = getRank(agent.fusedScore);
  const rankColor = getRankColor(rank);
  const confidence = getConfidence(agent);
  const topSkills = agent.skills.slice(0, 4);

  const ringRadius = 65;
  const ringSize = (ringRadius + 10) * 2;
  const bgCirclePath = `M ${ringRadius + 10} 10 A ${ringRadius} ${ringRadius} 0 1 1 ${ringRadius + 9.99} 10`;
  const scorePath = buildScoreRingPath(ringRadius, agent.fusedScore);

  const scoreRing = {
    type: "div",
    props: {
      style: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "relative", width: `${ringSize}px`, height: `${ringSize}px` },
      children: [
        {
          type: "svg",
          props: {
            width: ringSize.toString(),
            height: ringSize.toString(),
            viewBox: `0 0 ${ringSize} ${ringSize}`,
            style: { position: "absolute", top: "0", left: "0" },
            children: [
              {
                type: "path",
                props: {
                  d: bgCirclePath,
                  fill: "none",
                  stroke: "#27272a",
                  "stroke-width": "8",
                },
              },
              {
                type: "path",
                props: {
                  d: scorePath,
                  fill: "none",
                  stroke: "#F94144",
                  "stroke-width": "10",
                  "stroke-linecap": "round",
                },
              },
            ],
          },
        },
        {
          type: "div",
          props: {
            style: { display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", position: "absolute", top: "0", left: "0", right: "0", bottom: "0" },
            children: [
              { type: "div", props: { style: { fontSize: "36px", fontWeight: "bold", color: "white" }, children: Math.round(agent.fusedScore).toString() } },
              { type: "div", props: { style: { fontSize: "11px", color: "#71717a", letterSpacing: "1px", marginTop: "2px" }, children: "FUSED" } },
            ],
          },
        },
      ],
    },
  };

  const jsx = {
    type: "div",
    props: {
      style: {
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#020203",
        color: "white",
        fontFamily: "Inter, sans-serif",
        padding: "40px",
        position: "relative",
        overflow: "hidden",
      },
      children: [
        {
          type: "div",
          props: {
            style: {
              position: "absolute",
              top: "0",
              right: "0",
              width: "300px",
              height: "300px",
              background: `radial-gradient(circle at center, ${rankColor}15, transparent 70%)`,
            },
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "8px",
            },
            children: [
              {
                type: "div",
                props: {
                  style: { display: "flex", alignItems: "center", gap: "12px" },
                  children: [
                    {
                      type: "div",
                      props: {
                        style: {
                          width: "36px",
                          height: "36px",
                          borderRadius: "8px",
                          background: "#F94144",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "18px",
                          fontWeight: "bold",
                        },
                        children: "CT",
                      },
                    },
                    {
                      type: "span",
                      props: {
                        style: { fontSize: "28px", fontWeight: "bold", color: "#F94144", letterSpacing: "2px" },
                        children: "CLAWTRUST PASSPORT",
                      },
                    },
                  ],
                },
              },
              {
                type: "div",
                props: {
                  style: {
                    padding: "4px 14px",
                    borderRadius: "6px",
                    border: `1px solid ${rankColor}66`,
                    background: `${rankColor}18`,
                    fontSize: "14px",
                    fontWeight: "bold",
                    color: rankColor,
                    letterSpacing: "1px",
                  },
                  children: rank.toUpperCase(),
                },
              },
            ],
          },
        },
        {
          type: "div",
          props: {
            style: { width: "100%", height: "1px", background: "#1a1a1f", margin: "10px 0 20px" },
          },
        },
        {
          type: "div",
          props: {
            style: { display: "flex", justifyContent: "space-between", flex: "1" },
            children: [
              {
                type: "div",
                props: {
                  style: { display: "flex", flexDirection: "column", justifyContent: "space-between", flex: "1", paddingRight: "30px" },
                  children: [
                    {
                      type: "div",
                      props: {
                        style: { display: "flex", flexDirection: "column" },
                        children: [
                          {
                            type: "div",
                            props: {
                              style: { fontSize: "36px", fontWeight: "bold", color: "#e4e4e7", marginBottom: "4px" },
                              children: agent.handle,
                            },
                          },
                          {
                            type: "div",
                            props: {
                              style: { fontSize: "13px", color: "#71717a", fontFamily: "monospace", marginBottom: "16px" },
                              children: `${agent.walletAddress.slice(0, 6)}...${agent.walletAddress.slice(-4)}${agent.isVerified ? "  VERIFIED" : ""}`,
                            },
                          },
                          {
                            type: "div",
                            props: {
                              style: { display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" },
                              children: topSkills.map((skill: string) => ({
                                type: "div",
                                props: {
                                  style: {
                                    padding: "4px 12px",
                                    borderRadius: "6px",
                                    background: "#27272a",
                                    fontSize: "13px",
                                    color: "#e4e4e7",
                                  },
                                  children: skill,
                                },
                              })),
                            },
                          },
                          ...(agent.moltDomain ? [{
                            type: "div",
                            props: {
                              style: {
                                display: "flex",
                                alignItems: "center",
                                gap: "6px",
                                padding: "4px 12px",
                                borderRadius: "6px",
                                border: "1px solid #00d4ff44",
                                background: "#00d4ff0a",
                                fontSize: "13px",
                                color: "#00d4ff",
                              },
                              children: `.molt: ${agent.moltDomain}`,
                            },
                          }] : []),
                        ],
                      },
                    },
                    {
                      type: "div",
                      props: {
                        style: { display: "flex", gap: "30px", marginTop: "auto" },
                        children: [
                          makeStat("GIGS", agent.totalGigsCompleted.toString()),
                          makeStat("EARNED", `$${agent.totalEarned.toLocaleString()}`),
                          makeStat("KARMA", agent.moltbookKarma.toString()),
                          makeStat("CONFIDENCE", `${Math.round(confidence * 100)}%`),
                        ],
                      },
                    },
                  ],
                },
              },
              scoreRing,
            ],
          },
        },
        {
          type: "div",
          props: {
            style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto", paddingTop: "12px", borderTop: "1px solid #1a1a1f" },
            children: [
              {
                type: "div",
                props: {
                  style: { display: "flex", alignItems: "center", gap: "8px" },
                  children: [
                    { type: "span", props: { style: { fontSize: "10px", color: "#3f3f46", letterSpacing: "1px" }, children: "CLAWTRUST PASSPORT" } },
                    { type: "span", props: { style: { fontSize: "10px", color: "#F94144", fontWeight: "bold" }, children: "ERC-8004" } },
                    ...(agent.fusedScore >= 75 ? [
                      { type: "span", props: { style: { fontSize: "10px", color: "#F9414466" }, children: "CRUSTAFARIAN" } },
                    ] : []),
                  ],
                },
              },
              { type: "span", props: { style: { fontSize: "10px", color: "#3f3f46" }, children: "Base Sepolia" } },
            ],
          },
        },
      ],
    },
  };

  const fontData = await loadFont();

  const svg = await satori(jsx as any, {
    width: PASSPORT_WIDTH,
    height: PASSPORT_HEIGHT,
    fonts: [
      {
        name: "Inter",
        data: fontData,
        weight: 400,
        style: "normal" as const,
      },
    ],
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width" as const, value: PASSPORT_WIDTH },
  });
  const pngData = resvg.render();
  return Buffer.from(pngData.asPng());
}

export function generatePassportMetadata(agent: Agent, baseUrl: string) {
  const rank = getRank(agent.fusedScore);
  const confidence = getConfidence(agent);
  const topSkills = agent.skills.slice(0, 6);

  return {
    name: `ClawTrust Passport - ${rank}`,
    description: `Dynamic reputation passport for OpenClaw agent. Fused score: ${Math.round(agent.fusedScore)}/100. Linked Molt.id: ${agent.moltDomain || "none"}. Verifiable via ERC-8004.`,
    image: `${baseUrl}/api/passports/${agent.walletAddress}/image`,
    external_url: `${baseUrl}/profile/${agent.id}`,
    attributes: [
      { trait_type: "Fused Score", value: Math.round(agent.fusedScore * 10) / 10, display_type: "number" },
      { trait_type: "Rank", value: rank },
      { trait_type: "Confidence", value: confidence, display_type: "number" },
      { trait_type: "Top Skills", value: topSkills.join(", ") },
      { trait_type: "Molt Domain", value: agent.moltDomain || "Unlinked" },
      { trait_type: "Wallet", value: agent.walletAddress },
      { trait_type: "Gigs Completed", value: agent.totalGigsCompleted, display_type: "number" },
      { trait_type: "Total Earned (USDC)", value: agent.totalEarned, display_type: "number" },
      { trait_type: "Moltbook Karma", value: agent.moltbookKarma, display_type: "number" },
      { trait_type: "On-Chain Score", value: agent.onChainScore, display_type: "number" },
      { trait_type: "Verified", value: agent.isVerified ? "Yes" : "No" },
      { trait_type: "Last Updated", value: new Date().toISOString().split("T")[0] },
    ],
  };
}
