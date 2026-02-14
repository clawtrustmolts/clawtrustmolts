import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import rateLimit from "express-rate-limit";
import { storage } from "./storage";
import { insertGigSchema, insertEscrowSchema, registerAgentSchema, moltSyncSchema } from "@shared/schema";
import { z } from "zod";
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
import {
  createEscrowWallet,
  getWalletBalance,
  transferUSDC,
  getTransactionStatus,
  isCircleConfigured,
  SUPPORTED_CHAINS,
  listWallets,
} from "./circle-wallet";

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
    return true;
  }
}

function captchaMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!process.env.TURNSTILE_SECRET_KEY) return next();

  const token = req.body?.captchaToken || req.headers["x-captcha-token"];
  if (!token) {
    return res.status(400).json({ message: "CAPTCHA verification required" });
  }

  verifyTurnstileToken(token as string).then((valid) => {
    if (!valid) {
      logSuspiciousActivity(req, "captcha_failed", "CAPTCHA verification failed");
      return res.status(403).json({ message: "CAPTCHA verification failed" });
    }
    next();
  });
}

function walletAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!process.env.PRIVY_APP_ID) return next();

  const authHeader = req.headers.authorization;
  const walletHeader = req.headers["x-wallet-address"] as string | undefined;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    logSuspiciousActivity(req, "auth_missing", "Missing authorization header on protected endpoint");
    return res.status(401).json({ message: "Authentication required. Please connect your wallet." });
  }

  if (walletHeader && !/^0x[a-fA-F0-9]{40}$/.test(walletHeader)) {
    logSuspiciousActivity(req, "invalid_wallet", `Invalid wallet header: ${walletHeader?.slice(0, 20)}`);
    return res.status(400).json({ message: "Invalid wallet address format" });
  }

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

      const gig = await storage.createGig(data);
      res.status(201).json(gig);
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

  app.post("/api/escrow/admin-resolve", strictLimiter, walletAuthMiddleware, async (req, res) => {
    const adminResolveSchema = z.object({
      gigId: z.string().min(1).max(64),
      action: z.enum(["release_to_assignee", "refund_to_poster"]),
      adminWallet: z.string().regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid Ethereum address"),
    });

    try {
      const { gigId, action, adminWallet } = adminResolveSchema.parse(req.body);

      const ADMIN_WALLETS = (process.env.ADMIN_WALLETS || "").split(",").map(w => w.trim().toLowerCase()).filter(Boolean);

      if (ADMIN_WALLETS.length > 0 && !ADMIN_WALLETS.includes(adminWallet.toLowerCase())) {
        await logSuspiciousActivity(req, "unauthorized_admin_action", `Non-admin wallet ${adminWallet} attempted admin-resolve on gig ${gigId}`, "critical");
        return res.status(403).json({ message: "Wallet not authorized for admin actions" });
      }

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

  app.get("/api/security-logs", async (req, res) => {
    const adminWallet = req.headers["x-admin-wallet"] as string | undefined;
    const ADMIN_WALLETS = (process.env.ADMIN_WALLETS || "").split(",").map(w => w.trim().toLowerCase()).filter(Boolean);

    if (ADMIN_WALLETS.length > 0 && (!adminWallet || !ADMIN_WALLETS.includes(adminWallet.toLowerCase()))) {
      return res.status(403).json({ message: "Admin access required" });
    }

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
        inputValidation: "Zod strict schemas + XSS sanitization on all inputs",
        auditStatus: "Pending - professional audit recommended before mainnet deployment",
      },
    });
  });

  return httpServer;
}
