import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import type { Crew, Agent } from "@shared/schema";
import { readFileSync, existsSync } from "fs";
import { join } from "path";

const PASSPORT_WIDTH = 600;
const PASSPORT_HEIGHT = 400;

export function getCrewTier(score: number): string {
  if (score >= 90) return "Diamond Fleet";
  if (score >= 70) return "Gold Brigade";
  if (score >= 50) return "Silver Squad";
  if (score >= 30) return "Bronze Pinch";
  return "Hatchling Huddle";
}

export function getCrewTierColor(tier: string): string {
  switch (tier) {
    case "Diamond Fleet": return "#38bdf8";
    case "Gold Brigade": return "#eab308";
    case "Silver Squad": return "#94a3b8";
    case "Bronze Pinch": return "#ea580c";
    default: return "#52525b";
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

function makeStat(label: string, value: string, color?: string) {
  return {
    type: "div",
    props: {
      style: { display: "flex", flexDirection: "column", alignItems: "center" },
      children: [
        { type: "div", props: { style: { fontSize: "9px", color: color || "#71717a", letterSpacing: "1px" }, children: label } },
        { type: "div", props: { style: { fontSize: "16px", fontWeight: "bold", color: color ? "white" : "white" }, children: value } },
      ],
    },
  };
}

export async function generateCrewPassportImage(crew: Crew, members: Array<{ agent: Agent; role: string }>): Promise<Buffer> {
  const tier = getCrewTier(crew.fusedScore);
  const tierColor = getCrewTierColor(tier);
  const displayMembers = members.slice(0, 5);

  const ringRadius = 50;
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
                  stroke: "#27272a",
                  "stroke-width": "6",
                },
              },
              {
                type: "path",
                props: {
                  d: scorePath,
                  fill: "none",
                  stroke: "#F94144",
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
              { type: "div", props: { style: { fontSize: "28px", fontWeight: "bold", color: "white" }, children: Math.round(crew.fusedScore).toString() } },
              { type: "div", props: { style: { fontSize: "9px", color: "#71717a", letterSpacing: "1px", marginTop: "2px" }, children: "FUSED" } },
            ],
          },
        },
      ],
    },
  };

  const memberAvatars = {
    type: "div",
    props: {
      style: { display: "flex", gap: "12px", alignItems: "flex-start" },
      children: displayMembers.map((m) => ({
        type: "div",
        props: {
          style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" },
          children: [
            {
              type: "div",
              props: {
                style: {
                  width: "36px",
                  height: "36px",
                  borderRadius: "50%",
                  background: "#27272a",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "18px",
                  border: "2px solid #3f3f46",
                },
                children: m.agent.avatar || "L",
              },
            },
            {
              type: "div",
              props: {
                style: {
                  fontSize: "8px",
                  color: "#71717a",
                  letterSpacing: "0.5px",
                  padding: "1px 4px",
                  borderRadius: "3px",
                  background: "#1a1a1f",
                },
                children: m.role,
              },
            },
          ],
        },
      })),
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
              height: "2px",
              background: "linear-gradient(90deg, #ea580c, #F94144, #ea580c)",
            },
          },
        },
        {
          type: "div",
          props: {
            style: {
              position: "absolute",
              top: "0",
              right: "0",
              width: "250px",
              height: "250px",
              background: `radial-gradient(circle at top right, #ea580c15, transparent 70%)`,
            },
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              padding: "20px 28px",
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
                    marginBottom: "12px",
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
                                borderRadius: "6px",
                                background: "#F94144",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "13px",
                                fontWeight: "bold",
                              },
                              children: "CT",
                            },
                          },
                          {
                            type: "span",
                            props: {
                              style: { fontSize: "20px", fontWeight: "bold", color: "#F94144", letterSpacing: "2px" },
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
                          borderRadius: "5px",
                          border: `1px solid ${tierColor}66`,
                          background: `${tierColor}18`,
                          fontSize: "11px",
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
                  style: { fontSize: "36px", fontWeight: "bold", color: "white", marginBottom: "12px" },
                  children: crew.name,
                },
              },
              {
                type: "div",
                props: {
                  style: { display: "flex", justifyContent: "space-between", alignItems: "center", flex: "1" },
                  children: [
                    {
                      type: "div",
                      props: {
                        style: { display: "flex", flexDirection: "column", justifyContent: "space-between", flex: "1" },
                        children: [
                          memberAvatars,
                          {
                            type: "div",
                            props: {
                              style: { display: "flex", gap: "20px", marginTop: "auto" },
                              children: [
                                makeStat("BOND POOL", `$${crew.bondPool.toLocaleString()}`, "#00d4ff"),
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
                        style: { display: "flex", alignItems: "center", justifyContent: "center", marginLeft: "16px" },
                        children: [scoreRing],
                      },
                    },
                  ],
                },
              },
              {
                type: "div",
                props: {
                  style: { display: "flex", justifyContent: "space-between", alignItems: "center", paddingTop: "10px", borderTop: "1px solid #1a1a1f", marginTop: "10px" },
                  children: [
                    { type: "span", props: { style: { fontSize: "9px", color: "#3f3f46", letterSpacing: "1px" }, children: "CLAWTRUST CREW PASSPORT" } },
                    { type: "span", props: { style: { fontSize: "9px", color: "#3f3f46" }, children: "Base Sepolia" } },
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
