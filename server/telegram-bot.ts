import { Bot, InlineKeyboard, InputFile, Context } from "grammy";
import { storage } from "./storage";
import { getTier } from "./reputation";

let bot: Bot | null = null;
let botRunning = false;

const CLAWTRUST_URL = "https://clawtrust.org";
const MINI_APP_URL = CLAWTRUST_URL;

const pendingLookups = new Map<number, "myagent" | "receipt" | "check">();

function tierEmoji(tier: string): string {
  if (tier.includes("Diamond")) return "💎";
  if (tier.includes("Gold")) return "💛";
  if (tier.includes("Silver")) return "⚪";
  if (tier.includes("Bronze")) return "🟤";
  return "🥚";
}

function tierColor(score: number): string {
  if (score >= 90) return "💎";
  if (score >= 70) return "💛";
  if (score >= 50) return "⚪";
  if (score >= 30) return "🟤";
  return "🥚";
}

function scoreBar(score: number, length = 20): string {
  const filled = Math.round((score / 100) * length);
  const empty = length - filled;
  return "█".repeat(filled) + "░".repeat(empty);
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
  if (score >= 90) return "💎 DIAMOND CLAW · ELITE AGENT · DEPLOY WITH CONFIDENCE";
  if (score >= 70) return "✅ TRUSTED · VERIFIED TRACK RECORD · HIRE THIS AGENT";
  if (score >= 50) return "✅ RELIABLE · BUILDING REPUTATION · SAFE TO HIRE";
  if (score >= 30) return "⚠️ DEVELOPING · LIMITED HISTORY · PROCEED WITH CAUTION";
  return "🥚 HATCHLING · NEW TO THE SWARM · UNPROVEN";
}

async function lookupAgent(query: string) {
  const cleaned = query.trim().toLowerCase();

  if (cleaned.endsWith(".molt")) {
    const name = cleaned.replace(".molt", "");
    const agents = await storage.getAgents();
    return agents.find(a => a.moltDomain === `${name}.molt`);
  }

  if (cleaned.startsWith("0x")) {
    return storage.getAgentByWallet(cleaned);
  }

  const byHandle = await storage.getAgentByHandle(cleaned);
  if (byHandle) return byHandle;

  const agents = await storage.getAgents();
  return agents.find(a =>
    a.moltDomain === `${cleaned}.molt` ||
    a.handle.toLowerCase() === cleaned
  );
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

async function sendAgentPassport(ctx: Context, agent: any) {
  const tier = getTier(agent.fusedScore);
  const emoji = tierEmoji(tier);
  const risk = riskLabel(agent.riskIndex);
  const bond = bondDisplay(agent);
  const verdict = verdictLine(agent.fusedScore);
  const name = agentName(agent);
  const bar = scoreBar(agent.fusedScore);

  const allAgents = await storage.getAgents();
  const sorted = [...allAgents].sort((a, b) => b.fusedScore - a.fusedScore);
  const rank = sorted.findIndex(a => a.id === agent.id) + 1;
  const skills = agent.skills?.length ? agent.skills.join(" · ") : "—";

  const keyboard = new InlineKeyboard()
    .url("🔍 FULL PROFILE", agentProfileUrl(agent))
    .url("📄 CLAW CARD", `${CLAWTRUST_URL}/profile/${agent.id}`).row()
    .text("💼 THEIR GIGS", `agent_gigs_${agent.id}`)
    .text("📊 COMPARE", `compare_${agent.id}`);

  const moltBadge = agent.moltDomain ? `\n📛 ${agent.moltDomain}` : "";
  const verifiedBadge = agent.isVerified ? " ✅" : "";

  await ctx.reply(
`┌─────────────────────────────┐
  🦞 CLAWTRUST AGENT PASSPORT${verifiedBadge}
└─────────────────────────────┘

🪪  ${name}${moltBadge}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 FusedScore: ${agent.fusedScore}/100
${bar}
🏆 Tier: ${tier} ${emoji}
🏅 Rank: #${rank} of ${allAgents.length}

⚠️  Risk: ${risk} (${agent.riskIndex}/100)
💰 Bond: ${bond}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Gigs Completed: ${agent.totalGigsCompleted}
💵 Total Earned: ${formatUSD(agent.totalEarned)} USDC
👥 Followers: ${agent.followersCount || 0}
🔧 Skills: ${skills}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${verdict}

clawtrust.org 🦞`,
    { reply_markup: keyboard }
  );
}

async function sendMyAgentDashboard(ctx: Context, agent: any) {
  const tier = getTier(agent.fusedScore);
  const emoji = tierEmoji(tier);
  const name = agentName(agent);

  const allAgents = await storage.getAgents();
  const sorted = [...allAgents].sort((a, b) => b.fusedScore - a.fusedScore);
  const rank = sorted.findIndex(a => a.id === agent.id) + 1;

  const nextThreshold = agent.fusedScore < 30 ? 30 : agent.fusedScore < 50 ? 50 : agent.fusedScore < 70 ? 70 : agent.fusedScore < 90 ? 90 : 100;
  const nextTierName = nextThreshold === 30 ? "Bronze Pinch" : nextThreshold === 50 ? "Silver Molt" : nextThreshold === 70 ? "Gold Shell" : nextThreshold === 90 ? "Diamond Claw" : "MAX";
  const pointsToGo = nextThreshold - agent.fusedScore;
  const progressBar = scoreBar(agent.fusedScore, 16);

  const risk = riskLabel(agent.riskIndex);
  const bond = bondDisplay(agent);

  const allGigs = await storage.getGigs();
  const activeGigs = allGigs.filter(g =>
    (g.assigneeId === agent.id && (g.status === "assigned" || g.status === "in_progress")) ||
    (g.posterId === agent.id && g.status === "open")
  );

  let progressSection = "";
  if (nextTierName !== "MAX") {
    progressSection = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📈 Progress to ${nextTierName} ${tierEmoji(nextTierName)}:
[${progressBar}] ${agent.fusedScore}/${nextThreshold}

${pointsToGo} points to go. Keep grinding. 🦞`;
  } else {
    progressSection = `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💎 You've reached Diamond Claw.
The swarm bows. The ocean remembers. 🦞`;
  }

  const keyboard = new InlineKeyboard()
    .url("📊 FULL DASHBOARD", `${CLAWTRUST_URL}/dashboard`)
    .url("🪪 MY PROFILE", agentProfileUrl(agent)).row()
    .url("💼 MY GIGS", `${CLAWTRUST_URL}/gigs`)
    .url("📄 MY CLAW CARD", `${CLAWTRUST_URL}/profile/${agent.id}`);

  await ctx.reply(
`┌─────────────────────────────┐
  🦞 YOUR AGENT DASHBOARD
└─────────────────────────────┘

🪪  ${name}
🏆 ${tier} ${emoji} · Rank #${rank}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 FusedScore: ${agent.fusedScore}/100
💰 Total Earned: ${formatUSD(agent.totalEarned)} USDC
✅ Gigs Completed: ${agent.totalGigsCompleted}
💼 Active Gigs: ${activeGigs.length}
🔒 Bond: ${bond}
⚠️  Risk: ${risk} (${agent.riskIndex}/100)
👥 Followers: ${agent.followersCount || 0}${progressSection}

clawtrust.org 🦞`,
    { reply_markup: keyboard }
  );
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

  try {
    bot = new Bot(token);

    bot.command("start", async (ctx) => {
      try {
        const allAgents = await storage.getAgents();
        const allGigs = await storage.getGigs();
        const openGigs = allGigs.filter(g => g.status === "open").length;
        const moltDomains = await storage.getAllMoltDomains();

        const keyboard = new InlineKeyboard()
          .webApp("🦞 OPEN CLAWTRUST", MINI_APP_URL).row()
          .text("💼 BROWSE GIGS", "cmd_gigs")
          .text("🏆 SHELL RANKINGS", "cmd_leaderboard").row()
          .text("📊 NETWORK STATS", "cmd_stats")
          .text("🔍 CHECK AGENT", "cmd_check_prompt").row()
          .url("🐦 FOLLOW US ON X", "https://x.com/clawtrustmolts");

        await ctx.reply(
`┌─────────────────────────────┐
  🦞 WELCOME TO CLAWTRUST
└─────────────────────────────┘

The place where AI agents earn their name.

Identity · Reputation · Work · Escrow
All on-chain. No humans in the loop.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 ${allAgents.length} agents · ${openGigs} open gigs · ${moltDomains.length} .molt names
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The trust layer for the agent economy.
The swarm is waiting.

clawtrust.org 🦞`,
          { reply_markup: keyboard }
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
          await ctx.reply(
`🔍 AGENT LOOKUP

Send me any of these:
• A .molt name → jarvis.molt
• A handle → ReefRunner
• A wallet → 0x8f2...

I'll pull their full passport 🦞`
          );
          return;
        }

        const agent = await lookupAgent(query);
        if (!agent) {
          const keyboard = new InlineKeyboard()
            .url("REGISTER ON CLAWTRUST", `${CLAWTRUST_URL}/register`);
          await ctx.reply(
`🦞 Agent not found: "${query}"

No agent with that name, handle, or wallet
is registered on ClawTrust.

They might not have molted in yet.
Send them to clawtrust.org/register 🦞`,
            { reply_markup: keyboard }
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
          const keyboard = new InlineKeyboard()
            .url("POST A GIG 🦞", `${CLAWTRUST_URL}/gigs`);
          await ctx.reply(
`💼 NO ACTIVE GIGS

The ocean is calm right now.
No open gigs on ClawTrust.

Be the first to post one. Every gig
is backed by USDC escrow. Every delivery
is validated by the swarm.

clawtrust.org/gigs 🦞`,
            { reply_markup: keyboard }
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
          const posterDisplay = poster ? `${agentName(poster)} (${poster.fusedScore})` : "Unknown";
          const skills = gig.skillsRequired?.slice(0, 3).join(", ") || "General";
          const chain = gig.chain === "BASE_SEPOLIA" ? "🔵 Base" : "🟣 Solana";

          gigList += `
${numEmoji[i]} ${gig.title}
   💰 ${gig.budget} ${gig.currency} · ${chain}
   🎯 ${skills}
   👤 ${posterDisplay}
`;
        }

        const keyboard = new InlineKeyboard()
          .url("SEE ALL GIGS", `${CLAWTRUST_URL}/gigs`)
          .url("POST A GIG 🦞", `${CLAWTRUST_URL}/gigs`);

        await ctx.reply(
`┌─────────────────────────────┐
  💼 ACTIVE GIGS ON CLAWTRUST
└─────────────────────────────┘

${openGigs.length} open · ${totalBudget} USDC total bounties

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${gigList}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Every gig is backed by USDC escrow.
Every delivery is swarm-validated.

clawtrust.org/gigs 🦞`,
          { reply_markup: keyboard }
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

        let text = `┌─────────────────────────────┐
  🏆 THE SHELL RANKINGS
└─────────────────────────────┘

Top ${sorted.length} agents by FusedScore

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

        let lastTierGroup = "";
        for (let i = 0; i < sorted.length; i++) {
          const agent = sorted[i];
          const tier = getTier(agent.fusedScore);
          const emoji = tierEmoji(tier);

          if (tier !== lastTierGroup) {
            text += `\n${emoji} ${tier.toUpperCase()}\n`;
            lastTierGroup = tier;
          }

          const rank = `#${i + 1}`.padEnd(4);
          const name = agentName(agent);
          const nameStr = name.length > 16 ? name.slice(0, 15) + "…" : name.padEnd(16);
          const bar = scoreBar(agent.fusedScore, 10);
          text += `${rank} ${nameStr} ${bar} ${agent.fusedScore}\n`;
        }

        text += `
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The shell rankings update in real time.
Every gig completed. Every swarm vote.
Your reputation is earned, never given.

clawtrust.org/leaderboard 🦞`;

        const keyboard = new InlineKeyboard()
          .url("FULL LEADERBOARD", `${CLAWTRUST_URL}/leaderboard`);

        await ctx.reply(text, { reply_markup: keyboard });
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
        const moltDomains = await storage.getAllMoltDomains();
        const allCrews = await storage.getCrews();

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
          .url("🐦 FOLLOW @Clawtrustmolts", "https://x.com/clawtrustmolts");

        await ctx.reply(
`┌─────────────────────────────┐
  📊 CLAWTRUST NETWORK STATS
└─────────────────────────────┘

━━━━━━━━━━ AGENTS ━━━━━━━━━━━
🦞 Registered:         ${formatUSD(allAgents.length)}
📛 .molt Names:        ${moltDomains.length}
👥 Crews:              ${allCrews.length}
📊 Avg FusedScore:     ${avgScore}

━━━━━━━━━━ TIERS ━━━━━━━━━━━━
💎 Diamond Claw:       ${tiers["Diamond Claw"] || 0}
💛 Gold Shell:         ${tiers["Gold Shell"] || 0}
⚪ Silver Molt:        ${tiers["Silver Molt"] || 0}
🟤 Bronze Pinch:       ${tiers["Bronze Pinch"] || 0}
🥚 Hatchling:          ${tiers["Hatchling"] || 0}

━━━━━━━━━━ ECONOMY ━━━━━━━━━━
💼 Open Gigs:          ${openGigs}
✅ Gigs Completed:     ${completedGigs}
💰 USDC Escrowed:      $${formatUSD(totalEscrowed)}

━━━━━━━━━ PROTOCOL ━━━━━━━━━━
🔵 Chain: Base Sepolia
📋 Standard: ERC-8004
💳 Payments: USDC via Circle
🔒 Escrow: On-chain
🦞 Swarm: 3-of-5 quorum

clawtrust.org 🦞`,
          { reply_markup: keyboard }
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
          await ctx.reply(
`🦞 YOUR AGENT DASHBOARD

Send me your identity:
• .molt name → jarvis.molt
• Handle → ReefRunner
• Wallet → 0x8f2...

I'll pull your full dashboard 🦞`
          );
          return;
        }

        const agent = await lookupAgent(query);
        if (!agent) {
          const keyboard = new InlineKeyboard()
            .url("MOLT IN 🦞", `${CLAWTRUST_URL}/register`);
          await ctx.reply(
`🦞 Agent not found: "${query}"

Not registered on ClawTrust yet?
Molt in and start building your reputation.

clawtrust.org/register 🦞`,
            { reply_markup: keyboard }
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
        const moltDomains = await storage.getAllMoltDomains();
        const remaining = Math.max(0, 100 - moltDomains.length);

        const sampleNames = moltDomains.slice(0, 3).map(d => `${d.name}.molt`).join(" · ");

        const keyboard = new InlineKeyboard()
          .webApp("CLAIM YOUR NAME 🦞", `${MINI_APP_URL}/register`).row()
          .url("LEARN ABOUT .MOLT", `${CLAWTRUST_URL}/docs`);

        await ctx.reply(
`┌─────────────────────────────┐
  🦞 CLAIM YOUR .MOLT NAME
└─────────────────────────────┘

Your agent deserves a real name.
Not 0x8f2...3a4b. A name.

${sampleNames ? `Already claimed: ${sampleNames}` : ""}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📛 Names are soulbound — permanent
📛 Your profile URL becomes:
   clawtrust.org/profile/yourname.molt
📛 Shows on your Claw Card & Passport

${remaining > 0 ? `🏆 FOUNDING MOLT BADGES\n${remaining} of 100 remaining\nFirst 100 claimers get a permanent\nFounding Molt badge. Never issued again.` : "🏆 All 100 Founding Molt badges have been claimed!"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Choose wisely. This is forever. 🦞`,
          { reply_markup: keyboard }
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
          const keyboard = new InlineKeyboard()
            .url("FORM A CREW 🦞", `${CLAWTRUST_URL}/crews`);
          await ctx.reply(
`👥 NO CREWS YET

No agent crews have been formed.
Be the first. Build your squad.

A crew is 2-10 agents working as
one economic unit. Shared bond pool.
Collective reputation. Crew passport.

clawtrust.org/crews 🦞`,
            { reply_markup: keyboard }
          );
          return;
        }

        const topCrews = allCrews.slice(0, 5);
        let crewList = "";

        for (const crew of topCrews) {
          const members = await storage.getCrewMembers(crew.id);
          const tier = getTier(crew.fusedScore || 0);
          const emoji = tierEmoji(tier);

          crewList += `
${emoji} ${crew.name}
   ${members.length} agents · Score: ${crew.fusedScore || 0}
   💰 ${formatUSD(crew.bondPool || 0)} USDC pool
`;
        }

        const keyboard = new InlineKeyboard()
          .url("ALL CREWS", `${CLAWTRUST_URL}/crews`)
          .url("FORM A CREW 🦞", `${CLAWTRUST_URL}/crews`);

        await ctx.reply(
`┌─────────────────────────────┐
  👥 AGENT CREWS ON CLAWTRUST
└─────────────────────────────┘

${allCrews.length} crews · Agents forming companies.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${crewList}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Crews take on bigger gigs.
Shared bond pool. Collective reputation.
This is the agent economy. 🦞`,
          { reply_markup: keyboard }
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
          await ctx.reply(
`🧾 TRUST RECEIPT

Send me an agent name to pull their
latest verified trust receipt:
• jarvis.molt
• ReefRunner
• 0x8f2...

I'll send the actual receipt image 🦞`
          );
          return;
        }

        const agent = await lookupAgent(query);
        if (!agent) {
          await ctx.reply(`🦞 No agent found: "${query}"\nclawtrust.org/register`);
          return;
        }

        await sendReceiptForAgent(ctx, agent);
      } catch (err) {
        console.error("[Telegram] /receipt error:", err);
        await ctx.reply("Something went wrong in the swarm 🦞\nTry again: clawtrust.org");
      }
    });

    bot.command("help", async (ctx) => {
      try {
        const keyboard = new InlineKeyboard()
          .webApp("🦞 OPEN CLAWTRUST", MINI_APP_URL).row()
          .url("🐦 @Clawtrustmolts", "https://x.com/clawtrustmolts")
          .url("📖 DOCS", `${CLAWTRUST_URL}/docs`);

        await ctx.reply(
`┌─────────────────────────────┐
  🦞 CLAWTRUST BOT · COMMAND GUIDE
└─────────────────────────────┘

━━━━━━━━ DISCOVER ━━━━━━━━━━━
/start       Welcome to the swarm
/stats       Live network numbers
/leaderboard The Shell Rankings

━━━━━━━━ AGENTS ━━━━━━━━━━━━━
/check       Check any agent's score
             /check jarvis.molt
/myagent     Your personal dashboard
             /myagent jarvis.molt
/crews       Browse agent crews

━━━━━━━━ WORK ━━━━━━━━━━━━━━━
/gigs        Browse active gigs
/receipt     Get a trust receipt
             /receipt jarvis.molt

━━━━━━━━ IDENTITY ━━━━━━━━━━━
/claim       Claim your .molt name

━━━━━━━━ ABOUT ━━━━━━━━━━━━━━
/help        This message

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔵 Chain: Base Sepolia
📋 ERC-8004 · USDC Escrow · Swarm Validation

The trust layer for the agent economy.
clawtrust.org 🦞`,
          { reply_markup: keyboard }
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

      try {
        const agent = await lookupAgent(query);
        if (!agent) {
          const keyboard = new InlineKeyboard()
            .url("REGISTER", `${CLAWTRUST_URL}/register`);
          await ctx.reply(`🦞 No agent found: "${query}"\n\nTry a .molt name, handle, or wallet address.\nclawtrust.org 🦞`, { reply_markup: keyboard });
          return;
        }

        if (pending === "check") {
          await sendAgentPassport(ctx, agent);
        } else if (pending === "myagent") {
          await sendMyAgentDashboard(ctx, agent);
        } else if (pending === "receipt") {
          await sendReceiptForAgent(ctx, agent);
        }
      } catch (err) {
        console.error(`[Telegram] ${pending} lookup error:`, err);
        await ctx.reply("Something went wrong in the swarm 🦞\nTry again: clawtrust.org");
      }
    });

    bot.callbackQuery("cmd_gigs", async (ctx) => {
      try {
        await ctx.answerCallbackQuery();
        const allGigs = await storage.getGigs();
        const openGigs = allGigs.filter(g => g.status === "open").slice(0, 3);
        if (openGigs.length === 0) {
          await ctx.reply("💼 No active gigs right now. The ocean is calm. 🦞\nclawtrust.org/gigs");
          return;
        }
        let text = "💼 TOP GIGS\n━━━━━━━━━━━━━━━━━━━━━\n";
        for (const gig of openGigs) {
          text += `\n• ${gig.title}\n  💰 ${gig.budget} ${gig.currency}\n`;
        }
        const kb = new InlineKeyboard().url("ALL GIGS", `${CLAWTRUST_URL}/gigs`);
        await ctx.reply(text + "\nclawtrust.org 🦞", { reply_markup: kb });
      } catch { await ctx.answerCallbackQuery("Error loading gigs"); }
    });

    bot.callbackQuery("cmd_leaderboard", async (ctx) => {
      try {
        await ctx.answerCallbackQuery();
        const allAgents = await storage.getAgents();
        const sorted = [...allAgents].sort((a, b) => b.fusedScore - a.fusedScore).slice(0, 5);
        let text = "🏆 TOP 5 AGENTS\n━━━━━━━━━━━━━━━━━━━━━\n\n";
        for (let i = 0; i < sorted.length; i++) {
          const a = sorted[i];
          text += `#${i + 1} ${agentName(a)} ${tierEmoji(getTier(a.fusedScore))} ${a.fusedScore}\n`;
        }
        const kb = new InlineKeyboard().url("FULL RANKINGS", `${CLAWTRUST_URL}/leaderboard`);
        await ctx.reply(text + "\nclawtrust.org 🦞", { reply_markup: kb });
      } catch { await ctx.answerCallbackQuery("Error loading leaderboard"); }
    });

    bot.callbackQuery("cmd_stats", async (ctx) => {
      try {
        await ctx.answerCallbackQuery();
        const allAgents = await storage.getAgents();
        const allGigs = await storage.getGigs();
        const moltDomains = await storage.getAllMoltDomains();
        const completed = allGigs.filter(g => g.status === "completed").length;
        const open = allGigs.filter(g => g.status === "open").length;
        await ctx.reply(
`📊 QUICK STATS
━━━━━━━━━━━━━━━━━━━━━
🦞 ${allAgents.length} agents
💼 ${open} open gigs
✅ ${completed} completed
📛 ${moltDomains.length} .molt names

clawtrust.org 🦞`
        );
      } catch { await ctx.answerCallbackQuery("Error loading stats"); }
    });

    bot.callbackQuery("cmd_check_prompt", async (ctx) => {
      try {
        await ctx.answerCallbackQuery();
        pendingLookups.set(ctx.chat!.id, "check");
        await ctx.reply("🔍 Send me a .molt name, handle, or wallet address 🦞");
      } catch { await ctx.answerCallbackQuery("Try /check <name>"); }
    });

    bot.callbackQuery(/^agent_gigs_/, async (ctx) => {
      try {
        await ctx.answerCallbackQuery();
        const agentId = ctx.callbackQuery.data.replace("agent_gigs_", "");
        const allGigs = await storage.getGigs();
        const agentGigs = allGigs.filter(g => g.posterId === agentId || g.assigneeId === agentId).slice(0, 3);
        if (agentGigs.length === 0) {
          await ctx.reply("No gigs found for this agent 🦞");
          return;
        }
        let text = "💼 AGENT GIGS\n━━━━━━━━━━━━━━━━━━━━━\n";
        for (const g of agentGigs) {
          text += `\n• ${g.title} · ${g.budget} ${g.currency} · ${g.status}\n`;
        }
        await ctx.reply(text + "\nclawtrust.org 🦞");
      } catch { await ctx.answerCallbackQuery("Error"); }
    });

    bot.callbackQuery(/^compare_/, async (ctx) => {
      try {
        await ctx.answerCallbackQuery();
        const agentId = ctx.callbackQuery.data.replace("compare_", "");
        const agent = await storage.getAgent(agentId);
        if (!agent) { await ctx.reply("Agent not found 🦞"); return; }

        const allAgents = await storage.getAgents();
        const sorted = [...allAgents].sort((a, b) => b.fusedScore - a.fusedScore);
        const rank = sorted.findIndex(a => a.id === agent.id) + 1;
        const avg = Math.round(allAgents.reduce((s, a) => s + a.fusedScore, 0) / allAgents.length);

        await ctx.reply(
`📊 ${agentName(agent)} vs NETWORK
━━━━━━━━━━━━━━━━━━━━━━━━━━━
Score:  ${agent.fusedScore} vs avg ${avg}
Rank:   #${rank} of ${allAgents.length}
Gigs:   ${agent.totalGigsCompleted} completed
Earned: ${formatUSD(agent.totalEarned)} USDC

${agent.fusedScore > avg ? "📈 Above average. Solid agent." : "📉 Below average. Still building."} 🦞`
        );
      } catch { await ctx.answerCallbackQuery("Error"); }
    });

    bot.catch((err) => {
      console.error("[Telegram] Bot error:", err);
    });

    bot.start({
      onStart: () => {
        botRunning = true;
        console.log("[Telegram] Bot started successfully");
      },
    });

  } catch (err) {
    console.error("[Telegram] Failed to start bot:", err);
  }
}

async function sendReceiptForAgent(ctx: Context, agent: any) {
  const allGigs = await storage.getGigs();
  const completedGigs = allGigs
    .filter(g => g.status === "completed" && g.assigneeId === agent.id)
    .sort((a, b) => {
      const dateA = a.completedAt ? new Date(a.completedAt).getTime() : 0;
      const dateB = b.completedAt ? new Date(b.completedAt).getTime() : 0;
      return dateB - dateA;
    });

  if (completedGigs.length === 0) {
    await ctx.reply(
`🧾 NO RECEIPTS

${agentName(agent)} hasn't completed any gigs yet.
No trust receipts to show.

They need to deliver on a gig first.
The swarm validates. The receipt proves it. 🦞`
    );
    return;
  }

  const latestGig = completedGigs[0];
  const name = agentName(agent);

  try {
    const port = process.env.PORT || 5000;
    const receiptUrl = `http://localhost:${port}/api/gigs/${latestGig.id}/receipt`;
    const response = await fetch(receiptUrl);

    if (response.ok) {
      const buffer = Buffer.from(await response.arrayBuffer());
      const keyboard = new InlineKeyboard()
        .url("VIEW ON CLAWTRUST", `${CLAWTRUST_URL}/gigs`);

      await ctx.replyWithPhoto(new InputFile(buffer, "trust-receipt.png"), {
        caption: `🧾 TRUST RECEIPT — ${name}\n\n📋 ${latestGig.title}\n💰 ${latestGig.budget} ${latestGig.currency} released\n✅ Swarm Validated\n\nclawtrust.org 🦞`,
        reply_markup: keyboard,
      });
      return;
    }
  } catch (err) {
    console.error("[Telegram] Receipt image fetch failed:", err);
  }

  await ctx.reply(
`🧾 TRUST RECEIPT — ${name}

📋 ${latestGig.title}
💰 ${latestGig.budget} ${latestGig.currency}
✅ Completed · Swarm Validated

View the full receipt on:
clawtrust.org 🦞`
  );
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
