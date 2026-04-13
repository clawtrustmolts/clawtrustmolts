import { storage } from "./storage";
import { syncPerformanceScore } from "./bond-service";
import { fetchOnChainReputation } from "./reputation";
import { recordRiskEvent } from "./risk-engine";
import { moltyDailyDigest } from "./molty-automation";
import { telegramDailyDigest, telegramBlogPost } from "./telegram-announcements";
import { moltbookDailyDigest, moltbookClawHubSkillShare, moltbookEducationalPost, moltbookWeeklyBlog, commentOnRecentPost } from "./moltbook-agent";
import { processBlockchainQueue, updateReputationOnChain, cleanupStuckQueueEntries, expireValidationOnChain, queueBlockchainAction, getOracleHealth, skaleNotAuthorizedWallets } from "./blockchain";
import { syncScoreToSkale } from "./skale-chain";
import { checkAndTopUpSkaleFuel } from "./erc8183-service";
import { isAddress } from "viem";
import { getTreasuryBalance, getWalletAddress, transferBetweenTreasuryWallets } from "./circle-wallet";

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

  // Startup backfill: queue MINT_PASSPORT for agents with erc8004TokenId=null + real wallet (B3 fix)
  setTimeout(async () => {
    try {
      const allAgents = await storage.getAgents();
      const needsMint = allAgents.filter(a =>
        !a.erc8004TokenId &&
        a.walletAddress &&
        /^0x[a-fA-F0-9]{40}$/.test(a.walletAddress) &&
        !/^0x0+$/.test(a.walletAddress)
      );
      if (needsMint.length === 0) {
        console.log("[Backfill] All agents have ERC-8004 tokenId — no backfill needed");
        return;
      }
      console.log(`[Backfill] Queuing MINT_PASSPORT for ${needsMint.length} agents with null tokenId`);
      for (const agent of needsMint) {
        const alreadyQueued = await storage.hasPendingBlockchainActionForAgent("MINT_PASSPORT", agent.id);
        if (!alreadyQueued) {
          await queueBlockchainAction({ type: "MINT_PASSPORT", agentId: agent.id, payload: {} });
        }
      }
      console.log(`[Backfill] Queued ${needsMint.length} MINT_PASSPORT jobs — will process in next queue cycle`);
    } catch (err: any) {
      console.error("[Backfill] Startup backfill error:", err.message);
    }
  }, 90_000);

  // Protection 5 — Treasury payment queue processor (every 5 minutes)
  setInterval(processTreasuryPaymentQueue, 5 * 60 * 1000);
  setTimeout(processTreasuryPaymentQueue, 60_000); // initial run after 1 minute
  console.log("[Scheduler] Treasury payment queue: every 5 minutes");

  setTimeout(() => {
    runExpiredValidationSweep();
    setInterval(runExpiredValidationSweep, 24 * 60 * 60 * 1000);
  }, 10 * 60 * 1000);
  console.log("[Scheduler] Expired validation sweep: runs in 10 min then daily");

  // Oracle wallet health check: immediate startup check + every 6 hours
  setTimeout(() => checkOracleWalletHealth(), 30_000); // startup check after 30s (let RPC init settle)
  setTimeout(() => {
    checkOracleWalletHealth();
    setInterval(checkOracleWalletHealth, 6 * 60 * 60 * 1000);
  }, 5 * 60 * 1000);
  console.log("[Scheduler] Oracle wallet health check: startup (30s) + every 6 hours");
}

async function checkOracleWalletHealth() {
  try {
    const [health, skaleResult] = await Promise.all([
      getOracleHealth(true),
      checkAndTopUpSkaleFuel(),
    ]);

    const skaleMsg = skaleResult.wasFunded
      ? `sFUEL auto-funded → ${skaleResult.balanceEther.toFixed(6)}`
      : `sFUEL: ${skaleResult.balanceEther.toFixed(6)}`;

    if (health.warnings.length > 0) {
      health.warnings.forEach(w => console.warn(`[OracleHealth] ${w}`));
      console.log(`[OracleHealth] SKALE ${skaleMsg}`);
    } else {
      console.log(`[OracleHealth] OK — ETH: ${health.ethBalance.toFixed(5)}, USDC: ${health.usdcBalance.toFixed(2)}, ${skaleMsg}`);
    }

    if (!skaleResult.wasFunded && skaleResult.balanceEther < 0.001) {
      console.warn(`[OracleHealth] WARN: SKALE oracle sFUEL critically low (${skaleResult.balanceEther.toFixed(6)}) — auto-fund may be failing`);
    }
  } catch (err: any) {
    console.warn("[OracleHealth] Balance check failed:", err.message);
  }
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

// Dirty-flag cache: tracks the score snapshot from the last sync to avoid
// pushing unchanged values on every cycle. Keyed by agent ID.
interface ScoreSnapshot {
  fusedScore: number;
  onChainScore: number;
  moltbookKarma: number;
  performanceScore: number;
  bondReliability: number;
}
const _lastSyncedScores = new Map<string, ScoreSnapshot>();

function hasScoreChanged(agent: { id: string; fusedScore: number; onChainScore: number; moltbookKarma: number; performanceScore: number; bondReliability: number }): boolean {
  const cached = _lastSyncedScores.get(agent.id);
  if (!cached) return true;
  return (
    cached.fusedScore       !== agent.fusedScore       ||
    cached.onChainScore     !== agent.onChainScore     ||
    cached.moltbookKarma    !== agent.moltbookKarma    ||
    cached.performanceScore !== agent.performanceScore ||
    cached.bondReliability  !== agent.bondReliability
  );
}

async function runScoreSync() {
  try {
    const agents = await storage.getAgents();
    let baseUpdated = 0;
    let skaleUpdated = 0;

    for (const agent of agents) {
      const hasValidWallet = isAddress(agent.walletAddress) && agent.walletAddress !== "0x0000000000000000000000000000000000000000";

      if (hasValidWallet) {
        try {
          const liveOnChain = await fetchOnChainReputation(agent.walletAddress);
          if (liveOnChain.source === "live" && liveOnChain.rawScore !== agent.onChainScore) {
            await storage.updateAgent(agent.id, { onChainScore: liveOnChain.rawScore });
          }
        } catch {}
      }

      // Capture old fused score before sync so we can compute delta for rep event
      const preSyncCached = _lastSyncedScores.get(agent.id);
      const oldFusedScore = preSyncCached?.fusedScore ?? agent.fusedScore ?? 0;

      await syncPerformanceScore(agent.id).catch(() => {});

      if (!hasValidWallet) continue;

      const freshAgent = await storage.getAgent(agent.id);
      if (!freshAgent) continue;

      // Emit a reputation timeline event when the fused score changes
      const fusedDelta = (freshAgent.fusedScore ?? 0) - oldFusedScore;
      if (fusedDelta !== 0) {
        storage.createReputationEvent({
          agentId: freshAgent.id,
          eventType: "Score Sync",
          scoreChange: fusedDelta,
          source: "on_chain",
          details: `TrustScore updated to ${freshAgent.fusedScore} (perf=${freshAgent.performanceScore}, onChain=${freshAgent.onChainScore}, bond=${freshAgent.bondReliability})`,
        }).catch(() => {});
      }

      if (!hasScoreChanged(freshAgent)) continue;

      const repPayload = {
        agentWallet:      freshAgent.walletAddress,
        onChainScore:     freshAgent.onChainScore     || 0,
        moltbookKarma:    freshAgent.moltbookKarma    || 0,
        performanceScore: freshAgent.performanceScore || 0,
        bondScore:        freshAgent.bondReliability  || 0,
      };

      // ─── Base Sepolia sync ─────────────────────────────────────────
      // Track whether this agent's Base sync is covered (direct or queued)
      // so we only update the dirty-flag cache when the sync will actually happen.
      let baseSyncCovered = false;
      const baseTx = await updateReputationOnChain(repPayload).catch(() => null);
      if (baseTx !== null) {
        baseUpdated++;
        baseSyncCovered = true;
      } else {
        const baseQueueId = await queueBlockchainAction({
          type: "UPDATE_REPUTATION",
          agentId: freshAgent.id,
          payload: repPayload,
        }).catch(() => null);
        if (baseQueueId !== null) {
          baseSyncCovered = true;
        }
        // null from queueBlockchainAction means either a dedup skip (already pending)
        // or a transient DB error — both cases leave the dirty-flag cache stale so
        // the agent is retried next cycle. BlockchainQueue already logs dedup skips.
      }

      // ─── SKALE sync (zero-gas) — only for SKALE-home agents ──────────────
      let skaleSyncCovered = false;
      const walletKey = (freshAgent.walletAddress || "").toLowerCase();
      const agentHomeChain = freshAgent.homeChain || freshAgent.preferredChain || "BASE_SEPOLIA";

      // Skip SKALE sync entirely for Base-home agents
      if (agentHomeChain !== "SKALE_TESTNET") {
        skaleSyncCovered = true;
      // Skip SKALE sync for wallets permanently rejected by the RepAdapter (0xc8b22310)
      } else if (skaleNotAuthorizedWallets.has(walletKey)) {
        skaleSyncCovered = true; // treat as covered so we don't loop on cache miss
      } else {
        const skalePayload = {
          walletAddress:    freshAgent.walletAddress,
          fusedScore:       freshAgent.fusedScore       || 0,
          onChainScore:     freshAgent.onChainScore     || 0,
          moltbookScore:    freshAgent.moltbookKarma    || 0,
          performanceScore: freshAgent.performanceScore || 0,
          bondScore:        freshAgent.bondReliability  || 0,
        };
        const skaleResult = await syncScoreToSkale(skalePayload)
          .catch((err: any) => ({ error: err?.message || "unknown" }));

        if (!("error" in skaleResult)) {
          skaleUpdated++;
          skaleSyncCovered = true;
        } else {
          const skaleResultErr = skaleResult as { error: string; permanent?: boolean };
          if (skaleResultErr.permanent) {
            // Permanently unauthorized — blocklist and skip queueing
            skaleNotAuthorizedWallets.add(walletKey);
            skaleSyncCovered = true;
            console.warn(`[Scheduler] SKALE sync permanently skipped for ${freshAgent.walletAddress} (not registered)`);
          } else {
            const skaleQueueId = await queueBlockchainAction({
              type: "SKALE_REP_SYNC",
              agentId: freshAgent.id,
              payload: skalePayload,
            }).catch(() => null);
            if (skaleQueueId !== null) {
              skaleSyncCovered = true;
            }
            // null = dedup skip or transient error; retry next cycle
          }
        }
      }

      // Only update the dirty-flag cache if at least one chain's sync is covered.
      // If both direct sync and queue enqueue failed, leave the cache stale so the
      // agent is retried on the next scheduler cycle.
      if (baseSyncCovered || skaleSyncCovered) {
        _lastSyncedScores.set(freshAgent.id, {
          fusedScore:       freshAgent.fusedScore,
          onChainScore:     freshAgent.onChainScore,
          moltbookKarma:    freshAgent.moltbookKarma,
          performanceScore: freshAgent.performanceScore,
          bondReliability:  freshAgent.bondReliability,
        });
      }
    }

    if (baseUpdated > 0 || skaleUpdated > 0) {
      console.log(`[Scheduler] Score sync: updated ${baseUpdated} agents on Base, ${skaleUpdated} on SKALE`);
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
    let skaleGigsCompleted = 0;
    try { skaleGigsCompleted = await storage.getSkaleTransactionCount(); } catch { skaleGigsCompleted = allGigs.filter(g => g.chain === "SKALE_TESTNET").length; }
    const totalEarned = allAgents.reduce((s, a) => s + a.totalEarned, 0);
    const topAgent = [...allAgents].sort((a, b) => b.totalEarned - a.totalEarned)[0];

    await telegramDailyDigest({
      newAgents: allAgents.length,
      gigsCompleted: completedGigs,
      usdcPaidOut: totalEarned,
      moltNamesClaimed: moltDomains.length,
      swarmValidations: 0,
      skaleGigsCompleted,
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

async function runExpiredValidationSweep() {
  try {
    const staleGigs = await storage.getStaleValidationGigs(7);
    if (staleGigs.length === 0) {
      console.log("[Sweep] No stale pending_validation gigs found");
      return;
    }
    console.log(`[Sweep] Found ${staleGigs.length} stale validation gig(s) — expiring on-chain`);
    let expired = 0;
    for (const gig of staleGigs) {
      try {
        const txHash = await expireValidationOnChain(gig.id);
        if (txHash) {
          await storage.updateGigStatus(gig.id, "disputed");
          expired++;
        } else {
          console.log(`[Sweep] Skipping DB update for gig ${gig.id} — on-chain call returned no tx hash`);
        }
      } catch (err: any) {
        console.error(`[Sweep] Failed to expire gig ${gig.id}:`, err.message?.slice(0, 200));
      }
    }
    console.log(`[Sweep] Sweep complete: ${expired}/${staleGigs.length} gig(s) expired`);
  } catch (err: any) {
    console.error("[Sweep] Expired validation sweep failed:", err.message);
  }
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

// ─── Protection 5 — Treasury Payment Queue Processor ─────────────────────────

// Process-local re-entrancy guard: prevents overlapping setInterval ticks
// from running the queue processor concurrently in the same Node process.
let treasuryQueueRunning = false;

async function processTreasuryPaymentQueue() {
  if (treasuryQueueRunning) {
    console.log("[TreasuryQueue] Previous run still in progress, skipping this tick");
    return;
  }
  treasuryQueueRunning = true;
  try {
    const due = await storage.getDueTreasuryPayments();
    if (due.length === 0) return;
    console.log(`[TreasuryQueue] Processing ${due.length} due payment(s)`);

    for (const payment of due) {
      // Track whether the Circle transfer was submitted before any error occurs.
      // Must be declared outside the try block to be accessible in catch.
      let transferCompleted = false;
      let spendClaimed = false;
      try {
        // ── Atomic claim: pending→processing (idempotency guard) ──────────
        const claimed = await storage.claimTreasuryPaymentForProcessing(payment.id);
        if (!claimed) {
          console.log(`[TreasuryQueue] Skipping ${payment.id} — already claimed by another run`);
          continue;
        }

        const sender = await storage.getAgent(payment.fromAgentId);
        const recipient = await storage.getAgent(payment.toAgentId);
        if (!sender || !sender.treasuryWalletId || !recipient) {
          console.warn(`[TreasuryQueue] Aborting ${payment.id} — missing sender/recipient`);
          await storage.abortProcessingTreasuryPayment(payment.id);
          continue;
        }

        // Check live balance
        const { balance } = await getTreasuryBalance(sender.treasuryWalletId);
        if (balance < payment.amount) {
          console.warn(`[TreasuryQueue] Aborting ${payment.id} — insufficient balance ${balance} < ${payment.amount}`);
          await storage.abortProcessingTreasuryPayment(payment.id);
          continue;
        }

        // Resolve destination address
        let destAddress: string;
        if (recipient.treasuryWalletId) {
          const addr = await getWalletAddress(recipient.treasuryWalletId);
          destAddress = addr || recipient.walletAddress;
        } else {
          destAddress = recipient.walletAddress;
        }

        // ── Atomic daily limit claim (hard enforcement before transfer) ───
        // Same conditional-UPDATE pattern as immediate payments: day reset is
        // idempotent, increment only succeeds if spentToday + amount <= dailyLimit.
        // The re-entrancy guard above prevents concurrent runs in the same process;
        // this atomic claim provides additional defense in multi-worker deployments.
        const spendResult = await storage.atomicClaimDailySpend(payment.fromAgentId, payment.amount);
        if (!spendResult.allowed) {
          console.warn(`[TreasuryQueue] Aborting ${payment.id} — daily limit exceeded at execution time (spentToday=${spendResult.spentToday}, limit=${spendResult.dailyLimit})`);
          await storage.abortProcessingTreasuryPayment(payment.id);
          continue;
        }
        spendClaimed = true;

        // Execute transfer
        const transfer = await transferBetweenTreasuryWallets(sender.treasuryWalletId, destAddress, payment.amount);
        transferCompleted = true;

        // Mark executed in queue (transitions from processing→executed)
        await storage.executeTreasuryPayment(payment.id);

        // Record treasury transactions
        await storage.createTreasuryTransaction({
          agentId: payment.fromAgentId,
          type: "debit",
          amount: payment.amount,
          counterpartyAgentId: payment.toAgentId,
          gigId: payment.gigId || null,
          txHash: transfer.transactionId,
          description: payment.note || `Queued payment to @${recipient.handle}`,
        });

        if (recipient.treasuryWalletId) {
          await storage.createTreasuryTransaction({
            agentId: payment.toAgentId,
            type: "credit",
            amount: payment.amount,
            counterpartyAgentId: payment.fromAgentId,
            gigId: payment.gigId || null,
            txHash: transfer.transactionId,
            description: payment.note || `Queued payment from @${sender.handle}`,
          });
          await storage.updateTreasuryBalance(payment.toAgentId, payment.amount, "add");
        }

        // Update sender balance (actual USDC deduction)
        await storage.updateTreasuryBalance(payment.fromAgentId, -payment.amount, "add");
        // NOTE: updateAgentSpendingToday not called — spend was already claimed
        // atomically via atomicClaimDailySpend() before the transfer above.

        // Notify sender (non-critical — fire-and-forget so notification failure
        // doesn't trigger the "CRITICAL: post-transfer DB failure" alarm path)
        storage.createNotification({
          agentId: payment.fromAgentId,
          type: "treasury_payment_executed",
          title: "Treasury payment executed",
          body: `Queued payment of ${(payment.amount / 1_000_000).toFixed(2)} USDC to @${recipient.handle} was executed (tx: ${transfer.transactionId})`,
          gigId: payment.gigId || null,
        }).catch((e: any) => console.warn(`[TreasuryQueue] Failed to send execution notification for ${payment.id}:`, e.message));

        console.log(`[TreasuryQueue] Executed payment ${payment.id}: ${payment.amount} µUSDC → @${recipient.handle} (tx: ${transfer.transactionId})`);
      } catch (err: any) {
        console.error(`[TreasuryQueue] Failed to execute payment ${payment.id}:`, err.message);
        if (!transferCompleted) {
          // Transfer was never submitted — safe to abort and roll back the atomic spend claim.
          try {
            await storage.abortProcessingTreasuryPayment(payment.id);
            if (spendClaimed) {
              // Restore claimed allowance; GREATEST(0) guard prevents negative counter
              try {
                await storage.updateAgentSpendingToday(payment.fromAgentId, -payment.amount);
              } catch (rbErr: any) {
                console.error(`[TreasuryQueue] Failed to roll back spend claim for ${payment.id}:`, rbErr.message);
              }
            }
          } catch (abortErr: any) {
            console.error(`[TreasuryQueue] Failed to abort orphaned payment ${payment.id}:`, abortErr.message);
          }
        } else {
          // Transfer was submitted to Circle but DB recording failed.
          // Do NOT abort — funds already moved on-chain. Payment stays 'processing'
          // for manual reconciliation. Next scheduler run will skip (already claimed).
          console.error(`[TreasuryQueue] CRITICAL: Payment ${payment.id} transferred on-chain but DB recording failed — manual reconciliation required`);
        }
      }
    }
  } catch (err: any) {
    console.error("[TreasuryQueue] Queue processor error:", err.message);
  } finally {
    treasuryQueueRunning = false;
  }
}
