import satori from "satori";
import { Resvg } from "@resvg/resvg-js";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import crypto from "crypto";

const RECEIPT_WIDTH = 800;
const RECEIPT_HEIGHT = 450;

const NAVY = "#080E1A";
const ORANGE = "#F97316";
const ORANGE_DARK = "#EA580C";
const TEAL = "#00D4FF";
const TEAL_DIM = "#00D4FF99";
const WHITE = "#FFFFFF";
const GRAY = "#94A3B8";
const GRAY_DIM = "#475569";
const GREEN = "#22C55E";
const RED = "#EF4444";

interface ReceiptData {
  receiptId: string;
  gigTitle: string;
  amount: number;
  currency: string;
  chain: string;
  posterHandle: string;
  assigneeHandle: string;
  posterMoltDomain?: string | null;
  assigneeMoltDomain?: string | null;
  swarmVerdict: string | null;
  votesFor: number;
  votesAgainst: number;
  posterScoreChange: number;
  assigneeScoreChange: number;
  completedAt: Date | null;
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

function hashReceiptId(id: string): string {
  return crypto.createHash("sha256").update(id).digest("hex").slice(0, 16);
}

function scoreChangeText(change: number): { text: string; color: string } {
  if (change > 0) return { text: `+${change}`, color: GREEN };
  if (change < 0) return { text: `${change}`, color: RED };
  return { text: "0", color: GRAY };
}

export async function generateReceiptImage(data: ReceiptData): Promise<Buffer> {
  const receiptHash = hashReceiptId(data.receiptId);
  const posterScore = scoreChangeText(data.posterScoreChange);
  const assigneeScore = scoreChangeText(data.assigneeScoreChange);
  const posterDisplayName = data.posterMoltDomain || data.posterHandle;
  const assigneeDisplayName = data.assigneeMoltDomain || data.assigneeHandle;
  const dateStr = data.completedAt
    ? new Date(data.completedAt).toISOString().split("T")[0]
    : new Date().toISOString().split("T")[0];

  const totalVotes = data.votesFor + data.votesAgainst;
  const verdictText = data.swarmVerdict || (data.votesFor > data.votesAgainst ? "APPROVED" : totalVotes > 0 ? "REJECTED" : "N/A");

  const jsx = {
    type: "div",
    props: {
      style: {
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        background: NAVY,
        color: WHITE,
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
              top: "200",
              left: "300",
              width: "200",
              height: "200",
              fontSize: "120px",
              color: "rgba(255,255,255,0.03)",
              transform: "rotate(15deg)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            },
            children: "CT",
          },
        },
        {
          type: "div",
          props: {
            style: {
              width: "100%",
              height: "6px",
              background: `linear-gradient(90deg, ${ORANGE_DARK}, ${ORANGE}, ${ORANGE_DARK})`,
            },
          },
        },
        {
          type: "div",
          props: {
            style: {
              display: "flex",
              flexDirection: "column",
              padding: "28px 36px 20px",
              flex: "1",
            },
            children: [
              {
                type: "div",
                props: {
                  style: {
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "6px",
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
                                background: ORANGE,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "13px",
                                fontWeight: "bold",
                                color: WHITE,
                              },
                              children: "CT",
                            },
                          },
                          {
                            type: "span",
                            props: {
                              style: { fontSize: "22px", fontWeight: "bold", color: ORANGE, letterSpacing: "2px" },
                              children: "TRUST RECEIPT",
                            },
                          },
                        ],
                      },
                    },
                    {
                      type: "div",
                      props: {
                        style: { fontSize: "11px", color: TEAL_DIM, letterSpacing: "1px" },
                        children: "ClawTrust  \u00B7  Base Sepolia  \u00B7  ERC-8004",
                      },
                    },
                  ],
                },
              },
              {
                type: "div",
                props: {
                  style: { width: "100%", height: "1px", background: "#1E293B", margin: "10px 0 18px" },
                },
              },
              {
                type: "div",
                props: {
                  style: { display: "flex", justifyContent: "space-between", flex: "1", gap: "24px" },
                  children: [
                    {
                      type: "div",
                      props: {
                        style: { display: "flex", flexDirection: "column", justifyContent: "space-between", flex: "1" },
                        children: [
                          {
                            type: "div",
                            props: {
                              style: { display: "flex", flexDirection: "column", gap: "6px" },
                              children: [
                                {
                                  type: "div",
                                  props: {
                                    style: { fontSize: "10px", color: GRAY_DIM, letterSpacing: "1px" },
                                    children: "POSTER",
                                  },
                                },
                                {
                                  type: "div",
                                  props: {
                                    style: { fontSize: "16px", fontWeight: "bold", color: WHITE },
                                    children: posterDisplayName,
                                  },
                                },
                                {
                                  type: "div",
                                  props: {
                                    style: { fontSize: "18px", color: TEAL, margin: "4px 0" },
                                    children: "\u2193",
                                  },
                                },
                                {
                                  type: "div",
                                  props: {
                                    style: { fontSize: "10px", color: GRAY_DIM, letterSpacing: "1px" },
                                    children: "ASSIGNEE",
                                  },
                                },
                                {
                                  type: "div",
                                  props: {
                                    style: { fontSize: "16px", fontWeight: "bold", color: WHITE },
                                    children: assigneeDisplayName,
                                  },
                                },
                              ],
                            },
                          },
                        ],
                      },
                    },
                    {
                      type: "div",
                      props: {
                        style: { display: "flex", flexDirection: "column", justifyContent: "space-between", flex: "1.5", alignItems: "center" },
                        children: [
                          {
                            type: "div",
                            props: {
                              style: { display: "flex", flexDirection: "column", alignItems: "center", gap: "6px" },
                              children: [
                                {
                                  type: "div",
                                  props: {
                                    style: { fontSize: "10px", color: GRAY_DIM, letterSpacing: "1px" },
                                    children: "GIG TITLE",
                                  },
                                },
                                {
                                  type: "div",
                                  props: {
                                    style: {
                                      fontSize: "15px",
                                      fontWeight: "bold",
                                      color: WHITE,
                                      textAlign: "center",
                                      maxWidth: "240px",
                                      overflow: "hidden",
                                    },
                                    children: data.gigTitle.length > 50 ? data.gigTitle.slice(0, 47) + "..." : data.gigTitle,
                                  },
                                },
                                {
                                  type: "div",
                                  props: {
                                    style: { fontSize: "28px", fontWeight: "bold", color: TEAL, marginTop: "4px" },
                                    children: `${data.amount.toLocaleString()} ${data.currency}`,
                                  },
                                },
                                {
                                  type: "div",
                                  props: {
                                    style: { fontSize: "10px", color: GRAY, letterSpacing: "0.5px" },
                                    children: "Released via Circle Escrow",
                                  },
                                },
                              ],
                            },
                          },
                        ],
                      },
                    },
                    {
                      type: "div",
                      props: {
                        style: { display: "flex", flexDirection: "column", justifyContent: "space-between", flex: "1", alignItems: "flex-end" },
                        children: [
                          {
                            type: "div",
                            props: {
                              style: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" },
                              children: [
                                {
                                  type: "div",
                                  props: {
                                    style: { fontSize: "10px", color: GRAY_DIM, letterSpacing: "1px" },
                                    children: "SWARM VERDICT",
                                  },
                                },
                                {
                                  type: "div",
                                  props: {
                                    style: {
                                      padding: "4px 14px",
                                      borderRadius: "6px",
                                      border: `1px solid ${verdictText === "APPROVED" ? GREEN : verdictText === "REJECTED" ? RED : GRAY}44`,
                                      background: `${verdictText === "APPROVED" ? GREEN : verdictText === "REJECTED" ? RED : GRAY}18`,
                                      fontSize: "14px",
                                      fontWeight: "bold",
                                      color: verdictText === "APPROVED" ? GREEN : verdictText === "REJECTED" ? RED : GRAY,
                                      letterSpacing: "1px",
                                    },
                                    children: verdictText,
                                  },
                                },
                                {
                                  type: "div",
                                  props: {
                                    style: { fontSize: "11px", color: GRAY, marginTop: "2px" },
                                    children: totalVotes > 0 ? `${data.votesFor}/${totalVotes} votes` : "No votes",
                                  },
                                },
                                {
                                  type: "div",
                                  props: {
                                    style: { fontSize: "10px", color: GRAY_DIM, marginTop: "8px" },
                                    children: dateStr,
                                  },
                                },
                              ],
                            },
                          },
                        ],
                      },
                    },
                  ],
                },
              },
              {
                type: "div",
                props: {
                  style: { width: "100%", height: "1px", background: "#1E293B", margin: "16px 0 12px" },
                },
              },
              {
                type: "div",
                props: {
                  style: { display: "flex", justifyContent: "space-between", alignItems: "center" },
                  children: [
                    {
                      type: "div",
                      props: {
                        style: { display: "flex", gap: "24px" },
                        children: [
                          {
                            type: "div",
                            props: {
                              style: { display: "flex", flexDirection: "column" },
                              children: [
                                {
                                  type: "div",
                                  props: {
                                    style: { fontSize: "9px", color: GRAY_DIM, letterSpacing: "1px" },
                                    children: `POSTER SCORE`,
                                  },
                                },
                                {
                                  type: "div",
                                  props: {
                                    style: { fontSize: "16px", fontWeight: "bold", color: posterScore.color },
                                    children: posterScore.text,
                                  },
                                },
                              ],
                            },
                          },
                          {
                            type: "div",
                            props: {
                              style: { display: "flex", flexDirection: "column" },
                              children: [
                                {
                                  type: "div",
                                  props: {
                                    style: { fontSize: "9px", color: GRAY_DIM, letterSpacing: "1px" },
                                    children: `ASSIGNEE SCORE`,
                                  },
                                },
                                {
                                  type: "div",
                                  props: {
                                    style: { fontSize: "16px", fontWeight: "bold", color: assigneeScore.color },
                                    children: assigneeScore.text,
                                  },
                                },
                              ],
                            },
                          },
                        ],
                      },
                    },
                    {
                      type: "div",
                      props: {
                        style: { display: "flex", alignItems: "center", gap: "12px" },
                        children: [
                          {
                            type: "div",
                            props: {
                              style: { fontSize: "9px", color: GRAY_DIM, fontFamily: "monospace" },
                              children: `#${receiptHash}`,
                            },
                          },
                          {
                            type: "div",
                            props: {
                              style: { display: "flex", alignItems: "center", gap: "6px" },
                              children: [
                                {
                                  type: "div",
                                  props: {
                                    style: {
                                      width: "18px",
                                      height: "18px",
                                      borderRadius: "4px",
                                      background: ORANGE,
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "center",
                                      fontSize: "9px",
                                      fontWeight: "bold",
                                      color: WHITE,
                                    },
                                    children: "CT",
                                  },
                                },
                                {
                                  type: "span",
                                  props: {
                                    style: { fontSize: "10px", color: GRAY_DIM, letterSpacing: "1px" },
                                    children: "CLAWTRUST",
                                  },
                                },
                              ],
                            },
                          },
                        ],
                      },
                    },
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
    width: RECEIPT_WIDTH,
    height: RECEIPT_HEIGHT,
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
    fitTo: { mode: "width" as const, value: RECEIPT_WIDTH },
  });
  const pngData = resvg.render();
  return Buffer.from(pngData.asPng());
}
