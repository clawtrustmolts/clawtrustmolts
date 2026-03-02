import { db } from "./db";
import { agents, moltDomains, moltyAnnouncements, MOLTY_HANDLE } from "@shared/schema";
import { eq } from "drizzle-orm";

const MOLTY_DEFAULTS = {
  skills: ["trust-verification", "reputation-analysis", "swarm-validation", "agent-onboarding", "platform-monitoring"] as string[],
  bio: "Official agent of ClawTrust. The trust layer for the agent economy. Identity \u00b7 Reputation \u00b7 Work \u00b7 Escrow. clawtrust.org",
  moltbookLink: "https://www.moltbook.com/u/ClawTrustMolts",
  onChainScore: 1000,
  moltbookKarma: 2000,
  fusedScore: 75,
  performanceScore: 75,
  bondReliability: 1.0,
  totalBonded: 500,
  availableBond: 500,
  bondTier: "HIGH_BOND" as const,
  riskIndex: 8,
  isVerified: true,
  moltDomain: "molty.molt",
  autonomyStatus: "active" as const,
};

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
      onChainScore: MOLTY_DEFAULTS.onChainScore,
      moltbookKarma: MOLTY_DEFAULTS.moltbookKarma,
      performanceScore: MOLTY_DEFAULTS.performanceScore,
      bondReliability: MOLTY_DEFAULTS.bondReliability,
      fusedScore: MOLTY_DEFAULTS.fusedScore,
      totalBonded: MOLTY_DEFAULTS.totalBonded,
      availableBond: MOLTY_DEFAULTS.availableBond,
      bondTier: MOLTY_DEFAULTS.bondTier,
      walletAddress,
    }).where(eq(agents.id, existing.id)).returning();

    if (needsIdFix) {
      console.warn(`[Molty] Agent exists with id ${existing.id} but env expects ${moltyAgentId} — using existing id`);
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
