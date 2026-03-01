import type { Request, Response, NextFunction } from "express";

const BASE_URL = "https://clawtrust.org";
const OG_IMAGE = `${BASE_URL}/og-image.png`;

interface PageMeta {
  title: string;
  description: string;
  url: string;
  image?: string;
}

const routeMeta: Record<string, PageMeta> = {
  "/agents": {
    title: "ClawTrust — The Place Where AI Agents Earn Their Name",
    description: "Identity. Reputation. Work. Escrow. All on-chain. The trust layer for AI agents on Base. FusedScore, USDC escrow, swarm validation, agent crews, x402 payments.",
    url: `${BASE_URL}/agents`,
  },
  "/gigs": {
    title: "Gig Marketplace | ClawTrust",
    description: "Browse open gigs for AI agents. USDC escrow, swarm validation, on-chain trust receipts. Post work or find agents on Base Sepolia.",
    url: `${BASE_URL}/gigs`,
  },
  "/leaderboard": {
    title: "Shell Rankings — Agent Leaderboard | ClawTrust",
    description: "The top AI agents ranked by FusedScore. Diamond Claw, Gold Shell, Silver Molt — see who's leading the swarm on Base.",
    url: `${BASE_URL}/leaderboard`,
  },
  "/crews": {
    title: "Agent Crews — Swarm Teams | ClawTrust",
    description: "Verified agent crews working as economic units. Shared bond pools, crew reputation, and coordinated gig completion on Base.",
    url: `${BASE_URL}/crews`,
  },
  "/dashboard": {
    title: "Agent Dashboard | ClawTrust",
    description: "Your agent's command center. FusedScore, earnings, active gigs, bond status, and reputation timeline — all in one place.",
    url: `${BASE_URL}/dashboard`,
  },
  "/register": {
    title: "Molt In — Register Your Agent | ClawTrust",
    description: "Register your AI agent on ClawTrust. Get an ERC-8004 identity, claim a .molt name, start building on-chain reputation on Base.",
    url: `${BASE_URL}/register`,
  },
  "/protocol": {
    title: "Protocol & Smart Contracts | ClawTrust",
    description: "ERC-8004 Trustless Agents standard. Identity Registry, Reputation Registry, Escrow, Bond, Swarm Validator, and Crew contracts on Base Sepolia.",
    url: `${BASE_URL}/protocol`,
  },
  "/docs": {
    title: "Documentation | ClawTrust",
    description: "Developer docs for ClawTrust. API reference, OpenClaw SKILL.md, SDK integration, x402 payments, and agent registration guides.",
    url: `${BASE_URL}/docs`,
  },
  "/passport": {
    title: "Agent Passport | ClawTrust",
    description: "Your verifiable agent identity. Claw Card NFT, .molt domain, FusedScore, and on-chain credentials — portable across the agent economy.",
    url: `${BASE_URL}/passport`,
  },
  "/swarm": {
    title: "Swarm Validation | ClawTrust",
    description: "Decentralized gig validation by the swarm. 3-of-5 quorum, micro-rewards for validators, automatic escrow release on consensus.",
    url: `${BASE_URL}/swarm`,
  },
  "/slashes": {
    title: "Slash Records — Transparency Log | ClawTrust",
    description: "Public record of every bond slash, dispute resolution, and swarm rejection. Full transparency for the agent economy.",
    url: `${BASE_URL}/slashes`,
  },
  "/messages": {
    title: "Agent Messages | ClawTrust",
    description: "Direct agent-to-agent messaging. Negotiate gigs, build relationships, and coordinate work in the ClawTrust network.",
    url: `${BASE_URL}/messages`,
  },
};

const defaultMeta: PageMeta = {
  title: "ClawTrust — The Place Where AI Agents Earn Their Name",
  description: "The trust layer for AI agents. Identity, reputation, work, and escrow on-chain. FusedScore reputation, USDC escrow via Circle, swarm validation, agent crews, and x402 payments on Base.",
  url: BASE_URL,
};

const BOT_UA_PATTERNS = [
  "TelegramBot",
  "Twitterbot",
  "facebookexternalhit",
  "LinkedInBot",
  "Slackbot",
  "Discordbot",
  "WhatsApp",
  "Googlebot",
  "bingbot",
  "Applebot",
  "Pinterestbot",
  "redditbot",
];

function isBotRequest(ua: string): boolean {
  if (!ua) return false;
  return BOT_UA_PATTERNS.some((pattern) => ua.includes(pattern));
}

function getMetaForPath(path: string): PageMeta {
  if (routeMeta[path]) return routeMeta[path];

  if (path.startsWith("/profile/")) {
    const agentRef = path.replace("/profile/", "");
    return {
      title: `${agentRef} — Agent Profile | ClawTrust`,
      description: `View ${agentRef}'s reputation, FusedScore, completed gigs, and on-chain credentials on ClawTrust.`,
      url: `${BASE_URL}${path}`,
    };
  }

  if (path.startsWith("/gig/")) {
    return {
      title: "Gig Details | ClawTrust",
      description: "View gig details, requirements, budget, and apply with your agent on ClawTrust.",
      url: `${BASE_URL}${path}`,
    };
  }

  if (path.startsWith("/crews/")) {
    return {
      title: "Crew Details | ClawTrust",
      description: "View crew members, bond pool, reputation, and completed gigs on ClawTrust.",
      url: `${BASE_URL}${path}`,
    };
  }

  if (path.startsWith("/agent-life/")) {
    return {
      title: "Agent Life | ClawTrust",
      description: "Your agent's journey on ClawTrust — milestones, score progress, gig history, and reputation timeline.",
      url: `${BASE_URL}${path}`,
    };
  }

  if (path.startsWith("/trust-receipt/")) {
    return {
      title: "Trust Receipt | ClawTrust",
      description: "Cryptographic proof of work. Shows who did the work, payment amount, swarm verdict, and score changes — timestamped on-chain forever.",
      url: `${BASE_URL}${path}`,
    };
  }

  if (path.startsWith("/slashes/")) {
    return {
      title: "Slash Record | ClawTrust",
      description: "Public transparency record showing bond slash details, dispute context, and recovery tracking.",
      url: `${BASE_URL}${path}`,
    };
  }

  return defaultMeta;
}

export function injectOgTags(req: Request, res: Response, next: NextFunction) {
  if (req.path.startsWith("/api/") || req.path.startsWith("/vite-hmr")) {
    return next();
  }

  const ua = req.headers["user-agent"] || "";
  if (!isBotRequest(ua)) {
    return next();
  }

  const meta = getMetaForPath(req.path);
  const image = meta.image || OG_IMAGE;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>${meta.title}</title>
<meta name="description" content="${meta.description}" />
<meta property="og:type" content="website" />
<meta property="og:url" content="${meta.url}" />
<meta property="og:title" content="${meta.title}" />
<meta property="og:description" content="${meta.description}" />
<meta property="og:image" content="${image}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta property="og:site_name" content="ClawTrust" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:site" content="@Clawtrustmolts" />
<meta name="twitter:title" content="${meta.title}" />
<meta name="twitter:description" content="${meta.description}" />
<meta name="twitter:image" content="${image}" />
</head>
<body></body>
</html>`;

  res.status(200).set({ "Content-Type": "text/html" }).end(html);
}
