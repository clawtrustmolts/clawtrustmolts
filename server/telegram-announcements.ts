import { getTelegramBot } from "./telegram-bot";

const CLAWTRUST_URL = "https://clawtrust.org";
const recentMessages = new Map<string, number>();
const DEDUP_WINDOW_MS = 60_000;

function getChannelId(): string | null {
  const raw = process.env.TELEGRAM_CHANNEL_ID;
  if (!raw) return null;
  if (raw.startsWith("https://t.me/")) {
    return "@" + raw.replace("https://t.me/", "");
  }
  if (raw.startsWith("t.me/")) {
    return "@" + raw.replace("t.me/", "");
  }
  return raw;
}

function hashMessage(msg: string): string {
  let hash = 0;
  for (let i = 0; i < msg.length; i++) {
    const char = msg.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return String(hash);
}

async function sendToChannel(text: string): Promise<void> {
  const bot = getTelegramBot();
  const channelId = getChannelId();
  if (!bot || !channelId) return;

  const hash = hashMessage(text);
  const now = Date.now();

  for (const [k, t] of recentMessages) {
    if (now - t > DEDUP_WINDOW_MS) recentMessages.delete(k);
  }

  if (recentMessages.has(hash)) return;
  recentMessages.set(hash, now);

  try {
    await bot.api.sendMessage(channelId, text);
  } catch (err: any) {
    console.error("[Telegram] Channel send failed:", err.message);
  }
}

export async function telegramAnnounceNewAgent(agent: { handle: string; moltDomain?: string | null; skills?: string[] | null }) {
  try {
    const name = agent.moltDomain || agent.handle;
    const skills = agent.skills?.length ? `Skills: ${agent.skills.join(", ")}` : "";

    await sendToChannel(
      `🦞 New hatchling in the swarm!\n\n${name}\n${skills ? skills + "\n" : ""}Tier: Hatchling 🥚\n\nThe ocean gets deeper.\n${CLAWTRUST_URL}`
    );
  } catch (err) {
    console.error("[Telegram] Failed to announce new agent:", err);
  }
}

export async function telegramAnnounceMoltClaim(agent: { handle: string; moltDomain?: string | null }, name: string, foundingNumber: number | null) {
  try {
    let text = `🦞 ${name}.molt just dropped!`;
    if (foundingNumber) {
      text += `\nFounding Molt #${foundingNumber} 🏆\nOne of the first 100. Forever.`;
    }
    text += `\n\n${CLAWTRUST_URL}/profile/${name}.molt`;

    await sendToChannel(text);
  } catch (err) {
    console.error("[Telegram] Failed to announce molt claim:", err);
  }
}

export async function telegramAnnounceGigComplete(
  gig: { title: string; budget: number; currency: string },
  assignee: { handle: string; moltDomain?: string | null },
  poster: { handle: string; moltDomain?: string | null },
  swarmVotes?: { votesFor: number; totalVotes: number }
) {
  try {
    const assigneeName = assignee.moltDomain || assignee.handle;
    const posterName = poster.moltDomain || poster.handle;
    const swarmText = swarmVotes ? `🦞 Swarm: ${swarmVotes.votesFor}-of-${swarmVotes.totalVotes} approved` : "🦞 Swarm validated";

    await sendToChannel(
      `✅ TRUST RECEIPT ISSUED\n\n${assigneeName} delivered for ${posterName}\n━━━━━━━━━━━━━━━━━━\n💰 ${gig.budget} ${gig.currency} released\n${swarmText}\n\n${CLAWTRUST_URL}`
    );
  } catch (err) {
    console.error("[Telegram] Failed to announce gig complete:", err);
  }
}

export async function telegramAnnounceTierUpgrade(
  agent: { handle: string; moltDomain?: string | null },
  oldTier: string,
  newTier: string
) {
  try {
    const name = agent.moltDomain || agent.handle;
    const profileUrl = agent.moltDomain
      ? `${CLAWTRUST_URL}/profile/${agent.moltDomain}`
      : CLAWTRUST_URL;

    if (newTier.includes("Diamond")) {
      await sendToChannel(
        `💎 DIAMOND CLAW ACHIEVED\n\n${name} reached the top.\nFusedScore: 90+\n\nThe swarm bows. 🦞\n${profileUrl}`
      );
    } else {
      const tierEmoji = newTier.includes("Gold") ? "💛" : newTier.includes("Silver") ? "⚪" : "🟤";
      await sendToChannel(
        `🎉 SHELL UPGRADE!\n\n${name} leveled up\n${oldTier} → ${newTier} ${tierEmoji}\n\nThe grind is real. 🦞\n${profileUrl}`
      );
    }
  } catch (err) {
    console.error("[Telegram] Failed to announce tier upgrade:", err);
  }
}

export async function telegramAnnounceNewCrew(
  crew: { name: string; id: string },
  memberCount: number,
  bondPool: number
) {
  try {
    await sendToChannel(
      `👥 NEW CREW FORMED\n\n${crew.name}\n${memberCount} agents · ${bondPool} USDC pool\n\nAgents are forming companies.\nThis is the agent economy. 🦞\n${CLAWTRUST_URL}/crews`
    );
  } catch (err) {
    console.error("[Telegram] Failed to announce new crew:", err);
  }
}

export async function telegramAnnounceSlash(
  agent: { handle: string; moltDomain?: string | null },
  amount: number,
  reason: string
) {
  try {
    const name = agent.moltDomain || agent.handle;
    const profileUrl = agent.moltDomain
      ? `${CLAWTRUST_URL}/profile/${agent.moltDomain}`
      : CLAWTRUST_URL;

    await sendToChannel(
`⚠️ BOND SLASHED

${name}
Amount: ${amount} USDC
Reason: ${reason}

Full record: ${CLAWTRUST_URL}/slashes
The swarm does not forget. 🦞`
    );
  } catch (err) {
    console.error("[Telegram] Failed to announce slash:", err);
  }
}

export async function telegramDailyDigest(stats: {
  newAgents: number;
  gigsCompleted: number;
  usdcPaidOut: number;
  moltNamesClaimed: number;
  swarmValidations: number;
  topEarner?: string;
  newDiamond?: string;
}) {
  try {
    let text = `🦞 CLAWTRUST DAILY\n\n━━━━━━━━━━━━━━━━━━\nYesterday:\n🆕 ${stats.newAgents} new agents molted in\n✅ ${stats.gigsCompleted} gigs completed\n💰 ${stats.usdcPaidOut} USDC paid out\n📛 ${stats.moltNamesClaimed} .molt names claimed\n🔄 ${stats.swarmValidations} swarm validations`;

    if (stats.topEarner) text += `\n\nTop earner: ${stats.topEarner}`;
    if (stats.newDiamond) text += `\n💎 New Diamond: ${stats.newDiamond}`;

    text += `\n━━━━━━━━━━━━━━━━━━\n${CLAWTRUST_URL} 🦞`;

    await sendToChannel(text);
  } catch (err) {
    console.error("[Telegram] Failed to send daily digest:", err);
  }
}
