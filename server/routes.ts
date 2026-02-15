import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import rateLimit from "express-rate-limit";
import { storage } from "./storage";
import { insertGigSchema, insertEscrowSchema, registerAgentSchema, moltSyncSchema, autonomousRegisterSchema, insertAgentSkillSchema } from "@shared/schema";
import { z } from "zod";
import * as jose from "jose";
import crypto from "crypto";
import { type Address } from "viem";
import { computeFusedScore, getScoreBreakdown, estimateRepBoostFromMolt, computeLiveFusedReputation } from "./reputation";
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
import { startBot, stopBot, getBotStatus, runBotCycle, previewBotCycle, triggerIntroPost, postManifesto } from "./moltbook-bot";
import { syncProtocolFiles, syncSingleFile, syncAllFiles, syncSkillRepo, checkGitHubConnection, getProtocolFileList, getAllFileList } from "./github-sync";
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

  app.get("/api/agents", async (_req, res) => {
    const agents = await storage.getAgents();
    res.json(agents);
  });

  app.get("/api/agents/:id", async (req, res) => {
    const agent = await storage.getAgent(req.params.id);
    if (!agent) return res.status(404).json({ message: "Agent not found" });
    res.json(agent);
  });

  app.get("/api/agents/:id/gigs", async (req, res) => {
    const gigs = await storage.getGigsByAgent(req.params.id);
    res.json(gigs);
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

      const updated = await storage.updateGig(gigId.data, {
        assigneeId,
        status: "assigned",
      });

      await storage.createReputationEvent({
        agentId: assigneeId,
        eventType: "gig_assigned",
        scoreChange: 2,
        source: "escrow",
        details: `Assigned to gig: ${gig.title}`,
      });

      res.json(updated);
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
      const topAgents = await storage.getTopAgentsByFusedScore(candidateCount, excludeIds);

      if (topAgents.length < threshold) {
        return res.status(400).json({
          message: `Not enough eligible validators. Found ${topAgents.length}, need at least ${threshold}. Try reducing threshold or candidate count.`,
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
  });

  app.post("/api/validations/vote", apiLimiter, walletAuthMiddleware, async (req, res) => {
    try {
      const parsed = voteBodySchema.parse(req.body);
      const { validationId, voterId, vote } = parsed;

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
      await storage.castVote({ validationId, voterId, vote, rewardAmount });

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
                fusedScore: computeFusedScore(Math.min(assignee.onChainScore + 10, 1000), assignee.moltbookKarma),
              });
            }
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
                  fusedScore: computeFusedScore(Math.min(voter.onChainScore + 2, 1000), voter.moltbookKarma),
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
      const newFused = computeFusedScore(agent.onChainScore, effectiveKarma);

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

    function getTierName(score: number) {
      if (score >= 90) return "Diamond Claw";
      if (score >= 70) return "Gold Shell";
      if (score >= 50) return "Silver Molt";
      if (score >= 30) return "Bronze Pinch";
      return "Hatchling";
    }

    const topTiersCount: Record<string, number> = {};
    const badgeCounts: Record<string, number> = {};
    agents.forEach((a) => {
      const tier = getTierName(a.fusedScore);
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

      const getRank = (score: number): string => {
        if (score >= 90) return "Diamond Claw";
        if (score >= 70) return "Gold Shell";
        if (score >= 50) return "Silver Molt";
        if (score >= 30) return "Bronze Pinch";
        return "Hatchling";
      };

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

      const hireable = effectiveScore >= 40 && !hasActiveDisputes;

      let reason: string;
      if (hireable) {
        reason = "Meets threshold (fused >= 40, no disputes, recently active)";
      } else {
        const reasons: string[] = [];
        if (effectiveScore < 40) reasons.push(`score too low (${effectiveScore})`);
        if (hasActiveDisputes) reasons.push("has active disputes");
        if (daysSinceActive > 30) reasons.push(`inactive for ${daysSinceActive} days (score decayed)`);
        reason = `Not hireable: ${reasons.join(", ")}`;
      }

      const disputeSummaryUrl = hasActiveDisputes
        ? `/disputes?wallet=${encodeURIComponent(agent.walletAddress)}`
        : undefined;

      res.json({
        hireable,
        score: effectiveScore,
        confidence,
        reason,
        onChainVerified,
        details: {
          wallet: agent.walletAddress,
          fusedScore: agent.fusedScore,
          hasActiveDisputes,
          lastActive: lastActive instanceof Date ? lastActive.toISOString() : String(lastActive),
          rank: getRank(effectiveScore),
          onChainRepScore,
          disputeSummaryUrl,
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

    const updated = await storage.updateAgent(agentId, {
      lastHeartbeat: new Date(),
      autonomyStatus: agent.autonomyStatus === "registered" ? "active" : agent.autonomyStatus,
    });

    res.json({ status: updated?.autonomyStatus, lastHeartbeat: updated?.lastHeartbeat });
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
    const skill = req.query.skill as string;
    if (!skill || skill.length < 1) {
      return res.status(400).json({ message: "Provide ?skill= query parameter" });
    }

    const matched = await storage.searchGigsBySkill(sanitizeString(skill, 100));
    res.json({ gigs: matched, count: matched.length, skill });
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
      const gigId = req.params.gigId;
      const gig = await storage.getGig(gigId);
      if (!gig) return res.status(404).json({ message: "Gig not found" });

      const poster = await storage.getAgent(gig.posterId);
      const posterName = poster?.handle || "Anonymous";

      const existingSubmolt = await storage.getGigSubmoltByGig(gigId);

      const title = `[GIG] ${gig.title} - ${gig.budget} ${gig.currency}`;
      const content = `New gig on ClawTrust Marketplace!\n\n${gig.description}\n\nBudget: ${gig.budget} ${gig.currency} on ${gig.chain === "BASE_SEPOLIA" ? "Base Sepolia" : "Solana Devnet"}\nSkills: ${gig.skillsRequired.join(", ") || "General"}\nPosted by: ${posterName}\nStatus: ${gig.status}\n\nApply now: https://clawtrust.org/gigs\nRegister your agent: POST https://clawtrust.org/api/agent-register\n\n#AgentEconomy #ClawTrust #GigMarketplace #OpenClaw`;

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

  return httpServer;
}
