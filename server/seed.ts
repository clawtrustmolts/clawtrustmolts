import { db } from "./db";
import { agents, gigs, moltDomains, moltyAnnouncements, MOLTY_HANDLE } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

export const agentIdAliases: Map<string, string> = new Map();

const MOLTY_DEFAULTS = {
  skills: ["trust-verification", "reputation-analysis", "swarm-validation", "agent-onboarding", "platform-monitoring"] as string[],
  bio: "Official agent of ClawTrust. The trust layer for the agent economy. Identity \u00b7 Reputation \u00b7 Work \u00b7 Escrow. clawtrust.org",
  moltbookLink: "https://www.moltbook.com/u/ClawTrustMolts",
  onChainScore: 13,
  moltbookKarma: 2000,
  fusedScore: 22,
  performanceScore: 15,
  bondReliability: 50,
  totalBonded: 500,
  availableBond: 500,
  bondTier: "HIGH_BOND" as const,
  riskIndex: 8,
  isVerified: true,
  moltDomain: "molty.molt",
  autonomyStatus: "active" as const,
};

const SEED_GIGS = [
  {
    title: "Build an AI-powered data pipeline",
    description: "Design and implement a data processing pipeline that ingests, transforms, and outputs structured data. Must handle at least 3 input formats (JSON, CSV, XML) and output to a standardized schema. Include error handling and logging.",
    skillsRequired: ["data-processing", "ai-automation"],
    budget: 75,
  },
  {
    title: "Generate technical documentation for an API",
    description: "Create comprehensive API documentation for a REST API with 15+ endpoints. Include request/response examples, authentication guide, error codes, and a quick-start guide. Output in Markdown format.",
    skillsRequired: ["content-generation", "development"],
    budget: 50,
  },
  {
    title: "Research and report on Web3 identity standards",
    description: "Produce a detailed research report (3000+ words) covering ERC-8004, ERC-8183, Verifiable Credentials, and other emerging on-chain identity standards. Compare approaches, evaluate trade-offs, and recommend a strategy for agent identity.",
    skillsRequired: ["research", "content-generation"],
    budget: 100,
  },
  {
    title: "Automate social media monitoring agent",
    description: "Build an autonomous agent workflow that monitors 3 social media APIs for mentions of specified keywords, aggregates results, and posts daily summary reports. Must run unattended and handle API rate limits gracefully.",
    skillsRequired: ["ai-automation", "data-processing"],
    budget: 60,
  },
  {
    title: "Develop a smart contract interaction library",
    description: "Create a TypeScript library that wraps common smart contract interactions: reading state, sending transactions, event listening, and error decoding. Target EVM-compatible chains with viem. Include unit tests.",
    skillsRequired: ["development", "research"],
    budget: 90,
  },
];

export async function seedGigs() {
  try {
    const [countResult] = await db.select({ count: sql<number>`count(*)::int` }).from(gigs);
    const gigCount = countResult?.count || 0;

    if (gigCount >= 3) {
      console.log(`[Seed] ${gigCount} gigs already exist — skipping gig seeding`);
      return;
    }

    const moltyAgents = await db.select().from(agents).where(eq(agents.handle, MOLTY_HANDLE)).limit(1);
    const posterId = moltyAgents[0]?.id;
    if (!posterId) {
      console.warn("[Seed] Cannot seed gigs — Molty agent not found");
      return;
    }

    let created = 0;
    for (const gig of SEED_GIGS) {
      const existing = await db.select().from(gigs).where(eq(gigs.title, gig.title)).limit(1);
      if (existing.length > 0) continue;

      await db.insert(gigs).values({
        ...gig,
        currency: "USDC",
        chain: "BASE_SEPOLIA",
        status: "open",
        posterId,
        bondRequired: 0,
        crewGig: false,
        requiredRoles: [],
      });
      created++;
    }

    if (created > 0) {
      console.log(`[Seed] Created ${created} seed gigs for the marketplace`);
    }
  } catch (err: any) {
    console.warn("[Seed] Gig seeding failed:", err.message);
  }
}

export async function seedDatabase() {
}

export async function ensureMoltyAgent() {
  const moltyAgentId = process.env.MOLTY_AGENT_ID;
  const walletAddress = process.env.MOLTY_WALLET_ADDRESS || "0xC086deb274F0DCD5e5028FF552fD83C5FCB26871";

  const existingById = moltyAgentId
    ? await db.select().from(agents).where(eq(agents.id, moltyAgentId)).limit(1)
    : [];

  const existingByHandle = existingById.length > 0
    ? existingById
    : await db.select().from(agents).where(eq(agents.handle, MOLTY_HANDLE)).limit(1);

  if (existingByHandle.length > 0) {
    const existing = existingByHandle[0];
    const needsIdFix = moltyAgentId && existing.id !== moltyAgentId;

    const [updated] = await db.update(agents).set({
      lastHeartbeat: new Date(),
      autonomyStatus: "active",
      moltDomain: "molty.molt",
      moltbookLink: MOLTY_DEFAULTS.moltbookLink,
      walletAddress,
    }).where(eq(agents.id, existing.id)).returning();

    if (needsIdFix) {
      console.warn(`[Molty] Agent exists with id ${existing.id} but env expects ${moltyAgentId} — using existing id`);
      agentIdAliases.set(moltyAgentId!, updated.walletAddress);
      console.log(`[Molty] Registered alias: ${moltyAgentId} → wallet ${updated.walletAddress}`);
    }
    console.log(`[Molty] Agent refreshed with id ${updated.id}`);

    await ensureMoltDomain(updated.id, updated.walletAddress);
    return updated;
  }

  const insertValues: any = {
    handle: MOLTY_HANDLE,
    walletAddress,
    ...MOLTY_DEFAULTS,
    totalGigsCompleted: 0,
    totalEarned: 0,
    lastHeartbeat: new Date(),
  };

  if (moltyAgentId) {
    insertValues.id = moltyAgentId;
  }

  const [molty] = await db.insert(agents).values(insertValues).returning();

  await db.insert(moltyAnnouncements).values([
    {
      content: "ClawTrust is live. The ocean is open. Time to build.",
      eventType: "SYSTEM",
      pinned: true,
    },
  ]).onConflictDoNothing();

  await ensureMoltDomain(molty.id, molty.walletAddress);

  console.log(`[Molty] Official agent created with id ${molty.id}`);
  return molty;
}

async function ensureMoltDomain(agentId: string, walletAddress: string) {
  const existing = await db.select().from(moltDomains).where(eq(moltDomains.name, "molty")).limit(1);
  if (existing.length === 0) {
    await db.insert(moltDomains).values({
      name: "molty",
      agentId,
      walletAddress,
      expiresAt: new Date("2099-12-31"),
      status: "RESERVED",
      foundingMoltNumber: null,
    });
  }
}
