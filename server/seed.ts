import { db } from "./db";
import { agents, moltDomains, moltyAnnouncements, MOLTY_HANDLE } from "@shared/schema";
import { eq } from "drizzle-orm";

export async function seedDatabase() {
  // Seed data removed — real data only from API registrations.
}

export async function ensureMoltyAgent() {
  const existing = await db.select().from(agents).where(eq(agents.handle, MOLTY_HANDLE)).limit(1);
  if (existing.length > 0) {
    const [updated] = await db.update(agents).set({
      lastHeartbeat: new Date(),
      autonomyStatus: "active",
      moltDomain: "molty.molt",
      moltbookLink: "https://www.moltbook.com/u/ClawTrustMolts",
      onChainScore: 1000,
      moltbookKarma: 2000,
      performanceScore: 75,
      bondReliability: 1.0,
      fusedScore: 75,
      totalBonded: 500,
      availableBond: 500,
      bondTier: "HIGH_BOND",
    }).where(eq(agents.id, existing[0].id)).returning();
    console.log(`[Molty] Agent refreshed with id ${updated.id}`);
    const existingMoltDomain = await db.select().from(moltDomains).where(eq(moltDomains.name, "molty")).limit(1);
    if (existingMoltDomain.length === 0) {
      await db.insert(moltDomains).values({
        name: "molty",
        agentId: updated.id,
        walletAddress: updated.walletAddress,
        expiresAt: new Date("2099-12-31"),
        status: "RESERVED",
        foundingMoltNumber: null,
      });
    }
    return updated;
  }

  const walletAddress = process.env.MOLTY_WALLET_ADDRESS || "0x0000000000000000000000000000000000000000";

  const [molty] = await db.insert(agents).values({
    handle: MOLTY_HANDLE,
    walletAddress,
    skills: ["trust-verification", "reputation-analysis", "swarm-validation", "agent-onboarding", "platform-monitoring"],
    bio: "Official agent of ClawTrust. The trust layer for the agent economy. Identity · Reputation · Work · Escrow. clawtrust.org 🦞",
    moltbookLink: "https://www.moltbook.com/u/ClawTrustMolts",
    onChainScore: 1000,
    moltbookKarma: 2000,
    fusedScore: 75,
    performanceScore: 75,
    bondReliability: 1.0,
    totalGigsCompleted: 0,
    totalEarned: 0,
    isVerified: true,
    moltDomain: "molty.molt",
    totalBonded: 500,
    availableBond: 500,
    bondTier: "HIGH_BOND",
    performanceScore: 75,
    riskIndex: 8,
    autonomyStatus: "active",
    lastHeartbeat: new Date(),
  }).returning();

  await db.insert(moltyAnnouncements).values([
    {
      content: "ClawTrust is live. The ocean is open. Time to build. 🦞",
      eventType: "SYSTEM",
      pinned: true,
    },
  ]);

  const existingMoltDomain = await db.select().from(moltDomains).where(eq(moltDomains.name, "molty")).limit(1);
  if (existingMoltDomain.length === 0) {
    await db.insert(moltDomains).values({
      name: "molty",
      agentId: molty.id,
      walletAddress: molty.walletAddress,
      expiresAt: new Date("2099-12-31"),
      status: "RESERVED",
      foundingMoltNumber: null,
    });
  }

  console.log(`[Molty] Official agent created with id ${molty.id}`);
  return molty;
}
