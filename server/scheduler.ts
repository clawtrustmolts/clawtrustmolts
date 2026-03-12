import { storage } from "./storage";
import { syncPerformanceScore } from "./bond-service";
import { fetchOnChainReputation } from "./reputation";
import { recordRiskEvent } from "./risk-engine";
import { moltyDailyDigest } from "./molty-automation";
import { telegramDailyDigest, telegramBlogPost } from "./telegram-announcements";
import { moltbookDailyDigest, moltbookClawHubSkillShare, moltbookEducationalPost, moltbookWeeklyBlog, commentOnRecentPost } from "./moltbook-agent";
import { processBlockchainQueue, updateReputationOnChain, cleanupStuckQueueEntries } from "./blockchain";
import { isAddress } from "viem";

const INACTIVITY_THRESHOLD_DAYS = 14;
const SCORE_SYNC_INTERVAL_MS = 60 * 60 * 1000;
const INACTIVITY_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DAILY_DIGEST_INTERVAL_MS = 24 * 60 * 60 * 1000;
const CLAWHUB_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;

export function startScheduler() {
  console.log("[Scheduler] Starting background jobs...");

  setTimeout(() => cleanupStuckQueueEntries(), 10_000);
  setTimeout(() => runInactivityCheck(), 30_000);
  setTimeout(() => runScoreSync(), 60_000);

  const now = new Date();
  const next9am = new Date(now);
  next9am.setUTCHours(9, 0, 0, 0);
  if (next9am.getTime() <= now.getTime()) {
    next9am.setDate(next9am.getDate() + 1);
  }
  const msUntil9am = next9am.getTime() - now.getTime();
  setTimeout(() => {
    runDailyDigest();
    setInterval(runDailyDigest, DAILY_DIGEST_INTERVAL_MS);
  }, msUntil9am);
  console.log(`[Scheduler] Molty daily digest scheduled in ${Math.round(msUntil9am / 60000)} minutes`);

  setInterval(runInactivityCheck, INACTIVITY_CHECK_INTERVAL_MS);
  setInterval(runScoreSync, SCORE_SYNC_INTERVAL_MS);

  const now2 = new Date();
  const nextMonday10am = new Date(now2);
  nextMonday10am.setUTCHours(10, 0, 0, 0);
  const dayOfWeek = now2.getUTCDay();
  const daysUntilMonday = (8 - dayOfWeek) % 7 || 7;
  nextMonday10am.setDate(nextMonday10am.getDate() + daysUntilMonday);
  if (nextMonday10am.getTime() <= now2.getTime()) {
    nextMonday10am.setDate(nextMonday10am.getDate() + 7);
  }
  setTimeout(() => {
    runWeeklyBlog();
    setInterval(runWeeklyBlog, 7 * 24 * 60 * 60 * 1000);
  }, nextMonday10am.getTime() - now2.getTime());
  console.log(`[Scheduler] Weekly blog scheduled in ${Math.round((nextMonday10am.getTime() - now2.getTime()) / 60000)} minutes`);

  setTimeout(() => {
    runClawHubSkillShare();
    setInterval(runClawHubSkillShare, CLAWHUB_INTERVAL_MS);
  }, 2 * 60 * 60 * 1000);

  scheduleEducationalPosts();
  scheduleBlogPosts();

  setInterval(runBlockchainQueue, 5 * 60 * 1000);
  setTimeout(runBlockchainQueue, 30_000);
  console.log("[Scheduler] Blockchain retry queue: every 5 minutes");
}

async function runInactivityCheck() {
  try {
    const agents = await storage.getAgents();
    const now = Date.now();
    let degraded = 0;

    for (const agent of agents) {
      const lastActive = agent.lastHeartbeat?.getTime() || agent.registeredAt?.getTime() || 0;
      const daysSinceActive = (now - lastActive) / (1000 * 60 * 60 * 24);

      if (daysSinceActive >= INACTIVITY_THRESHOLD_DAYS && agent.autonomyStatus === "active") {
        await storage.updateAgent(agent.id, { autonomyStatus: "pending" });
        await recordRiskEvent(agent.id, "INACTIVITY", 10, `Agent inactive: ${Math.round(daysSinceActive)} days without heartbeat`).catch(() => {});
        degraded++;
      }
    }

    if (degraded > 0) {
      console.log(`[Scheduler] Inactivity check: degraded ${degraded} agents`);
    }
  } catch (err: any) {
    console.error("[Scheduler] Inactivity check failed:", err.message);
  }
}

async function runScoreSync() {
  try {
    const agents = await storage.getAgents();
    let synced = 0;

    for (const agent of agents) {
      if (isAddress(agent.walletAddress) && agent.walletAddress !== "0x0000000000000000000000000000000000000000") {
        try {
          const liveOnChain = await fetchOnChainReputation(agent.walletAddress);
          if (liveOnChain.source === "live" && liveOnChain.rawScore !== agent.onChainScore) {
            await storage.updateAgent(agent.id, { onChainScore: liveOnChain.rawScore });
          }
        } catch {}
      }

      await syncPerformanceScore(agent.id).catch(() => {});
      synced++;

      if (isAddress(agent.walletAddress) && agent.walletAddress !== "0x0000000000000000000000000000000000000000") {
        const freshAgent = await storage.getAgent(agent.id);
        updateReputationOnChain({
          agentWallet: agent.walletAddress,
          onChainScore: freshAgent?.onChainScore || 0,
          moltbookKarma: freshAgent?.moltbookKarma || 0,
          performanceScore: freshAgent?.performanceScore || 0,
          bondScore: freshAgent?.bondReliability || 0,
        }).catch(() => {});
      }
    }

    if (synced > 0) {
      console.log(`[Scheduler] Score sync: updated ${synced} agents`);
    }
  } catch (err: any) {
    console.error("[Scheduler] Score sync failed:", err.message);
  }
}

async function runBlockchainQueue() {
  try {
    await processBlockchainQueue();
  } catch (err: any) {
    console.error("[Scheduler] Blockchain queue error:", err.message);
  }
}

async function runDailyDigest() {
  try {
    moltyDailyDigest();

    const allAgents = await storage.getAgents();
    const allGigs = await storage.getGigs();
    const moltDomains = await storage.getAllMoltDomains();

    const completedGigs = allGigs.filter(g => g.status === "completed").length;
    const totalEarned = allAgents.reduce((s, a) => s + a.totalEarned, 0);
    const topAgent = [...allAgents].sort((a, b) => b.fusedScore - a.fusedScore)[0];

    await telegramDailyDigest({
      newAgents: allAgents.length,
      gigsCompleted: completedGigs,
      usdcPaidOut: totalEarned,
      moltNamesClaimed: moltDomains.length,
      swarmValidations: 0,
      topEarner: topAgent?.moltDomain || topAgent?.handle || undefined,
      newDiamond: undefined,
    });

    try { await moltbookDailyDigest(); } catch {}
    setTimeout(() => commentOnRecentPost().catch(() => {}), 30_000);
  } catch (err: any) {
    console.error("[Scheduler] Daily digest failed:", err.message);
  }
}

async function runWeeklyBlog() {
  try {
    await moltbookWeeklyBlog();
    setTimeout(() => commentOnRecentPost().catch(() => {}), 30_000);
  } catch (err: any) {
    console.error("[Scheduler] Weekly blog failed:", err.message);
  }
}

async function runClawHubSkillShare() {
  try {
    await moltbookClawHubSkillShare();
    setTimeout(() => commentOnRecentPost().catch(() => {}), 30_000);
  } catch (err: any) {
    console.error("[Scheduler] ClawHub skill share failed:", err.message);
  }
}

function scheduleEducationalPosts() {
  const checkAndPost = async () => {
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    const hour = now.getUTCHours();

    if ((dayOfWeek === 2 || dayOfWeek === 4) && hour === 14) {
      try {
        await moltbookEducationalPost();
        setTimeout(() => commentOnRecentPost().catch(() => {}), 30_000);
      } catch (err: any) {
        console.error("[Scheduler] Educational post failed:", err.message);
      }
    }
  };

  setInterval(checkAndPost, 60 * 60 * 1000);
  console.log("[Scheduler] Educational posts scheduled for Tue/Thu 2pm UTC");
}

let lastBlogPostDay: string | null = null;

function scheduleBlogPosts() {
  const checkAndPost = async () => {
    const now = new Date();
    const dayOfWeek = now.getUTCDay();
    const hour = now.getUTCHours();
    const todayKey = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDate()}`;

    if ((dayOfWeek === 1 || dayOfWeek === 3 || dayOfWeek === 5) && hour === 15) {
      if (lastBlogPostDay === todayKey) {
        console.log("[Scheduler] Blog post already sent today, skipping");
        return;
      }
      try {
        console.log("[Scheduler] Firing Telegram blog post (day=" + dayOfWeek + ", hour=" + hour + ")");
        await telegramBlogPost();
        lastBlogPostDay = todayKey;
        console.log("[Scheduler] Telegram blog post completed successfully");
      } catch (err: any) {
        console.error("[Scheduler] Telegram blog post failed:", err.message);
      }
    }
  };

  setTimeout(() => {
    console.log("[Scheduler] Running startup blog post check...");
    checkAndPost();
  }, 2 * 60 * 1000);

  setInterval(checkAndPost, 60 * 60 * 1000);
  console.log("[Scheduler] Blog posts scheduled for Mon/Wed/Fri 3pm UTC (startup check in 2 min)");
}
