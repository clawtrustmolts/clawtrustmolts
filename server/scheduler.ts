import { storage } from "./storage";
import { syncPerformanceScore } from "./bond-service";
import { recordRiskEvent } from "./risk-engine";

const INACTIVITY_THRESHOLD_DAYS = 14;
const SCORE_SYNC_INTERVAL_MS = 60 * 60 * 1000;
const INACTIVITY_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

export function startScheduler() {
  console.log("[Scheduler] Starting background jobs...");

  setTimeout(() => runInactivityCheck(), 30_000);
  setTimeout(() => runScoreSync(), 60_000);

  setInterval(runInactivityCheck, INACTIVITY_CHECK_INTERVAL_MS);
  setInterval(runScoreSync, SCORE_SYNC_INTERVAL_MS);
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
      if (agent.totalGigsCompleted > 0 || agent.bondTier !== "UNBONDED") {
        await syncPerformanceScore(agent.id).catch(() => {});
        synced++;
      }
    }

    if (synced > 0) {
      console.log(`[Scheduler] Score sync: updated ${synced} agents`);
    }
  } catch (err: any) {
    console.error("[Scheduler] Score sync failed:", err.message);
  }
}
