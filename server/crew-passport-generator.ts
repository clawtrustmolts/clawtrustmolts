import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import type { Crew, Agent } from "@shared/schema";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const PASSPORT_WIDTH = 800;
const PASSPORT_HEIGHT = 450;

export function getCrewTier(score: number): string {
  if (score >= 90) return "Diamond Fleet";
  if (score >= 70) return "Gold Brigade";
  if (score >= 50) return "Silver Squad";
  if (score >= 30) return "Bronze Pinch";
  return "Hatchling Huddle";
}

export function getCrewTierColor(tier: string): string {
  switch (tier) {
    case "Diamond Fleet": return "#0aeeb8";
    case "Gold Brigade": return "#d4a017";
    case "Silver Squad": return "#94a3b8";
    case "Bronze Pinch": return "#ea580c";
    default: return "#71717a";
  }
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

const roleColorMap: Record<string, string> = {
  LEAD: "#ea580c",
  RESEARCHER: "#3b82f6",
  CODER: "#22c55e",
  DESIGNER: "#a855f7",
  VALIDATOR: "#0aeeb8",
};

export async function generateCrewPassportImage(crew: Crew, members: Array<{ agent: Agent; role: string }>): Promise<Buffer> {
  const tier = getCrewTier(crew.fusedScore);
  const tierColor = getCrewTierColor(tier);
  const displayMembers = members.slice(0, 5);

  const ringRadius = 55;
  const ringSize = (ringRadius + 10) * 2;
  const bgCirclePath = `M ${ringRadius + 10} 10 A ${ringRadius} ${ringRadius} 0 1 1 ${ringRadius + 9.99} 10`;
  const scorePath = buildScoreRingPath(ringRadius, crew.fusedScore);

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
                  stroke: "#e2ddd5",
                  "stroke-width": "6",
                },
              },
              {
                type: "path",
                props: {
                  d: scorePath,
                  fill: "none",
                  stroke: "#ea580c",
                  "stroke-width": "8",
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
              { type: "div", props: { style: { fontSize: "30px", fontWeight: "bold", color: "#1a1a1a" }, children: Math.round(crew.fusedScore).toString() } },
              { type: "div", props: { style: { fontSize: "9px", color: "#8a8580", letterSpacing: "2px", marginTop: "2px" }, children: "CREW" } },
            ],
          },
        },
      ],
    },
  };

  const memberChips = {
    type: "div",
    props: {
      style: { display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "16px" },
      children: displayMembers.map((m) => {
        const roleColor = roleColorMap[m.role] || "#71717a";
        return {
          type: "div",
          props: {
            style: {
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "4px 10px",
              borderRadius: "4px",
              background: "#f0ece6",
              border: "1px solid #e2ddd5",
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    width: "22px",
                    height: "22px",
                    borderRadius: "50%",
                    background: "white",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "11px",
                    fontWeight: "bold",
                    color: "#1a1a1a",
                    border: `2px solid ${roleColor}`,
                  },
                  children: (m.agent.handle || "?")[0].toUpperCase(),
                },
              },
              {
                type: "div",
                props: {
                  style: { display: "flex", flexDirection: "column" },
                  children: [
                    { type: "div", props: { style: { fontSize: "11px", color: "#1a1a1a", fontWeight: "600" }, children: m.agent.handle } },
                    { type: "div", props: { style: { fontSize: "8px", color: roleColor, letterSpacing: "1px", fontWeight: "bold" }, children: m.role } },
                  ],
                },
              },
            ],
          },
        };
      }),
    },
  };

  function makeStat(label: string, value: string, accent?: boolean) {
    return {
      type: "div",
      props: {
        style: { display: "flex", flexDirection: "column", alignItems: "center" },
        children: [
          { type: "div", props: { style: { fontSize: "9px", color: "#8a8580", letterSpacing: "1.5px", marginBottom: "2px" }, children: label } },
          { type: "div", props: { style: { fontSize: "18px", fontWeight: "bold", color: accent ? "#0aeeb8" : "#1a1a1a" }, children: value } },
        ],
      },
    };
  }

  const jsx = {
    type: "div",
    props: {
      style: {
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        background: "#f7f5f2",
        color: "#1a1a1a",
        fontFamily: "Inter, sans-serif",
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
              left: "0",
              right: "0",
              height: "3px",
              background: "linear-gradient(90deg, #ea580c, #d4a017, #ea580c)",
            },
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              padding: "24px 32px",
              flex: "1",
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: "4px",
                  },
                  children: [
                    {
                      type: "div",
                      props: {
                        style: { display: "flex", alignItems: "center", gap: "10px" },
                        children: [
                          {
                            type: "div",
                            props: {
                              style: {
                                width: "28px",
                                height: "28px",
                                borderRadius: "4px",
                                background: "#ea580c",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "12px",
                                fontWeight: "bold",
                                color: "white",
                              },
                              children: "CT",
                            },
                          },
                          {
                            type: "span",
                            props: {
                              style: { fontSize: "13px", fontWeight: "bold", color: "#ea580c", letterSpacing: "3px" },
                              children: "CREW PASSPORT",
                            },
                          },
                        ],
                      },
                    },
                    {
                      type: "div",
                      props: {
                        style: {
                          padding: "3px 10px",
                          borderRadius: "4px",
                          border: `1px solid ${tierColor}66`,
                          background: `${tierColor}18`,
                          fontSize: "10px",
                          fontWeight: "bold",
                          color: tierColor,
                          letterSpacing: "1px",
                        },
                        children: tier.toUpperCase(),
                      },
                    },
                  ],
                },
              },
              {
                type: "div",
                props: {
                  style: { width: "100%", height: "1px", background: "#e2ddd5", margin: "10px 0 14px" },
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
                        style: { display: "flex", flexDirection: "column", justifyContent: "space-between", flex: "1", paddingRight: "24px" },
                        children: [
                          {
                            type: "div",
                            props: {
                              style: { display: "flex", flexDirection: "column" },
                              children: [
                                {
                                  type: "div",
                                  props: {
                                    style: { fontSize: "28px", fontWeight: "bold", color: "#1a1a1a", marginBottom: "2px" },
                                    children: crew.name,
                                  },
                                },
                                {
                                  type: "div",
                                  props: {
                                    style: { fontSize: "12px", color: "#8a8580", fontFamily: "monospace", marginBottom: "4px" },
                                    children: `@${crew.handle}`,
                                  },
                                },
                                memberChips,
                              ],
                            },
                          },
                          {
                            type: "div",
                            props: {
                              style: { display: "flex", gap: "28px", marginTop: "auto", paddingTop: "12px" },
                              children: [
                                makeStat("BOND POOL", `$${crew.bondPool.toLocaleString()}`, true),
                                makeStat("GIGS", crew.gigsCompleted.toString()),
                                makeStat("EARNED", `$${crew.totalEarned.toLocaleString()}`),
                                makeStat("MEMBERS", members.length.toString()),
                              ],
                            },
                          },
                        ],
                      },
                    },
                    {
                      type: "div",
                      props: {
                        style: { display: "flex", alignItems: "center", justifyContent: "center" },
                        children: [scoreRing],
                      },
                    },
                  ],
                },
              },
              {
                type: "div",
                props: {
                  style: { display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "10px", borderTop: "1px solid #e2ddd5", marginTop: "10px" },
                  children: [
                    {
                      type: "div",
                      props: {
                        style: { display: "flex", alignItems: "center", gap: "8px" },
                        children: [
                          { type: "span", props: { style: { fontSize: "9px", color: "#8a8580", letterSpacing: "1px" }, children: "CLAWTRUST CREW PASSPORT" } },
                          { type: "span", props: { style: { fontSize: "9px", color: "#ea580c", fontWeight: "bold" }, children: "ERC-8004" } },
                        ],
                      },
                    },
                    { type: "span", props: { style: { fontSize: "9px", color: "#8a8580" }, children: "Base Sepolia" } },
                  ],
                },
              },
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
