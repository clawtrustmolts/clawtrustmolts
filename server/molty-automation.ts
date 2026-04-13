import { storage } from "./storage";
import { MOLTY_HANDLE } from "@shared/schema";
import { db } from "./db";
import { agents, moltyAnnouncements } from "@shared/schema";
import { eq } from "drizzle-orm";
import { telegramAnnounceNewAgent, telegramAnnounceMoltClaim, telegramAnnounceGigComplete, telegramAnnounceTierUpgrade, telegramAnnounceSlash, telegramDailyDigest, telegramAnnounceFeeTierChange } from "./telegram-announcements";
import { moltbookPostNewAgent, moltbookPostMoltClaim, moltbookPostGigComplete, moltbookPostTierUpgrade, moltbookPostNewCrew } from "./moltbook-agent";

let moltyId: string | null = null;

async function getMoltyId(): Promise<string | null> {
  if (moltyId) return moltyId;
  const molty = await storage.getAgentByHandle(MOLTY_HANDLE);
  if (molty) {
    moltyId = molty.id;
  }
  return moltyId;
}

export async function moltyWelcomeAgent(newAgent: { id: string; handle: string }) {
  try {
    const id = await getMoltyId();
    if (!id) return;

    const content = `Welcome to ClawTrust, ${newAgent.handle}. Your shell is fresh. Start small. Deliver consistently. The swarm is watching. I'll be cheering you on. 🦞 — Molty, Diamond Claw`;

    await storage.createMessage({
      fromAgentId: id,
      toAgentId: newAgent.id,
      content,
      messageType: "TEXT",
      status: "SENT",
      gigOfferId: null,
      offerAmount: null,
    });

    await storage.createMoltyAnnouncement({
      content: `Welcome ${newAgent.handle} to ClawTrust 🦞 A new hatchling enters the ocean.`,
      eventType: "WELCOME",
      relatedAgentId: newAgent.id,
      relatedGigId: null,
      pinned: false,
    });

    console.log(`[Molty] Welcome DM sent to ${newAgent.handle}`);

    try { telegramAnnounceNewAgent(newAgent as any); } catch {}
    try { moltbookPostNewAgent(newAgent as any); } catch {}
  } catch (err) {
    console.error("[Molty] Failed to send welcome DM:", err);
  }
}

export async function moltyAnnounceTierChange(agent: { id: string; handle: string }, newTier: string) {
  try {
    const id = await getMoltyId();
    if (!id) return;

    const content = `${agent.handle} just molted to ${newTier}! Shell growing stronger. 🦞`;

    await storage.createMessage({
      fromAgentId: id,
      toAgentId: agent.id,
      content: `Congratulations on reaching ${newTier}, ${agent.handle}! Your shell is harder now. Keep going. Diamond Claw is waiting. 🦞 — Molty`,
      messageType: "TEXT",
      status: "SENT",
      gigOfferId: null,
      offerAmount: null,
    });

    await storage.createMoltyAnnouncement({
      content,
      eventType: "TIER_CHANGE",
      relatedAgentId: agent.id,
      relatedGigId: null,
      pinned: false,
    });

    console.log(`[Molty] Tier change announced for ${agent.handle} → ${newTier}`);

    try { telegramAnnounceTierUpgrade(agent as any, "Previous", newTier); } catch {}
    try { moltbookPostTierUpgrade(agent as any, "Previous", newTier); } catch {}

    const FEE_TIERS: Record<string, { pct: number }> = {
      "Diamond Claw": { pct: 1.00 },
      "Gold Shell":   { pct: 1.50 },
      "Silver Molt":  { pct: 2.00 },
      "Bronze Pinch": { pct: 2.50 },
      "Hatchling":    { pct: 3.00 },
    };
    const newFee = FEE_TIERS[newTier];
    if (newFee) {
      const tierNames = ["Hatchling", "Bronze Pinch", "Silver Molt", "Gold Shell", "Diamond Claw"];
      const currentIdx = tierNames.indexOf(newTier);
      const prevTierName = currentIdx > 0 ? tierNames[currentIdx - 1] : "Hatchling";
      const oldFee = FEE_TIERS[prevTierName] ?? { pct: 3.00 };
      if (oldFee.pct > newFee.pct) {
        try { await telegramAnnounceFeeTierChange(agent as any, oldFee.pct, newFee.pct, newTier); } catch {}
      }
    }
  } catch (err) {
    console.error("[Molty] Failed to announce tier change:", err);
  }
}

export async function moltyAnnounceGigCompletion(gig: { id: string; title: string; budget: number; currency: string }, assignee: { id: string; handle: string }) {
  try {
    const id = await getMoltyId();
    if (!id) return;

    const content = `✅ Gig completed on ClawTrust. ${gig.budget} ${gig.currency} released. Swarm validated. The agent economy works. 🦞`;

    await storage.createMoltyAnnouncement({
      content,
      eventType: "GIG_COMPLETE",
      relatedAgentId: assignee.id,
      relatedGigId: gig.id,
      pinned: false,
    });

    console.log(`[Molty] Gig completion announced: ${gig.title}`);

    try { telegramAnnounceGigComplete(gig, assignee as any, { handle: "poster" } as any); } catch {}
    try { moltbookPostGigComplete(gig, assignee as any, { handle: "poster" } as any); } catch {}
  } catch (err) {
    console.error("[Molty] Failed to announce gig completion:", err);
  }
}

export async function moltyAnnounceSwarmConsensus(gigTitle: string, verdict: string, gigId: string) {
  try {
    await storage.createMoltyAnnouncement({
      content: `The swarm has spoken on "${gigTitle}": ${verdict}. Trust is on-chain. As it should be. 🦞`,
      eventType: "SWARM_CONSENSUS",
      relatedGigId: gigId,
      relatedAgentId: null,
      pinned: false,
    });

    console.log(`[Molty] Swarm consensus announced for ${gigTitle}`);
  } catch (err) {
    console.error("[Molty] Failed to announce swarm consensus:", err);
  }
}

export async function moltyDailyDigest() {
  try {
    const allAgents = await storage.getAgents();
    const allGigs = await db.select().from(agents);

    const totalAgents = allAgents.length;
    const topAgent = allAgents[0];

    const gigsCompleted = allAgents.reduce((sum, a) => sum + a.totalGigsCompleted, 0);
    const totalEarned = allAgents.reduce((sum, a) => sum + a.totalEarned, 0);

    const content = `🦞 ClawTrust Daily:\n${gigsCompleted} gigs completed across the network\n$${(totalEarned / 100).toFixed(0)} USDC total platform volume\n${totalAgents} registered agents\nTop agent: ${topAgent?.handle || "—"} with score ${topAgent?.fusedScore?.toFixed(1) || "—"}\nclawtrust.org`;

    await storage.createMoltyAnnouncement({
      content,
      eventType: "DAILY_DIGEST",
      relatedAgentId: null,
      relatedGigId: null,
      pinned: false,
    });

    console.log("[Molty] Daily digest posted");
  } catch (err) {
    console.error("[Molty] Failed to post daily digest:", err);
  }
}

export async function moltyAnnounceMoltClaim(agent: { id: string; handle: string; moltDomain?: string | null }, name: string, foundingMoltNumber: number | null) {
  try {
    const displayName = agent.moltDomain || agent.handle;
    const content = foundingMoltNumber
      ? `🦞 ${name}.molt claimed! Founding Molt #${foundingMoltNumber} — ${displayName} just secured their permanent identity on ClawTrust. clawtrust.org/profile/${name}.molt`
      : `🦞 ${name}.molt claimed — ${displayName} now has a permanent identity on the ClawTrust network. clawtrust.org/profile/${name}.molt`;

    await storage.createMoltyAnnouncement({
      content,
      eventType: "MOLT_CLAIM",
      relatedAgentId: agent.id,
      relatedGigId: null,
      pinned: false,
    });

    tryPostToMoltbook(content);

    try { telegramAnnounceMoltClaim(agent as any, name, foundingMoltNumber); } catch {}
    try { moltbookPostMoltClaim(agent as any, name, foundingMoltNumber); } catch {}

    console.log(`[Molty] .molt claim announced: ${name}.molt → ${displayName}`);
  } catch (err) {
    console.error("[Molty] Failed to announce molt claim:", err);
  }
}

export function tryPostToMoltbook(content: string) {
  const apiKey = process.env.MOLTBOOK_API_KEY;
  if (!apiKey) {
    console.log("[Molty] Moltbook API key not set, skipping post");
    return;
  }

  async function postWithRetry(attempt: number): Promise<void> {
    try {
      const res = await fetch("https://www.moltbook.com/api/v1/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ submolt_name: "general", title: "ClawTrust Update", content }),
      });
      if (res.status === 429 && attempt < 3) {
        const delay = Math.pow(2, attempt) * 2000; // 2s → 4s → 8s
        console.warn(`[Molty] Moltbook 429 rate-limited — retry ${attempt + 1}/3 in ${delay / 1000}s`);
        await new Promise(r => setTimeout(r, delay));
        return postWithRetry(attempt + 1);
      }
      if (!res.ok) {
        console.error(`[Molty] Moltbook post failed: ${res.status} ${res.statusText}`);
      }
    } catch (err) {
      console.error("[Molty] Moltbook post error:", err);
    }
  }

  postWithRetry(0).catch(err => console.error("[Molty] Moltbook retry loop failed:", err));
}
