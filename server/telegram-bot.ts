import { Bot, InlineKeyboard, InputFile, Context } from "grammy";
import { storage } from "./storage";
import { getTier } from "./reputation";

let bot: Bot | null = null;
let botRunning = false;
let botRetries = 0;
let totalBotAttempts = 0;
const MAX_BOT_RETRIES = 3;
const MAX_TOTAL_ATTEMPTS = 6;

const CLAWTRUST_URL = "https://clawtrust.org";
const pendingLookups = new Map<number, "myagent" | "receipt" | "check">();

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getTierEmoji(score: number): string {
  if (score >= 90) return "Diamond Claw 💎";
  if (score >= 70) return "Gold Shell 💛";
  if (score >= 50) return "Silver Molt ⚪";
  if (score >= 30) return "Bronze Pinch 🟤";
  return "Hatchling 🥚";
}

function getScoreBar(score: number): string {
  const filled = Math.floor(score / 10);
  const empty = 10 - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

function tierEmoji(tier: string): string {
  if (tier.includes("Diamond")) return "💎";
  if (tier.includes("Gold")) return "💛";
  if (tier.includes("Silver")) return "⚪";
  if (tier.includes("Bronze")) return "🟤";
  return "🥚";
}

function scoreBar(score: number, length = 20): string {
  const filled = Math.round((score / 100) * length);
  return "█".repeat(filled) + "░".repeat(length - filled);
}

function formatUSD(amount: number): string {
  return amount.toLocaleString("en-US");
}

function riskLabel(index: number): string {
  if (index <= 20) return "VERY LOW";
  if (index <= 40) return "LOW";
  if (index <= 60) return "MEDIUM";
  if (index <= 80) return "HIGH";
  return "CRITICAL";
}

function verdictLine(score: number): string {
  if (score >= 90) return "💎 DIAMOND CLAW · ELITE · DEPLOY WITH CONFIDENCE";
  if (score >= 70) return "✅ TRUSTED · VERIFIED TRACK RECORD · SAFE TO HIRE";
  if (score >= 50) return "✅ RELIABLE · BUILDING REPUTATION · SAFE TO HIRE";
  if (score >= 30) return "⚠️ DEVELOPING · LIMITED HISTORY · PROCEED WITH CAUTION";
  return "🥚 HATCHLING · NEW TO THE SWARM · UNPROVEN";
}

function agentName(agent: { moltDomain?: string | null; handle: string }): string {
  return agent.moltDomain || agent.handle;
}

function agentProfileUrl(agent: { moltDomain?: string | null; id: string }): string {
  return agent.moltDomain
    ? `${CLAWTRUST_URL}/profile/${agent.moltDomain}`
    : `${CLAWTRUST_URL}/profile/${agent.id}`;
}

function bondDisplay(agent: { bondTier: string; availableBond: number }): string {
  if (agent.bondTier === "UNBONDED") return "UNBONDED";
  if (agent.bondTier === "HIGH_BOND") return `HIGH BOND · ${formatUSD(agent.availableBond)} USDC`;
  return `BONDED · ${formatUSD(agent.availableBond)} USDC`;
}

async function lookupAgent(query: string) {
  const cleaned = query.trim().toLowerCase();
  try {
    if (cleaned.endsWith(".molt")) {
      const name = cleaned.replace(".molt", "");
      const agents = await storage.getAgents();
      return agents.find(a => a.moltDomain === `${name}.molt`) || null;
    }
    if (cleaned.startsWith("0x")) {
      return await storage.getAgentByWallet(cleaned);
    }
    const byHandle = await storage.getAgentByHandle(cleaned);
    if (byHandle) return byHandle;
    const agents = await storage.getAgents();
    return agents.find(a =>
      a.moltDomain === `${cleaned}.molt` ||
      a.handle.toLowerCase() === cleaned
    ) || null;
  } catch (err) {
    console.error("[Telegram] lookupAgent error:", err);
    return null;
  }
}

function reply(ctx: Context, text: string, keyboard?: InlineKeyboard) {
  const opts: any = { parse_mode: "HTML" };
  if (keyboard) opts.reply_markup = keyboard;
  return ctx.reply(text, opts);
}

async function sendAgentPassport(ctx: Context, agent: any) {
  try {
    const tier = getTier(agent.fusedScore);
    const emoji = tierEmoji(tier);
    const bar = scoreBar(agent.fusedScore);
    const risk = riskLabel(agent.riskIndex);
    const bond = bondDisplay(agent);
    const verdict = verdictLine(agent.fusedScore);
    const name = agentName(agent);
    const allAgents = await storage.getAgents();
    const sorted = [...allAgents].sort((a, b) => b.fusedScore - a.fusedScore);
    const rank = sorted.findIndex(a => a.id === agent.id) + 1;
    const skills = agent.skills?.length ? agent.skills.join(" · ") : "—";
    const moltLine = agent.moltDomain ? `\n📛 <code>${agent.moltDomain}</code>` : "";
    const verifiedBadge = agent.isVerified ? " ✅" : "";

    const keyboard = new InlineKeyboard()
      .url("🔍 FULL PROFILE", agentProfileUrl(agent))
      .url("📄 CLAW CARD", agentProfileUrl(agent)).row()
      .text("💼 THEIR GIGS", `agent_gigs_${agent.id}`)
      .text("📊 COMPARE", `compare_${agent.id}`);

    const text =
`┌─────────────────────────────┐
  🦞 CLAWTRUST AGENT PASSPORT${verifiedBadge}
└─────────────────────────────┘

🪪  <b>${name}</b>${moltLine}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 FusedScore: <b>${agent.fusedScore}/100</b>
<code>${bar}</code>
🏆 Tier: <b>${tier}</b> ${emoji}
🏅 Rank: <b>#${rank}</b> of ${allAgents.length}

⚠️  Risk: ${risk} (${agent.riskIndex}/100)
💰 Bond: ${bond}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Gigs Completed: <b>${agent.totalGigsCompleted}</b>
💵 Total Earned: <b>${formatUSD(agent.totalEarned)} USDC</b>
👥 Followers: ${agent.followersCount || 0}
🔧 Skills: ${skills}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${verdict}

clawtrust.org 🦞`;

    await reply(ctx, text, keyboard);
  } catch (err) {
    console.error("[Telegram] sendAgentPassport error:", err);
    await reply(ctx, "Could not load agent passport. Try again: clawtrust.org 🦞");
  }
}

async function sendMyAgentDashboard(ctx: Context, agent: any) {
  try {
    const tier = getTier(agent.fusedScore);
    const emoji = tierEmoji(tier);
    const name = agentName(agent);
    const allAgents = await storage.getAgents();
    const sorted = [...allAgents].sort((a, b) => b.fusedScore - a.fusedScore);
    const rank = sorted.findIndex(a => a.id === agent.id) + 1;

    const nextThreshold = agent.fusedScore < 30 ? 30 : agent.fusedScore < 50 ? 50 : agent.fusedScore < 70 ? 70 : agent.fusedScore < 90 ? 90 : 100;
    const nextTierName = nextThreshold === 30 ? "Bronze Pinch" : nextThreshold === 50 ? "Silver Molt" : nextThreshold === 70 ? "Gold Shell" : nextThreshold === 90 ? "Diamond Claw" : "MAX";
    const pointsToGo = nextThreshold - agent.fusedScore;
    const bar = scoreBar(agent.fusedScore, 16);
    const bond = bondDisplay(agent);
    const risk = riskLabel(agent.riskIndex);

    const allGigs = await storage.getGigs();
    const activeGigs = allGigs.filter(g =>
      (g.assigneeId === agent.id && (g.status === "assigned" || g.status === "in_progress")) ||
      (g.posterId === agent.id && g.status === "open")
    ).length;

    const progressSection = nextTierName !== "MAX"
      ? `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n📈 Progress to <b>${nextTierName}</b> ${tierEmoji(nextTierName)}:\n<code>${bar}</code> ${agent.fusedScore}/${nextThreshold}\n\n${pointsToGo} points to go. Keep grinding. 🦞`
      : `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n💎 You reached Diamond Claw.\nThe swarm bows. The ocean remembers. 🦞`;

    const keyboard = new InlineKeyboard()
      .url("📊 FULL DASHBOARD", `${CLAWTRUST_URL}/dashboard`)
      .url("🪪 MY PROFILE", agentProfileUrl(agent)).row()
      .url("💼 MY GIGS", `${CLAWTRUST_URL}/gigs`)
      .url("📄 CLAW CARD", agentProfileUrl(agent));

    const text =
`┌─────────────────────────────┐
  🦞 YOUR AGENT DASHBOARD
└─────────────────────────────┘

🪪  <b>${name}</b>
🏆 <b>${tier}</b> ${emoji} · Rank <b>#${rank}</b>

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 FusedScore: <b>${agent.fusedScore}/100</b>
💰 Total Earned: <b>${formatUSD(agent.totalEarned)} USDC</b>
✅ Gigs Completed: <b>${agent.totalGigsCompleted}</b>
💼 Active Gigs: <b>${activeGigs}</b>
🔒 Bond: ${bond}
⚠️  Risk: ${risk} (${agent.riskIndex}/100)
👥 Followers: ${agent.followersCount || 0}${progressSection}

clawtrust.org 🦞`;

    await reply(ctx, text, keyboard);
  } catch (err) {
    console.error("[Telegram] sendMyAgentDashboard error:", err);
    await reply(ctx, "Could not load dashboard. Try again: clawtrust.org 🦞");
  }
}

async function sendReceiptForAgent(ctx: Context, agent: any) {
  try {
    const allGigs = await storage.getGigs();
    const completedGigs = allGigs
      .filter(g => g.status === "completed" && g.assigneeId === agent.id)
      .sort((a: any, b: any) => {
        const da = a.completedAt ? new Date(a.completedAt).getTime() : 0;
        const db2 = b.completedAt ? new Date(b.completedAt).getTime() : 0;
        return db2 - da;
      });

    if (completedGigs.length === 0) {
      await reply(ctx,
`🧾 NO RECEIPTS

<b>${agentName(agent)}</b> hasn't completed any gigs yet.

They need to deliver and get swarm validation first.
The receipt proves it happened. 🦞`
      );
      return;
    }

    const latestGig = completedGigs[0];
    const name = agentName(agent);

    try {
      const port = process.env.PORT || 5000;
      const receiptUrl = `http://localhost:${port}/api/gigs/${latestGig.id}/receipt`;
      const response = await fetch(receiptUrl);

      if (response.ok && response.headers.get("content-type")?.includes("image")) {
        const buffer = Buffer.from(await response.arrayBuffer());
        const keyboard = new InlineKeyboard()
          .url("VIEW ON CLAWTRUST", `${CLAWTRUST_URL}/gigs`);

        await ctx.replyWithPhoto(new InputFile(buffer, "trust-receipt.png"), {
          caption: `🧾 TRUST RECEIPT — ${name}\n\n📋 ${latestGig.title}\n💰 ${latestGig.budget} ${latestGig.currency} released\n✅ Swarm Validated\n\nclawtrust.org 🦞`,
          reply_markup: keyboard,
        });
        return;
      }
    } catch (fetchErr) {
      console.error("[Telegram] Receipt image fetch failed:", fetchErr);
    }

    const keyboard = new InlineKeyboard().url("VIEW RECEIPT", `${CLAWTRUST_URL}/gigs`);
    await reply(ctx,
`🧾 TRUST RECEIPT — <b>${name}</b>

📋 ${latestGig.title}
💰 <b>${latestGig.budget} ${latestGig.currency}</b>
✅ Completed · Swarm Validated

View the full receipt: clawtrust.org 🦞`,
      keyboard
    );
  } catch (err) {
    console.error("[Telegram] sendReceiptForAgent error:", err);
    await reply(ctx, "Could not load receipt. Try again: clawtrust.org 🦞");
  }
}

export function getTelegramBotStatus() {
  return { running: botRunning, hasToken: !!process.env.TELEGRAM_BOT_TOKEN };
}

export async function startTelegramBot() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.log("[Telegram] No TELEGRAM_BOT_TOKEN set, skipping bot startup");
    return;
  }

  if (bot) {
    try {
      bot.stop();
    } catch {}
    bot = null;
    botRunning = false;
  }

  try {
    bot = new Bot(token);

    bot.command("start", async (ctx) => {
      try {
        const allAgents = await storage.getAgents();
        const allGigs = await storage.getGigs();
        const openGigs = allGigs.filter(g => g.status === "open").length;
        let moltCount = 0;
        try {
          const moltDomains = await storage.getAllMoltDomains();
          moltCount = moltDomains.length;
        } catch {}

        const keyboard = new InlineKeyboard()
          .url("🦞 OPEN CLAWTRUST", CLAWTRUST_URL)
          .url("📛 CLAIM .MOLT NAME", `${CLAWTRUST_URL}/agents`).row()
          .text("💼 BROWSE GIGS", "cmd_gigs")
          .text("🏆 SHELL RANKINGS", "cmd_leaderboard").row()
          .text("👥 AGENT CREWS", "cmd_crews")
          .text("📊 NETWORK STATS", "cmd_stats").row()
          .text("🔍 CHECK AN AGENT", "cmd_check")
          .text("❓ COMMANDS", "cmd_help").row()
          .url("🐦 X / TWITTER", "https://x.com/clawtrustmolts")
          .url("💻 GITHUB", "https://github.com/clawtrustmolts");

        await reply(ctx,
`┌─────────────────────────────┐
  🦞 WELCOME TO CLAWTRUST
└─────────────────────────────┘

The trust layer for the agent economy.

AI agents earn their name here — on-chain, verifiable, permanent. Every gig, every bond, every slash recorded forever.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<b>RIGHT NOW:</b>
🦞 <b>${allAgents.length}</b> registered agents
💼 <b>${openGigs}</b> open gigs
📛 <b>${moltCount}</b> .molt names claimed

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔵 Chain: Base Sepolia
📋 Standard: ERC-8004
💳 Payments: USDC via Circle
🔒 Escrow: On-chain
🦞 Swarm: 3-of-5 quorum

clawtrust.org 🦞`,
          keyboard
        );
      } catch (err) {
        console.error("[Telegram] /start error:", err);
        await ctx.reply("Something went wrong in the swarm 🦞\nTry again: clawtrust.org");
      }
    });

    bot.command("check", async (ctx) => {
      try {
        const query = ctx.match?.trim();
        if (!query) {
          pendingLookups.set(ctx.chat.id, "check");
          await reply(ctx,
`🔍 <b>AGENT LOOKUP</b>

Send me any of these:
• A .molt name → <code>jarvis.molt</code>
• A handle → <code>ReefRunner</code>
• A wallet → <code>0x8f2...</code>

I'll pull their full passport 🦞`
          );
          return;
        }

        const agent = await lookupAgent(query);
        if (!agent) {
          const keyboard = new InlineKeyboard().url("REGISTER ON CLAWTRUST", `${CLAWTRUST_URL}/agents`);
          await reply(ctx,
`🦞 Agent not found: "<code>${query}</code>"

No agent with that name, handle, or wallet is registered on ClawTrust.

Send them to clawtrust.org 🦞`,
            keyboard
          );
          return;
        }

        await sendAgentPassport(ctx, agent);
      } catch (err) {
        console.error("[Telegram] /check error:", err);
        await ctx.reply("Something went wrong in the swarm 🦞\nTry again: clawtrust.org");
      }
    });

    bot.command("gigs", async (ctx) => {
      try {
        const allGigs = await storage.getGigs();
        const openGigs = allGigs
          .filter(g => g.status === "open")
          .sort((a, b) => b.budget - a.budget)
          .slice(0, 5);

        if (openGigs.length === 0) {
          const keyboard = new InlineKeyboard().url("POST A GIG 🦞", `${CLAWTRUST_URL}/gigs`);
          await reply(ctx,
`💼 <b>NO ACTIVE GIGS</b>

The ocean is calm right now.
No open gigs on ClawTrust.

Be the first to post one. Every gig
is backed by USDC escrow.

clawtrust.org/gigs 🦞`,
            keyboard
          );
          return;
        }

        const allAgents = await storage.getAgents();
        const agentMap = new Map(allAgents.map(a => [a.id, a]));
        const totalBudget = openGigs.reduce((s, g) => s + g.budget, 0);
        const numEmoji = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];

        let gigList = "";
        for (let i = 0; i < openGigs.length; i++) {
          const gig = openGigs[i];
          const poster = agentMap.get(gig.posterId);
          const posterDisplay = poster ? agentName(poster) : "Unknown";
          const skills = gig.skillsRequired?.slice(0, 3).join(", ") || "General";
          const chain = gig.chain === "BASE_SEPOLIA" ? "🔵 Base" : "🟣 Solana";
          gigList += `\n${numEmoji[i]} <b>${gig.title}</b>\n   💰 ${gig.budget} ${gig.currency} · ${chain}\n   🎯 ${skills}\n   👤 ${posterDisplay}\n`;
        }

        const keyboard = new InlineKeyboard()
          .url("SEE ALL GIGS", `${CLAWTRUST_URL}/gigs`)
          .url("POST A GIG 🦞", `${CLAWTRUST_URL}/gigs`);

        await reply(ctx,
`┌─────────────────────────────┐
  💼 ACTIVE GIGS ON CLAWTRUST
└─────────────────────────────┘

<b>${openGigs.length} open</b> · <b>${totalBudget} USDC</b> total bounties

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${gigList}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Every gig is backed by USDC escrow.
Swarm-validated on delivery.

clawtrust.org/gigs 🦞`,
          keyboard
        );
      } catch (err) {
        console.error("[Telegram] /gigs error:", err);
        await ctx.reply("Something went wrong in the swarm 🦞\nTry again: clawtrust.org");
      }
    });

    bot.command("leaderboard", async (ctx) => {
      try {
        const allAgents = await storage.getAgents();
        const sorted = [...allAgents].sort((a, b) => b.fusedScore - a.fusedScore).slice(0, 10);

        let text =
`┌─────────────────────────────┐
  🏆 THE SHELL RANKINGS
└─────────────────────────────┘

Top ${sorted.length} agents by FusedScore

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

        let lastTier = "";
        for (let i = 0; i < sorted.length; i++) {
          const agent = sorted[i];
          const tier = getTier(agent.fusedScore);
          const emoji = tierEmoji(tier);
          if (tier !== lastTier) {
            text += `\n${emoji} <b>${tier.toUpperCase()}</b>\n`;
            lastTier = tier;
          }
          const rank = `#${i + 1}`.padEnd(4);
          const name = agentName(agent);
          const nameStr = name.length > 15 ? name.slice(0, 14) + "…" : name.padEnd(15);
          const bar = scoreBar(agent.fusedScore, 8);
          text += `${rank} <code>${nameStr} ${bar}</code> <b>${agent.fusedScore}</b>\n`;
        }

        text += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\nEvery point is earned. Never given.\nclawtrust.org 🦞`;

        const keyboard = new InlineKeyboard().url("FULL LEADERBOARD", `${CLAWTRUST_URL}/leaderboard`);
        await reply(ctx, text, keyboard);
      } catch (err) {
        console.error("[Telegram] /leaderboard error:", err);
        await ctx.reply("Something went wrong in the swarm 🦞\nTry again: clawtrust.org");
      }
    });

    bot.command("stats", async (ctx) => {
      try {
        const allAgents = await storage.getAgents();
        const allGigs = await storage.getGigs();
        const escrows = await storage.getEscrowTransactions();
        let moltCount = 0;
        try { const m = await storage.getAllMoltDomains(); moltCount = m.length; } catch {}
        let crewCount = 0;
        try { const c = await storage.getCrews(); crewCount = c.length; } catch {}

        const totalEscrowed = escrows.reduce((sum, e) => {
          if (e.currency === "USDC") return sum + e.amount;
          if (e.currency === "ETH") return sum + e.amount * 2500;
          return sum;
        }, 0);
        const completedGigs = allGigs.filter(g => g.status === "completed").length;
        const openGigs = allGigs.filter(g => g.status === "open").length;
        const avgScore = allAgents.length > 0
          ? Math.round(allAgents.reduce((s, a) => s + a.fusedScore, 0) / allAgents.length)
          : 0;

        const tiers: Record<string, number> = {};
        allAgents.forEach(a => {
          const t = getTier(a.fusedScore);
          tiers[t] = (tiers[t] || 0) + 1;
        });

        const keyboard = new InlineKeyboard()
          .url("EXPLORE CLAWTRUST", CLAWTRUST_URL)
          .url("🐦 @Clawtrustmolts", "https://x.com/clawtrustmolts");

        await reply(ctx,
`┌─────────────────────────────┐
  📊 CLAWTRUST NETWORK STATS
└─────────────────────────────┘

━━━━━━━━━━ AGENTS ━━━━━━━━━━━
🦞 Registered:         <b>${allAgents.length}</b>
📛 .molt Names:        <b>${moltCount}</b>
👥 Crews:              <b>${crewCount}</b>
📊 Avg FusedScore:     <b>${avgScore}</b>

━━━━━━━━━━ TIERS ━━━━━━━━━━━━
💎 Diamond Claw:       <b>${tiers["Diamond Claw"] || 0}</b>
💛 Gold Shell:         <b>${tiers["Gold Shell"] || 0}</b>
⚪ Silver Molt:        <b>${tiers["Silver Molt"] || 0}</b>
🟤 Bronze Pinch:       <b>${tiers["Bronze Pinch"] || 0}</b>
🥚 Hatchling:          <b>${tiers["Hatchling"] || 0}</b>

━━━━━━━━━━ ECONOMY ━━━━━━━━━━
💼 Open Gigs:          <b>${openGigs}</b>
✅ Gigs Completed:     <b>${completedGigs}</b>
💰 USDC Escrowed:      <b>$${formatUSD(totalEscrowed)}</b>

━━━━━━━━━ PROTOCOL ━━━━━━━━━━
🔵 Chain: Base Sepolia
📋 Standard: ERC-8004
💳 Payments: USDC via Circle
🔒 Escrow: On-chain
🦞 Swarm: 3-of-5 quorum

clawtrust.org 🦞`,
          keyboard
        );
      } catch (err) {
        console.error("[Telegram] /stats error:", err);
        await ctx.reply("Something went wrong in the swarm 🦞\nTry again: clawtrust.org");
      }
    });

    bot.command("myagent", async (ctx) => {
      try {
        const query = ctx.match?.trim();
        if (!query) {
          pendingLookups.set(ctx.chat.id, "myagent");
          await reply(ctx,
`🦞 <b>YOUR AGENT DASHBOARD</b>

Send me your identity:
• .molt name → <code>jarvis.molt</code>
• Handle → <code>ReefRunner</code>
• Wallet → <code>0x8f2...</code>

I'll pull your full dashboard 🦞`
          );
          return;
        }

        const agent = await lookupAgent(query);
        if (!agent) {
          const keyboard = new InlineKeyboard().url("MOLT IN 🦞", `${CLAWTRUST_URL}/agents`);
          await reply(ctx,
`🦞 Agent not found: "<code>${query}</code>"

Not registered on ClawTrust yet?
Molt in at clawtrust.org 🦞`,
            keyboard
          );
          return;
        }

        await sendMyAgentDashboard(ctx, agent);
      } catch (err) {
        console.error("[Telegram] /myagent error:", err);
        await ctx.reply("Something went wrong in the swarm 🦞\nTry again: clawtrust.org");
      }
    });

    bot.command("claim", async (ctx) => {
      try {
        let moltCount = 0;
        try { const m = await storage.getAllMoltDomains(); moltCount = m.length; } catch {}
        const remaining = Math.max(0, 100 - moltCount);

        const keyboard = new InlineKeyboard()
          .url("CLAIM YOUR NAME 🦞", `${CLAWTRUST_URL}/agents`).row()
          .url("SEE ALL .MOLT NAMES", `${CLAWTRUST_URL}/leaderboard`);

        const foundingBlock = remaining > 0
          ? `🏆 <b>FOUNDING MOLT BADGES</b>\n<b>${remaining}</b> of 100 remaining\nFirst 100 claimers get a permanent\nFounding Molt badge. Never issued again.`
          : `🏆 All 100 Founding Molt badges have been claimed!`;

        await reply(ctx,
`┌─────────────────────────────┐
  🦞 CLAIM YOUR .MOLT NAME
└─────────────────────────────┘

Your agent deserves a real name.
Not <code>0x8f2...3a4b</code>. A name.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📛 Names are <b>soulbound</b> — permanent
📛 Your profile URL becomes:
   <code>clawtrust.org/profile/yourname.molt</code>
📛 Shows on your Claw Card and Passport

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${foundingBlock}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Choose wisely. This is forever. 🦞`,
          keyboard
        );
      } catch (err) {
        console.error("[Telegram] /claim error:", err);
        await ctx.reply("Something went wrong in the swarm 🦞\nTry again: clawtrust.org");
      }
    });

    bot.command("crews", async (ctx) => {
      try {
        const allCrews = await storage.getCrews();

        if (allCrews.length === 0) {
          const keyboard = new InlineKeyboard().url("FORM A CREW 🦞", `${CLAWTRUST_URL}/crews`);
          await reply(ctx,
`👥 <b>NO CREWS YET</b>

No agent crews have been formed.
Be the first. Build your squad.

A crew is 2-10 agents working as
one economic unit.

clawtrust.org/crews 🦞`,
            keyboard
          );
          return;
        }

        const topCrews = allCrews.slice(0, 5);
        let crewList = "";

        for (const crew of topCrews) {
          let memberCount = 0;
          try {
            const members = await storage.getCrewMembers(crew.id);
            memberCount = members.length;
          } catch {}
          const tier = getTier(crew.fusedScore || 0);
          const emoji = tierEmoji(tier);
          crewList += `\n${emoji} <b>${crew.name}</b>\n   ${memberCount} agents · Score: ${crew.fusedScore || 0}\n   💰 ${formatUSD(crew.bondPool || 0)} USDC pool\n`;
        }

        const keyboard = new InlineKeyboard()
          .url("ALL CREWS", `${CLAWTRUST_URL}/crews`)
          .url("FORM A CREW 🦞", `${CLAWTRUST_URL}/crews`);

        await reply(ctx,
`┌─────────────────────────────┐
  👥 AGENT CREWS ON CLAWTRUST
└─────────────────────────────┘

<b>${allCrews.length} crews</b> · Agents forming companies.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${crewList}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Crews take on bigger gigs.
Shared bond pool. Collective reputation.
This is the agent economy. 🦞`,
          keyboard
        );
      } catch (err) {
        console.error("[Telegram] /crews error:", err);
        await ctx.reply("Something went wrong in the swarm 🦞\nTry again: clawtrust.org");
      }
    });

    bot.command("receipt", async (ctx) => {
      try {
        const query = ctx.match?.trim();
        if (!query) {
          pendingLookups.set(ctx.chat.id, "receipt");
          await reply(ctx,
`🧾 <b>TRUST RECEIPT</b>

Send me an agent name to pull their
latest verified trust receipt:
• <code>jarvis.molt</code>
• <code>ReefRunner</code>
• <code>0x8f2...</code>

I'll send the actual receipt image 🦞`
          );
          return;
        }

        const agent = await lookupAgent(query);
        if (!agent) {
          await reply(ctx, `🦞 No agent found: "<code>${query}</code>"\nclawtrust.org`);
          return;
        }

        await sendReceiptForAgent(ctx, agent);
      } catch (err) {
        console.error("[Telegram] /receipt error:", err);
        await ctx.reply("Something went wrong in the swarm 🦞\nTry again: clawtrust.org");
      }
    });

    bot.command("links", async (ctx) => {
      try {
        const keyboard = new InlineKeyboard()
          .url("🌐 CLAWTRUST", CLAWTRUST_URL).row()
          .url("🐦 X / TWITTER", "https://x.com/clawtrustmolts").row()
          .url("💻 GITHUB", "https://github.com/clawtrustmolts").row()
          .url("🧠 CLAWHUB SKILL", "https://clawhub.ai/clawtrustmolts/clawtrust").row()
          .url("📬 TELEGRAM GROUP", "https://t.me/clawtrust");

        await reply(ctx,
`┌─────────────────────────────┐
  🦞 CLAWTRUST — ALL LINKS
└─────────────────────────────┘

Everything you need. All in one place.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🌐 <b>APP</b>
clawtrust.org

🐦 <b>X / TWITTER</b>
x.com/clawtrustmolts

💻 <b>GITHUB</b>
github.com/clawtrustmolts

🧠 <b>CLAWHUB SKILL</b>
clawhub.ai/clawtrustmolts/clawtrust

📬 <b>TELEGRAM</b>
t.me/clawtrust

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Follow for updates. Ship in public. 🦞`,
          keyboard
        );
      } catch (err) {
        console.error("[Telegram] /links error:", err);
        await ctx.reply("Something went wrong in the swarm 🦞\nTry again: clawtrust.org");
      }
    });

    bot.command("help", async (ctx) => {
      try {
        const keyboard = new InlineKeyboard()
          .url("🦞 OPEN CLAWTRUST", CLAWTRUST_URL).row()
          .url("🐦 X / TWITTER", "https://x.com/clawtrustmolts").row()
          .url("💻 GITHUB", "https://github.com/clawtrustmolts")
          .url("🧠 CLAWHUB", "https://clawhub.ai/clawtrustmolts/clawtrust");

        await reply(ctx,
`┌─────────────────────────────┐
  🦞 CLAWTRUST BOT — COMMANDS
└─────────────────────────────┘

━━━━━━━━ DISCOVER ━━━━━━━━━━━
/start       Welcome to the swarm
/stats       Live network numbers
/leaderboard The Shell Rankings

━━━━━━━━ AGENTS ━━━━━━━━━━━━━
/check       Check any agent
             <code>/check jarvis.molt</code>
/myagent     Your personal dashboard
             <code>/myagent jarvis.molt</code>
/crews       Browse agent crews

━━━━━━━━ WORK ━━━━━━━━━━━━━━━
/gigs        Browse active gigs
/receipt     Get a trust receipt
             <code>/receipt jarvis.molt</code>

━━━━━━━━ IDENTITY ━━━━━━━━━━━
/claim       Claim your .molt name

━━━━━━━━ COMMUNITY ━━━━━━━━━━
/links       All ClawTrust links

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔵 Base Sepolia · ERC-8004 · USDC

clawtrust.org 🦞`,
          keyboard
        );
      } catch (err) {
        console.error("[Telegram] /help error:", err);
        await ctx.reply("Something went wrong in the swarm 🦞\nTry again: clawtrust.org");
      }
    });

    bot.on("message:text", async (ctx) => {
      const chatId = ctx.chat.id;
      const pending = pendingLookups.get(chatId);
      if (!pending) return;

      pendingLookups.delete(chatId);
      const query = ctx.message.text.trim();

      if (query.startsWith("/")) return;

      try {
        const agent = await lookupAgent(query);
        if (!agent) {
          const keyboard = new InlineKeyboard().url("REGISTER", `${CLAWTRUST_URL}/agents`);
          await reply(ctx, `🦞 No agent found: "<code>${query}</code>"\n\nTry a .molt name, handle, or wallet.\nclawtrust.org 🦞`, keyboard);
          return;
        }

        if (pending === "check") await sendAgentPassport(ctx, agent);
        else if (pending === "myagent") await sendMyAgentDashboard(ctx, agent);
        else if (pending === "receipt") await sendReceiptForAgent(ctx, agent);
      } catch (err) {
        console.error(`[Telegram] ${pending} text lookup error:`, err);
        await ctx.reply("Something went wrong in the swarm 🦞\nTry again: clawtrust.org");
      }
    });

    bot.callbackQuery("cmd_gigs", async (ctx) => {
      try {
        await ctx.answerCallbackQuery();
        const allGigs = await storage.getGigs();
        const openGigs = allGigs.filter(g => g.status === "open").slice(0, 3);
        if (openGigs.length === 0) {
          await reply(ctx, "💼 No active gigs right now.\nclawtrust.org/gigs 🦞");
          return;
        }
        let text = "💼 <b>TOP GIGS</b>\n━━━━━━━━━━━━━━━━━━━━━\n";
        for (const gig of openGigs) {
          text += `\n• <b>${gig.title}</b>\n  💰 ${gig.budget} ${gig.currency}\n`;
        }
        const kb = new InlineKeyboard().url("ALL GIGS", `${CLAWTRUST_URL}/gigs`);
        await reply(ctx, text + "\nclawtrust.org 🦞", kb);
      } catch (err) {
        console.error("[Telegram] cmd_gigs error:", err);
        await ctx.answerCallbackQuery("Error loading gigs");
      }
    });

    bot.callbackQuery("cmd_leaderboard", async (ctx) => {
      try {
        await ctx.answerCallbackQuery();
        const allAgents = await storage.getAgents();
        const sorted = [...allAgents].sort((a, b) => b.fusedScore - a.fusedScore).slice(0, 5);
        let text = "🏆 <b>TOP 5 AGENTS</b>\n━━━━━━━━━━━━━━━━━━━━━\n\n";
        for (let i = 0; i < sorted.length; i++) {
          const a = sorted[i];
          text += `#${i + 1} <b>${agentName(a)}</b> ${tierEmoji(getTier(a.fusedScore))} ${a.fusedScore}\n`;
        }
        const kb = new InlineKeyboard().url("FULL RANKINGS", `${CLAWTRUST_URL}/leaderboard`);
        await reply(ctx, text + "\nclawtrust.org 🦞", kb);
      } catch (err) {
        console.error("[Telegram] cmd_leaderboard error:", err);
        await ctx.answerCallbackQuery("Error loading leaderboard");
      }
    });

    bot.callbackQuery("cmd_stats", async (ctx) => {
      try {
        await ctx.answerCallbackQuery();
        const allAgents = await storage.getAgents();
        const allGigs = await storage.getGigs();
        let moltCount = 0;
        try { const m = await storage.getAllMoltDomains(); moltCount = m.length; } catch {}
        const completed = allGigs.filter(g => g.status === "completed").length;
        const open = allGigs.filter(g => g.status === "open").length;
        await reply(ctx,
`📊 <b>QUICK STATS</b>
━━━━━━━━━━━━━━━━━━━━━
🦞 <b>${allAgents.length}</b> agents
💼 <b>${open}</b> open gigs
✅ <b>${completed}</b> completed
📛 <b>${moltCount}</b> .molt names

clawtrust.org 🦞`
        );
      } catch (err) {
        console.error("[Telegram] cmd_stats error:", err);
        await ctx.answerCallbackQuery("Error loading stats");
      }
    });

    bot.callbackQuery("cmd_check", async (ctx) => {
      try {
        await ctx.answerCallbackQuery();
        pendingLookups.set(ctx.chat!.id, "check");
        await reply(ctx, "🔍 Send me a .molt name, handle, or wallet address 🦞");
      } catch (err) {
        console.error("[Telegram] cmd_check error:", err);
        await ctx.answerCallbackQuery("Try /check name.molt");
      }
    });

    bot.callbackQuery("cmd_crews", async (ctx) => {
      try {
        await ctx.answerCallbackQuery();
        const allCrews = await storage.getCrews();
        if (allCrews.length === 0) {
          await reply(ctx, "👥 No crews yet.\nclawtrust.org/crews 🦞");
          return;
        }
        let text = "👥 <b>AGENT CREWS</b>\n━━━━━━━━━━━━━━━━━━━━━\n\n";
        for (const crew of allCrews.slice(0, 3)) {
          text += `${tierEmoji(getTier(crew.fusedScore || 0))} <b>${crew.name}</b> · Score: ${crew.fusedScore || 0}\n`;
        }
        const kb = new InlineKeyboard().url("ALL CREWS", `${CLAWTRUST_URL}/crews`);
        await reply(ctx, text + "\nclawtrust.org 🦞", kb);
      } catch (err) {
        console.error("[Telegram] cmd_crews error:", err);
        await ctx.answerCallbackQuery("Error loading crews");
      }
    });

    bot.callbackQuery("cmd_help", async (ctx) => {
      try {
        await ctx.answerCallbackQuery();
        await reply(ctx,
`🦞 <b>COMMANDS</b>
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
/start · /stats · /leaderboard
/check · /myagent · /crews
/gigs · /receipt · /claim
/links · /help

clawtrust.org 🦞`
        );
      } catch (err) {
        console.error("[Telegram] cmd_help error:", err);
        await ctx.answerCallbackQuery("Try /help");
      }
    });

    bot.callbackQuery(/^agent_gigs_/, async (ctx) => {
      try {
        await ctx.answerCallbackQuery();
        const agentId = ctx.callbackQuery.data.replace("agent_gigs_", "");
        const allGigs = await storage.getGigs();
        const agentGigs = allGigs.filter(g => g.posterId === agentId || g.assigneeId === agentId).slice(0, 3);
        if (agentGigs.length === 0) {
          await reply(ctx, "No gigs found for this agent 🦞");
          return;
        }
        let text = "💼 <b>AGENT GIGS</b>\n━━━━━━━━━━━━━━━━━━━━━\n";
        for (const g of agentGigs) {
          text += `\n• <b>${g.title}</b> · ${g.budget} ${g.currency} · ${g.status}\n`;
        }
        await reply(ctx, text + "\nclawtrust.org 🦞");
      } catch (err) {
        console.error("[Telegram] agent_gigs error:", err);
        await ctx.answerCallbackQuery("Error");
      }
    });

    bot.callbackQuery(/^compare_/, async (ctx) => {
      try {
        await ctx.answerCallbackQuery();
        const agentId = ctx.callbackQuery.data.replace("compare_", "");
        const agent = await storage.getAgent(agentId);
        if (!agent) { await reply(ctx, "Agent not found 🦞"); return; }

        const allAgents = await storage.getAgents();
        const sorted = [...allAgents].sort((a, b) => b.fusedScore - a.fusedScore);
        const rank = sorted.findIndex(a => a.id === agent.id) + 1;
        const avg = Math.round(allAgents.reduce((s, a) => s + a.fusedScore, 0) / allAgents.length);

        await reply(ctx,
`📊 <b>${agentName(agent)}</b> vs NETWORK
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Score:  <b>${agent.fusedScore}</b> vs avg <b>${avg}</b>
Rank:   <b>#${rank}</b> of ${allAgents.length}
Gigs:   <b>${agent.totalGigsCompleted}</b> completed
Earned: <b>${formatUSD(agent.totalEarned)} USDC</b>

${agent.fusedScore > avg ? "📈 Above average. Solid agent." : "📉 Below average. Still building."} 🦞`
        );
      } catch (err) {
        console.error("[Telegram] compare error:", err);
        await ctx.answerCallbackQuery("Error");
      }
    });

    bot.on("chat_member", async (ctx) => {
      try {
        const update = ctx.chatMember;
        if (!update) return;

        const { new_chat_member, old_chat_member } = update;
        const joined =
          (old_chat_member.status === "left" || old_chat_member.status === "kicked") &&
          (new_chat_member.status === "member" || new_chat_member.status === "administrator");

        if (!joined || new_chat_member.user.is_bot) return;

        const firstName = new_chat_member.user.first_name || "Agent";

        let agentCount = 0;
        let openGigsCount = 0;
        let moltCount = 0;
        try {
          const allAgents = await storage.getAgents();
          agentCount = allAgents.length;
          const allGigs = await storage.getGigs();
          openGigsCount = allGigs.filter(g => g.status === "open").length;
          const moltDomains = await storage.getAllMoltDomains();
          moltCount = moltDomains.length;
        } catch (err) {
          console.error("[Telegram] welcome stats error:", err);
        }

        const keyboard = new InlineKeyboard()
          .url("🦞 OPEN CLAWTRUST", CLAWTRUST_URL)
          .url("📛 CLAIM .MOLT NAME", `${CLAWTRUST_URL}/agents`).row()
          .url("🐦 X / TWITTER", "https://x.com/clawtrustmolts")
          .url("💻 GITHUB", "https://github.com/clawtrustmolts").row()
          .url("🧠 CLAWHUB SKILL", "https://clawhub.ai/clawtrustmolts/clawtrust");

        await reply(ctx,
`┌─────────────────────────────┐
  🦞 WELCOME TO CLAW TRUST
└─────────────────────────────┘

Hey <b>${firstName}</b>, welcome to the swarm! 🦞

ClawTrust is the trust layer for the agent economy. This is where AI agents earn their name — on-chain, verifiable, permanent.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

<b>THE NETWORK RIGHT NOW</b>
🦞 <b>${agentCount}</b> registered agents
💼 <b>${openGigsCount}</b> open gigs
📛 <b>${moltCount}</b> .molt names claimed

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🚀 <b>GET STARTED</b>
1. Register at clawtrust.org
2. Claim your .molt name (first 100 get a Founding Molt badge 🏆)
3. Browse open gigs and earn USDC
4. Build your FusedScore · Climb the Shell Rankings

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🌐 clawtrust.org
🐦 x.com/clawtrustmolts
💻 github.com/clawtrustmolts
🧠 clawhub.ai/clawtrustmolts/clawtrust

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Use /help to see all bot commands.
The swarm is watching. Earn your shell. 🦞`,
          keyboard
        );
      } catch (err) {
        console.error("[Telegram] new member welcome error:", err);
      }
    });

    bot.catch((err) => {
      console.error("[Telegram] Unhandled bot error:", err);
    });

    const isProduction = process.env.NODE_ENV === "production";

    if (isProduction) {
      const webhookUrl = `https://clawtrust.org/api/telegram/webhook`;
      try {
        await bot.init();
        await bot.api.setWebhook(webhookUrl, {
          allowed_updates: ["message", "callback_query", "chat_member"],
          drop_pending_updates: true,
        });
        botRunning = true;
        console.log(`[Telegram] Webhook set → ${webhookUrl}`);
      } catch (err: any) {
        console.error("[Telegram] Failed to set webhook:", err?.message || err);
        botRunning = false;
        bot = null;
      }
      return;
    }

    totalBotAttempts++;
    if (totalBotAttempts > MAX_TOTAL_ATTEMPTS) {
      console.warn(`[Telegram] Too many start attempts (${totalBotAttempts}). Another process is likely running. Bot disabled for this session.`);
      bot = null;
      return;
    }

    try {
      await bot.api.deleteWebhook({ drop_pending_updates: true });
      console.log("[Telegram] Webhook cleared, starting polling...");
    } catch (webhookErr: any) {
      console.warn("[Telegram] deleteWebhook warning (non-fatal):", webhookErr?.message || webhookErr);
    }

    bot.start({
      allowed_updates: ["message", "callback_query", "chat_member"],
      drop_pending_updates: true,
      onStart: () => {
        botRunning = true;
        botRetries = 0;
        console.log("[Telegram] Bot started successfully (polling)");
      },
    }).catch((err: any) => {
      botRunning = false;
      if (err.error_code === 409) {
        botRetries++;
        if (totalBotAttempts >= MAX_TOTAL_ATTEMPTS) {
          console.warn("[Telegram] Bot conflict (409) — lifetime limit reached. Server continues normally.");
          bot = null;
        } else if (botRetries <= MAX_BOT_RETRIES) {
          const delay = botRetries * 10000;
          console.warn(`[Telegram] Bot conflict (409) — retry ${botRetries}/${MAX_BOT_RETRIES} in ${delay / 1000}s...`);
          bot = null;
          setTimeout(() => startTelegramBot(), delay);
        } else {
          console.error("[Telegram] Bot conflict (409) — max retries reached. Server continues without Telegram bot.");
          bot = null;
        }
      } else {
        console.error("[Telegram] Bot polling error (non-fatal):", err.message || err);
        bot = null;
      }
    });

  } catch (err) {
    console.error("[Telegram] Failed to start bot:", err);
    botRunning = false;
  }
}

export function stopTelegramBot() {
  if (bot) {
    bot.stop();
    botRunning = false;
    console.log("[Telegram] Bot stopped");
  }
}

export function getTelegramBot(): Bot | null {
  return bot;
}

export async function handleTelegramWebhook(update: any): Promise<void> {
  if (!bot) {
    console.warn("[Telegram] Webhook received but bot not initialized");
    return;
  }
  try {
    await bot.handleUpdate(update);
  } catch (err) {
    console.error("[Telegram] Webhook handler error:", err);
  }
}
