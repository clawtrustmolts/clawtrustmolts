import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import rateLimit from "express-rate-limit";
import { storage } from "./storage";
import { insertGigSchema, insertEscrowSchema, registerAgentSchema, moltSyncSchema, autonomousRegisterSchema, insertAgentSkillSchema, sendMessageSchema, insertSlashEventSchema, insertReputationMigrationSchema, MOLT_RESERVED_NAMES } from "@shared/schema";
import { z } from "zod";
import * as jose from "jose";
import crypto from "crypto";
import { type Address } from "viem";
import { computeFusedScore, getScoreBreakdown, estimateRepBoostFromMolt, computeLiveFusedReputation, getTier } from "./reputation";
import { moltyWelcomeAgent, moltyAnnounceGigCompletion, moltyAnnounceSwarmConsensus, moltyAnnounceTierChange, tryPostToMoltbook, moltyAnnounceMoltClaim } from "./molty-automation";
import {
  buildIdentityMetadata,
  prepareEscrowTxData,
  getContractInfo,
  buildReputationFeedback,
  prepareRegisterAgentTx,
  verifyAgentOwnership,
  verifyAgentByHandle,
  prepareSubmitFusedFeedbackTx,
  sendSubmitFusedFeedback,
  checkRepAdapterFusedScore,
  ERC8004_CONTRACTS,
} from "./erc8004";
import { fetchMoltbookData, fetchPostData, computeViralScore, normalizeMoltbookScore, getMoltbookRateLimitStatus } from "./moltbook-client";
import { generateClawCard, generateCardMetadata } from "./card-generator";
import { generatePassportImage, generatePassportMetadata } from "./passport-generator";
import { generateReceiptImage } from "./receipt-generator";
import { generateCrewPassportImage, getCrewTier } from "./crew-passport-generator";
import { startBot, stopBot, getBotStatus, runBotCycle, previewBotCycle, triggerIntroPost, postManifesto, directPost } from "./moltbook-bot";
import { paymentMiddleware } from "x402-express";
import { getBondStatus, ensureBondWallet, depositBond, withdrawBond, lockBond, unlockBond, slashBond, checkBondEligibility, getBondHistory, getNetworkBondStats, lockBondForGig, unlockBondForGig, syncPerformanceScore, computePerformanceScore } from "./bond-service";
import { calculateRiskProfile, updateRiskIndex, recordRiskEvent, checkGigRiskEligibility, getRiskLevel } from "./risk-engine";
import { syncProtocolFiles, syncSingleFile, syncAllFiles, syncSkillRepo, syncContractsRepo, syncSdkRepo, syncDocsRepo, syncOrgProfileRepo, syncAllRepos, checkGitHubConnection, getProtocolFileList, getAllFileList } from "./github-sync";
import {
  createEscrowWallet,
  getWalletBalance,
  transferUSDC,
  getTransactionStatus,
  isCircleConfigured,
  SUPPORTED_CHAINS,
  listWallets,
} from "./circle-wallet";

const escrowCircuitBreaker = {
  isOpen: false,
  openedAt: null as Date | null,
  reason: null as string | null,
  failureCount: 0,
  threshold: 5,
  resetTimeMs: 5 * 60 * 1000,
};

function checkCircuitBreaker(): { allowed: boolean; reason?: string } {
  if (escrowCircuitBreaker.isOpen) {
    if (escrowCircuitBreaker.openedAt &&
        Date.now() - escrowCircuitBreaker.openedAt.getTime() > escrowCircuitBreaker.resetTimeMs) {
      escrowCircuitBreaker.isOpen = false;
      escrowCircuitBreaker.failureCount = 0;
      escrowCircuitBreaker.reason = null;
      escrowCircuitBreaker.openedAt = null;
      return { allowed: true };
    }
    return { allowed: false, reason: escrowCircuitBreaker.reason || "Escrow operations paused" };
  }
  return { allowed: true };
}

function recordCircuitFailure(reason: string) {
  escrowCircuitBreaker.failureCount++;
  if (escrowCircuitBreaker.failureCount >= escrowCircuitBreaker.threshold) {
    escrowCircuitBreaker.isOpen = true;
    escrowCircuitBreaker.openedAt = new Date();
    escrowCircuitBreaker.reason = `Auto-tripped: ${reason} (${escrowCircuitBreaker.failureCount} failures)`;
    console.error(`[CircuitBreaker] OPENED: ${escrowCircuitBreaker.reason}`);
  }
}

const sanitizeString = (s: string, maxLen = 500): string =>
  s.replace(/[<>'";&\\]/g, "").trim().slice(0, maxLen);

const sanitizeArray = (arr: string[], maxLen = 64): string[] =>
  arr.map((s) => sanitizeString(s, maxLen)).filter(Boolean);

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const safeId = z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/);
const safeUUID = z.string().regex(uuidPattern, "Must be a valid UUID");

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  handler: async (req, res) => {
    await logSuspiciousActivity(req, "rate_limit_exceeded", "Exceeded 100 requests in 15 minutes");
    res.status(429).json({ message: "Too many requests. Please try again later." });
  },
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  validate: { xForwardedForHeader: false },
  handler: async (req, res) => {
    await logSuspiciousActivity(req, "strict_rate_limit_exceeded", "Exceeded 20 sensitive requests in 15 minutes");
    res.status(429).json({ message: "Too many requests on this endpoint. Please try again later." });
  },
});

async function logSuspiciousActivity(req: Request, eventType: string, details: string, severity: string = "warning") {
  try {
    await storage.createSecurityLog({
      eventType,
      ipAddress: req.ip || req.socket.remoteAddress || "unknown",
      userAgent: req.headers["user-agent"]?.slice(0, 500) || null,
      endpoint: `${req.method} ${req.path}`,
      details: details.slice(0, 1000),
      severity,
    });
  } catch {
  }
}

async function verifyTurnstileToken(token: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;

  try {
    const resp = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `secret=${encodeURIComponent(secret)}&response=${encodeURIComponent(token)}`,
    });
    const data = await resp.json() as { success: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

function captchaMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!process.env.TURNSTILE_SECRET_KEY) return next();

  const token = req.body?.captchaToken || req.headers["x-captcha-token"];
  if (!token) {
    logSuspiciousActivity(req, "captcha_missing", "No CAPTCHA token provided on protected endpoint");
    return res.status(400).json({ message: "CAPTCHA verification required" });
  }

  verifyTurnstileToken(token as string).then((valid) => {
    if (!valid) {
      logSuspiciousActivity(req, "captcha_failed", "CAPTCHA verification failed");
      return res.status(403).json({ message: "CAPTCHA verification failed" });
    }
    next();
  }).catch(() => {
    logSuspiciousActivity(req, "captcha_error", "CAPTCHA verification service error");
    return res.status(503).json({ message: "CAPTCHA verification service unavailable. Please try again." });
  });
}

let privyVerificationKey: crypto.KeyObject | null = null;
try {
  const keyPem = process.env.PRIVY_VERIFICATION_KEY;
  if (keyPem) {
    privyVerificationKey = crypto.createPublicKey(keyPem.replace(/\\n/g, "\n"));
    console.log("[Auth] Privy verification key loaded - cryptographic JWT verification enabled");
  }
} catch (err: any) {
  console.error("[Auth] Failed to load PRIVY_VERIFICATION_KEY:", err.message);
}

async function verifyPrivyJWT(token: string): Promise<{ verified: boolean; payload?: any; error?: string }> {
  if (privyVerificationKey) {
    try {
      const { payload } = await jose.jwtVerify(token, privyVerificationKey, {
        issuer: "privy.io",
        audience: process.env.PRIVY_APP_ID,
      });
      return { verified: true, payload };
    } catch (err: any) {
      return { verified: false, error: err.message?.slice(0, 200) };
    }
  }

  try {
    const parts = token.split(".");
    if (parts.length !== 3) return { verified: false, error: "Not a valid JWT format" };
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());

    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return { verified: false, error: `Token expired at ${new Date(payload.exp * 1000).toISOString()}` };
    }
    if (payload.iss && !payload.iss.includes("privy")) {
      return { verified: false, error: `Wrong issuer: ${String(payload.iss).slice(0, 50)}` };
    }
    if (payload.aud && payload.aud !== process.env.PRIVY_APP_ID) {
      return { verified: false, error: "Wrong audience" };
    }

    return { verified: true, payload };
  } catch {
    return { verified: false, error: "Failed to decode token" };
  }
}

function walletAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!process.env.PRIVY_APP_ID) return next();

  const authHeader = req.headers.authorization;
  const walletHeader = req.headers["x-wallet-address"] as string | undefined;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logSuspiciousActivity(req, "auth_missing", "Missing authorization header on protected endpoint");
    return res.status(401).json({ message: "Authentication required. Please connect your wallet." });
  }

  const token = authHeader.slice(7);
  if (!token || token.length < 10) {
    logSuspiciousActivity(req, "auth_invalid_token", "Bearer token too short or empty");
    return res.status(401).json({ message: "Invalid authentication token" });
  }

  verifyPrivyJWT(token).then((result) => {
    if (!result.verified) {
      logSuspiciousActivity(req, "auth_verification_failed", result.error || "JWT verification failed");
      return res.status(401).json({ message: "Authentication failed. Please reconnect your wallet." });
    }

    if (walletHeader && !/^0x[a-fA-F0-9]{40}$/.test(walletHeader)) {
      logSuspiciousActivity(req, "invalid_wallet", `Invalid wallet header: ${walletHeader?.slice(0, 20)}`);
      return res.status(400).json({ message: "Invalid wallet address format" });
    }

    const tokenWallet = result.payload?.wallet_address || result.payload?.linked_accounts?.find?.((a: any) => a.type === "wallet")?.address;
    if (walletHeader && tokenWallet && walletHeader.toLowerCase() !== tokenWallet.toLowerCase()) {
      logSuspiciousActivity(req, "auth_wallet_mismatch", `Header wallet ${walletHeader} != token wallet ${tokenWallet}`, "critical");
      return res.status(403).json({ message: "Wallet address does not match authenticated identity" });
    }

    (req as any).authUser = {
      sub: result.payload?.sub,
      walletAddress: walletHeader || tokenWallet,
    };

    next();
  }).catch(() => {
    logSuspiciousActivity(req, "auth_internal_error", "Internal auth verification error");
    return res.status(500).json({ message: "Authentication service error" });
  });
}

function adminAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  const adminWallet = req.headers["x-admin-wallet"] as string | undefined;
  const ADMIN_WALLETS = (process.env.ADMIN_WALLETS || "").split(",").map(w => w.trim().toLowerCase()).filter(Boolean);

  if (ADMIN_WALLETS.length === 0) {
    logSuspiciousActivity(req, "admin_not_configured", "Admin endpoint accessed but ADMIN_WALLETS not configured", "critical");
    return res.status(503).json({ message: "Admin access not configured. Set ADMIN_WALLETS environment variable." });
  }

  if (!adminWallet) {
    logSuspiciousActivity(req, "admin_missing_wallet", "Admin endpoint accessed without x-admin-wallet header");
    return res.status(401).json({ message: "Admin wallet address required. Send x-admin-wallet header." });
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(adminWallet)) {
    logSuspiciousActivity(req, "admin_invalid_wallet", `Invalid admin wallet format: ${adminWallet.slice(0, 20)}`);
    return res.status(400).json({ message: "Invalid admin wallet address format" });
  }

  if (!ADMIN_WALLETS.includes(adminWallet.toLowerCase())) {
    logSuspiciousActivity(req, "unauthorized_admin_action", `Non-admin wallet ${adminWallet} attempted admin access`, "critical");
    return res.status(403).json({ message: "Wallet not authorized for admin actions" });
  }

  (req as any).adminWallet = adminWallet;
  next();
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  const x402PayToAddress = process.env.X402_PAY_TO_ADDRESS || "0x0000000000000000000000000000000000000000";
  const x402Enabled = x402PayToAddress !== "0x0000000000000000000000000000000000000000";

  if (x402Enabled) {
    try {
      app.use(
        paymentMiddleware(
          x402PayToAddress as `0x${string}`,
          {
            "GET /api/trust-check/:wallet": {
              price: "$0.001",
              network: "base-sepolia",
              config: {
                description: "ClawTrust trust-check API — returns full agent trust data including fusedScore, tier, risk, and hireability status",
              },
            },
            "GET /api/reputation/:agentId": {
              price: "$0.002",
              network: "base-sepolia",
              config: {
                description: "ClawTrust reputation lookup — returns detailed fused reputation breakdown, on-chain verification, and event history",
              },
            },
          },
        ),
      );
      console.log("[x402] Payment middleware enabled — trust-check: $0.001, reputation: $0.002 USDC on Base Sepolia");
    } catch (err: any) {
      console.warn("[x402] Failed to initialize payment middleware:", err.message);
    }
  } else {
    console.log("[x402] Payment middleware disabled — set X402_PAY_TO_ADDRESS to enable");
  }

  app.get("/api/agents", async (_req, res) => {
    const agents = await storage.getAgents();
    res.json(agents);
  });

  app.get("/api/agents/handle/:handle", async (req, res) => {
    try {
      const agent = await storage.getAgentByHandle(req.params.handle);
      if (!agent) return res.status(404).json({ message: "Agent not found" });
      res.json(agent);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/molty/announcements", async (req, res) => {
    try {
      const pinned = req.query.pinned === "true" ? true : req.query.pinned === "false" ? false : undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string) : 20;
      const announcements = await storage.getMoltyAnnouncements(pinned, limit);
      res.json(announcements);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  function getAgentActivityStatus(agent: { lastHeartbeat: Date | null; registeredAt: Date | null }): {
    status: "active" | "warm" | "cooling" | "dormant" | "inactive";
    label: string;
    eligibleForGigs: boolean;
    trustPenalty: number;
  } {
    const lastActive = agent.lastHeartbeat || agent.registeredAt;
    if (!lastActive) return { status: "inactive", label: "Inactive", eligibleForGigs: false, trustPenalty: 0.5 };
    const hoursSince = (Date.now() - new Date(lastActive).getTime()) / (1000 * 60 * 60);
    if (hoursSince < 1) return { status: "active", label: "Active", eligibleForGigs: true, trustPenalty: 0 };
    if (hoursSince < 24) return { status: "warm", label: "Warm", eligibleForGigs: true, trustPenalty: 0.05 };
    if (hoursSince < 168) return { status: "cooling", label: "Cooling", eligibleForGigs: false, trustPenalty: 0.15 };
    if (hoursSince < 720) return { status: "dormant", label: "Dormant", eligibleForGigs: false, trustPenalty: 0.3 };
    return { status: "inactive", label: "Inactive", eligibleForGigs: false, trustPenalty: 0.5 };
  }

  app.get("/api/agents/discover", apiLimiter, async (req, res) => {
    try {
      const skillsParam = req.query.skills as string;
      const skills = skillsParam ? skillsParam.split(",").map(s => s.trim()).filter(Boolean) : undefined;
      const minScore = req.query.minScore ? parseFloat(req.query.minScore as string) : undefined;
      const maxRisk = req.query.maxRisk ? parseFloat(req.query.maxRisk as string) : undefined;
      const minBond = req.query.minBond ? parseFloat(req.query.minBond as string) : undefined;
      const sortBy = (req.query.sortBy as string) || "score_high";
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;
      const activeOnly = req.query.activeOnly === "true";

      const result = await storage.discoverAgents({ skills, minScore, maxRisk, minBond, sortBy, limit, offset });

      let enriched = await Promise.all(result.agents.map(async (a) => {
        const agentSkillsList = await storage.getAgentSkills(a.id);
        const activityStatus = getAgentActivityStatus(a);
        const followerCount = await storage.getFollowerCount(a.id);
        return {
          id: a.id, handle: a.handle, walletAddress: a.walletAddress, avatar: a.avatar, bio: a.bio,
          skills: a.skills,
          detailedSkills: agentSkillsList.map(s => ({ name: s.skillName, mcpEndpoint: s.mcpEndpoint, description: s.description })),
          fusedScore: a.fusedScore, riskIndex: a.riskIndex, bondTier: a.bondTier, availableBond: a.availableBond,
          totalGigsCompleted: a.totalGigsCompleted, totalEarned: a.totalEarned, isVerified: a.isVerified,
          performanceScore: a.performanceScore, bondReliability: a.bondReliability,
          activityStatus, followerCount,
          tier: getTier(a.fusedScore),
        };
      }));

      if (activeOnly) {
        enriched = enriched.filter(a => a.activityStatus.eligibleForGigs);
      }

      res.json({
        agents: enriched,
        total: activeOnly ? enriched.length : result.total,
        limit, offset,
        filters: { skills: skills || [], minScore, maxRisk, minBond, sortBy, activeOnly },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/agents/:id", async (req, res) => {
    const agent = await storage.getAgent(req.params.id);
    if (!agent) return res.status(404).json({ message: "Agent not found" });
    res.json(agent);
  });

  app.get("/api/agents/:id/verify", async (req, res) => {
    try {
      const agent = await storage.getAgent(req.params.id);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      let verification: any = null;

      if (agent.erc8004TokenId) {
        verification = await verifyAgentOwnership({
          walletAddress: agent.walletAddress as Address,
          tokenId: agent.erc8004TokenId,
        });
      } else {
        const handleResult = await verifyAgentByHandle(agent.handle);
        verification = handleResult;

        if (handleResult.tokenIdFound) {
          await storage.updateAgent(agent.id, {
            erc8004TokenId: handleResult.tokenIdFound,
            isVerified: handleResult.isRegistered,
          });
        }
      }

      if (verification?.isOwner || verification?.isRegistered) {
        if (!agent.isVerified) {
          await storage.updateAgent(agent.id, { isVerified: true });
        }
      }

      let repAdapterScore = null;
      try {
        repAdapterScore = await checkRepAdapterFusedScore(agent.walletAddress as Address);
      } catch {
      }

      res.json({
        agent: {
          id: agent.id,
          handle: agent.handle,
          walletAddress: agent.walletAddress,
          erc8004TokenId: agent.erc8004TokenId,
          isVerified: agent.isVerified || verification?.isOwner || verification?.isRegistered || false,
        },
        verification,
        repAdapterScore,
        contracts: {
          identityRegistry: ERC8004_CONTRACTS.identity.address,
          reputationRegistry: ERC8004_CONTRACTS.reputation.address,
        },
      });
    } catch (err: any) {
      res.status(500).json({
        message: "Verification check failed",
        error: err.message?.substring(0, 300),
      });
    }
  });

  app.post("/api/register-agent", strictLimiter, captchaMiddleware, walletAuthMiddleware, async (req, res) => {
    try {
      if (req.body?.captchaToken) delete req.body.captchaToken;
      const data = registerAgentSchema.parse(req.body);

      data.skills = sanitizeArray(data.skills);
      if (data.bio) data.bio = sanitizeString(data.bio, 500);

      const existingHandle = await storage.getAgentByHandle(data.handle);
      if (existingHandle) {
        return res.status(409).json({ message: "Handle already registered" });
      }

      const existingWallet = await storage.getAgentByWallet(data.walletAddress);
      if (existingWallet) {
        return res.status(409).json({ message: "Wallet address already registered" });
      }

      const metadata = buildIdentityMetadata({
        handle: data.handle,
        walletAddress: data.walletAddress,
        skills: data.skills,
        bio: data.bio || undefined,
        moltbookLink: data.moltbookLink || undefined,
        x402Support: true,
      });

      const metadataUri = data.metadataUri || `ipfs://clawtrust/${data.handle}/metadata.json`;

      const mintTx = await prepareRegisterAgentTx({
        handle: data.handle,
        metadataUri,
        skills: data.skills,
      });

      const agent = await storage.createAgent({
        handle: data.handle,
        walletAddress: data.walletAddress,
        solanaAddress: data.solanaAddress || null,
        skills: data.skills,
        bio: data.bio || null,
        avatar: data.avatar || null,
        metadataUri,
        moltbookLink: data.moltbookLink || null,
        moltbookKarma: 0,
        onChainScore: 0,
        erc8004TokenId: null,
      });

      await storage.createReputationEvent({
        agentId: agent.id,
        eventType: "Identity Registered",
        scoreChange: 5,
        source: "on_chain",
        details: "ERC-8004 identity registered via ClawTrust",
        proofUri: null,
      });

      const updatedAgent = await storage.updateAgent(agent.id, {
        onChainScore: 5,
        fusedScore: computeFusedScore(5, 0),
      });

      moltyWelcomeAgent({ id: agent.id, handle: agent.handle });
      tryPostToMoltbook(`Welcome ${agent.handle} to ClawTrust 🦞 A new hatchling enters the ocean. clawtrust.org`);

      res.status(201).json({
        agent: updatedAgent,
        metadata,
        erc8004: {
          identityRegistry: ERC8004_CONTRACTS.identity.address,
          metadataUri,
          status: "pending_mint",
          note: "Sign and submit the mint transaction to register ERC-8004 identity NFT on Base Sepolia",
        },
        mintTransaction: {
          to: mintTx.to,
          data: mintTx.data,
          value: mintTx.value,
          chainId: mintTx.chainId,
          description: mintTx.description,
          gasEstimate: mintTx.gasEstimate,
          error: mintTx.error,
        },
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/gigs", async (_req, res) => {
    const allGigs = await storage.getGigs();
    const validations = await storage.getValidations();
    const validationMap = new Map(validations.map(v => [v.gigId, v]));

    const gigsWithValidation = allGigs.map(g => ({
      ...g,
      validation: validationMap.get(g.id) ? {
        id: validationMap.get(g.id)!.id,
        status: validationMap.get(g.id)!.status,
        votesFor: validationMap.get(g.id)!.votesFor,
        votesAgainst: validationMap.get(g.id)!.votesAgainst,
        threshold: validationMap.get(g.id)!.threshold,
        selectedValidators: validationMap.get(g.id)!.selectedValidators,
        totalRewardPool: validationMap.get(g.id)!.totalRewardPool,
        rewardPerValidator: validationMap.get(g.id)!.rewardPerValidator,
      } : null,
    }));
    res.json(gigsWithValidation);
  });

  app.post("/api/gigs", apiLimiter, captchaMiddleware, walletAuthMiddleware, async (req, res) => {
    try {
      if (req.body?.captchaToken) delete req.body.captchaToken;
      const data = insertGigSchema.parse(req.body);

      data.title = sanitizeString(data.title, 200);
      data.description = sanitizeString(data.description, 2000);
      if (data.skillsRequired) data.skillsRequired = sanitizeArray(data.skillsRequired);

      if (data.posterId) {
        const poster = await storage.getAgent(data.posterId);
        if (!poster) {
          return res.status(404).json({ message: "Poster agent not found" });
        }
        if (poster.fusedScore < 15) {
          return res.status(403).json({ message: "Minimum fusedScore of 15 required to post gigs" });
        }
      } else {
        return res.status(400).json({ message: "posterId is required to create a gig" });
      }

      const gig = await storage.createGig(data);
      res.status(201).json(gig);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/gigs/:id/assign", apiLimiter, walletAuthMiddleware, async (req, res) => {
    try {
      const gigId = safeId.safeParse(req.params.id);
      if (!gigId.success) return res.status(400).json({ message: "Invalid gig ID" });

      const { assigneeId } = z.object({ assigneeId: z.string().uuid() }).parse(req.body);

      const gig = await storage.getGig(gigId.data);
      if (!gig) return res.status(404).json({ message: "Gig not found" });

      if (gig.status !== "open") {
        return res.status(400).json({ message: `Gig is "${gig.status}", only open gigs can be assigned` });
      }

      if (gig.posterId === assigneeId) {
        return res.status(400).json({ message: "Cannot assign a gig to its own poster" });
      }

      const assignee = await storage.getAgent(assigneeId);
      if (!assignee) return res.status(404).json({ message: "Assignee agent not found" });

      const riskCheck = await checkGigRiskEligibility(assigneeId);
      if (!riskCheck.eligible) {
        return res.status(400).json({
          message: riskCheck.reason,
          riskIndex: riskCheck.riskIndex,
        });
      }

      if (gig.bondRequired > 0) {
        const bondResult = await lockBondForGig(assigneeId, gigId.data, gig.bondRequired);
        if (!bondResult.locked) {
          return res.status(400).json({
            message: bondResult.reason,
            autoSlashed: bondResult.autoSlashed,
            bondRequired: gig.bondRequired,
          });
        }
      }

      const updated = await storage.updateGig(gigId.data, {
        assigneeId,
        status: "assigned",
        bondLocked: gig.bondRequired > 0,
      });

      await storage.createReputationEvent({
        agentId: assigneeId,
        eventType: "gig_assigned",
        scoreChange: 2,
        source: "escrow",
        details: `Assigned to gig: ${gig.title}`,
      });

      res.json({ ...updated, bondLocked: gig.bondRequired > 0, bondAmount: gig.bondRequired });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.patch("/api/gigs/:id/status", apiLimiter, walletAuthMiddleware, async (req, res) => {
    try {
      const gigId = safeId.safeParse(req.params.id);
      if (!gigId.success) return res.status(400).json({ message: "Invalid gig ID" });

      const { status } = z.object({
        status: z.enum(["open", "assigned", "in_progress", "pending_validation", "completed", "disputed"]),
      }).parse(req.body);

      const gig = await storage.getGig(gigId.data);
      if (!gig) return res.status(404).json({ message: "Gig not found" });

      const validTransitions: Record<string, string[]> = {
        open: ["assigned"],
        assigned: ["in_progress", "open"],
        in_progress: ["pending_validation", "completed", "disputed"],
        pending_validation: ["completed", "disputed"],
        disputed: ["completed", "open"],
      };

      if (!validTransitions[gig.status]?.includes(status)) {
        return res.status(400).json({
          message: `Cannot transition from "${gig.status}" to "${status}"`,
          validTransitions: validTransitions[gig.status] || [],
        });
      }

      const updated = await storage.updateGigStatus(gigId.data, status);
      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/reputation/:agentId", async (req, res) => {
    const agent = await storage.getAgent(req.params.agentId);
    if (!agent) return res.status(404).json({ message: "Agent not found" });

    const events = await storage.getReputationEvents(req.params.agentId);
    const dbBreakdown = getScoreBreakdown(agent);

    let liveFused;
    try {
      liveFused = await computeLiveFusedReputation(agent);
    } catch (err: any) {
      liveFused = null;
    }

    const fusedResult = liveFused
      ? {
          fusedScore: liveFused.fusedScore,
          onChainAvg: liveFused.onChainAvg,
          moltWeight: liveFused.moltWeight,
          proofURIs: liveFused.proofURIs,
          tier: liveFused.tier,
          badges: liveFused.badges,
          weights: liveFused.weights,
          source: liveFused.source,
          feedbacks: liveFused.feedbacks,
          moltbook: liveFused.moltbook,
          error: liveFused.error,
        }
      : {
          fusedScore: dbBreakdown.fusedScore,
          onChainAvg: dbBreakdown.onChainNormalized,
          moltWeight: dbBreakdown.moltbookNormalized,
          proofURIs: [],
          tier: dbBreakdown.tier,
          badges: dbBreakdown.badges,
          weights: dbBreakdown.weights,
          source: "fallback" as const,
          feedbacks: [],
          moltbook: {
            rawKarma: agent.moltbookKarma,
            viralBonus: 0,
            normalized: dbBreakdown.moltbookNormalized,
            source: "db_fallback" as const,
            postCount: 0,
            followers: 0,
            topPostCount: 0,
            viralScore: { viralBonus: 0, totalInteractions: 0, weightedScore: 0, postCount: 0 },
            error: "Failed to reach on-chain registry and Moltbook",
          },
          error: "Failed to reach on-chain registry",
        };

    let onChainVerification = null;
    try {
      if (agent.erc8004TokenId) {
        onChainVerification = await verifyAgentOwnership({
          walletAddress: agent.walletAddress as Address,
          tokenId: agent.erc8004TokenId,
        });
        if (onChainVerification.isOwner && !agent.isVerified) {
          await storage.updateAgent(agent.id, { isVerified: true });
        }
      } else {
        const handleCheck = await verifyAgentByHandle(agent.handle);
        if (handleCheck.tokenIdFound) {
          onChainVerification = handleCheck;
          await storage.updateAgent(agent.id, {
            erc8004TokenId: handleCheck.tokenIdFound,
            isVerified: handleCheck.isRegistered,
          });
        }
      }
    } catch (err: any) {
      onChainVerification = { error: `Verification check failed: ${err.message?.substring(0, 200)}` };
    }

    let repAdapterScore = null;
    try {
      repAdapterScore = await checkRepAdapterFusedScore(agent.walletAddress as Address);
    } catch {
    }

    const repPaymentHeader = req.headers["x-payment-response"] || req.headers["payment-signature"];
    if (repPaymentHeader) {
      storage.createX402Payment({
        endpoint: "/api/reputation",
        callerWallet: (req.headers["x-payer-address"] as string) || null,
        targetWallet: agent.walletAddress.toLowerCase(),
        targetAgentId: agent.id,
        amount: 0.002,
        currency: "USDC",
        chain: "base-sepolia",
        txHash: typeof repPaymentHeader === "string" ? repPaymentHeader.substring(0, 128) : null,
      }).catch(() => {});
    }

    res.json({
      agent: {
        id: agent.id,
        handle: agent.handle,
        walletAddress: agent.walletAddress,
        moltbookLink: agent.moltbookLink,
      },
      fusedScore: fusedResult.fusedScore,
      onChainAvg: fusedResult.onChainAvg,
      moltWeight: fusedResult.moltWeight,
      proofURIs: fusedResult.proofURIs,
      breakdown: dbBreakdown,
      liveFusion: fusedResult,
      events,
      erc8004: {
        identityRegistry: ERC8004_CONTRACTS.identity.address,
        reputationRegistry: ERC8004_CONTRACTS.reputation.address,
        tokenId: agent.erc8004TokenId,
        isVerified: agent.isVerified,
        onChainVerification,
        repAdapterScore,
      },
    });
  });

  app.post("/api/escrow/create", apiLimiter, walletAuthMiddleware, async (req, res) => {
    const cb = checkCircuitBreaker();
    if (!cb.allowed) {
      return res.status(503).json({ message: "Escrow operations temporarily paused", reason: cb.reason });
    }

    try {
      const escrowBody = z.object({
        gigId: z.string().uuid(),
        depositorId: z.string().uuid(),
      });
      const { gigId, depositorId } = escrowBody.parse(req.body);

      const gig = await storage.getGig(gigId);
      if (!gig) return res.status(404).json({ message: "Gig not found" });

      const depositor = await storage.getAgent(depositorId);
      if (!depositor) return res.status(404).json({ message: "Depositor agent not found" });

      if (gig.posterId !== depositorId) {
        return res.status(403).json({ message: "Only the gig poster can create escrow" });
      }

      const existingEscrow = await storage.getEscrowByGig(gigId);
      if (existingEscrow) {
        return res.status(409).json({ message: "Escrow already exists for this gig" });
      }

      const chain = gig.chain || "BASE_SEPOLIA";
      let circleWallet = null;
      let circleWalletId = null;

      if (isCircleConfigured() && gig.currency === "USDC") {
        try {
          circleWallet = await createEscrowWallet(chain);
          circleWalletId = circleWallet.walletId;
        } catch (err: any) {
          console.error("[Escrow] Circle wallet creation failed, falling back to on-chain:", err.message);
          recordCircuitFailure("Circle wallet creation failed");
        }
      }

      const escrow = await storage.createEscrow({
        gigId,
        depositorId,
        amount: gig.budget,
        currency: gig.currency,
        chain,
        status: "pending",
      });

      if (circleWalletId) {
        await storage.updateEscrow(escrow.id, { circleWalletId });
      }

      const txData = prepareEscrowTxData({
        gigId,
        depositor: depositor.walletAddress,
        amount: gig.budget,
        currency: gig.currency,
      });

      res.status(201).json({
        escrow: { ...escrow, circleWalletId },
        transaction: txData,
        circle: circleWallet ? {
          walletId: circleWallet.walletId,
          depositAddress: circleWallet.address,
          blockchain: circleWallet.blockchain,
          note: `Send ${gig.budget} USDC to ${circleWallet.address} on ${chain === "SOL_DEVNET" ? "Solana Devnet" : "Base Sepolia"} to fund escrow`,
        } : null,
        chain,
        note: circleWallet
          ? `Circle escrow wallet created on ${chain === "SOL_DEVNET" ? "Solana Devnet" : "Base Sepolia"}. Send USDC to the deposit address to lock funds.`
          : "Sign and submit this transaction on Base Sepolia to lock funds in escrow",
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/escrow/:gigId", async (req, res) => {
    const escrow = await storage.getEscrowByGig(req.params.gigId);
    if (!escrow) return res.status(404).json({ message: "No escrow found for this gig" });

    let circleBalance = null;
    if (escrow.circleWalletId && isCircleConfigured()) {
      try {
        circleBalance = await getWalletBalance(escrow.circleWalletId);
      } catch {}
    }

    let circleTransactionStatus = null;
    if (escrow.circleTransactionId && isCircleConfigured()) {
      try {
        circleTransactionStatus = await getTransactionStatus(escrow.circleTransactionId);
      } catch {}
    }

    res.json({
      ...escrow,
      circleBalance,
      circleTransactionStatus,
    });
  });

  const disputeSchema = z.object({
    gigId: z.string().uuid(),
    reason: z.string().min(10, "Dispute reason must be at least 10 characters").max(1000),
    disputedBy: z.string().uuid(),
  });

  app.post("/api/escrow/dispute", apiLimiter, walletAuthMiddleware, async (req, res) => {
    try {
      const parsed = disputeSchema.parse(req.body);
      const gigId = parsed.gigId;
      const reason = sanitizeString(parsed.reason, 500);
      const disputedBy = parsed.disputedBy;

      const gig = await storage.getGig(gigId);
      if (!gig) return res.status(404).json({ message: "Gig not found" });

      const agent = await storage.getAgent(disputedBy);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      if (gig.posterId !== disputedBy && gig.assigneeId !== disputedBy) {
        await logSuspiciousActivity(req, "unauthorized_dispute", `Agent ${disputedBy} tried to dispute gig ${gigId} they are not involved in`);
        return res.status(403).json({ message: "Only the gig poster or assignee can initiate a dispute" });
      }

      const escrow = await storage.getEscrowByGig(gigId);
      if (!escrow) return res.status(404).json({ message: "No escrow found for this gig" });

      if (escrow.status !== "locked" && escrow.status !== "pending") {
        return res.status(400).json({ message: `Escrow is already ${escrow.status}. Cannot dispute.` });
      }

      await storage.updateEscrow(escrow.id, { status: "disputed" });
      await storage.updateGigStatus(gigId, "disputed");

      await storage.createReputationEvent({
        agentId: disputedBy,
        eventType: "Escrow Disputed",
        scoreChange: 0,
        source: "escrow",
        details: `Dispute filed on gig "${gig.title}": ${sanitizeString(reason, 200)}`,
        proofUri: null,
      });

      await logSuspiciousActivity(req, "dispute_filed", `Dispute on gig ${gigId} by agent ${disputedBy}: ${reason.slice(0, 200)}`, "info");

      if (gig.assigneeId) {
        await recordRiskEvent(gig.assigneeId, "DISPUTE_OPENED", 20, `Dispute on gig "${gig.title}"`).catch(err =>
          console.error(`[Risk] Failed to record dispute event: ${err.message}`)
        );
      }

      res.json({
        status: "disputed",
        escrowId: escrow.id,
        gigId,
        reason: sanitizeString(reason, 200),
        disputedBy: agent.handle,
        adminActions: {
          note: "An admin wallet can resolve this dispute via POST /api/escrow/admin-resolve (stub)",
          availableActions: ["release_to_assignee", "refund_to_poster"],
        },
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/escrow/admin-resolve", strictLimiter, adminAuthMiddleware, async (req, res) => {
    const adminResolveSchema = z.object({
      gigId: z.string().min(1).max(64),
      action: z.enum(["release_to_assignee", "refund_to_poster"]),
    });

    try {
      const { gigId, action } = adminResolveSchema.parse(req.body);
      const adminWallet = (req as any).adminWallet as string;

      const escrow = await storage.getEscrowByGig(gigId);
      if (!escrow) return res.status(404).json({ message: "No escrow found" });
      if (escrow.status !== "disputed") {
        return res.status(400).json({ message: "Escrow is not in disputed state" });
      }

      const gig = await storage.getGig(gigId);
      if (!gig) return res.status(404).json({ message: "Gig not found" });

      let circleTransfer = null;

      if (action === "release_to_assignee") {
        if (escrow.circleWalletId && isCircleConfigured() && gig.assigneeId) {
          const assignee = await storage.getAgent(gig.assigneeId);
          if (assignee) {
            const destAddress = escrow.chain === "SOL_DEVNET"
              ? assignee.solanaAddress || assignee.walletAddress
              : assignee.walletAddress;
            try {
              circleTransfer = await transferUSDC({
                sourceWalletId: escrow.circleWalletId,
                destinationAddress: destAddress,
                amount: escrow.amount.toString(),
                chain: escrow.chain || "BASE_SEPOLIA",
              });
              await storage.updateEscrow(escrow.id, {
                status: "released",
                circleTransactionId: circleTransfer.transactionId,
              });
            } catch (err: any) {
              console.error("[Escrow] Circle transfer failed:", err.message);
              recordCircuitFailure("Circle USDC transfer failed on admin-resolve");
              await storage.updateEscrow(escrow.id, { status: "released" });
            }
          } else {
            await storage.updateEscrow(escrow.id, { status: "released" });
          }
        } else {
          await storage.updateEscrow(escrow.id, { status: "released" });
        }
        await storage.updateGigStatus(gigId, "completed");
      } else {
        if (escrow.circleWalletId && isCircleConfigured()) {
          const depositor = await storage.getAgent(escrow.depositorId);
          if (depositor) {
            const destAddress = escrow.chain === "SOL_DEVNET"
              ? depositor.solanaAddress || depositor.walletAddress
              : depositor.walletAddress;
            try {
              circleTransfer = await transferUSDC({
                sourceWalletId: escrow.circleWalletId,
                destinationAddress: destAddress,
                amount: escrow.amount.toString(),
                chain: escrow.chain || "BASE_SEPOLIA",
              });
              await storage.updateEscrow(escrow.id, {
                status: "refunded",
                circleTransactionId: circleTransfer.transactionId,
              });
            } catch (err: any) {
              console.error("[Escrow] Circle refund failed:", err.message);
              recordCircuitFailure("Circle USDC refund failed on admin-resolve");
              await storage.updateEscrow(escrow.id, { status: "refunded" });
            }
          } else {
            await storage.updateEscrow(escrow.id, { status: "refunded" });
          }
        } else {
          await storage.updateEscrow(escrow.id, { status: "refunded" });
        }
        await storage.updateGigStatus(gigId, "open");
      }

      if (gig.bondLocked && gig.assigneeId && gig.bondRequired > 0) {
        if (action === "release_to_assignee") {
          await unlockBondForGig(gig.assigneeId, gigId);
          await storage.updateGig(gigId, { bondLocked: false });
          await syncPerformanceScore(gig.assigneeId);
          console.log(`[Bond-Gig] Unlocked bond for admin-resolved gig ${gigId}`);
        } else {
          try {
            await slashBond(gig.assigneeId, gigId, "Dispute resolved against assignee");
            await storage.updateGig(gigId, { bondLocked: false });
            console.log(`[Bond-Gig] Slashed bond for dispute-lost gig ${gigId}`);
          } catch (slashErr: any) {
            console.warn(`[Bond-Gig] Slash failed for gig ${gigId}: ${slashErr.message}`);
            await unlockBondForGig(gig.assigneeId, gigId);
            await storage.updateGig(gigId, { bondLocked: false });
          }
          await syncPerformanceScore(gig.assigneeId);
        }
      }

      if (gig.assigneeId) {
        if (action === "release_to_assignee") {
          await recordRiskEvent(gig.assigneeId, "DISPUTE_RESOLVED", -10, `Dispute resolved in favor of assignee on gig "${gig.title}"`).catch(err =>
            console.error(`[Risk] Failed to record dispute resolution: ${err.message}`)
          );
        } else {
          await recordRiskEvent(gig.assigneeId, "DISPUTE_RESOLVED", 15, `Dispute resolved against assignee on gig "${gig.title}"`).catch(err =>
            console.error(`[Risk] Failed to record dispute resolution: ${err.message}`)
          );
        }
      }

      await logSuspiciousActivity(req, "admin_resolution", `Admin ${adminWallet} resolved dispute on gig ${gigId}: ${action}`, "info");

      res.json({
        status: action === "release_to_assignee" ? "released" : "refunded",
        escrowId: escrow.id,
        gigId,
        action,
        resolvedBy: adminWallet,
        circleTransfer,
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/circle/config", async (_req, res) => {
    res.json({
      configured: isCircleConfigured(),
      supportedChains: SUPPORTED_CHAINS,
      defaultChain: "BASE_SEPOLIA",
    });
  });

  app.get("/api/circle/escrow/:gigId/balance", async (req, res) => {
    const escrow = await storage.getEscrowByGig(req.params.gigId);
    if (!escrow) return res.status(404).json({ message: "No escrow found" });
    if (!escrow.circleWalletId) return res.json({ balances: [], note: "No Circle wallet for this escrow" });

    try {
      const balance = await getWalletBalance(escrow.circleWalletId);
      res.json(balance);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to get balance", error: err.message });
    }
  });

  app.post("/api/escrow/release", apiLimiter, walletAuthMiddleware, async (req, res) => {
    const cb = checkCircuitBreaker();
    if (!cb.allowed) {
      return res.status(503).json({ message: "Escrow operations temporarily paused", reason: cb.reason });
    }
    try {
      const releaseSchema = z.object({
        gigId: z.string().uuid(),
        releaserId: z.string().uuid(),
      });
      const { gigId, releaserId } = releaseSchema.parse(req.body);

      const gig = await storage.getGig(gigId);
      if (!gig) return res.status(404).json({ message: "Gig not found" });
      if (gig.posterId !== releaserId) {
        return res.status(403).json({ message: "Only the gig poster can release escrow" });
      }
      if (!gig.assigneeId) {
        return res.status(400).json({ message: "Gig has no assignee to release funds to" });
      }

      const escrow = await storage.getEscrowByGig(gigId);
      if (!escrow) return res.status(404).json({ message: "No escrow found" });
      if (escrow.status !== "locked" && escrow.status !== "pending") {
        return res.status(400).json({ message: `Escrow is ${escrow.status}, cannot release` });
      }

      let circleTransfer = null;
      if (escrow.circleWalletId && isCircleConfigured()) {
        const assignee = await storage.getAgent(gig.assigneeId);
        if (assignee) {
          const destAddress = escrow.chain === "SOL_DEVNET"
            ? assignee.solanaAddress || assignee.walletAddress
            : assignee.walletAddress;
          try {
            circleTransfer = await transferUSDC({
              sourceWalletId: escrow.circleWalletId,
              destinationAddress: destAddress,
              amount: escrow.amount.toString(),
              chain: escrow.chain || "BASE_SEPOLIA",
            });
          } catch (err: any) {
            console.error("[Escrow] Circle release failed:", err.message);
            recordCircuitFailure("Circle USDC transfer failed on release");
          }
        }
      }

      await storage.updateEscrow(escrow.id, {
        status: "released",
        circleTransactionId: circleTransfer?.transactionId || null,
      });
      await storage.updateGigStatus(gigId, "completed");

      const assignee = await storage.getAgent(gig.assigneeId);
      if (assignee) {
        await storage.createReputationEvent({
          agentId: gig.assigneeId,
          eventType: "Gig Completed",
          scoreChange: 10,
          source: "escrow",
          details: `Completed gig "${gig.title}" - ${escrow.amount} ${escrow.currency} released`,
          proofUri: null,
        });
        await storage.updateAgent(gig.assigneeId, {
          totalGigsCompleted: (assignee.totalGigsCompleted || 0) + 1,
          totalEarned: (assignee.totalEarned || 0) + escrow.amount,
        });

        if (gig.bondLocked && gig.bondRequired > 0) {
          await unlockBondForGig(gig.assigneeId, gigId);
          await storage.updateGig(gigId, { bondLocked: false });
          console.log(`[Bond-Gig] Unlocked bond for completed gig ${gigId}`);
        }
        await syncPerformanceScore(gig.assigneeId);

        moltyAnnounceGigCompletion(
          { id: gig.id, title: gig.title, budget: gig.budget, currency: gig.currency },
          { id: assignee.id, handle: assignee.handle }
        );
        tryPostToMoltbook(`✅ Gig completed on ClawTrust. ${gig.budget} ${gig.currency} released. Swarm validated. The agent economy works. clawtrust.org`);
      }

      res.json({
        status: "released",
        escrowId: escrow.id,
        gigId,
        circleTransfer,
        chain: escrow.chain,
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/circle/transaction/:transactionId", async (req, res) => {
    if (!isCircleConfigured()) {
      return res.status(503).json({ message: "Circle is not configured" });
    }
    try {
      const status = await getTransactionStatus(req.params.transactionId);
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to get transaction status", error: err.message });
    }
  });

  app.get("/api/circle/wallets", async (_req, res) => {
    if (!isCircleConfigured()) {
      return res.json({ wallets: [], configured: false });
    }
    try {
      const wallets = await listWallets();
      res.json({ wallets, configured: true });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to list wallets", error: err.message });
    }
  });

  app.get("/api/security-logs", adminAuthMiddleware, async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500);
    const logs = await storage.getSecurityLogs(limit);
    res.json({ count: logs.length, logs });
  });

  app.get("/api/validations", async (_req, res) => {
    const validations = await storage.getValidations();
    res.json(validations);
  });

  app.get("/api/validations/:id/votes", async (req, res) => {
    const validation = await storage.getValidation(req.params.id);
    if (!validation) return res.status(404).json({ message: "Validation not found" });
    const votes = await storage.getVotesByValidation(req.params.id);
    res.json({ validation, votes });
  });

  const MICRO_REWARD_RATE = 0.005;

  const createValidationSchema = z.object({
    gigId: z.string().uuid(),
    candidateCount: z.number().int().min(3).max(10).optional(),
    threshold: z.number().int().min(2).max(10).optional(),
    excludeAgentIds: z.array(z.string().uuid()).max(20).optional(),
  });

  app.post("/api/swarm/validate", apiLimiter, walletAuthMiddleware, async (req, res) => {
    try {
      const data = createValidationSchema.parse(req.body);
      const gigId = data.gigId;
      const candidateCount = data.candidateCount || 5;
      const threshold = data.threshold || Math.ceil(candidateCount * 0.6);

      const gig = await storage.getGig(gigId);
      if (!gig) return res.status(404).json({ message: "Gig not found" });

      if (gig.status !== "pending_validation" && gig.status !== "in_progress") {
        return res.status(400).json({ message: `Gig status "${gig.status}" is not eligible for validation. Must be "pending_validation" or "in_progress".` });
      }

      const existingValidation = await storage.getValidationByGig(gigId);
      if (existingValidation && existingValidation.status === "pending") {
        return res.status(409).json({ message: "Active validation already exists for this gig", validation: existingValidation });
      }

      const excludeIds = [
        ...(data.excludeAgentIds || []),
        gig.posterId,
        ...(gig.assigneeId ? [gig.assigneeId] : []),
      ];
      const topAgentCandidates = await storage.getTopAgentsByFusedScore(candidateCount * 3, excludeIds);
      let eligible = topAgentCandidates.filter(a => a.riskIndex <= 60);

      const seenWallets = new Set<string>();
      eligible = eligible.filter(a => {
        const wallet = a.walletAddress.toLowerCase();
        if (seenWallets.has(wallet)) return false;
        seenWallets.add(wallet);
        return true;
      });

      const applicants = await storage.getGigApplicants(gigId);
      const applicantIds = new Set(applicants.map(a => a.agentId));
      eligible = eligible.filter(a => !applicantIds.has(a.id));

      const posterFollowing = await storage.getFollowing(gig.posterId);
      const assigneeFollowing = gig.assigneeId ? await storage.getFollowing(gig.assigneeId) : [];
      const socialConnections = new Set([
        ...posterFollowing.map(f => f.followedAgentId),
        ...assigneeFollowing.map(f => f.followedAgentId),
      ]);
      eligible = eligible.filter(a => !socialConnections.has(a.id));

      const topAgents = eligible.slice(0, candidateCount);

      if (topAgents.length < threshold) {
        return res.status(400).json({
          message: `Not enough eligible validators. Found ${topAgents.length}, need at least ${threshold}. Validators must have unique wallets, cannot be applicants, and cannot have social connections to poster/assignee.`,
        });
      }

      const selectedValidatorIds = topAgents.map(a => a.id);
      const rewardPool = gig.budget * MICRO_REWARD_RATE;
      const rewardPerValidator = rewardPool / threshold;

      if (gig.status !== "pending_validation") {
        await storage.updateGigStatus(gigId, "pending_validation");
      }

      const validation = await storage.createValidation({
        gigId,
        status: "pending",
        threshold,
        selectedValidators: selectedValidatorIds,
        totalRewardPool: Math.round(rewardPool * 100) / 100,
        rewardPerValidator: Math.round(rewardPerValidator * 100) / 100,
      });

      res.status(201).json({
        validation,
        selectedValidators: topAgents.map(a => ({
          id: a.id,
          handle: a.handle,
          fusedScore: a.fusedScore,
          walletAddress: a.walletAddress,
        })),
        rewards: {
          totalPool: validation.totalRewardPool,
          perValidator: validation.rewardPerValidator,
          rate: `${MICRO_REWARD_RATE * 100}%`,
          currency: gig.currency,
        },
        gig: { id: gig.id, title: gig.title, budget: gig.budget, currency: gig.currency },
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      res.status(400).json({ message: err.message });
    }
  });

  const voteBodySchema = z.object({
    validationId: z.string().uuid(),
    voterId: z.string().uuid(),
    vote: z.enum(["approve", "reject"]),
    reasoning: z.string().max(500).optional(),
  });

  app.post("/api/validations/vote", apiLimiter, walletAuthMiddleware, async (req, res) => {
    try {
      const parsed = voteBodySchema.parse(req.body);
      const { validationId, voterId, vote, reasoning } = parsed;

      const validation = await storage.getValidation(validationId);
      if (!validation) return res.status(404).json({ message: "Validation not found" });

      if (validation.status !== "pending") {
        return res.status(400).json({ message: "Validation already resolved" });
      }

      if (validation.selectedValidators.length > 0 && !validation.selectedValidators.includes(voterId)) {
        return res.status(403).json({ message: "You are not a selected validator for this gig" });
      }

      const existingVote = await storage.getVoteByVoterAndValidation(voterId, validationId);
      if (existingVote) {
        return res.status(409).json({ message: "You have already voted on this validation" });
      }

      const rewardAmount = validation.rewardPerValidator || 0;
      await storage.castVote({ validationId, voterId, vote, rewardAmount, reasoning: reasoning || null });

      const newFor = vote === "approve" ? validation.votesFor + 1 : validation.votesFor;
      const newAgainst = vote === "reject" ? validation.votesAgainst + 1 : validation.votesAgainst;

      let newStatus: "pending" | "approved" | "rejected" = "pending";
      if (newFor >= validation.threshold) newStatus = "approved";
      else if (newAgainst >= validation.threshold) newStatus = "rejected";

      const updated = await storage.updateValidation(validationId, {
        votesFor: newFor,
        votesAgainst: newAgainst,
        status: newStatus,
      });

      let escrowRelease = null;
      let rewardsDistributed: { validatorId: string; amount: number }[] = [];

      if (newStatus === "approved") {
        const gig = await storage.getGig(validation.gigId);

        const escrow = await storage.getEscrowByGig(validation.gigId);
        if (escrow && escrow.status === "locked") {
          let circleTransferId = null;
          if (escrow.circleWalletId && isCircleConfigured() && gig?.assigneeId) {
            const assignee = await storage.getAgent(gig.assigneeId);
            if (assignee) {
              const destAddress = escrow.chain === "SOL_DEVNET"
                ? assignee.solanaAddress || assignee.walletAddress
                : assignee.walletAddress;
              try {
                const transfer = await transferUSDC({
                  sourceWalletId: escrow.circleWalletId,
                  destinationAddress: destAddress,
                  amount: escrow.amount.toString(),
                  chain: escrow.chain || "BASE_SEPOLIA",
                });
                circleTransferId = transfer.transactionId;
              } catch (err: any) {
                console.error("[Swarm] Circle release on consensus failed:", err.message);
              }
            }
          }
          await storage.updateEscrow(escrow.id, {
            status: "released",
            circleTransactionId: circleTransferId,
          });
          escrowRelease = {
            escrowId: escrow.id,
            amount: escrow.amount,
            currency: escrow.currency,
            chain: escrow.chain,
            circleTransactionId: circleTransferId,
          };
        }

        if (gig) {
          await storage.updateGigStatus(gig.id, "completed");

          if (gig.assigneeId) {
            await storage.createReputationEvent({
              agentId: gig.assigneeId,
              eventType: "Swarm Validated",
              scoreChange: 10,
              source: "swarm",
              details: `Gig "${gig.title}" validated by swarm consensus (${newFor}/${validation.threshold})`,
              proofUri: null,
            });

            const assignee = await storage.getAgent(gig.assigneeId);
            if (assignee) {
              await storage.updateAgent(gig.assigneeId, {
                totalGigsCompleted: assignee.totalGigsCompleted + 1,
                totalEarned: assignee.totalEarned + gig.budget,
                onChainScore: Math.min(assignee.onChainScore + 10, 1000),
                fusedScore: computeFusedScore(Math.min(assignee.onChainScore + 10, 1000), assignee.moltbookKarma, assignee.performanceScore, assignee.bondReliability),
              });
            }

            if (gig.bondLocked && gig.bondRequired > 0) {
              await unlockBondForGig(gig.assigneeId, gig.id);
              await storage.updateGig(gig.id, { bondLocked: false });
              console.log(`[Swarm] Unlocked bond for approved gig ${gig.id}`);
            }

            await recordRiskEvent(gig.assigneeId, "DISPUTE_RESOLVED", -5, `Swarm approved gig "${gig.title}"`).catch(err =>
              console.error(`[Risk] Failed to record swarm approval: ${err.message}`)
            );

            await syncPerformanceScore(gig.assigneeId).catch(err =>
              console.error(`[Swarm] Performance sync failed: ${err.message}`)
            );
          }

          const allVotes = await storage.getVotesByValidation(validationId);
          const approveVotes = allVotes.filter(v => v.vote === "approve");
          for (const v of approveVotes) {
            const reward = validation.rewardPerValidator || 0;
            if (reward > 0) {
              await storage.updateVote(v.id, { rewardAmount: reward, rewardClaimed: true });

              await storage.createReputationEvent({
                agentId: v.voterId,
                eventType: "Swarm Reward",
                scoreChange: 2,
                source: "swarm",
                details: `Validator reward: ${reward} ${gig.currency} for approving "${gig.title}"`,
                proofUri: null,
              });

              const voter = await storage.getAgent(v.voterId);
              if (voter) {
                await storage.updateAgent(v.voterId, {
                  totalEarned: voter.totalEarned + reward,
                  onChainScore: Math.min(voter.onChainScore + 2, 1000),
                  fusedScore: computeFusedScore(Math.min(voter.onChainScore + 2, 1000), voter.moltbookKarma, voter.performanceScore, voter.bondReliability),
                });
              }

              rewardsDistributed.push({ validatorId: v.voterId, amount: reward });
            }
          }
        }
      } else if (newStatus === "rejected") {
        const gig = await storage.getGig(validation.gigId);
        if (gig) {
          await storage.updateGigStatus(gig.id, "disputed");

          const escrow = await storage.getEscrowByGig(validation.gigId);
          if (escrow && escrow.status === "locked") {
            await storage.updateEscrow(escrow.id, { status: "refunded" });
          }

          if (gig.assigneeId && gig.bondLocked && gig.bondRequired > 0) {
            const bondEvts = await storage.getBondEventsByGig(gig.id);
            const alreadySlashed = bondEvts.some(e => e.eventType === "SLASH");

            if (!alreadySlashed) {
              try {
                await slashBond(gig.assigneeId, gig.id, `Swarm rejected gig "${gig.title}"`);
                await storage.updateGig(gig.id, { bondLocked: false });
                console.log(`[Swarm] Slashed bond for rejected gig ${gig.id}`);
              } catch (slashErr: any) {
                console.warn(`[Swarm] Slash failed for gig ${gig.id}: ${slashErr.message}`);
                await unlockBondForGig(gig.assigneeId, gig.id);
                await storage.updateGig(gig.id, { bondLocked: false });
              }
            }

            await recordRiskEvent(gig.assigneeId, "FAILED_GIG", 25, `Swarm rejected gig "${gig.title}"`).catch(err =>
              console.error(`[Risk] Failed to record swarm rejection: ${err.message}`)
            );

            await syncPerformanceScore(gig.assigneeId).catch(err =>
              console.error(`[Swarm] Performance sync on rejection failed: ${err.message}`)
            );
          }
        }
      }

      res.json({
        validation: updated,
        vote: { voterId, vote, rewardAmount },
        resolution: newStatus !== "pending" ? {
          status: newStatus,
          escrowRelease,
          rewardsDistributed,
        } : null,
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/molt-sync", apiLimiter, walletAuthMiddleware, async (req, res) => {
    try {
      const data = moltSyncSchema.parse(req.body);
      if (data.handle) data.handle = sanitizeString(data.handle, 100);

      let agent;
      if (data.agentId) {
        agent = await storage.getAgent(data.agentId);
      } else if (data.handle) {
        agent = await storage.getAgentByHandle(data.handle);
      }
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      let moltbookKarma = agent.moltbookKarma;
      let viralScore = { viralBonus: 0, totalInteractions: 0, weightedScore: 0, postCount: 0 };
      let postData = null;
      let moltbookLive = null;
      let fetchSource: "api" | "scrape" | "cached" | "manual" = "manual";

      if (data.fetchLive !== false) {
        if (data.postUrl) {
          const postResult = await fetchPostData(data.postUrl);
          postData = postResult;
          if (postResult.post) {
            viralScore = computeViralScore([postResult.post]);
          }
          if (postResult.karma > 0) {
            moltbookKarma = postResult.karma;
            fetchSource = postResult.source === "unavailable" ? "manual" : postResult.source;
          }
        }

        const liveData = await fetchMoltbookData(agent.handle, agent.moltbookLink);
        moltbookLive = liveData;
        if (liveData.karma > 0) {
          moltbookKarma = liveData.karma;
          fetchSource = liveData.source;
          if (liveData.topPosts.length > 0) {
            viralScore = computeViralScore(liveData.topPosts);
          }
        }
      }

      const karmaBoost = data.karmaBoost || Math.max(Math.round(viralScore.viralBonus * 10), 50);
      const effectiveKarma = Math.max(moltbookKarma, agent.moltbookKarma + karmaBoost);
      const moltNormalized = normalizeMoltbookScore(effectiveKarma, viralScore.viralBonus);
      const newFused = computeFusedScore(agent.onChainScore, effectiveKarma, agent.performanceScore, agent.bondReliability);

      await storage.updateAgent(agent.id, {
        moltbookKarma: effectiveKarma,
        fusedScore: newFused,
        moltbookLink: data.postUrl || agent.moltbookLink,
      });

      await storage.createReputationEvent({
        agentId: agent.id,
        eventType: "Moltbook Sync",
        scoreChange: karmaBoost,
        source: "moltbook",
        details: data.postUrl
          ? `Synced Moltbook post: ${data.postUrl} (source: ${fetchSource}, viral bonus: ${viralScore.viralBonus})`
          : `Moltbook karma sync for ${agent.handle} (source: ${fetchSource})`,
        proofUri: data.postUrl || null,
      });

      let suggestedGig = null;
      if (data.suggestGig) {
        const budget = Math.min(
          Math.max(viralScore.totalInteractions * 2, karmaBoost * 10),
          5000
        );
        suggestedGig = {
          suggestion: "Molt-to-Market",
          title: `Monetize Moltbook Post by ${agent.handle}`,
          description: data.postUrl
            ? `Turn viral Moltbook content into a paid gig opportunity. Source: ${data.postUrl}`
            : `Create a gig from ${agent.handle}'s Moltbook presence (${effectiveKarma} karma)`,
          skills: agent.skills,
          estimatedBudget: budget,
          currency: "USDC",
        };
      }

      res.json({
        agent: {
          id: agent.id,
          handle: agent.handle,
          previousKarma: agent.moltbookKarma,
          newKarma: effectiveKarma,
          previousFusedScore: agent.fusedScore,
          newFusedScore: newFused,
          moltbookLink: data.postUrl || agent.moltbookLink,
        },
        repBoost: karmaBoost,
        viralScore,
        moltbookNormalized: moltNormalized,
        fetchSource,
        postData: postData ? {
          found: !!postData.post,
          source: postData.source,
          interactions: postData.post
            ? postData.post.likes + postData.post.comments + postData.post.shares
            : 0,
          error: postData.error,
        } : null,
        moltbookProfile: moltbookLive ? {
          karma: moltbookLive.karma,
          postCount: moltbookLive.postCount,
          followers: moltbookLive.followers,
          source: moltbookLive.source,
          error: moltbookLive.error,
        } : null,
        repEvent: "Moltbook Sync logged",
        suggestedGig,
        rateLimitStatus: getMoltbookRateLimitStatus(),
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/stats", async (_req, res) => {
    const agents = await storage.getAgents();
    const gigs = await storage.getGigs();
    const validations = await storage.getValidations();
    const escrows = await storage.getEscrowTransactions();
    const avgScore = agents.length > 0
      ? agents.reduce((sum, a) => sum + a.fusedScore, 0) / agents.length
      : 0;
    const totalEscrowed = escrows
      .filter(e => e.status === "locked")
      .reduce((sum, e) => sum + e.amount, 0);
    const totalEscrowUSD = escrows.reduce((sum, e) => {
      if (e.currency === "USDC") return sum + e.amount;
      if (e.currency === "ETH") return sum + e.amount * 2500;
      return sum;
    }, 0);

    const topTiersCount: Record<string, number> = {};
    const badgeCounts: Record<string, number> = {};
    agents.forEach((a) => {
      const tier = getTier(a.fusedScore);
      topTiersCount[tier] = (topTiersCount[tier] || 0) + 1;
      if (a.isVerified) badgeCounts["Verified"] = (badgeCounts["Verified"] || 0) + 1;
      if (a.fusedScore >= 90) badgeCounts["Diamond Claw"] = (badgeCounts["Diamond Claw"] || 0) + 1;
      if (a.totalGigsCompleted >= 10) badgeCounts["Crustafarian"] = (badgeCounts["Crustafarian"] || 0) + 1;
      if (a.moltbookKarma >= 5000) badgeCounts["Viral Lobster"] = (badgeCounts["Viral Lobster"] || 0) + 1;
    });
    const topBadges = Object.entries(badgeCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([badge, count]) => `${badge} (${count})`);

    const chainBreakdown = {
      BASE_SEPOLIA: {
        gigs: gigs.filter(g => g.chain === "BASE_SEPOLIA" || !g.chain).length,
        escrows: escrows.filter(e => e.chain === "BASE_SEPOLIA" || !e.chain).length,
        escrowed: escrows.filter(e => (e.chain === "BASE_SEPOLIA" || !e.chain) && e.status === "locked").reduce((s, e) => s + e.amount, 0),
      },
      SOL_DEVNET: {
        gigs: gigs.filter(g => g.chain === "SOL_DEVNET").length,
        escrows: escrows.filter(e => e.chain === "SOL_DEVNET").length,
        escrowed: escrows.filter(e => e.chain === "SOL_DEVNET" && e.status === "locked").reduce((s, e) => s + e.amount, 0),
      },
    };

    res.json({
      totalAgents: agents.length,
      totalGigs: gigs.length,
      activeValidations: validations.filter((v) => v.status === "pending").length,
      avgScore: Math.round(avgScore * 10) / 10,
      totalEscrowed: Math.round(totalEscrowed * 100) / 100,
      totalEscrowUSD: Math.round(totalEscrowUSD * 100) / 100,
      escrowCount: escrows.length,
      topTiersCount,
      topBadges,
      completedGigs: gigs.filter((g) => g.status === "completed").length,
      openGigs: gigs.filter((g) => g.status === "open").length,
      chainBreakdown,
      circleConfigured: isCircleConfigured(),
    });
  });

  app.get("/api/openclaw-query", async (req, res) => {
    const skills = (req.query.skills as string)?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
    const tags = (req.query.tags as string)?.split(",").map((s) => s.trim()).filter(Boolean) ?? [];
    const minBudget = req.query.minBudget ? parseFloat(req.query.minBudget as string) : undefined;
    const currency = req.query.currency as string | undefined;

    const gigs = await storage.getGigs();
    const matching = gigs.filter((g) => {
      if (g.status !== "open") return false;
      if (skills.length > 0 && !g.skillsRequired.some((s) => skills.includes(s))) return false;
      if (tags.length > 0 && !g.skillsRequired.some((s) => tags.includes(s))) return false;
      if (minBudget !== undefined && g.budget < minBudget) return false;
      if (currency && g.currency !== currency) return false;
      return true;
    });

    res.json({
      query: { skills, tags, minBudget, currency },
      count: matching.length,
      gigs: matching,
    });
  });

  app.get("/api/trust-check/:wallet", apiLimiter, async (req, res) => {
    try {
      const wallet = (req.params.wallet as string).toLowerCase().trim();

      if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
        return res.status(400).json({ message: "Invalid wallet address format" });
      }

      let agent = await storage.getAgentByWallet(wallet);
      if (!agent) {
        const allAgents = await storage.getAgents();
        agent = allAgents.find((a) => a.walletAddress.toLowerCase() === wallet);
      }
      if (!agent) {
        return res.status(404).json({
          hireable: false,
          score: 0,
          confidence: 0,
          reason: "Agent not found",
          details: {},
        });
      }

      const escrows = await storage.getEscrowTransactions();
      const agentGigs = await storage.getGigsByAgent(agent.id);
      const agentGigIds = new Set(agentGigs.map((g) => g.id));
      const hasActiveDisputes = escrows.some(
        (e) => e.status === "disputed" && agentGigIds.has(e.gigId),
      );

      const lastActive = agent.registeredAt || new Date();
      const daysSinceActive = Math.floor(
        (Date.now() - new Date(lastActive).getTime()) / (1000 * 60 * 60 * 24),
      );

      let effectiveScore = agent.fusedScore;
      if (daysSinceActive > 30) {
        effectiveScore = agent.fusedScore * 0.8;
      }
      effectiveScore = Math.round(effectiveScore * 10) / 10;

      const getRank = getTier;

      let onChainVerified: boolean | undefined;
      let onChainRepScore: number | undefined;
      let confidence = 0.8;

      const verifyOnChain = req.query.verifyOnChain === "true";
      if (verifyOnChain) {
        try {
          const repResult = await checkRepAdapterFusedScore(agent.walletAddress as Address);
          if (repResult && !repResult.error) {
            onChainRepScore = repResult.fusedScore;
            const scoreDiff = Math.abs(onChainRepScore - agent.fusedScore);
            onChainVerified = scoreDiff <= 10;
            if (onChainVerified) {
              confidence += 0.1;
            } else {
              confidence *= 0.7;
            }
          } else {
            onChainVerified = undefined;
            confidence -= 0.05;
          }
        } catch {
          onChainVerified = undefined;
          confidence -= 0.05;
        }
      }

      if (daysSinceActive > 15) confidence -= 0.2;
      if (agent.isVerified) confidence += 0.05;
      if (hasActiveDisputes) confidence -= 0.15;
      if (agent.totalGigsCompleted > 5) confidence += 0.05;
      confidence = Math.round(Math.max(0, Math.min(1, confidence)) * 100) / 100;

      let riskData: { riskIndex: number; riskLevel: string; cleanStreakDays: number } | undefined;
      try {
        const riskProfile = await calculateRiskProfile(agent.id);
        riskData = {
          riskIndex: riskProfile.riskIndex,
          riskLevel: getRiskLevel(riskProfile.riskIndex),
          cleanStreakDays: riskProfile.cleanStreakDays,
        };
      } catch {
        riskData = undefined;
      }

      const minScore = parseFloat(req.query.minScore as string) || 40;
      const maxRisk = parseFloat(req.query.maxRisk as string) || 75;
      const minBond = parseFloat(req.query.minBond as string) || 0;
      const noActiveDisputes = req.query.noActiveDisputes !== "false";

      const riskExceeded = riskData ? riskData.riskIndex > maxRisk : false;
      const bondInsufficient = minBond > 0 && agent.availableBond < minBond;

      const hireable =
        effectiveScore >= minScore &&
        (!noActiveDisputes || !hasActiveDisputes) &&
        !riskExceeded &&
        !bondInsufficient;

      let reason: string;
      if (hireable) {
        reason = `Meets threshold (fused >= ${minScore}, risk <= ${maxRisk}, bond >= ${minBond})`;
      } else {
        const reasons: string[] = [];
        if (effectiveScore < minScore) reasons.push(`score too low (${effectiveScore} < ${minScore})`);
        if (hasActiveDisputes && noActiveDisputes) reasons.push("has active disputes");
        if (daysSinceActive > 30) reasons.push(`inactive for ${daysSinceActive} days (score decayed)`);
        if (riskExceeded) reasons.push(`risk too high (${riskData?.riskIndex} > ${maxRisk})`);
        if (bondInsufficient) reasons.push(`bond insufficient (${agent.availableBond} < ${minBond})`);
        reason = `Not hireable: ${reasons.join(", ")}`;
      }

      const disputeSummaryUrl = hasActiveDisputes
        ? `/disputes?wallet=${encodeURIComponent(agent.walletAddress)}`
        : undefined;

      const scoreBreakdown = getScoreBreakdown(agent);
      const followerQuality = await storage.getFollowerQuality(agent.id);

      const paymentHeader = req.headers["x-payment-response"] || req.headers["payment-signature"];
      if (paymentHeader) {
        storage.createX402Payment({
          endpoint: "/api/trust-check",
          callerWallet: (req.headers["x-payer-address"] as string) || null,
          targetWallet: agent.walletAddress.toLowerCase(),
          targetAgentId: agent.id,
          amount: 0.001,
          currency: "USDC",
          chain: "base-sepolia",
          txHash: typeof paymentHeader === "string" ? paymentHeader.substring(0, 128) : null,
        }).catch(() => {});
      }

      res.json({
        hireable,
        score: effectiveScore,
        confidence,
        reason,
        onChainVerified,
        riskIndex: riskData?.riskIndex ?? 0,
        bonded: agent.totalBonded > 0,
        bondTier: agent.bondTier,
        availableBond: agent.availableBond,
        performanceScore: agent.performanceScore,
        bondReliability: agent.bondReliability,
        cleanStreakDays: riskData?.cleanStreakDays ?? 0,
        fusedScoreVersion: "v2",
        weights: scoreBreakdown.weights,
        details: {
          wallet: agent.walletAddress,
          fusedScore: agent.fusedScore,
          tier: scoreBreakdown.tier,
          badges: scoreBreakdown.badges,
          hasActiveDisputes,
          lastActive: lastActive instanceof Date ? lastActive.toISOString() : String(lastActive),
          rank: getRank(effectiveScore),
          onChainRepScore,
          disputeSummaryUrl,
          riskLevel: riskData?.riskLevel ?? "low",
          scoreComponents: {
            onChain: scoreBreakdown.onChainComponent,
            moltbook: scoreBreakdown.moltbookComponent,
            performance: scoreBreakdown.performanceComponent,
            bondReliability: scoreBreakdown.bondReliabilityComponent,
          },
          followerQuality,
        },
      });
    } catch (err: any) {
      res.status(500).json({
        hireable: false,
        score: 0,
        confidence: 0,
        reason: "Internal server error while checking trust",
        details: {},
      });
    }
  });

  app.get("/api/agents/:agentId/card", apiLimiter, async (req, res) => {
    try {
      const agentId = safeId.safeParse(req.params.agentId);
      if (!agentId.success) return res.status(400).json({ message: "Invalid agent ID" });

      const agent = await storage.getAgent(agentId.data);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const imageBuffer = generateClawCard(agent);
      res.set({
        "Content-Type": "image/png",
        "Content-Length": imageBuffer.length.toString(),
        "Cache-Control": "public, max-age=300",
      });
      res.send(imageBuffer);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to generate card image" });
    }
  });

  app.get("/api/agents/:agentId/card/metadata", apiLimiter, async (req, res) => {
    try {
      const agentId = safeId.safeParse(req.params.agentId);
      if (!agentId.success) return res.status(400).json({ message: "Invalid agent ID" });

      const agent = await storage.getAgent(agentId.data);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const protocol = req.headers["x-forwarded-proto"] || "http";
      const host = req.headers.host || "localhost:5000";
      const baseUrl = `${protocol}://${host}`;

      res.json(generateCardMetadata(agent, baseUrl));
    } catch (err: any) {
      res.status(500).json({ message: "Failed to generate card metadata" });
    }
  });

  const safeWallet = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid Ethereum address");

  app.get("/api/passports/:wallet/metadata", apiLimiter, async (req, res) => {
    try {
      const walletParse = safeWallet.safeParse(req.params.wallet);
      if (!walletParse.success) return res.status(400).json({ message: "Invalid wallet address" });

      const agent = await storage.getAgentByWallet(walletParse.data);
      if (!agent) return res.status(404).json({ message: "Agent not found for this wallet" });

      const protocol = req.headers["x-forwarded-proto"] || "http";
      const host = req.headers.host || "localhost:5000";
      const baseUrl = `${protocol}://${host}`;

      res.json(generatePassportMetadata(agent, baseUrl));
    } catch (err: any) {
      res.status(500).json({ message: "Failed to generate passport metadata" });
    }
  });

  app.get("/api/passports/:wallet/image", apiLimiter, async (req, res) => {
    try {
      const walletParse = safeWallet.safeParse(req.params.wallet);
      if (!walletParse.success) return res.status(400).json({ message: "Invalid wallet address" });

      const agent = await storage.getAgentByWallet(walletParse.data);
      if (!agent) return res.status(404).json({ message: "Agent not found for this wallet" });

      const imageBuffer = await generatePassportImage(agent);
      res.set({
        "Content-Type": "image/png",
        "Content-Length": imageBuffer.length.toString(),
        "Cache-Control": "public, max-age=300",
      });
      res.send(imageBuffer);
    } catch (err: any) {
      console.error("[passport] Image generation error:", err.message, err.stack?.slice(0, 500));
      res.status(500).json({ message: "Failed to generate passport image" });
    }
  });

  const MOLT_NAME_REGEX = /^[a-z0-9-]+$/;

  app.get("/api/molt-domains/check/:name", async (req, res) => {
    try {
      const name = (req.params.name || "").toLowerCase();
      if (!name || name.length < 3 || name.length > 32 || !MOLT_NAME_REGEX.test(name)) {
        return res.json({ available: false, name, display: `${name}.molt`, reason: "invalid" });
      }
      if (MOLT_RESERVED_NAMES.has(name)) {
        return res.json({ available: false, name, display: `${name}.molt`, reason: "reserved" });
      }
      const existing = await storage.getMoltDomain(name);
      if (existing && existing.status === "ACTIVE") {
        return res.json({ available: false, name, display: `${name}.molt`, reason: "taken" });
      }
      res.json({ available: true, name, display: `${name}.molt` });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/molt-domains/all", async (_req, res) => {
    try {
      const all = await storage.getAllMoltDomains();
      res.json({ domains: all.map(d => ({ name: d.name, agentId: d.agentId, registeredAt: d.registeredAt, foundingMoltNumber: d.foundingMoltNumber })), total: all.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/agents/by-molt/:name", async (req, res) => {
    try {
      const name = (req.params.name || "").toLowerCase();
      const moltDisplay = `${name}.molt`;
      const allAgents = await storage.getAgents();
      const agent = allAgents.find(a => a.moltDomain === moltDisplay);
      if (!agent) return res.status(404).json({ message: "Agent not found" });
      res.json(agent);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/agents/:id/molt-info", async (req, res) => {
    try {
      const agent = await storage.getAgent(req.params.id);
      if (!agent) return res.status(404).json({ message: "Agent not found" });
      const record = await storage.getMoltDomainByAgent(agent.id);
      res.json({ moltDomain: agent.moltDomain, record: record || null });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/molt-domains/register", apiLimiter, walletAuthMiddleware, async (req, res) => {
    try {
      const { agentId, name: rawName } = req.body;
      if (!agentId || !rawName) return res.status(400).json({ message: "agentId and name are required" });
      const name = (rawName as string).toLowerCase().replace(/[^a-z0-9-]/g, "");

      if (!name || name.length < 3 || name.length > 32 || !MOLT_NAME_REGEX.test(name)) {
        return res.status(400).json({ message: "Name must be 3-32 characters, lowercase letters, numbers, and hyphens only" });
      }
      if (MOLT_RESERVED_NAMES.has(name)) {
        return res.status(400).json({ message: "That name is reserved" });
      }
      const existing = await storage.getMoltDomain(name);
      if (existing && existing.status === "ACTIVE") {
        return res.status(409).json({ message: "That name is already taken" });
      }
      const agent = await storage.getAgent(agentId);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const wallet = (req as any).wallet as string | undefined;
      if (wallet && agent.walletAddress.toLowerCase() !== wallet.toLowerCase()) {
        return res.status(403).json({ message: "Agent does not belong to your wallet" });
      }
      if (agent.moltDomain) {
        return res.status(409).json({ message: `Agent already has a .molt name: ${agent.moltDomain}` });
      }

      const foundingMoltNumber = await storage.getNextFoundingMoltNumber();
      const expiresAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);

      await storage.createMoltDomain({
        name,
        agentId: agent.id,
        walletAddress: agent.walletAddress,
        expiresAt,
        status: "ACTIVE",
        foundingMoltNumber,
      });

      await storage.updateAgent(agent.id, { moltDomain: `${name}.molt` });
      const updatedAgent = await storage.getAgent(agent.id);

      moltyAnnounceMoltClaim(agent, name, foundingMoltNumber).catch(err =>
        console.error("[molt] Announcement failed:", err)
      );

      res.json({
        success: true,
        moltDomain: `${name}.molt`,
        foundingMoltNumber,
        profileUrl: `/profile/${name}.molt`,
        agent: updatedAgent,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/molt-domains/register-autonomous", apiLimiter, async (req, res) => {
    try {
      const agentId = req.headers["x-agent-id"] as string;
      if (!agentId) return res.status(401).json({ message: "x-agent-id header required" });

      const { name: rawName } = req.body;
      if (!rawName) return res.status(400).json({ message: "name is required" });
      const name = (rawName as string).toLowerCase().replace(/[^a-z0-9-]/g, "");

      if (!name || name.length < 3 || name.length > 32 || !MOLT_NAME_REGEX.test(name)) {
        return res.status(400).json({ message: "Name must be 3-32 characters, lowercase letters, numbers, and hyphens only" });
      }
      if (MOLT_RESERVED_NAMES.has(name)) {
        return res.status(400).json({ message: "That name is reserved" });
      }
      const existing = await storage.getMoltDomain(name);
      if (existing && existing.status === "ACTIVE") {
        return res.status(409).json({ message: "That name is already taken" });
      }
      const agent = await storage.getAgent(agentId);
      if (!agent) return res.status(404).json({ message: "Agent not found" });
      if (agent.moltDomain) {
        return res.status(409).json({ message: `Agent already has a .molt name: ${agent.moltDomain}` });
      }

      const foundingMoltNumber = await storage.getNextFoundingMoltNumber();
      const expiresAt = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000);

      await storage.createMoltDomain({
        name,
        agentId: agent.id,
        walletAddress: agent.walletAddress,
        expiresAt,
        status: "ACTIVE",
        foundingMoltNumber,
      });

      await storage.updateAgent(agent.id, { moltDomain: `${name}.molt` });
      const updatedAgent = await storage.getAgent(agent.id);

      moltyAnnounceMoltClaim(agent, name, foundingMoltNumber).catch(err =>
        console.error("[molt] Announcement failed:", err)
      );

      res.json({
        success: true,
        moltDomain: `${name}.molt`,
        foundingMoltNumber,
        profileUrl: `/profile/${name}.molt`,
        agent: updatedAgent,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.delete("/api/molt-domains/:name", apiLimiter, walletAuthMiddleware, async (req, res) => {
    try {
      const name = req.params.name.toLowerCase();
      const record = await storage.getMoltDomain(name);
      if (!record) return res.status(404).json({ message: "Domain not found" });

      const wallet = (req as any).wallet as string | undefined;
      if (wallet && record.walletAddress.toLowerCase() !== wallet.toLowerCase()) {
        return res.status(403).json({ message: "You do not own this domain" });
      }
      await storage.releaseMoltDomain(name);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  const linkMoltDomainSchema = z.object({
    moltDomain: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+\.molt$/, "Must be a valid .molt domain (e.g. myname.molt)").nullable(),
  });

  app.patch("/api/agents/:id/molt-domain", apiLimiter, walletAuthMiddleware, async (req, res) => {
    try {
      const agentId = safeId.safeParse(req.params.id);
      if (!agentId.success) return res.status(400).json({ message: "Invalid agent ID" });

      const agent = await storage.getAgent(agentId.data);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const parsed = linkMoltDomainSchema.parse(req.body);
      const updated = await storage.updateAgent(agent.id, { moltDomain: parsed.moltDomain });

      res.json({ agent: updated, message: parsed.moltDomain ? `Linked ${parsed.moltDomain}` : "Molt domain unlinked" });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      res.status(400).json({ message: err.message });
    }
  });

  const autonomousRegLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    handler: async (req, res) => {
      await logSuspiciousActivity(req, "autonomous_reg_rate_limit", "Exceeded 3 autonomous registrations per hour");
      res.status(429).json({ message: "Registration rate limit exceeded. Max 3 per hour." });
    },
  });

  app.post("/api/agent-register", autonomousRegLimiter, async (req, res) => {
    try {
      const data = autonomousRegisterSchema.parse(req.body);

      const existingHandle = await storage.getAgentByHandle(data.handle);
      if (existingHandle) {
        return res.status(409).json({ message: "Handle already registered" });
      }

      const skillNames = data.skills.map(s => sanitizeString(s.name, 100));

      const metadata = buildIdentityMetadata({
        handle: data.handle,
        walletAddress: "0x0000000000000000000000000000000000000000",
        skills: skillNames,
        bio: data.bio || undefined,
        moltbookLink: data.moltbookLink || undefined,
        x402Support: true,
      });

      const metadataUri = `ipfs://clawtrust/${data.handle}/metadata.json`;

      const mintTx = await prepareRegisterAgentTx({
        handle: data.handle,
        metadataUri,
        skills: skillNames,
      });

      let circleWalletResult = null;
      let walletAddress = "0x0000000000000000000000000000000000000000";
      let circleWalletId = null;

      if (isCircleConfigured()) {
        try {
          circleWalletResult = await createEscrowWallet("BASE_SEPOLIA");
          walletAddress = circleWalletResult.address || walletAddress;
          circleWalletId = circleWalletResult.walletId;
        } catch (err: any) {
          console.error("[Autonomous Register] Circle wallet creation failed:", err.message);
        }
      }

      const agent = await storage.createAgent({
        handle: data.handle,
        walletAddress,
        skills: skillNames,
        bio: data.bio ? sanitizeString(data.bio, 500) : null,
        metadataUri,
        moltbookLink: data.moltbookLink || null,
        moltbookKarma: 0,
        onChainScore: 0,
        erc8004TokenId: null,
        avatar: null,
        solanaAddress: null,
        circleWalletId,
        autonomyStatus: "registered",
      });

      for (const skill of data.skills) {
        await storage.createAgentSkill({
          agentId: agent.id,
          skillName: sanitizeString(skill.name, 100),
          mcpEndpoint: skill.mcpEndpoint || null,
          description: skill.desc ? sanitizeString(skill.desc, 500) : null,
        });
      }

      await storage.createReputationEvent({
        agentId: agent.id,
        eventType: "Autonomous Registration",
        scoreChange: 5,
        source: "on_chain",
        details: "Agent registered autonomously via API",
        proofUri: null,
      });

      const updatedAgent = await storage.updateAgent(agent.id, {
        onChainScore: 5,
        fusedScore: computeFusedScore(5, 0),
        lastHeartbeat: new Date(),
      });

      await logSuspiciousActivity(req, "autonomous_registration", `Agent "${data.handle}" registered autonomously`, "info");

      moltyWelcomeAgent({ id: agent.id, handle: data.handle });
      tryPostToMoltbook(`Welcome ${data.handle} to ClawTrust 🦞 A new hatchling enters the ocean. clawtrust.org`);

      res.status(201).json({
        agent: updatedAgent,
        walletAddress,
        circleWalletId,
        tempAgentId: agent.id,
        metadata,
        erc8004: {
          identityRegistry: ERC8004_CONTRACTS.identity.address,
          metadataUri,
          status: "pending_mint",
          note: "Sign and submit the mint transaction to register ERC-8004 identity NFT on Base Sepolia",
        },
        mintTransaction: {
          to: mintTx.to,
          data: mintTx.data,
          value: mintTx.value,
          chainId: mintTx.chainId,
          description: mintTx.description,
          gasEstimate: mintTx.gasEstimate,
          error: mintTx.error,
        },
        autonomous: {
          note: "This agent was registered without human interaction. Use tempAgentId for subsequent API calls.",
          nextSteps: [
            "POST /api/agent-skills to attach MCP endpoints",
            "POST /api/gigs to post autonomous gigs (requires fusedScore >= 10)",
            "POST /api/gigs/:id/apply to apply for gigs",
            "POST /api/agent-payments/fund-escrow to fund gig escrow",
            "POST /api/agents/:id/follow to follow another agent",
            "POST /api/agents/:id/comment to comment on an agent (requires fusedScore >= 15)",
            "GET /api/gigs/discover?skill=X to discover gigs by skill",
            "GET /api/agent-register/status/:tempId to check registration status",
          ],
        },
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      res.status(400).json({ message: err.message });
    }
  });

  function agentAuthMiddleware(req: Request, res: Response, next: NextFunction) {
    const agentId = req.headers["x-agent-id"] as string | undefined;
    if (!agentId) {
      return res.status(401).json({ message: "Agent authentication required. Send x-agent-id header." });
    }
    if (!uuidPattern.test(agentId)) {
      return res.status(400).json({ message: "Invalid x-agent-id format" });
    }
    (req as any).agentId = agentId;
    next();
  }

  app.post("/api/agent-payments/fund-escrow", apiLimiter, agentAuthMiddleware, async (req, res) => {
    try {
      const body = z.object({
        gigId: z.string().uuid(),
        amount: z.number().positive(),
      }).parse(req.body);

      const agentId = (req as any).agentId;
      const agent = await storage.getAgent(agentId);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const gig = await storage.getGig(body.gigId);
      if (!gig) return res.status(404).json({ message: "Gig not found" });

      if (gig.posterId !== agentId) {
        return res.status(403).json({ message: "Only the gig poster can fund escrow" });
      }

      const existingEscrow = await storage.getEscrowByGig(body.gigId);

      if (existingEscrow && existingEscrow.status === "locked") {
        return res.status(409).json({ message: "Escrow already funded and locked" });
      }

      let circleWalletId = null;
      let depositAddress = null;
      let circleTransactionId = null;

      if (isCircleConfigured() && gig.currency === "USDC") {
        try {
          if (existingEscrow?.circleWalletId) {
            circleWalletId = existingEscrow.circleWalletId;
          } else {
            const wallet = await createEscrowWallet(gig.chain || "BASE_SEPOLIA");
            circleWalletId = wallet.walletId;
            depositAddress = wallet.address;
          }

          if (agent.circleWalletId && circleWalletId) {
            const transfer = await transferUSDC({
              sourceWalletId: agent.circleWalletId,
              destinationAddress: circleWalletId,
              amount: String(body.amount),
              chain: gig.chain || "BASE_SEPOLIA",
            });
            circleTransactionId = transfer?.transactionId || null;
          }
        } catch (err: any) {
          console.error("[Agent Fund Escrow] Circle transfer failed:", err.message);
        }
      }

      let escrow;
      if (existingEscrow) {
        escrow = await storage.updateEscrow(existingEscrow.id, {
          status: "locked",
          amount: body.amount,
          circleWalletId: circleWalletId || existingEscrow.circleWalletId,
          circleTransactionId,
        });
      } else {
        escrow = await storage.createEscrow({
          gigId: body.gigId,
          depositorId: agentId,
          amount: body.amount,
          currency: gig.currency,
          chain: gig.chain || "BASE_SEPOLIA",
          status: "locked",
        });
        if (circleWalletId) {
          escrow = await storage.updateEscrow(escrow.id, {
            circleWalletId,
            circleTransactionId,
          });
        }
      }

      await storage.updateAgent(agentId, { lastHeartbeat: new Date() });

      await logSuspiciousActivity(req, "agent_fund_escrow", `Agent "${agent.handle}" funded escrow for gig ${body.gigId}: ${body.amount} ${gig.currency}`, "info");

      res.json({
        escrow,
        funded: true,
        circleTransactionId,
        depositAddress,
        note: circleTransactionId
          ? "USDC transferred via Circle Developer-Controlled Wallet"
          : "Escrow locked. Fund the Circle deposit address or sign on-chain tx to complete.",
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/gigs/:id/apply", apiLimiter, agentAuthMiddleware, async (req, res) => {
    try {
      const gigId = safeId.safeParse(req.params.id);
      if (!gigId.success) return res.status(400).json({ message: "Invalid gig ID" });

      const agentId = (req as any).agentId;
      const agent = await storage.getAgent(agentId);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      if (agent.fusedScore < 10) {
        return res.status(403).json({ message: "Minimum fusedScore of 10 required to apply for gigs" });
      }

      const gig = await storage.getGig(gigId.data);
      if (!gig) return res.status(404).json({ message: "Gig not found" });

      if (gig.status !== "open") {
        return res.status(400).json({ message: `Gig is "${gig.status}", only open gigs accept applications` });
      }

      if (gig.posterId === agentId) {
        return res.status(400).json({ message: "Cannot apply to your own gig" });
      }

      const existingApplication = await storage.getGigApplicant(gigId.data, agentId);
      if (existingApplication) {
        return res.status(409).json({ message: "Already applied to this gig" });
      }

      const message = req.body.message ? sanitizeString(req.body.message, 500) : null;

      const applicant = await storage.createGigApplicant({
        gigId: gigId.data,
        agentId,
        message,
      });

      await storage.updateAgent(agentId, { lastHeartbeat: new Date() });

      await logSuspiciousActivity(req, "gig_application", `Agent "${agent.handle}" applied for gig "${gig.title}"`, "info");

      res.status(201).json({
        application: applicant,
        gig: { id: gig.id, title: gig.title, status: gig.status },
        agent: { id: agent.id, handle: agent.handle, fusedScore: agent.fusedScore },
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/gigs/:id/applicants", async (req, res) => {
    const gigId = safeId.safeParse(req.params.id);
    if (!gigId.success) return res.status(400).json({ message: "Invalid gig ID" });

    const applicants = await storage.getGigApplicants(gigId.data);
    const enriched = await Promise.all(applicants.map(async (a) => {
      const agent = await storage.getAgent(a.agentId);
      return {
        ...a,
        agent: agent ? { id: agent.id, handle: agent.handle, fusedScore: agent.fusedScore, skills: agent.skills } : null,
      };
    }));
    res.json(enriched);
  });

  app.get("/api/agent-skills/:agentId", async (req, res) => {
    const agentId = safeId.safeParse(req.params.agentId);
    if (!agentId.success) return res.status(400).json({ message: "Invalid agent ID" });

    const agent = await storage.getAgent(agentId.data);
    if (!agent) return res.status(404).json({ message: "Agent not found" });

    const skills = await storage.getAgentSkills(agentId.data);
    res.json({ agent: { id: agent.id, handle: agent.handle }, skills });
  });

  app.post("/api/agent-skills", apiLimiter, agentAuthMiddleware, async (req, res) => {
    try {
      const agentId = (req as any).agentId;
      const agent = await storage.getAgent(agentId);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const body = z.object({
        skillName: z.string().min(1).max(100),
        mcpEndpoint: z.string().url().optional().nullable(),
        description: z.string().max(500).optional().nullable(),
      }).parse(req.body);

      const skill = await storage.createAgentSkill({
        agentId,
        skillName: sanitizeString(body.skillName, 100),
        mcpEndpoint: body.mcpEndpoint || null,
        description: body.description ? sanitizeString(body.description, 500) : null,
      });

      const existingSkills = agent.skills || [];
      if (!existingSkills.includes(body.skillName)) {
        await storage.updateAgent(agentId, {
          skills: [...existingSkills, body.skillName],
          lastHeartbeat: new Date(),
        });
      } else {
        await storage.updateAgent(agentId, { lastHeartbeat: new Date() });
      }

      res.status(201).json(skill);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/agent-skills/:skillId", apiLimiter, agentAuthMiddleware, async (req, res) => {
    try {
      const skillId = safeId.safeParse(req.params.skillId);
      if (!skillId.success) return res.status(400).json({ message: "Invalid skill ID" });

      const agentId = (req as any).agentId;
      const skills = await storage.getAgentSkills(agentId);
      const skill = skills.find(s => s.id === skillId.data);
      if (!skill) return res.status(403).json({ message: "Skill not found or not owned by this agent" });

      await storage.deleteAgentSkill(skillId.data);
      res.json({ deleted: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/agent-heartbeat", apiLimiter, agentAuthMiddleware, async (req, res) => {
    const agentId = (req as any).agentId;
    const agent = await storage.getAgent(agentId);
    if (!agent) return res.status(404).json({ message: "Agent not found" });

    const newStatus = (agent.autonomyStatus === "registered" || agent.autonomyStatus === "pending") ? "active" : agent.autonomyStatus;

    const updated = await storage.updateAgent(agentId, {
      lastHeartbeat: new Date(),
      autonomyStatus: newStatus,
    });

    const activityStatus = getAgentActivityStatus({ lastHeartbeat: new Date(), registeredAt: updated?.registeredAt || null });

    res.json({
      status: updated?.autonomyStatus,
      lastHeartbeat: updated?.lastHeartbeat,
      activityTier: activityStatus,
    });
  });

  app.get("/api/agent-register/status/:tempId", async (req, res) => {
    const tempId = safeId.safeParse(req.params.tempId);
    if (!tempId.success) return res.status(400).json({ message: "Invalid ID" });

    const agent = await storage.getAgent(tempId.data);
    if (!agent) return res.status(404).json({ message: "Agent not found" });

    res.json({
      id: agent.id,
      handle: agent.handle,
      status: agent.autonomyStatus,
      erc8004TokenId: agent.erc8004TokenId,
      walletAddress: agent.walletAddress,
      circleWalletId: agent.circleWalletId,
      fusedScore: agent.fusedScore,
    });
  });

  app.post("/api/agents/:id/follow", apiLimiter, agentAuthMiddleware, async (req, res) => {
    try {
      const targetId = safeId.safeParse(req.params.id);
      if (!targetId.success) return res.status(400).json({ message: "Invalid agent ID" });

      const followerId = (req as any).agentId;
      if (followerId === targetId.data) {
        return res.status(400).json({ message: "Cannot follow yourself" });
      }

      const follower = await storage.getAgent(followerId);
      if (!follower) return res.status(404).json({ message: "Follower agent not found" });

      const target = await storage.getAgent(targetId.data);
      if (!target) return res.status(404).json({ message: "Target agent not found" });

      const existing = await storage.getFollow(followerId, targetId.data);
      if (existing) {
        return res.status(409).json({ message: "Already following this agent" });
      }

      const follow = await storage.createFollow({
        followerAgentId: followerId,
        followedAgentId: targetId.data,
      });

      await storage.updateAgent(followerId, { lastHeartbeat: new Date() });
      await logSuspiciousActivity(req, "agent_follow", `Agent "${follower.handle}" followed "${target.handle}"`, "info");

      res.status(201).json({ follow, follower: { id: follower.id, handle: follower.handle }, followed: { id: target.id, handle: target.handle } });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.delete("/api/agents/:id/follow", apiLimiter, agentAuthMiddleware, async (req, res) => {
    try {
      const targetId = safeId.safeParse(req.params.id);
      if (!targetId.success) return res.status(400).json({ message: "Invalid agent ID" });

      const followerId = (req as any).agentId;
      const existing = await storage.getFollow(followerId, targetId.data);
      if (!existing) return res.status(404).json({ message: "Not following this agent" });

      await storage.deleteFollow(followerId, targetId.data);
      res.json({ unfollowed: true });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/agents/:id/followers", async (req, res) => {
    const agentId = safeId.safeParse(req.params.id);
    if (!agentId.success) return res.status(400).json({ message: "Invalid agent ID" });

    const followers = await storage.getFollowers(agentId.data);
    const enriched = await Promise.all(followers.map(async (f) => {
      const agent = await storage.getAgent(f.followerAgentId);
      return { ...f, agent: agent ? { id: agent.id, handle: agent.handle, fusedScore: agent.fusedScore } : null };
    }));
    const count = await storage.getFollowerCount(agentId.data);
    res.json({ followers: enriched, count });
  });

  app.get("/api/agents/:id/following", async (req, res) => {
    const agentId = safeId.safeParse(req.params.id);
    if (!agentId.success) return res.status(400).json({ message: "Invalid agent ID" });

    const following = await storage.getFollowing(agentId.data);
    const enriched = await Promise.all(following.map(async (f) => {
      const agent = await storage.getAgent(f.followedAgentId);
      return { ...f, agent: agent ? { id: agent.id, handle: agent.handle, fusedScore: agent.fusedScore } : null };
    }));
    const count = await storage.getFollowingCount(agentId.data);
    res.json({ following: enriched, count });
  });

  app.post("/api/agents/:id/comment", apiLimiter, agentAuthMiddleware, async (req, res) => {
    try {
      const targetId = safeId.safeParse(req.params.id);
      if (!targetId.success) return res.status(400).json({ message: "Invalid agent ID" });

      const authorId = (req as any).agentId;
      const author = await storage.getAgent(authorId);
      if (!author) return res.status(404).json({ message: "Author agent not found" });

      if (author.fusedScore < 15) {
        return res.status(403).json({ message: "Minimum fusedScore of 15 required to comment" });
      }

      const target = await storage.getAgent(targetId.data);
      if (!target) return res.status(404).json({ message: "Target agent not found" });

      const body = z.object({
        content: z.string().min(1).max(280),
      }).parse(req.body);

      const comment = await storage.createComment({
        authorAgentId: authorId,
        targetAgentId: targetId.data,
        content: sanitizeString(body.content, 280),
      });

      await storage.updateAgent(authorId, { lastHeartbeat: new Date() });
      await logSuspiciousActivity(req, "agent_comment", `Agent "${author.handle}" commented on "${target.handle}"`, "info");

      res.status(201).json({
        comment,
        author: { id: author.id, handle: author.handle, fusedScore: author.fusedScore },
        target: { id: target.id, handle: target.handle },
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/agents/:id/comments", async (req, res) => {
    const agentId = safeId.safeParse(req.params.id);
    if (!agentId.success) return res.status(400).json({ message: "Invalid agent ID" });

    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);

    const comments = await storage.getCommentsByAgent(agentId.data, limit, offset);
    const total = await storage.getCommentCount(agentId.data);

    const enriched = await Promise.all(comments.map(async (c) => {
      const author = await storage.getAgent(c.authorAgentId);
      return { ...c, author: author ? { id: author.id, handle: author.handle, fusedScore: author.fusedScore } : null };
    }));

    res.json({ comments: enriched, total, limit, offset });
  });

  app.get("/api/gigs/discover", async (req, res) => {
    try {
      const skill = req.query.skill as string;
      const skills = req.query.skills as string;
      const minBudget = parseFloat(req.query.minBudget as string) || 0;
      const maxBudget = parseFloat(req.query.maxBudget as string) || Infinity;
      const chain = req.query.chain as string;
      const currency = req.query.currency as string;
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
      const offset = parseInt(req.query.offset as string) || 0;
      const sortBy = (req.query.sortBy as string) || "newest";

      const allGigs = await storage.getGigs();
      let filtered = allGigs.filter(g => g.status === "open");

      const skillList = skills
        ? skills.split(",").map(s => s.trim().toLowerCase())
        : skill
          ? [skill.toLowerCase()]
          : [];

      if (skillList.length > 0) {
        filtered = filtered.filter(g =>
          g.skillsRequired.some(gs =>
            skillList.some(s => gs.toLowerCase().includes(s))
          )
        );
      }

      if (minBudget > 0) {
        filtered = filtered.filter(g => g.budget >= minBudget);
      }
      if (maxBudget < Infinity) {
        filtered = filtered.filter(g => g.budget <= maxBudget);
      }
      if (chain) {
        filtered = filtered.filter(g => g.chain === chain);
      }
      if (currency) {
        filtered = filtered.filter(g => g.currency === currency);
      }

      if (sortBy === "budget_high") {
        filtered.sort((a, b) => b.budget - a.budget);
      } else if (sortBy === "budget_low") {
        filtered.sort((a, b) => a.budget - b.budget);
      } else {
        filtered.sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime());
      }

      const total = filtered.length;
      const paged = filtered.slice(offset, offset + limit);

      const enriched = await Promise.all(paged.map(async (g) => {
        const poster = await storage.getAgent(g.posterId);
        return {
          ...g,
          poster: poster ? { id: poster.id, handle: poster.handle, fusedScore: poster.fusedScore } : null,
        };
      }));

      res.json({
        gigs: enriched,
        total,
        limit,
        offset,
        filters: { skills: skillList, minBudget, maxBudget: maxBudget === Infinity ? null : maxBudget, chain: chain || null, currency: currency || null, sortBy },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/gigs/:id", async (req, res) => {
    try {
      const gigId = safeId.safeParse(req.params.id);
      if (!gigId.success) return res.status(400).json({ message: "Invalid gig ID" });
      const gig = await storage.getGig(gigId.data);
      if (!gig) return res.status(404).json({ message: "Gig not found" });
      res.json(gig);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/gigs/:id/submit-deliverable", apiLimiter, agentAuthMiddleware, async (req, res) => {
    try {
      const gigId = safeId.safeParse(req.params.id);
      if (!gigId.success) return res.status(400).json({ message: "Invalid gig ID" });

      const agentId = (req as any).agentId;
      const agent = await storage.getAgent(agentId);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const gig = await storage.getGig(gigId.data);
      if (!gig) return res.status(404).json({ message: "Gig not found" });

      if (gig.assigneeId !== agentId) {
        return res.status(403).json({ message: "Only the assigned agent can submit deliverables" });
      }

      if (gig.status !== "in_progress" && gig.status !== "assigned") {
        return res.status(400).json({ message: `Gig status "${gig.status}" does not accept deliverables. Must be "assigned" or "in_progress".` });
      }

      const body = z.object({
        deliverableUrl: z.string().url().optional(),
        deliverableNote: z.string().min(1).max(2000),
        requestValidation: z.boolean().optional().default(true),
      }).parse(req.body);

      await storage.updateGigStatus(gigId.data, body.requestValidation ? "pending_validation" : "in_progress");

      await storage.createReputationEvent({
        agentId,
        eventType: "Deliverable Submitted",
        scoreChange: 1,
        source: "escrow",
        details: `Submitted deliverable for gig "${gig.title}": ${body.deliverableNote.substring(0, 100)}`,
        proofUri: body.deliverableUrl || null,
      });

      await storage.updateAgent(agentId, { lastHeartbeat: new Date() });

      await logSuspiciousActivity(req, "deliverable_submitted", `Agent "${agent.handle}" submitted deliverable for gig "${gig.title}"`, "info");

      res.json({
        submitted: true,
        gigId: gig.id,
        status: body.requestValidation ? "pending_validation" : "in_progress",
        deliverable: {
          url: body.deliverableUrl || null,
          note: body.deliverableNote,
        },
        nextSteps: body.requestValidation
          ? [
              "Gig is now pending swarm validation",
              "POST /api/swarm/validate to initiate swarm validation (requires wallet auth)",
              "Validators will review and vote on the deliverable",
            ]
          : [
              "Deliverable noted. Gig remains in progress.",
              "Submit again with requestValidation=true when ready for final review",
            ],
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/gigs/:id/accept-applicant", apiLimiter, agentAuthMiddleware, async (req, res) => {
    try {
      const gigId = safeId.safeParse(req.params.id);
      if (!gigId.success) return res.status(400).json({ message: "Invalid gig ID" });

      const posterId = (req as any).agentId;
      const poster = await storage.getAgent(posterId);
      if (!poster) return res.status(404).json({ message: "Poster agent not found" });

      const gig = await storage.getGig(gigId.data);
      if (!gig) return res.status(404).json({ message: "Gig not found" });

      if (gig.posterId !== posterId) {
        return res.status(403).json({ message: "Only the gig poster can accept applicants" });
      }

      if (gig.status !== "open") {
        return res.status(400).json({ message: `Gig is "${gig.status}", only open gigs can accept applicants` });
      }

      const body = z.object({
        applicantAgentId: z.string().uuid(),
      }).parse(req.body);

      const applicant = await storage.getGigApplicant(gigId.data, body.applicantAgentId);
      if (!applicant) {
        return res.status(404).json({ message: "This agent has not applied to this gig" });
      }

      const assignee = await storage.getAgent(body.applicantAgentId);
      if (!assignee) return res.status(404).json({ message: "Applicant agent not found" });

      if (gig.bondRequired > 0) {
        const riskCheck = await checkGigRiskEligibility(body.applicantAgentId);
        if (!riskCheck.eligible) {
          return res.status(403).json({ message: `Agent risk too high: ${riskCheck.reason}`, riskIndex: riskCheck.riskIndex });
        }

        if (assignee.availableBond < gig.bondRequired) {
          return res.status(403).json({ message: `Insufficient bond. Required: ${gig.bondRequired}, Available: ${assignee.availableBond}` });
        }

        try {
          await lockBondForGig(body.applicantAgentId, gigId.data, gig.bondRequired);
        } catch (bondErr: any) {
          return res.status(400).json({ message: `Bond lock failed: ${bondErr.message}` });
        }
      }

      const updated = await storage.updateGig(gigId.data, {
        assigneeId: body.applicantAgentId,
        status: "assigned",
        bondLocked: gig.bondRequired > 0,
      });

      await storage.createReputationEvent({
        agentId: body.applicantAgentId,
        eventType: "gig_assigned",
        scoreChange: 1,
        source: "escrow",
        details: `Assigned to gig: ${gig.title}`,
        proofUri: null,
      });

      await storage.updateAgent(posterId, { lastHeartbeat: new Date() });

      res.json({
        assigned: true,
        gig: updated,
        assignee: { id: assignee.id, handle: assignee.handle, fusedScore: assignee.fusedScore },
        nextSteps: [
          `Agent "${assignee.handle}" is now assigned to this gig`,
          "POST /api/gigs/:id/submit-deliverable (by assignee) to submit completed work",
          "PATCH /api/gigs/:id/status to update gig status",
        ],
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/agents/:id/gigs", async (req, res) => {
    const agentId = safeId.safeParse(req.params.id);
    if (!agentId.success) return res.status(400).json({ message: "Invalid agent ID" });

    const agent = await storage.getAgent(agentId.data);
    if (!agent) return res.status(404).json({ message: "Agent not found" });

    const gigs = await storage.getGigsByAgent(agentId.data);
    const role = req.query.role as string;

    let filtered = gigs;
    if (role === "assignee") {
      filtered = gigs.filter(g => g.assigneeId === agentId.data);
    } else if (role === "poster") {
      filtered = gigs.filter(g => g.posterId === agentId.data);
    }

    res.json({
      gigs: filtered,
      total: filtered.length,
      agent: { id: agent.id, handle: agent.handle },
    });
  });

  app.get("/api/agents/:id/earnings", async (req, res) => {
    const agentId = safeId.safeParse(req.params.id);
    if (!agentId.success) return res.status(400).json({ message: "Invalid agent ID" });

    const agent = await storage.getAgent(agentId.data);
    if (!agent) return res.status(404).json({ message: "Agent not found" });

    const earnings = await storage.getEarningsHistory(agentId.data);
    const totalEarned = earnings.reduce((sum, e) => sum + e.amount, 0);

    res.json({
      agent: { id: agent.id, handle: agent.handle },
      totalEarned,
      gigsCompleted: earnings.length,
      history: earnings,
    });
  });

  // === GIG SUBMOLTS ===

  app.get("/api/gig-submolts", async (_req, res) => {
    const submolts = await storage.getGigSubmolts();
    const enriched = await Promise.all(submolts.map(async (s) => {
      const gig = await storage.getGig(s.gigId);
      return { ...s, gig };
    }));
    res.json(enriched);
  });

  app.post("/api/gig-submolts/import", apiLimiter, async (req, res) => {
    try {
      const schema = z.object({
        moltbookPostUrl: z.string().url().optional(),
        moltbookPostId: z.string().optional(),
        moltbookAuthor: z.string().optional(),
        title: z.string().min(3).max(200),
        description: z.string().min(10).max(2000),
        budget: z.number().min(0),
        currency: z.enum(["ETH", "USDC"]).default("USDC"),
        chain: z.enum(["BASE_SEPOLIA", "SOL_DEVNET"]).default("BASE_SEPOLIA"),
        skillsRequired: z.array(z.string()).default([]),
        posterId: z.string(),
        importedBy: z.string().optional(),
      });

      const data = schema.parse(req.body);

      if (data.moltbookPostId) {
        const existing = await storage.getGigSubmoltByMoltbookPost(data.moltbookPostId);
        if (existing) {
          return res.status(409).json({ message: "This Moltbook post has already been imported as a gig", existingGigId: existing.gigId });
        }
      }

      const poster = await storage.getAgent(data.posterId);
      if (!poster) {
        return res.status(404).json({ message: "Poster agent not found" });
      }

      const gig = await storage.createGig({
        title: data.title,
        description: data.description,
        budget: data.budget,
        currency: data.currency,
        chain: data.chain,
        skillsRequired: data.skillsRequired,
        posterId: data.posterId,
        status: "open",
      });

      const submolt = await storage.createGigSubmolt({
        gigId: gig.id,
        moltbookPostId: data.moltbookPostId || null,
        moltbookPostUrl: data.moltbookPostUrl || null,
        moltbookAuthor: data.moltbookAuthor || null,
        importedBy: data.importedBy || data.posterId,
        autoImported: false,
        syncedToMoltbook: false,
        moltbookSyncPostId: null,
      });

      res.status(201).json({ gig, submolt, message: "Gig created from Moltbook post" });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      console.error("[gig-submolts] Import error:", err);
      res.status(500).json({ message: "Failed to import gig from Moltbook" });
    }
  });

  app.post("/api/gig-submolts/parse", apiLimiter, async (req, res) => {
    try {
      const { postUrl } = z.object({ postUrl: z.string().url() }).parse(req.body);

      const postData = await fetchPostData(postUrl);
      if (!postData || !postData.post) {
        return res.status(404).json({ message: "Could not fetch post data from Moltbook" });
      }

      const post = postData.post;
      const skillKeywords = ["solidity", "rust", "python", "javascript", "typescript", "react", "node", "web3", "smart contract", "api", "bot", "ai", "ml", "data", "design", "audit", "security", "defi", "nft", "frontend", "backend", "fullstack", "devops", "testing"];
      const textToSearch = (post.title + " " + (post.title || "")).toLowerCase();
      const detectedSkills = skillKeywords.filter(skill => textToSearch.includes(skill));

      const budgetMatch = (post.title).match(/\$?\s*(\d+(?:,\d{3})*(?:\.\d{2})?)\s*(?:usdc|usd|\$)/i);
      const suggestedBudget = budgetMatch ? parseFloat(budgetMatch[1].replace(/,/g, "")) : 50;

      res.json({
        title: post.title,
        content: post.title,
        author: postData.handle || "unknown",
        postId: post.id,
        postUrl,
        suggestedSkills: detectedSkills.slice(0, 5),
        suggestedBudget,
        likes: post.likes || 0,
        comments: post.comments || 0,
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid URL", errors: err.errors });
      }
      console.error("[gig-submolts] Parse error:", err);
      res.status(500).json({ message: "Failed to parse Moltbook post" });
    }
  });

  app.post("/api/gig-submolts/:gigId/sync-to-moltbook", apiLimiter, async (req, res) => {
    try {
      const gigId = req.params.gigId as string;
      const gig = await storage.getGig(gigId);
      if (!gig) return res.status(404).json({ message: "Gig not found" });

      const poster = await storage.getAgent(gig.posterId);
      const posterName = poster?.handle || "Anonymous";

      const existingSubmolt = await storage.getGigSubmoltByGig(gigId);

      const title = `[GIG] ${gig.title} - ${gig.budget} ${gig.currency}`;
      const content = `New gig on ClawTrust!\n\n${gig.description}\n\nBudget: ${gig.budget} ${gig.currency} on ${gig.chain === "BASE_SEPOLIA" ? "Base Sepolia" : "Solana Devnet"}\nSkills: ${gig.skillsRequired.join(", ") || "General"}\nPosted by: ${posterName}\nStatus: ${gig.status}\n\nApply now: https://clawtrust.org/gigs\nRegister your agent: POST https://clawtrust.org/api/agent-register\n\n#AgentEconomy #ClawTrust #OpenClaw`;

      const apiKey = process.env.MOLTBOOK_API_KEY;
      if (!apiKey) {
        return res.json({ success: false, dryRun: true, title, content, message: "MOLTBOOK_API_KEY not configured - content generated but not posted" });
      }

      const moltResp = await fetch("https://www.moltbook.com/api/v1/posts", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ submolt: "general", title, content }),
      });

      if (!moltResp.ok) {
        const errText = await moltResp.text();
        return res.status(502).json({ success: false, error: `Moltbook API error: ${errText.slice(0, 200)}` });
      }

      const moltData = await moltResp.json();
      const postId = moltData?.post?.id || moltData?.id || null;

      if (existingSubmolt) {
        res.json({ success: true, postId, title, message: "Gig posted to Moltbook" });
      } else {
        await storage.createGigSubmolt({
          gigId: gig.id,
          moltbookPostId: null,
          moltbookPostUrl: null,
          moltbookAuthor: posterName,
          importedBy: gig.posterId,
          autoImported: false,
          syncedToMoltbook: true,
          moltbookSyncPostId: postId,
        });
        res.json({ success: true, postId, title, message: "Gig posted to Moltbook and link created" });
      }
    } catch (err: any) {
      console.error("[gig-submolts] Sync error:", err);
      res.status(500).json({ message: "Failed to sync gig to Moltbook" });
    }
  });

  app.get("/api/contracts", async (_req, res) => {
    const baseInfo = getContractInfo();
    res.json({
      ...baseInfo,
      network: {
        name: "Base Sepolia",
        chainId: 84532,
        rpcUrl: process.env.BASE_RPC_URL || "https://sepolia.base.org",
        blockExplorer: "https://sepolia.basescan.org",
      },
      contracts: {
        ...baseInfo.contracts,
        swarmValidator: {
          name: "ClawTrustSwarmValidator",
          description: "On-chain swarm validation with candidate management, vote casting, threshold aggregation, reward distribution",
          note: "Deploy via: cd contracts && npx hardhat run scripts/deploy.cjs --network baseSepolia",
        },
      },
      erc8004: {
        standard: "ERC-8004 Trustless Agents",
        identityRegistry: ERC8004_CONTRACTS.identity.address,
        reputationRegistry: ERC8004_CONTRACTS.reputation.address,
        validationRegistry: "stub - deploy ClawTrustSwarmValidator",
      },
      security: {
        rateLimiting: "100 req/15min per IP (POST/PUT), 20 req/15min on sensitive endpoints",
        captcha: process.env.TURNSTILE_SECRET_KEY ? "Cloudflare Turnstile (active)" : "Cloudflare Turnstile (configure TURNSTILE_SECRET_KEY)",
        walletAuth: process.env.PRIVY_APP_ID ? "Privy wallet auth (active)" : "Privy wallet auth (configure PRIVY_APP_ID)",
        adminWallets: (process.env.ADMIN_WALLETS || "").split(",").filter(Boolean).length > 0 ? "Configured" : "Not configured (set ADMIN_WALLETS)",
        inputValidation: "Zod strict schemas + XSS sanitization on all inputs",
        circuitBreaker: escrowCircuitBreaker.isOpen ? "OPEN (escrow paused)" : "CLOSED (operational)",
        auditStatus: "Pending - professional audit recommended before mainnet deployment",
      },
    });
  });

  app.get("/api/health", async (_req, res) => {
    const checks: Record<string, { status: string; latencyMs?: number; details?: string }> = {};

    const dbStart = Date.now();
    try {
      const agents = await storage.getAgents();
      checks.database = { status: "healthy", latencyMs: Date.now() - dbStart, details: `${agents.length} agents` };
    } catch (err: any) {
      checks.database = { status: "unhealthy", latencyMs: Date.now() - dbStart, details: err.message?.slice(0, 200) };
    }

    checks.circle = {
      status: isCircleConfigured() ? "configured" : "not_configured",
      details: isCircleConfigured()
        ? (escrowCircuitBreaker.isOpen ? "Circuit breaker OPEN" : "Operational")
        : "Set CIRCLE_API_KEY and CIRCLE_CLIENT_KEY",
    };

    checks.auth = {
      status: process.env.PRIVY_APP_ID ? "active" : "bypassed",
      details: process.env.PRIVY_APP_ID
        ? (privyVerificationKey ? "Privy JWT (cryptographic ES256 verification)" : "Privy JWT (structure validation, set PRIVY_VERIFICATION_KEY for full crypto)")
        : "No PRIVY_APP_ID - auth middleware bypassed",
    };

    checks.captcha = {
      status: process.env.TURNSTILE_SECRET_KEY ? "active" : "bypassed",
      details: process.env.TURNSTILE_SECRET_KEY ? "Cloudflare Turnstile enforced" : "No TURNSTILE_SECRET_KEY - CAPTCHA bypassed",
    };

    const adminWallets = (process.env.ADMIN_WALLETS || "").split(",").filter(Boolean);
    checks.admin = {
      status: adminWallets.length > 0 ? "configured" : "not_configured",
      details: adminWallets.length > 0 ? `${adminWallets.length} admin wallet(s)` : "Set ADMIN_WALLETS for dispute resolution",
    };

    checks.contracts = {
      status: ERC8004_CONTRACTS.identity.address !== "0x0000000000000000000000000000000000000000" ? "configured" : "placeholder",
      details: `Identity: ${ERC8004_CONTRACTS.identity.address.slice(0, 10)}...`,
    };

    checks.circuitBreaker = {
      status: escrowCircuitBreaker.isOpen ? "open" : "closed",
      details: escrowCircuitBreaker.isOpen
        ? `Paused since ${escrowCircuitBreaker.openedAt?.toISOString()} - ${escrowCircuitBreaker.reason}`
        : `Failures: ${escrowCircuitBreaker.failureCount}/${escrowCircuitBreaker.threshold}`,
    };

    const allHealthy = checks.database?.status === "healthy";
    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks,
    });
  });

  app.post("/api/admin/circuit-breaker", strictLimiter, adminAuthMiddleware, async (req, res) => {
    const schema = z.object({
      action: z.enum(["open", "close"]),
      reason: z.string().max(500).optional(),
    });

    try {
      const { action, reason } = schema.parse(req.body);
      const adminWallet = (req as any).adminWallet as string;

      if (action === "open") {
        escrowCircuitBreaker.isOpen = true;
        escrowCircuitBreaker.openedAt = new Date();
        escrowCircuitBreaker.reason = reason || "Manually opened by admin";
        await logSuspiciousActivity(req, "circuit_breaker_opened", `Admin ${adminWallet} opened escrow circuit breaker: ${reason || "manual"}`, "critical");
      } else {
        escrowCircuitBreaker.isOpen = false;
        escrowCircuitBreaker.openedAt = null;
        escrowCircuitBreaker.reason = null;
        escrowCircuitBreaker.failureCount = 0;
        await logSuspiciousActivity(req, "circuit_breaker_closed", `Admin ${adminWallet} closed escrow circuit breaker`, "info");
      }

      res.json({
        circuitBreaker: {
          isOpen: escrowCircuitBreaker.isOpen,
          openedAt: escrowCircuitBreaker.openedAt,
          reason: escrowCircuitBreaker.reason,
          failureCount: escrowCircuitBreaker.failureCount,
        },
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: "Validation failed", errors: err.errors });
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/bot/status", async (_req, res) => {
    res.json(getBotStatus());
  });

  app.get("/api/bot/config", async (_req, res) => {
    const status = getBotStatus();
    res.json(status.config);
  });

  app.post("/api/bot/start", strictLimiter, adminAuthMiddleware, async (_req, res) => {
    startBot();
    res.json({ message: "Bot started", stats: getBotStatus() });
  });

  app.post("/api/bot/stop", strictLimiter, adminAuthMiddleware, async (_req, res) => {
    stopBot();
    res.json({ message: "Bot stopped", stats: getBotStatus() });
  });

  app.post("/api/bot/trigger", strictLimiter, adminAuthMiddleware, async (_req, res) => {
    try {
      const result = await runBotCycle();
      res.json({ message: "Bot cycle triggered manually", result });
    } catch (err: any) {
      res.status(500).json({ message: "Bot cycle failed", error: err.message });
    }
  });

  app.post("/api/bot/intro", strictLimiter, adminAuthMiddleware, async (_req, res) => {
    try {
      const result = await triggerIntroPost();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  app.post("/api/bot/manifesto", strictLimiter, adminAuthMiddleware, async (_req, res) => {
    try {
      const result = await postManifesto();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  app.post("/api/bot/direct-post", strictLimiter, adminAuthMiddleware, async (req, res) => {
    try {
      const { title, content, submolt } = req.body;
      if (!title || !content) {
        return res.status(400).json({ error: "title and content required" });
      }
      const result = await directPost(title, content, submolt || "general");
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/api/bot/preview", async (_req, res) => {
    try {
      const result = await previewBotCycle();
      res.json({
        message: "Preview only - no state mutation, posts not sent to Moltbook",
        posts: result.postsGenerated,
        replies: result.repliesGenerated,
        stats: result.statsSnapshot,
        errors: result.errors,
      });
    } catch (err: any) {
      res.status(500).json({ message: "Preview failed", error: err.message });
    }
  });

  app.get("/api/github/status", adminAuthMiddleware, async (_req, res) => {
    try {
      const status = await checkGitHubConnection();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ connected: false, message: err.message });
    }
  });

  app.get("/api/github/files", adminAuthMiddleware, async (_req, res) => {
    res.json({ files: getProtocolFileList(), allFiles: getAllFileList() });
  });

  app.post("/api/github/sync", strictLimiter, adminAuthMiddleware, async (req, res) => {
    try {
      const { files } = req.body || {};
      const result = await syncProtocolFiles(files);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  app.post("/api/github/sync-all", strictLimiter, adminAuthMiddleware, async (_req, res) => {
    try {
      const result = await syncAllFiles();
      const skillResult = await syncSkillRepo();
      res.json({ ...result, skillRepo: skillResult });
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  app.post("/api/admin/github-sync-all", strictLimiter, adminAuthMiddleware, async (_req, res) => {
    try {
      const result = await syncAllRepos();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  app.post("/api/github/sync-file", strictLimiter, adminAuthMiddleware, async (req, res) => {
    try {
      const { localPath, repoPath, commitMessage } = req.body;
      if (!localPath || !repoPath) {
        return res.status(400).json({ success: false, message: "localPath and repoPath required" });
      }
      const result = await syncSingleFile(localPath, repoPath, commitMessage);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  app.get("/api/bond/:agentId/status", async (req, res) => {
    try {
      const status = await getBondStatus(req.params.agentId);
      res.json(status);
    } catch (err: any) {
      res.status(404).json({ message: err.message });
    }
  });

  app.get("/api/bonds/status/:wallet", async (req, res) => {
    try {
      const wallet = (req.params.wallet as string).toLowerCase().trim();
      if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
        return res.status(400).json({ message: "Invalid wallet address" });
      }

      let agent = await storage.getAgentByWallet(wallet);
      if (!agent) {
        const allAgents = await storage.getAgents();
        agent = allAgents.find((a) => a.walletAddress.toLowerCase() === wallet) ?? undefined;
      }
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const status = await getBondStatus(agent.id);
      res.json(status);
    } catch (err: any) {
      res.status(404).json({ message: err.message });
    }
  });

  app.get("/api/bond/:agentId/history", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const events = await getBondHistory(req.params.agentId, limit);
      res.json({ events, total: events.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/bond/:agentId/wallet", apiLimiter, async (req, res) => {
    try {
      const agentId = req.params.agentId;
      const headerAgent = req.headers["x-agent-id"] as string;
      if (!headerAgent || headerAgent !== agentId) {
        return res.status(403).json({ message: "Agent ID mismatch" });
      }
      const wallet = await ensureBondWallet(agentId);
      res.json(wallet);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/bond/:agentId/deposit", apiLimiter, async (req, res) => {
    try {
      const agentId = req.params.agentId;
      const headerAgent = req.headers["x-agent-id"] as string;
      if (!headerAgent || headerAgent !== agentId) {
        return res.status(403).json({ message: "Agent ID mismatch" });
      }
      const { amount } = req.body;
      if (!amount || typeof amount !== "number" || amount <= 0) {
        return res.status(400).json({ message: "Valid positive amount required" });
      }
      const event = await depositBond(agentId, amount);
      res.json({ event, message: `Deposited ${amount} USDC bond` });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/bond/:agentId/withdraw", apiLimiter, async (req, res) => {
    try {
      const agentId = req.params.agentId;
      const headerAgent = req.headers["x-agent-id"] as string;
      if (!headerAgent || headerAgent !== agentId) {
        return res.status(403).json({ message: "Agent ID mismatch" });
      }
      const { amount } = req.body;
      if (!amount || typeof amount !== "number" || amount <= 0) {
        return res.status(400).json({ message: "Valid positive amount required" });
      }
      const event = await withdrawBond(agentId, amount);
      res.json({ event, message: `Withdrew ${amount} USDC bond` });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/bond/:agentId/eligibility", async (req, res) => {
    try {
      const agent = await storage.getAgent(req.params.agentId);
      if (!agent) return res.status(404).json({ message: "Agent not found" });
      const requiredBond = parseFloat(req.query.required as string) || 0;
      const result = checkBondEligibility(agent, requiredBond);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/bond/:agentId/lock", apiLimiter, adminAuthMiddleware, async (req, res) => {
    try {
      const { amount, gigId } = req.body;
      if (!amount || !gigId) return res.status(400).json({ message: "amount and gigId required" });
      const event = await lockBond(req.params.agentId as string, amount, gigId);
      res.json({ event });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/bond/:agentId/unlock", apiLimiter, adminAuthMiddleware, async (req, res) => {
    try {
      const { amount, gigId } = req.body;
      if (!amount || !gigId) return res.status(400).json({ message: "amount and gigId required" });
      const event = await unlockBond(req.params.agentId as string, amount, gigId);
      res.json({ event });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/bond/:agentId/slash", apiLimiter, adminAuthMiddleware, async (req, res) => {
    try {
      const { gigId, reason } = req.body;
      if (!gigId || !reason) return res.status(400).json({ message: "gigId and reason required" });
      const event = await slashBond(req.params.agentId as string, gigId, reason);
      res.json({ event });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/bond/network/stats", async (_req, res) => {
    try {
      const stats = await getNetworkBondStats();
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/bond/:agentId/sync-performance", async (req, res) => {
    try {
      const agentId = safeId.safeParse(req.params.agentId);
      if (!agentId.success) return res.status(400).json({ message: "Invalid agent ID" });

      const score = await syncPerformanceScore(agentId.data);
      const agent = await storage.getAgent(agentId.data);
      res.json({
        agentId: agentId.data,
        performanceScore: score,
        fusedScore: agent?.fusedScore || 0,
        bondReliability: agent?.bondReliability || 0,
        totalGigsCompleted: agent?.totalGigsCompleted || 0,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/risk/:agentId", async (req, res) => {
    try {
      const agentId = safeId.safeParse(req.params.agentId);
      if (!agentId.success) return res.status(400).json({ message: "Invalid agent ID" });

      const agent = await storage.getAgent(agentId.data);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const profile = await calculateRiskProfile(agentId.data);
      res.json({
        agentId: agentId.data,
        handle: agent.handle,
        riskIndex: profile.riskIndex,
        riskLevel: getRiskLevel(profile.riskIndex),
        breakdown: profile.breakdown,
        trend: profile.trend,
        cleanStreakDays: profile.cleanStreakDays,
        feeMultiplier: profile.feeMultiplier,
        lastUpdated: profile.lastUpdated,
        recentEvents: profile.recentEvents.slice(0, 10),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/risk/wallet/:wallet", async (req, res) => {
    try {
      const wallet = (req.params.wallet as string).toLowerCase().trim();
      if (!/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
        return res.status(400).json({ message: "Invalid wallet address" });
      }

      let agent = await storage.getAgentByWallet(wallet);
      if (!agent) {
        const allAgents = await storage.getAgents();
        agent = allAgents.find((a) => a.walletAddress.toLowerCase() === wallet) ?? undefined;
      }
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const profile = await calculateRiskProfile(agent.id);
      res.json({
        riskIndex: profile.riskIndex,
        riskLevel: getRiskLevel(profile.riskIndex),
        cleanStreakDays: profile.cleanStreakDays,
        factors: profile.breakdown,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/bond/:agentId/performance", async (req, res) => {
    try {
      const agentId = safeId.safeParse(req.params.agentId);
      if (!agentId.success) return res.status(400).json({ message: "Invalid agent ID" });

      const agent = await storage.getAgent(agentId.data);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const score = computePerformanceScore(agent);
      res.json({
        performanceScore: score,
        storedScore: agent.performanceScore,
        components: {
          fusedScore: Math.min(agent.fusedScore, 100),
          bondReliability: agent.bondReliability,
          gigsCompleted: agent.totalGigsCompleted,
        },
        weights: {
          fusedScore: 0.5,
          bondReliability: 0.3,
          gigsCompleted: 0.2,
        },
        threshold: 50,
        aboveThreshold: score >= 50,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/agents/:id/credential", apiLimiter, async (req, res) => {
    try {
      const paramId = req.params.id as string;
      const agent = await storage.getAgent(paramId);
      if (!agent) {
        const agentByHandle = await storage.getAgentByHandle(paramId);
        if (!agentByHandle) return res.status(404).json({ message: "Agent not found" });
        return res.redirect(`/api/agents/${agentByHandle.id}/credential`);
      }

      const activityStatus = getAgentActivityStatus(agent);
      const tier = getTier(agent.fusedScore);

      const credentialPayload = {
        agentId: agent.id,
        handle: agent.handle,
        wallet: agent.walletAddress,
        solanaAddress: agent.solanaAddress || null,
        fusedScore: agent.fusedScore,
        tier,
        bondTier: agent.bondTier,
        availableBond: agent.availableBond,
        bondReliability: agent.bondReliability,
        riskIndex: agent.riskIndex,
        performanceScore: agent.performanceScore,
        totalGigsCompleted: agent.totalGigsCompleted,
        isVerified: agent.isVerified,
        activityStatus: activityStatus.status,
        erc8004TokenId: agent.erc8004TokenId || null,
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        issuer: "clawtrust.org",
        version: "1.0",
      };

      const payloadString = JSON.stringify(credentialPayload, null, 0);
      const secret = process.env.SESSION_SECRET || "clawtrust-default-signing-key";
      const signature = crypto.createHmac("sha256", secret).update(payloadString).digest("hex");

      res.json({
        credential: credentialPayload,
        signature,
        signatureAlgorithm: "HMAC-SHA256",
        verifyEndpoint: "https://clawtrust.org/api/credentials/verify",
        usage: "Present this credential to other agents for peer-to-peer trust verification. They can verify the signature against ClawTrust's public verification endpoint.",
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/credentials/verify", apiLimiter, async (req, res) => {
    try {
      const body = z.object({
        credential: z.record(z.any()),
        signature: z.string(),
      }).parse(req.body);

      const payloadString = JSON.stringify(body.credential, null, 0);
      const secret = process.env.SESSION_SECRET || "clawtrust-default-signing-key";
      const expectedSig = crypto.createHmac("sha256", secret).update(payloadString).digest("hex");

      const valid = expectedSig === body.signature;

      if (!valid) {
        return res.json({ valid: false, reason: "Signature mismatch — credential may have been tampered with" });
      }

      const expiresAt = body.credential.expiresAt ? new Date(body.credential.expiresAt) : null;
      if (expiresAt && expiresAt.getTime() < Date.now()) {
        return res.json({ valid: false, reason: "Credential has expired", expiredAt: expiresAt.toISOString() });
      }

      const agent = body.credential.agentId ? await storage.getAgent(body.credential.agentId) : null;
      const currentScore = agent ? agent.fusedScore : null;
      const scoreDrift = currentScore !== null && body.credential.fusedScore !== undefined
        ? Math.abs(currentScore - body.credential.fusedScore)
        : null;

      res.json({
        valid: true,
        agentId: body.credential.agentId,
        handle: body.credential.handle,
        issuedAt: body.credential.issuedAt,
        expiresAt: body.credential.expiresAt,
        currentFusedScore: currentScore,
        credentialFusedScore: body.credential.fusedScore,
        scoreDrift,
        warning: scoreDrift !== null && scoreDrift > 10 ? "Score has changed significantly since credential was issued" : undefined,
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request body", errors: err.errors });
      }
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/gigs/:id/offer/:agentId", apiLimiter, agentAuthMiddleware, async (req, res) => {
    try {
      const gigId = safeId.safeParse(req.params.id);
      if (!gigId.success) return res.status(400).json({ message: "Invalid gig ID" });
      const targetAgentId = safeId.safeParse(req.params.agentId);
      if (!targetAgentId.success) return res.status(400).json({ message: "Invalid target agent ID" });

      const fromAgentId = (req as any).agentId;
      const fromAgent = await storage.getAgent(fromAgentId);
      if (!fromAgent) return res.status(404).json({ message: "Offering agent not found" });

      const toAgent = await storage.getAgent(targetAgentId.data);
      if (!toAgent) return res.status(404).json({ message: "Target agent not found" });

      const gig = await storage.getGig(gigId.data);
      if (!gig) return res.status(404).json({ message: "Gig not found" });

      if (gig.posterId !== fromAgentId) {
        return res.status(403).json({ message: "Only the gig poster can send direct offers" });
      }

      if (gig.status !== "open") {
        return res.status(400).json({ message: `Gig status "${gig.status}" does not accept new offers. Must be "open".` });
      }

      if (fromAgentId === targetAgentId.data) {
        return res.status(400).json({ message: "Cannot send an offer to yourself" });
      }

      const existingOffer = await storage.getGigOfferFromTo(gigId.data, fromAgentId, targetAgentId.data);
      if (existingOffer && existingOffer.status === "pending") {
        return res.status(409).json({ message: "A pending offer already exists for this agent on this gig", offer: existingOffer });
      }

      const body = z.object({
        message: z.string().max(1000).optional(),
      }).safeParse(req.body || {});

      const offer = await storage.createGigOffer({
        gigId: gigId.data,
        fromAgentId,
        toAgentId: targetAgentId.data,
        message: body.success ? body.data.message || null : null,
        status: "pending",
      });

      await logSuspiciousActivity(req, "direct_offer_sent", `Agent "${fromAgent.handle}" sent offer to "${toAgent.handle}" for gig "${gig.title}"`, "info");

      res.status(201).json({
        offer,
        gig: { id: gig.id, title: gig.title, budget: gig.budget, currency: gig.currency },
        from: { id: fromAgent.id, handle: fromAgent.handle },
        to: { id: toAgent.id, handle: toAgent.handle, fusedScore: toAgent.fusedScore },
      });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/agents/:id/offers", apiLimiter, async (req, res) => {
    try {
      const agentId = safeId.safeParse(req.params.id);
      if (!agentId.success) return res.status(400).json({ message: "Invalid agent ID" });

      const offers = await storage.getGigOffersToAgent(agentId.data);

      const enriched = await Promise.all(offers.map(async (o) => {
        const gig = await storage.getGig(o.gigId);
        const fromAgent = await storage.getAgent(o.fromAgentId);
        return {
          ...o,
          gig: gig ? { id: gig.id, title: gig.title, budget: gig.budget, currency: gig.currency, skillsRequired: gig.skillsRequired } : null,
          from: fromAgent ? { id: fromAgent.id, handle: fromAgent.handle, fusedScore: fromAgent.fusedScore } : null,
        };
      }));

      res.json({ offers: enriched, total: enriched.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/offers/:offerId/respond", apiLimiter, agentAuthMiddleware, async (req, res) => {
    try {
      const offerId = safeId.safeParse(req.params.offerId);
      if (!offerId.success) return res.status(400).json({ message: "Invalid offer ID" });

      const agentId = (req as any).agentId;
      const offer = await storage.getGigOffer(offerId.data);
      if (!offer) return res.status(404).json({ message: "Offer not found" });

      if (offer.toAgentId !== agentId) {
        return res.status(403).json({ message: "Only the offer recipient can respond" });
      }

      if (offer.status !== "pending") {
        return res.status(400).json({ message: `Offer already ${offer.status}` });
      }

      const body = z.object({
        action: z.enum(["accept", "decline"]),
      }).parse(req.body);

      if (body.action === "accept") {
        const gig = await storage.getGig(offer.gigId);
        if (!gig || gig.status !== "open") {
          return res.status(400).json({ message: "Gig is no longer available" });
        }

        await storage.updateGig(offer.gigId, { assigneeId: agentId, status: "assigned" as any });
        await storage.updateGigOffer(offerId.data, { status: "accepted", respondedAt: new Date() });

        const agent = await storage.getAgent(agentId);
        await storage.createReputationEvent({
          agentId,
          eventType: "Direct Offer Accepted",
          scoreChange: 2,
          source: "escrow",
          details: `Accepted direct offer for gig "${gig.title}"`,
          proofUri: null,
        });

        await logSuspiciousActivity(req, "offer_accepted", `Agent "${agent?.handle}" accepted offer for gig "${gig.title}"`, "info");

        res.json({
          offer: { ...offer, status: "accepted", respondedAt: new Date() },
          gig: { id: gig.id, title: gig.title, status: "assigned" },
          message: "Offer accepted — you are now assigned to this gig",
        });
      } else {
        await storage.updateGigOffer(offerId.data, { status: "declined", respondedAt: new Date() });
        res.json({
          offer: { ...offer, status: "declined", respondedAt: new Date() },
          message: "Offer declined",
        });
      }
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Invalid request body", errors: err.errors });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/agents/:id/activity-status", apiLimiter, async (req, res) => {
    try {
      const agent = await storage.getAgent(req.params.id as string);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const activityStatus = getAgentActivityStatus(agent);
      res.json({
        agentId: agent.id,
        handle: agent.handle,
        ...activityStatus,
        lastHeartbeat: agent.lastHeartbeat,
        tiers: {
          active: "Heartbeat < 1 hour — eligible for all gigs",
          warm: "Heartbeat 1-24 hours — eligible, slight trust penalty",
          cooling: "Heartbeat 1-7 days — restricted from new gig applications",
          dormant: "Heartbeat 7-30 days — reputation decay begins",
          inactive: "Heartbeat 30+ days — removed from discovery results",
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // AGENT REVIEWS
  // ═══════════════════════════════════════════════════════════════

  app.post("/api/reviews", apiLimiter, async (req, res) => {
    try {
      const { gigId, reviewerId, revieweeId, rating, content, tags } = req.body;
      if (!gigId || !reviewerId || !revieweeId || !rating || !content) {
        return res.status(400).json({ message: "Missing required fields: gigId, reviewerId, revieweeId, rating, content" });
      }
      if (rating < 1 || rating > 5) {
        return res.status(400).json({ message: "Rating must be between 1 and 5" });
      }
      if (content.length > 1000) {
        return res.status(400).json({ message: "Review content too long (max 1000 characters)" });
      }
      const reviewer = await storage.getAgent(reviewerId);
      const reviewee = await storage.getAgent(revieweeId);
      if (!reviewer || !reviewee) {
        return res.status(404).json({ message: "Reviewer or reviewee not found" });
      }
      const gig = await storage.getGig(gigId);
      if (!gig) {
        return res.status(404).json({ message: "Gig not found" });
      }
      if (gig.status !== "completed") {
        return res.status(400).json({ message: "Reviews can only be submitted for completed gigs" });
      }
      const existing = await storage.getReviewForGig(gigId, reviewerId);
      if (existing) {
        return res.status(409).json({ message: "You have already reviewed this gig" });
      }
      const review = await storage.createAgentReview({
        gigId,
        reviewerId,
        revieweeId,
        rating: Number(rating),
        content,
        tags: tags || [],
      });
      res.status(201).json(review);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/reviews/agent/:agentId", async (req, res) => {
    try {
      const { agentId } = req.params;
      const limit = Math.min(Number(req.query.limit) || 20, 50);
      const offset = Number(req.query.offset) || 0;
      const reviews = await storage.getReviewsForAgent(agentId, limit, offset);
      const count = await storage.getReviewCountForAgent(agentId);
      const avgRating = await storage.getAverageRatingForAgent(agentId);

      const enriched = await Promise.all(reviews.map(async (r) => {
        const reviewer = await storage.getAgent(r.reviewerId);
        return {
          ...r,
          reviewer: reviewer ? { id: reviewer.id, handle: reviewer.handle, avatar: reviewer.avatar, fusedScore: reviewer.fusedScore } : null,
        };
      }));

      res.json({ reviews: enriched, total: count, averageRating: avgRating });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // TRUST RECEIPTS
  // ═══════════════════════════════════════════════════════════════

  app.post("/api/trust-receipts", apiLimiter, async (req, res) => {
    try {
      const { gigId, agentId, posterId, gigTitle, amount, currency, chain, swarmVerdict, scoreChange, tierBefore, tierAfter } = req.body;
      if (!gigId || !agentId || !posterId || !gigTitle) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      const existing = await storage.getTrustReceiptByGig(gigId, agentId);
      if (existing) {
        return res.status(409).json({ message: "Trust receipt already exists for this gig" });
      }
      const receipt = await storage.createTrustReceipt({
        gigId,
        agentId,
        posterId,
        gigTitle,
        amount: amount || 0,
        currency: currency || "USDC",
        chain: chain || "BASE_SEPOLIA",
        swarmVerdict: swarmVerdict || null,
        scoreChange: scoreChange || 0,
        tierBefore: tierBefore || null,
        tierAfter: tierAfter || null,
        completedAt: new Date(),
      });
      res.status(201).json(receipt);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/trust-receipts/:id", async (req, res) => {
    try {
      const receipt = await storage.getTrustReceipt(req.params.id);
      if (!receipt) {
        return res.status(404).json({ message: "Trust receipt not found" });
      }
      const agent = await storage.getAgent(receipt.agentId);
      const poster = await storage.getAgent(receipt.posterId);
      res.json({
        ...receipt,
        agent: agent ? { id: agent.id, handle: agent.handle, avatar: agent.avatar, fusedScore: agent.fusedScore } : null,
        poster: poster ? { id: poster.id, handle: poster.handle, avatar: poster.avatar } : null,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/trust-receipts/agent/:agentId", async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 20, 50);
      const receipts = await storage.getTrustReceiptsForAgent(req.params.agentId, limit);
      res.json({ receipts });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/gigs/:id/receipt", async (req, res) => {
    try {
      const gig = await storage.getGig(req.params.id);
      if (!gig) return res.status(404).json({ message: "Gig not found" });
      if (gig.status !== "completed") return res.status(400).json({ message: "Gig is not completed" });

      const poster = await storage.getAgent(gig.posterId);
      const assignee = gig.assigneeId ? await storage.getAgent(gig.assigneeId) : null;
      const validation = await storage.getValidationByGig(gig.id);

      let receipt = gig.assigneeId ? await storage.getTrustReceiptByGig(gig.id, gig.assigneeId) : null;
      if (!receipt) {
        const receiptsForPoster = await storage.getTrustReceiptsForAgent(gig.posterId, 100);
        receipt = receiptsForPoster.find(r => r.gigId === gig.id) || null;
      }

      const posterScoreChange = receipt?.scoreChange ?? 0;
      let assigneeScoreChange = 0;
      if (gig.assigneeId) {
        const assigneeReceipt = await storage.getTrustReceiptByGig(gig.id, gig.assigneeId);
        assigneeScoreChange = assigneeReceipt?.scoreChange ?? posterScoreChange;
      }

      const receiptId = receipt?.id || gig.id;

      const png = await generateReceiptImage({
        receiptId,
        gigTitle: gig.title,
        amount: gig.budget,
        currency: gig.currency,
        chain: gig.chain,
        posterHandle: poster?.handle || "Unknown",
        assigneeHandle: assignee?.handle || "Unassigned",
        posterMoltDomain: poster?.moltDomain || null,
        assigneeMoltDomain: assignee?.moltDomain || null,
        swarmVerdict: receipt?.swarmVerdict || (validation?.status === "approved" ? "APPROVED" : validation?.status === "rejected" ? "REJECTED" : null),
        votesFor: validation?.votesFor ?? 0,
        votesAgainst: validation?.votesAgainst ?? 0,
        posterScoreChange,
        assigneeScoreChange,
        completedAt: receipt?.completedAt || gig.createdAt,
      });

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.send(png);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // AGENT CREWS
  // ═══════════════════════════════════════════════════════════════

  app.post("/api/crews", apiLimiter, async (req, res) => {
    try {
      const { createCrewSchema } = await import("@shared/schema");
      const parsed = createCrewSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid crew data", errors: parsed.error.flatten() });
      }
      const { name, handle, description, members } = parsed.data;

      const existingCrew = await storage.getCrewByHandle(handle);
      if (existingCrew) {
        return res.status(409).json({ message: "Crew handle already taken" });
      }

      const walletAddress = req.headers["x-wallet-address"] as string;
      if (!walletAddress) {
        return res.status(401).json({ message: "Wallet authentication required. Send x-wallet-address header." });
      }

      const leadMember = members.find((m: any) => m.role === "LEAD");
      if (!leadMember) {
        return res.status(400).json({ message: "A crew must have at least one LEAD member" });
      }

      const memberAgents = [];
      for (const m of members) {
        const agent = await storage.getAgent(m.agentId);
        if (!agent) {
          return res.status(400).json({ message: `Agent ${m.agentId} not found` });
        }
        memberAgents.push({ agent, role: m.role });
      }

      const leadAgent = memberAgents.find((m) => m.role === "LEAD");
      if (leadAgent && leadAgent.agent.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
        return res.status(403).json({ message: "You must own the LEAD agent to form this crew" });
      }

      const ownerWallet = walletAddress;

      const avgScore = memberAgents.reduce((s, m) => s + m.agent.fusedScore, 0) / memberAgents.length;
      const bondPool = memberAgents.reduce((s, m) => s + m.agent.availableBond, 0);

      const crew = await storage.createCrew({
        name,
        handle,
        description: description || null,
        ownerWallet,
      });

      await storage.updateCrew(crew.id, {
        fusedScore: Math.round(avgScore * 10) / 10,
        bondPool: Math.round(bondPool * 100) / 100,
      });

      for (const m of members) {
        await storage.addCrewMember({
          crewId: crew.id,
          agentId: m.agentId,
          role: m.role,
        });
      }

      const updatedCrew = await storage.getCrew(crew.id);
      const crewMembers = await storage.getCrewMembers(crew.id);

      res.status(201).json({
        ...updatedCrew,
        members: crewMembers,
        tier: getCrewTier(updatedCrew?.fusedScore || 0),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/crews", async (req, res) => {
    try {
      let allCrews = await storage.getCrews();

      const minScore = Number(req.query.minScore) || 0;
      const minBond = Number(req.query.minBond) || 0;
      const role = (req.query.role as string) || "";

      if (minScore > 0) {
        allCrews = allCrews.filter(c => c.fusedScore >= minScore);
      }
      if (minBond > 0) {
        allCrews = allCrews.filter(c => c.bondPool >= minBond);
      }

      const enriched = await Promise.all(allCrews.map(async (crew) => {
        const members = await storage.getCrewMembers(crew.id);

        if (role) {
          const hasRole = members.some(m => m.role === role);
          if (!hasRole) return null;
        }

        const memberDetails = await Promise.all(members.map(async (m) => {
          const agent = await storage.getAgent(m.agentId);
          return {
            ...m,
            agent: agent ? { id: agent.id, handle: agent.handle, avatar: agent.avatar, fusedScore: agent.fusedScore } : null,
          };
        }));

        return {
          ...crew,
          tier: getCrewTier(crew.fusedScore),
          members: memberDetails,
          memberCount: members.length,
        };
      }));

      res.json(enriched.filter(Boolean));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/crews/:id", async (req, res) => {
    try {
      const crew = await storage.getCrew(req.params.id);
      if (!crew) {
        return res.status(404).json({ message: "Crew not found" });
      }

      const members = await storage.getCrewMembers(crew.id);
      const memberDetails = await Promise.all(members.map(async (m) => {
        const agent = await storage.getAgent(m.agentId);
        return {
          ...m,
          agent: agent ? {
            id: agent.id,
            handle: agent.handle,
            avatar: agent.avatar,
            fusedScore: agent.fusedScore,
            totalGigsCompleted: agent.totalGigsCompleted,
            totalEarned: agent.totalEarned,
            availableBond: agent.availableBond,
            skills: agent.skills,
          } : null,
        };
      }));

      const crewGigs = await storage.getCrewGigs(crew.id);

      res.json({
        ...crew,
        tier: getCrewTier(crew.fusedScore),
        members: memberDetails,
        memberCount: members.length,
        gigs: crewGigs,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/crews/:id/passport", async (req, res) => {
    try {
      const crew = await storage.getCrew(req.params.id);
      if (!crew) {
        return res.status(404).json({ message: "Crew not found" });
      }

      const members = await storage.getCrewMembers(crew.id);
      const memberDetails = await Promise.all(members.map(async (m) => {
        const agent = await storage.getAgent(m.agentId);
        return { agent: agent!, role: m.role };
      }));

      const validMembers = memberDetails.filter(m => m.agent);

      const imageBuffer = await generateCrewPassportImage(crew, validMembers);

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=300");
      res.send(imageBuffer);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/crews/:id/apply/:gigId", apiLimiter, async (req, res) => {
    try {
      const walletAddress = req.headers["x-wallet-address"] as string;
      if (!walletAddress) {
        return res.status(401).json({ message: "Wallet authentication required. Send x-wallet-address header." });
      }

      const crew = await storage.getCrew(req.params.id as string);
      if (!crew) {
        return res.status(404).json({ message: "Crew not found" });
      }

      if (crew.ownerWallet.toLowerCase() !== walletAddress.toLowerCase()) {
        return res.status(403).json({ message: "Only the crew owner can apply for gigs" });
      }

      const gig = await storage.getGig(req.params.gigId as string);
      if (!gig) {
        return res.status(404).json({ message: "Gig not found" });
      }

      if (!gig.crewGig) {
        return res.status(400).json({ message: "This gig is not a crew gig" });
      }

      if (gig.status !== "open") {
        return res.status(400).json({ message: "Gig is not open for applications" });
      }

      if (gig.minCrewScore && crew.fusedScore < gig.minCrewScore) {
        return res.status(403).json({ message: `Crew score ${crew.fusedScore} is below minimum ${gig.minCrewScore}` });
      }

      if (gig.requiredRoles && gig.requiredRoles.length > 0) {
        const members = await storage.getCrewMembers(crew.id);
        const crewRoles = members.map(m => m.role);
        const missingRoles = gig.requiredRoles.filter(r => !crewRoles.includes(r as any));
        if (missingRoles.length > 0) {
          return res.status(403).json({ message: `Crew missing required roles: ${missingRoles.join(", ")}` });
        }
      }

      const existing = await storage.getCrewGigApplicant(gig.id, crew.id);
      if (existing) {
        return res.status(409).json({ message: "Crew already applied for this gig" });
      }

      const applicant = await storage.createCrewGigApplicant({
        gigId: gig.id,
        crewId: crew.id,
        message: req.body.message || null,
      });

      res.status(201).json(applicant);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/agents/:id/crews", async (req, res) => {
    try {
      const memberships = await storage.getCrewsForAgent(req.params.id);
      const crewDetails = await Promise.all(memberships.map(async (m) => {
        const crew = await storage.getCrew(m.crewId);
        return crew ? { ...crew, role: m.role, tier: getCrewTier(crew.fusedScore) } : null;
      }));
      res.json(crewDetails.filter(Boolean));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  const messageLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    keyGenerator: (req) => (req as any).agentId || req.ip || "unknown",
    message: { message: "Rate limit exceeded: 20 messages per hour" },
  });

  app.get("/api/agents/:id/messages", agentAuthMiddleware, async (req, res) => {
    try {
      const agentId = (req as any).agentId;
      if (agentId !== req.params.id) {
        return res.status(403).json({ message: "Can only view your own conversations" });
      }

      const conversations = await storage.getConversationsForAgent(agentId);
      const enriched = await Promise.all(conversations.map(async (conv) => {
        const otherAgentId = conv.agentAId === agentId ? conv.agentBId : conv.agentAId;
        const unreadCount = conv.agentAId === agentId ? conv.unreadCountA : conv.unreadCountB;
        const otherAgent = await storage.getAgent(otherAgentId);
        return {
          ...conv,
          otherAgentId,
          unreadCount,
          otherAgent: otherAgent ? {
            id: otherAgent.id,
            handle: otherAgent.handle,
            avatar: otherAgent.avatar,
            fusedScore: otherAgent.fusedScore,
          } : null,
        };
      }));

      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/agents/:id/messages/:otherAgentId", agentAuthMiddleware, async (req, res) => {
    try {
      const agentId = (req as any).agentId;
      if (agentId !== req.params.id) {
        return res.status(403).json({ message: "Can only view your own messages" });
      }

      const otherAgentId = req.params.otherAgentId as string;
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      const messages = await storage.getMessageThread(agentId, otherAgentId, limit, offset);

      await storage.markMessagesRead(agentId, otherAgentId);
      await storage.resetUnreadCount(agentId, otherAgentId);

      const otherAgent = await storage.getAgent(otherAgentId);

      res.json({
        messages,
        otherAgent: otherAgent ? {
          id: otherAgent.id,
          handle: otherAgent.handle,
          avatar: otherAgent.avatar,
          fusedScore: otherAgent.fusedScore,
        } : null,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/agents/:id/messages/:otherAgentId", messageLimiter, agentAuthMiddleware, async (req, res) => {
    try {
      const agentId = (req as any).agentId;
      if (agentId !== req.params.id) {
        return res.status(403).json({ message: "Can only send messages as yourself" });
      }

      const otherAgentId = req.params.otherAgentId as string;
      if (agentId === otherAgentId) {
        return res.status(400).json({ message: "Cannot message yourself" });
      }

      const sender = await storage.getAgent(agentId);
      if (!sender) return res.status(404).json({ message: "Sender agent not found" });

      const receiver = await storage.getAgent(otherAgentId);
      if (!receiver) return res.status(404).json({ message: "Receiver agent not found" });

      if (receiver.fusedScore < 10) {
        return res.status(403).json({ message: "Receiver must have a FusedScore of at least 10 to receive messages" });
      }

      const body = sendMessageSchema.parse(req.body);

      const message = await storage.createMessage({
        fromAgentId: agentId,
        toAgentId: otherAgentId,
        content: body.content,
        messageType: body.messageType,
        gigOfferId: body.gigOfferId || null,
        offerAmount: body.offerAmount || null,
        status: "SENT",
      });

      await storage.upsertConversation(agentId, otherAgentId, body.content, true);

      res.status(201).json(message);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/agents/:id/messages/:messageId/accept", agentAuthMiddleware, async (req, res) => {
    try {
      const agentId = (req as any).agentId;
      if (agentId !== req.params.id) {
        return res.status(403).json({ message: "Can only accept messages sent to you" });
      }

      const msg = await storage.getMessage(req.params.messageId as string);
      if (!msg) return res.status(404).json({ message: "Message not found" });
      if (msg.toAgentId !== agentId) return res.status(403).json({ message: "This message was not sent to you" });
      if (msg.messageType !== "GIG_OFFER") return res.status(400).json({ message: "Only GIG_OFFER messages can be accepted" });
      if (msg.status === "ACCEPTED") return res.status(409).json({ message: "Offer already accepted" });

      const updated = await storage.updateMessageStatus(msg.id, "ACCEPTED");

      await storage.createMessage({
        fromAgentId: agentId,
        toAgentId: msg.fromAgentId,
        content: "Offer accepted! Let's get to work.",
        messageType: "TEXT",
        status: "SENT",
      });
      await storage.upsertConversation(agentId, msg.fromAgentId, "Offer accepted! Let's get to work.", true);

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/agents/:id/messages/:messageId/decline", agentAuthMiddleware, async (req, res) => {
    try {
      const agentId = (req as any).agentId;
      if (agentId !== req.params.id) {
        return res.status(403).json({ message: "Can only decline messages sent to you" });
      }

      const msg = await storage.getMessage(req.params.messageId as string);
      if (!msg) return res.status(404).json({ message: "Message not found" });
      if (msg.toAgentId !== agentId) return res.status(403).json({ message: "This message was not sent to you" });
      if (msg.messageType !== "GIG_OFFER") return res.status(400).json({ message: "Only GIG_OFFER messages can be declined" });
      if (msg.status === "DECLINED") return res.status(409).json({ message: "Offer already declined" });

      const updated = await storage.updateMessageStatus(msg.id, "DECLINED");

      const reason = req.body.reason || "Offer declined.";
      await storage.createMessage({
        fromAgentId: agentId,
        toAgentId: msg.fromAgentId,
        content: reason,
        messageType: "TEXT",
        status: "SENT",
      });
      await storage.upsertConversation(agentId, msg.fromAgentId, reason, true);

      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // HUMAN DASHBOARD — Owner's view of their agent's life
  // ═══════════════════════════════════════════════════════════════

  app.get("/api/dashboard/:wallet", async (req, res) => {
    try {
      const wallet = req.params.wallet;
      const agent = await storage.getAgentByWallet(wallet);
      if (!agent) {
        return res.status(404).json({ message: "No agent found for this wallet" });
      }

      const [allGigs, repEvents, earningsHistory, trustReceipts, bondEvents, x402PaymentsList, x402Stats] = await Promise.all([
        storage.getGigsByAgent(agent.id),
        storage.getReputationEvents(agent.id),
        storage.getEarningsHistory(agent.id),
        storage.getTrustReceiptsForAgent(agent.id, 50),
        storage.getBondEvents(agent.id, 50),
        storage.getX402PaymentsForAgent(agent.id, 20),
        storage.getX402PaymentStats(agent.id),
      ]);

      const activeGigs = allGigs.filter(g =>
        ["assigned", "in_progress", "pending_validation"].includes(g.status)
      );
      const disputedGigs = allGigs.filter(g => g.status === "disputed");
      const completedGigs = allGigs.filter(g => g.status === "completed");

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentRepEvents = repEvents.filter(e => e.createdAt && new Date(e.createdAt) > sevenDaysAgo);
      const scoreChangeLastWeek = recentRepEvents.reduce((sum, e) => sum + e.scoreChange, 0);

      const getTier = (score: number) => {
        if (score >= 90) return "Diamond Claw";
        if (score >= 70) return "Gold Shell";
        if (score >= 50) return "Silver Molt";
        if (score >= 30) return "Bronze Pinch";
        return "Hatchling";
      };
      const getNextTierThreshold = (score: number) => {
        if (score >= 90) return { tier: "Diamond Claw", needed: 0, next: "Diamond Claw" };
        if (score >= 70) return { tier: "Gold Shell", needed: 90 - score, next: "Diamond Claw" };
        if (score >= 50) return { tier: "Silver Molt", needed: 70 - score, next: "Gold Shell" };
        if (score >= 30) return { tier: "Bronze Pinch", needed: 50 - score, next: "Silver Molt" };
        return { tier: "Hatchling", needed: 30 - score, next: "Bronze Pinch" };
      };

      const activityFeed: Array<{
        type: string;
        message: string;
        timestamp: string;
        highlight?: boolean;
        receiptId?: string;
        gigId?: string;
      }> = [];

      if (agent.lastHeartbeat) {
        const hbAgo = Date.now() - new Date(agent.lastHeartbeat).getTime();
        const hbMin = Math.round(hbAgo / 60000);
        activityFeed.push({
          type: "heartbeat",
          message: `Heartbeat received — ${hbMin < 60 ? hbMin + " min ago" : Math.round(hbMin / 60) + " hrs ago"}`,
          timestamp: agent.lastHeartbeat.toISOString ? agent.lastHeartbeat.toISOString() : String(agent.lastHeartbeat),
        });
      }

      for (const re of repEvents.slice(0, 30)) {
        const isPositive = re.scoreChange >= 0;
        activityFeed.push({
          type: "reputation",
          message: `${isPositive ? "+" : ""}${re.scoreChange} reputation — ${re.details || re.eventType}`,
          timestamp: re.createdAt?.toISOString?.() || String(re.createdAt || ""),
        });
      }

      for (const gig of completedGigs.slice(0, 10)) {
        const receipt = trustReceipts.find(r => r.gigId === gig.id);
        activityFeed.push({
          type: "gig_completed",
          message: `Gig completed: ${gig.title} — earned ${gig.budget} ${gig.currency}`,
          timestamp: gig.createdAt?.toISOString?.() || String(gig.createdAt || ""),
          receiptId: receipt?.id,
          gigId: gig.id,
        });
      }

      for (const re of recentRepEvents) {
        if (re.eventType === "tier_change" || re.details?.toLowerCase().includes("molted") || re.details?.toLowerCase().includes("tier")) {
          activityFeed.push({
            type: "tier_change",
            message: `${re.details || "Tier change!"}`,
            timestamp: re.createdAt?.toISOString?.() || String(re.createdAt || ""),
            highlight: true,
          });
        }
      }

      for (const be of bondEvents.slice(0, 10)) {
        activityFeed.push({
          type: "bond",
          message: `Bond ${be.eventType.toLowerCase()}: ${be.amount} USDC${be.reason ? " — " + be.reason : ""}`,
          timestamp: be.createdAt?.toISOString?.() || String(be.createdAt || ""),
        });
      }

      activityFeed.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      const now = new Date();
      const earningsGrouped = {
        weekly: [] as { date: string; amount: number }[],
        monthly: [] as { date: string; amount: number }[],
        all: [] as { date: string; amount: number }[],
      };

      const weeklyMap = new Map<string, number>();
      const monthlyMap = new Map<string, number>();
      const allMap = new Map<string, number>();

      for (const e of earningsHistory) {
        const d = e.completedAt ? new Date(e.completedAt) : now;
        const dayKey = d.toISOString().split("T")[0];
        const weekKey = `${d.getFullYear()}-W${Math.ceil((d.getDate() + new Date(d.getFullYear(), d.getMonth(), 1).getDay()) / 7).toString().padStart(2, "0")}`;
        const monthKey = `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, "0")}`;

        allMap.set(dayKey, (allMap.get(dayKey) || 0) + e.amount);
        if (d > new Date(now.getTime() - 30 * 24 * 3600000)) {
          monthlyMap.set(dayKey, (monthlyMap.get(dayKey) || 0) + e.amount);
        }
        if (d > new Date(now.getTime() - 7 * 24 * 3600000)) {
          weeklyMap.set(dayKey, (weeklyMap.get(dayKey) || 0) + e.amount);
        }
      }

      weeklyMap.forEach((amount, date) => earningsGrouped.weekly.push({ date, amount }));
      monthlyMap.forEach((amount, date) => earningsGrouped.monthly.push({ date, amount }));
      allMap.forEach((amount, date) => earningsGrouped.all.push({ date, amount }));
      earningsGrouped.weekly.sort((a, b) => a.date.localeCompare(b.date));
      earningsGrouped.monthly.sort((a, b) => a.date.localeCompare(b.date));
      earningsGrouped.all.sort((a, b) => a.date.localeCompare(b.date));

      const enrichedActiveGigs = await Promise.all(
        activeGigs.map(async (gig) => {
          const escrow = await storage.getEscrowByGig(gig.id);
          const counterparty = gig.assigneeId === agent.id
            ? await storage.getAgent(gig.posterId)
            : gig.assigneeId ? await storage.getAgent(gig.assigneeId) : null;
          return {
            ...gig,
            escrowAmount: escrow?.amount || 0,
            escrowStatus: escrow?.status || null,
            counterparty: counterparty ? { id: counterparty.id, handle: counterparty.handle, avatar: counterparty.avatar } : null,
            timeElapsed: gig.createdAt ? Date.now() - new Date(gig.createdAt).getTime() : 0,
          };
        })
      );

      const alerts = disputedGigs.map(g => ({
        type: "dispute",
        message: `${agent.handle} is in a dispute on Gig "${g.title}"`,
        gigId: g.id,
      }));

      const tierInfo = getNextTierThreshold(agent.fusedScore);

      res.json({
        agent: {
          id: agent.id,
          handle: agent.handle,
          walletAddress: agent.walletAddress,
          avatar: agent.avatar,
          fusedScore: agent.fusedScore,
          onChainScore: agent.onChainScore,
          totalEarned: agent.totalEarned,
          totalGigsCompleted: agent.totalGigsCompleted,
          bondTier: agent.bondTier,
          availableBond: agent.availableBond,
          riskIndex: agent.riskIndex,
          isVerified: agent.isVerified,
          autonomyStatus: agent.autonomyStatus,
        },
        stats: {
          totalEarned: agent.totalEarned,
          activeGigsCount: activeGigs.length,
          fusedScore: agent.fusedScore,
          scoreTrend: scoreChangeLastWeek,
          currentTier: getTier(agent.fusedScore),
          tierInfo,
        },
        earningsChart: earningsGrouped,
        activityFeed: activityFeed.slice(0, 50),
        activeGigs: enrichedActiveGigs,
        alerts,
        reputationHistory: repEvents.map(e => ({
          id: e.id,
          scoreChange: e.scoreChange,
          eventType: e.eventType,
          details: e.details,
          source: e.source,
          timestamp: e.createdAt?.toISOString?.() || String(e.createdAt || ""),
        })).slice(0, 100),
        trustReceipts: trustReceipts.slice(0, 20),
        x402: {
          payments: x402PaymentsList,
          stats: x402Stats,
        },
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/x402/payments/:agentId", async (req, res) => {
    try {
      const agentId = req.params.agentId;
      const limit = parseInt(req.query.limit as string) || 50;
      const payments = await storage.getX402PaymentsForAgent(agentId, limit);
      const stats = await storage.getX402PaymentStats(agentId);
      res.json({ payments, stats });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/x402/stats", async (_req, res) => {
    try {
      const stats = await storage.getX402PaymentStats();
      res.json({
        ...stats,
        endpoints: {
          "trust-check": { price: 0.001, currency: "USDC", chain: "base-sepolia" },
          "reputation": { price: 0.002, currency: "USDC", chain: "base-sepolia" },
        },
        protocol: "x402",
        facilitator: "https://x402.org/facilitator",
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/agents/:id/unread-count", agentAuthMiddleware, async (req, res) => {
    try {
      const agentId = (req as any).agentId;
      if (agentId !== req.params.id) {
        return res.status(403).json({ message: "Can only check your own unread count" });
      }
      const total = await storage.getTotalUnreadCount(agentId);
      res.json({ unreadCount: total });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/slashes", apiLimiter, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;
      const allSlashes = await storage.getSlashEvents(limit + offset);
      const slashes = allSlashes.slice(offset, offset + limit);

      const enriched = await Promise.all(slashes.map(async (s) => {
        const agent = await storage.getAgent(s.agentId);
        const gig = s.gigId ? await storage.getGig(s.gigId) : null;
        return {
          ...s,
          agent: agent ? { id: agent.id, handle: agent.handle, avatar: agent.avatar, fusedScore: agent.fusedScore } : null,
          gig: gig ? { id: gig.id, title: gig.title, budget: gig.budget } : null,
        };
      }));

      const totalCount = allSlashes.length;
      const totalSlashed = allSlashes.reduce((sum, s) => sum + (s.amount || 0), 0);

      res.json({
        slashes: enriched,
        total: totalCount,
        totalSlashed,
        limit,
        offset,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/slashes/agent/:agentId", apiLimiter, async (req, res) => {
    try {
      const agentId = req.params.agentId as string;
      const slashes = await storage.getSlashEventsForAgent(agentId);
      const slashCount = await storage.getSlashEventCount(agentId);

      const enriched = await Promise.all(slashes.map(async (s) => {
        const gig = s.gigId ? await storage.getGig(s.gigId) : null;
        return {
          ...s,
          gig: gig ? { id: gig.id, title: gig.title, budget: gig.budget } : null,
        };
      }));

      res.json({
        slashes: enriched,
        count: slashCount,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/slashes/:id", apiLimiter, async (req, res) => {
    try {
      const slash = await storage.getSlashEvent(req.params.id as string);
      if (!slash) return res.status(404).json({ message: "Slash event not found" });

      const agent = await storage.getAgent(slash.agentId);
      const gig = slash.gigId ? await storage.getGig(slash.gigId) : null;

      let swarmVotesData = null;
      if (slash.swarmVotes) {
        try {
          swarmVotesData = JSON.parse(slash.swarmVotes);
        } catch {
          swarmVotesData = null;
        }
      }

      res.json({
        ...slash,
        swarmVotesData,
        agent: agent ? {
          id: agent.id,
          handle: agent.handle,
          avatar: agent.avatar,
          fusedScore: agent.fusedScore,
          bondTier: agent.bondTier,
        } : null,
        gig: gig ? {
          id: gig.id,
          title: gig.title,
          budget: gig.budget,
          description: gig.description,
        } : null,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/agents/:id/inherit-reputation", strictLimiter, async (req, res) => {
    try {
      const oldAgentId = req.params.id as string;
      const { newWallet, oldWallet, signature, newAgentId } = req.body;

      if (!newWallet || !oldWallet || !newAgentId) {
        return res.status(400).json({ message: "newWallet, oldWallet, and newAgentId are required" });
      }

      const oldAgent = await storage.getAgent(oldAgentId);
      if (!oldAgent) {
        return res.status(404).json({ message: "Source agent not found" });
      }

      if (oldAgent.walletAddress.toLowerCase() !== oldWallet.toLowerCase()) {
        return res.status(400).json({ message: "oldWallet does not match agent's registered wallet" });
      }

      const newAgent = await storage.getAgent(newAgentId);
      if (!newAgent) {
        return res.status(404).json({ message: "Target agent not found" });
      }

      if (newAgent.totalGigsCompleted !== 0) {
        return res.status(400).json({ message: "Target agent must have zero completed gigs to inherit reputation" });
      }

      const existingMigration = await storage.getMigrationByAgent(oldAgentId);
      if (existingMigration) {
        return res.status(409).json({ message: "This agent has already been involved in a migration" });
      }

      const badgesArray = oldAgent.skills || [];
      const migratedBadges = JSON.stringify(badgesArray);

      await storage.updateAgent(newAgentId, {
        fusedScore: oldAgent.fusedScore,
        totalGigsCompleted: oldAgent.totalGigsCompleted,
        totalEarned: oldAgent.totalEarned,
        performanceScore: oldAgent.performanceScore,
        bondReliability: oldAgent.bondReliability,
        onChainScore: oldAgent.onChainScore,
        moltbookKarma: oldAgent.moltbookKarma,
      });

      await storage.updateAgent(oldAgentId, {
        autonomyStatus: "pending",
        bio: (oldAgent.bio || "") + " (MIGRATED)",
      });

      const migration = await storage.createReputationMigration({
        oldAgentId,
        newAgentId,
        oldWallet,
        newWallet,
        migratedScore: oldAgent.fusedScore,
        migratedGigs: oldAgent.totalGigsCompleted,
        migratedBadges,
        status: "completed",
      });

      res.json({
        success: true,
        migration,
        message: `Reputation successfully migrated from ${oldAgent.handle} to ${newAgent.handle}`,
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/agents/:id/migration-status", apiLimiter, async (req, res) => {
    try {
      const agentId = req.params.id as string;
      const migration = await storage.getMigrationByAgent(agentId);

      if (!migration) {
        return res.json({ hasMigrated: false, migration: null });
      }

      const isSource = migration.oldAgentId === agentId;
      const isTarget = migration.newAgentId === agentId;

      let relatedAgent = null;
      if (isSource) {
        relatedAgent = await storage.getAgent(migration.newAgentId);
      } else if (isTarget) {
        relatedAgent = await storage.getAgent(migration.oldAgentId);
      }

      res.json({
        hasMigrated: true,
        direction: isSource ? "outgoing" : "incoming",
        migration,
        relatedAgent: relatedAgent ? {
          id: relatedAgent.id,
          handle: relatedAgent.handle,
          avatar: relatedAgent.avatar,
        } : null,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  return httpServer;
}
