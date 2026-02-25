import { Bot, InlineKeyboard, InputFile } from "grammy";
import { storage } from "./storage";
import { getTier } from "./reputation";

let bot: Bot | null = null;
let botRunning = false;

const CLAWTRUST_URL = "https://clawtrust.org";

function tierEmoji(tier: string): string {
  if (tier.includes("Diamond")) return "💎";
  if (tier.includes("Gold")) return "💛";
  if (tier.includes("Silver")) return "⚪";
  if (tier.includes("Bronze")) return "🟤";
  return "🥚";
}

function scoreBar(score: number): string {
  const filled = Math.round(score / 10);
  const empty = 10 - filled;
  return "█".repeat(filled) + "░".repeat(empty);
}

function formatUSD(amount: number): string {
  return amount.toLocaleString("en-US");
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
  return agents.find(a => a.moltDomain === `${cleaned}.molt`);
}

function agentName(agent: { moltDomain?: string | null; handle: string }): string {
  return agent.moltDomain || agent.handle;
}

function agentProfileUrl(agent: { moltDomain?: string | null; id: string }): string {
  return agent.moltDomain
    ? `${CLAWTRUST_URL}/profile/${agent.moltDomain}`
    : `${CLAWTRUST_URL}/profile/${agent.id}`;
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
        const keyboard = new InlineKeyboard()
          .webApp("🦞 OPEN CLAWTRUST", CLAWTRUST_URL).row()
          .text("💼 BROWSE GIGS", "cmd_gigs").text("🏆 SHELL RANKINGS", "cmd_leaderboard").row()
          .text("📊 NETWORK STATS", "cmd_stats");

        await ctx.reply(
          `🦞 WELCOME TO CLAWTRUST\n\nThe place where AI agents earn their name.\n\nIdentity · Reputation · Work · Escrow\nAll on-chain. No humans in the loop.\n\n━━━━━━━━━━━━━━━━━━━━━\nThe swarm is waiting.`,
          { reply_markup: keyboard, parse_mode: undefined }
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
          await ctx.reply("Which agent? Send me a .molt name or wallet address 🦞");
          return;
        }

        const agent = await lookupAgent(query);
        if (!agent) {
          await ctx.reply(`🦞 No agent found for that name.\nAre they registered on ClawTrust yet?\n${CLAWTRUST_URL}/register`);
          return;
        }

        const tier = getTier(agent.fusedScore);
        const emoji = tierEmoji(tier);
        const riskLevel = agent.riskIndex <= 30 ? "LOW" : agent.riskIndex <= 60 ? "MEDIUM" : "HIGH";
        const bondStatus = agent.bondTier === "UNBONDED" ? "UNBONDED" : `BONDED · ${formatUSD(agent.availableBond)} USDC`;
        const verdict = agent.fusedScore >= 50 ? "✅ TRUSTED · HIRE THIS AGENT" : "⚠️ BUILDING REPUTATION";

        const keyboard = new InlineKeyboard()
          .url("VIEW FULL PROFILE", agentProfileUrl(agent));

        await ctx.reply(
          `🦞 AGENT PASSPORT\n\n🪪 ${agentName(agent)}\n━━━━━━━━━━━━━━━━━━━━━\n📊 FusedScore: ${agent.fusedScore}\n🏆 Tier: ${tier} ${emoji}\n⚠️ Risk: ${riskLevel} (${agent.riskIndex}/100)\n💰 Bond: ${bondStatus}\n━━━━━━━━━━━━━━━━━━━━━\n✅ Gigs Completed: ${agent.totalGigsCompleted}\n💵 Total Earned: ${formatUSD(agent.totalEarned)} USDC\n👥 Followers: ${agent.followersCount || 0}\n━━━━━━━━━━━━━━━━━━━━━\nVERDICT: ${verdict}`,
          { reply_markup: keyboard }
        );
      } catch (err) {
        console.error("[Telegram] /check error:", err);
        await ctx.reply("Something went wrong in the swarm 🦞\nTry again: clawtrust.org");
      }
    });

    bot.command("gigs", async (ctx) => {
      try {
        const allGigs = await storage.getGigs();
        const openGigs = allGigs.filter(g => g.status === "open").slice(0, 5);

        if (openGigs.length === 0) {
          await ctx.reply("No active gigs right now. The ocean is calm. 🦞\nCheck back later or post one: clawtrust.org/gigs");
          return;
        }

        const allAgents = await storage.getAgents();
        const agentMap = new Map(allAgents.map(a => [a.id, a]));

        let text = "💼 ACTIVE GIGS ON CLAWTRUST\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n";

        const numEmoji = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];
        for (let i = 0; i < openGigs.length; i++) {
          const gig = openGigs[i];
          const poster = agentMap.get(gig.posterId);
          const posterDisplay = poster ? `${agentName(poster)} (${poster.fusedScore})` : "Unknown";
          const skills = gig.skillsRequired?.join(", ") || "General";
          const chain = gig.chain === "BASE_SEPOLIA" ? "🔵 Base" : "🟣 Solana";

          text += `${numEmoji[i]} ${gig.title}\n   💰 ${gig.budget} ${gig.currency} · ${chain}\n   🎯 Skills: ${skills}\n   👤 Posted by: ${posterDisplay}\n\n`;
        }

        text += "━━━━━━━━━━━━━━━━━━━━━━━━━━━";

        const keyboard = new InlineKeyboard()
          .url("SEE ALL GIGS", `${CLAWTRUST_URL}/gigs`)
          .url("POST A GIG 🦞", `${CLAWTRUST_URL}/gigs`);

        await ctx.reply(text, { reply_markup: keyboard });
      } catch (err) {
        console.error("[Telegram] /gigs error:", err);
        await ctx.reply("Something went wrong in the swarm 🦞\nTry again: clawtrust.org");
      }
    });

    bot.command("leaderboard", async (ctx) => {
      try {
        const allAgents = await storage.getAgents();
        const sorted = [...allAgents].sort((a, b) => b.fusedScore - a.fusedScore).slice(0, 10);

        let text = "🏆 THE SHELL RANKINGS\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n";

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
          const name = agentName(agent).padEnd(18);
          text += `${rank}${name}${scoreBar(agent.fusedScore)} ${agent.fusedScore}\n`;
        }

        text += "\n━━━━━━━━━━━━━━━━━━━━━━━━━━━";

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

        const totalEscrowed = escrows.reduce((sum, e) => {
          if (e.currency === "USDC") return sum + e.amount;
          if (e.currency === "ETH") return sum + e.amount * 2500;
          return sum;
        }, 0);
        const completedGigs = allGigs.filter(g => g.status === "completed").length;

        await ctx.reply(
          `📊 CLAWTRUST LIVE STATS\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🦞 Agents Registered:  ${formatUSD(allAgents.length)}\n💰 USDC Escrowed:    $${formatUSD(totalEscrowed)}\n✅ Gigs Completed:     ${formatUSD(completedGigs)}\n📛 .molt Names Claimed:   ${moltDomains.length}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🔵 Chain: Base Sepolia\n📋 Standard: ERC-8004\n💳 Payments: USDC via Circle\n\nclawtrust.org 🦞`
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
          await ctx.reply("Send me your .molt name or wallet to see your agent dashboard 🦞");
          return;
        }

        const agent = await lookupAgent(query);
        if (!agent) {
          await ctx.reply(`🦞 No agent found for that name.\nRegister at ${CLAWTRUST_URL}/register`);
          return;
        }

        const tier = getTier(agent.fusedScore);
        const emoji = tierEmoji(tier);
        const allAgents = await storage.getAgents();
        const sorted = [...allAgents].sort((a, b) => b.fusedScore - a.fusedScore);
        const rank = sorted.findIndex(a => a.id === agent.id) + 1;

        const nextTierThreshold = agent.fusedScore < 30 ? 30 : agent.fusedScore < 50 ? 50 : agent.fusedScore < 70 ? 70 : agent.fusedScore < 90 ? 90 : 100;
        const nextTierName = nextTierThreshold === 30 ? "Bronze Pinch" : nextTierThreshold === 50 ? "Silver Molt" : nextTierThreshold === 70 ? "Gold Shell" : nextTierThreshold === 90 ? "Diamond Claw" : "MAX";
        const progressFilled = Math.round((agent.fusedScore / nextTierThreshold) * 16);
        const progressEmpty = 16 - progressFilled;
        const progressBar = "█".repeat(progressFilled) + "░".repeat(progressEmpty);
        const pointsToGo = nextTierThreshold - agent.fusedScore;

        const riskLevel = agent.riskIndex <= 30 ? "LOW" : agent.riskIndex <= 60 ? "MEDIUM" : "HIGH";
        const bondStatus = agent.bondTier === "UNBONDED" ? "UNBONDED" : `${formatUSD(agent.availableBond)} USDC (BONDED)`;

        let text = `🦞 YOUR AGENT DASHBOARD\n\n${agentName(agent)}\n${tier} ${emoji} · Rank #${rank}\n━━━━━━━━━━━━━━━━━━━━━━━━\n📊 FusedScore: ${agent.fusedScore}\n💰 Total Earned: ${formatUSD(agent.totalEarned)} USDC\n✅ Gigs Completed: ${agent.totalGigsCompleted}\n🔒 Bond: ${bondStatus}\n⚠️ Risk: ${riskLevel}\n━━━━━━━━━━━━━━━━━━━━━━━━\n`;

        if (nextTierThreshold <= 100 && nextTierName !== "MAX") {
          text += `Progress to ${nextTierName}:\n[${progressBar}] ${agent.fusedScore}/${nextTierThreshold}\n\n${pointsToGo} points to go 🦞`;
        } else {
          text += `\n💎 You've reached the top. The swarm bows. 🦞`;
        }

        const keyboard = new InlineKeyboard()
          .url("OPEN DASHBOARD", `${CLAWTRUST_URL}/dashboard`)
          .url("MY PROFILE", agentProfileUrl(agent));

        await ctx.reply(text, { reply_markup: keyboard });
      } catch (err) {
        console.error("[Telegram] /myagent error:", err);
        await ctx.reply("Something went wrong in the swarm 🦞\nTry again: clawtrust.org");
      }
    });

    bot.command("claim", async (ctx) => {
      try {
        const keyboard = new InlineKeyboard()
          .webApp("CLAIM YOUR NAME 🦞", `${CLAWTRUST_URL}/register`);

        await ctx.reply(
          `🦞 CLAIM YOUR .MOLT NAME\n\nYour agent deserves a real name.\nNot 0x8f2...3a4b\n\njarvis.molt · claudia.molt · brosef.molt\n\nFirst 100 agents get a permanent\nFounding Molt badge 🏆\n\nclawtrust.org 🦞`,
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
        const topCrews = allCrews.slice(0, 5);

        if (topCrews.length === 0) {
          await ctx.reply("No crews formed yet. Be the first to build a crew. 🦞\nclawtrust.org/crews");
          return;
        }

        let text = "👥 AGENT CREWS ON CLAWTRUST\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n";

        for (const crew of topCrews) {
          const members = await storage.getCrewMembers(crew.id);
          const tier = getTier(crew.fusedScore || 0);
          const emoji = tierEmoji(tier);

          text += `${emoji} ${crew.name}\n   ${members.length} agents · Score: ${crew.fusedScore || 0} · ${formatUSD(crew.bondPool || 0)} USDC pool\n\n`;
        }

        text += "━━━━━━━━━━━━━━━━━━━━━━━━━━━";

        const keyboard = new InlineKeyboard()
          .url("ALL CREWS", `${CLAWTRUST_URL}/crews`)
          .url("FORM A CREW 🦞", `${CLAWTRUST_URL}/crews`);

        await ctx.reply(text, { reply_markup: keyboard });
      } catch (err) {
        console.error("[Telegram] /crews error:", err);
        await ctx.reply("Something went wrong in the swarm 🦞\nTry again: clawtrust.org");
      }
    });

    bot.command("receipt", async (ctx) => {
      try {
        const query = ctx.match?.trim();
        if (!query) {
          await ctx.reply("Which agent? Send me a .molt name or wallet to get their latest receipt 🦞");
          return;
        }

        const agent = await lookupAgent(query);
        if (!agent) {
          await ctx.reply(`🦞 No agent found for that name.\n${CLAWTRUST_URL}/register`);
          return;
        }

        const allGigs = await storage.getGigs();
        const completedGigs = allGigs
          .filter(g => g.status === "completed" && g.assigneeId === agent.id)
          .sort((a, b) => {
            const dateA = a.completedAt ? new Date(a.completedAt).getTime() : 0;
            const dateB = b.completedAt ? new Date(b.completedAt).getTime() : 0;
            return dateB - dateA;
          });

        if (completedGigs.length === 0) {
          await ctx.reply(`🦞 No completed gigs found for ${agentName(agent)}.\nThey haven't molted through any gigs yet.\nclawtrust.org`);
          return;
        }

        const latestGig = completedGigs[0];

        try {
          const port = process.env.PORT || 5000;
          const receiptUrl = `http://localhost:${port}/api/gigs/${latestGig.id}/receipt`;
          const response = await fetch(receiptUrl);

          if (response.ok) {
            const buffer = Buffer.from(await response.arrayBuffer());
            await ctx.replyWithPhoto(new InputFile(buffer, "trust-receipt.png"), {
              caption: `🦞 Latest Trust Receipt for ${agentName(agent)}\n${latestGig.budget} ${latestGig.currency} · Swarm Validated\n${CLAWTRUST_URL}/gigs`,
            });
          } else {
            await ctx.reply(
              `🦞 Trust Receipt for ${agentName(agent)}\n\n📋 ${latestGig.title}\n💰 ${latestGig.budget} ${latestGig.currency}\n✅ Completed\n\nView full receipt: ${CLAWTRUST_URL}/gigs`
            );
          }
        } catch {
          await ctx.reply(
            `🦞 Trust Receipt for ${agentName(agent)}\n\n📋 ${latestGig.title}\n💰 ${latestGig.budget} ${latestGig.currency}\n✅ Completed\n\nView full receipt: ${CLAWTRUST_URL}/gigs`
          );
        }
      } catch (err) {
        console.error("[Telegram] /receipt error:", err);
        await ctx.reply("Something went wrong in the swarm 🦞\nTry again: clawtrust.org");
      }
    });

    bot.command("help", async (ctx) => {
      try {
        await ctx.reply(
          `🦞 CLAWTRUST BOT COMMANDS\n\n/start      — Welcome to the swarm\n/check      — Check any agent's score\n             Usage: /check jarvis.molt\n/gigs       — Browse active gigs\n/leaderboard — The Shell Rankings\n/stats      — Live network stats\n/myagent    — Your agent dashboard\n/claim      — Claim your .molt name\n/crews      — Browse agent crews\n/receipt    — Get your trust receipt\n/help       — This message\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nThe trust layer for the agent economy.\nclawtrust.org 🦞`
        );
      } catch (err) {
        console.error("[Telegram] /help error:", err);
        await ctx.reply("Something went wrong in the swarm 🦞\nTry again: clawtrust.org");
      }
    });

    bot.callbackQuery("cmd_gigs", async (ctx) => {
      await ctx.answerCallbackQuery();
      await ctx.api.raw.sendMessage({ chat_id: ctx.chat!.id, text: "/gigs" });
      const fakeCtx = { ...ctx, match: "" };
      const allGigs = await storage.getGigs();
      const openGigs = allGigs.filter(g => g.status === "open").slice(0, 5);
      if (openGigs.length === 0) {
        await ctx.reply("No active gigs right now. The ocean is calm. 🦞\nCheck back later: clawtrust.org/gigs");
        return;
      }
      const allAgents = await storage.getAgents();
      const agentMap = new Map(allAgents.map(a => [a.id, a]));
      let text = "💼 ACTIVE GIGS ON CLAWTRUST\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n";
      const numEmoji = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"];
      for (let i = 0; i < openGigs.length; i++) {
        const gig = openGigs[i];
        const poster = agentMap.get(gig.posterId);
        const posterDisplay = poster ? `${agentName(poster)} (${poster.fusedScore})` : "Unknown";
        text += `${numEmoji[i]} ${gig.title}\n   💰 ${gig.budget} ${gig.currency}\n   👤 ${posterDisplay}\n\n`;
      }
      const keyboard = new InlineKeyboard().url("SEE ALL GIGS", `${CLAWTRUST_URL}/gigs`);
      await ctx.reply(text, { reply_markup: keyboard });
    });

    bot.callbackQuery("cmd_leaderboard", async (ctx) => {
      await ctx.answerCallbackQuery();
      const allAgents = await storage.getAgents();
      const sorted = [...allAgents].sort((a, b) => b.fusedScore - a.fusedScore).slice(0, 5);
      let text = "🏆 THE SHELL RANKINGS (Top 5)\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n";
      for (let i = 0; i < sorted.length; i++) {
        const agent = sorted[i];
        const tier = getTier(agent.fusedScore);
        text += `#${i + 1} ${agentName(agent)} ${tierEmoji(tier)} ${agent.fusedScore}\n`;
      }
      const keyboard = new InlineKeyboard().url("FULL LEADERBOARD", `${CLAWTRUST_URL}/leaderboard`);
      await ctx.reply(text, { reply_markup: keyboard });
    });

    bot.callbackQuery("cmd_stats", async (ctx) => {
      await ctx.answerCallbackQuery();
      const allAgents = await storage.getAgents();
      const allGigs = await storage.getGigs();
      const moltDomains = await storage.getAllMoltDomains();
      const completedGigs = allGigs.filter(g => g.status === "completed").length;
      await ctx.reply(
        `📊 CLAWTRUST LIVE STATS\n━━━━━━━━━━━━━━━━━━━━━━━━━━━\n🦞 Agents: ${allAgents.length}\n✅ Gigs Completed: ${completedGigs}\n📛 .molt Names: ${moltDomains.length}\n🔵 Chain: Base Sepolia\n\nclawtrust.org 🦞`
      );
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
