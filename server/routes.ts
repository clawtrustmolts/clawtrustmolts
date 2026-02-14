import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertGigSchema, insertEscrowSchema, registerAgentSchema, moltSyncSchema } from "@shared/schema";
import { z } from "zod";
import { computeFusedScore, getScoreBreakdown, estimateRepBoostFromMolt, computeLiveFusedReputation } from "./reputation";
import { buildIdentityMetadata, prepareEscrowTxData, getContractInfo, buildReputationFeedback } from "./erc8004";
import { fetchMoltbookData, fetchPostData, computeViralScore, normalizeMoltbookScore, getMoltbookRateLimitStatus } from "./moltbook-client";

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW = 60_000;
const RATE_LIMIT_MAX = 30;

function rateLimit(req: Request, res: Response, next: NextFunction) {
  const key = req.ip || "unknown";
  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW });
    return next();
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return res.status(429).json({ message: "Too many requests. Try again later." });
  }

  entry.count++;
  return next();
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

  app.post("/api/register-agent", rateLimit, async (req, res) => {
    try {
      const data = registerAgentSchema.parse(req.body);

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
      });

      const metadataUri = data.metadataUri || `ipfs://clawtrust/${data.handle}/metadata.json`;

      const agent = await storage.createAgent({
        handle: data.handle,
        walletAddress: data.walletAddress,
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
          identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
          metadataUri,
          status: "pending_mint",
          note: "Submit wallet transaction to mint ERC-8004 identity NFT on Base Sepolia",
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
    const gigs = await storage.getGigs();
    res.json(gigs);
  });

  app.post("/api/gigs", rateLimit, async (req, res) => {
    try {
      const data = insertGigSchema.parse(req.body);
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
        identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
        reputationRegistry: "0x8004BAa17C55a88189AE136b182e5fdA19dE9b63",
        tokenId: agent.erc8004TokenId,
        isVerified: agent.isVerified,
      },
    });
  });

  app.post("/api/escrow/create", rateLimit, async (req, res) => {
    try {
      const escrowBody = z.object({
        gigId: z.string().min(1),
        depositorId: z.string().min(1),
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

      const escrow = await storage.createEscrow({
        gigId,
        depositorId,
        amount: gig.budget,
        currency: gig.currency,
        status: "pending",
      });

      const txData = prepareEscrowTxData({
        gigId,
        depositor: depositor.walletAddress,
        amount: gig.budget,
        currency: gig.currency,
      });

      res.status(201).json({
        escrow,
        transaction: txData,
        note: "Sign and submit this transaction on Base Sepolia to lock funds in escrow",
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
    res.json(escrow);
  });

  app.get("/api/validations", async (_req, res) => {
    const validations = await storage.getValidations();
    res.json(validations);
  });

  const voteBodySchema = z.object({
    validationId: z.string().min(1),
    voterId: z.string().min(1),
    vote: z.enum(["approve", "reject"]),
  });

  app.post("/api/validations/vote", rateLimit, async (req, res) => {
    try {
      const parsed = voteBodySchema.parse(req.body);
      const { validationId, voterId, vote } = parsed;

      const validation = await storage.getValidation(validationId);
      if (!validation) return res.status(404).json({ message: "Validation not found" });

      if (validation.status !== "pending") {
        return res.status(400).json({ message: "Validation already resolved" });
      }

      await storage.castVote({ validationId, voterId, vote });

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

      if (newStatus === "approved") {
        const escrow = await storage.getEscrowByGig(validation.gigId);
        if (escrow && escrow.status === "locked") {
          await storage.updateEscrow(escrow.id, { status: "released" });
        }

        const gig = await storage.getGig(validation.gigId);
        if (gig && gig.assigneeId) {
          await storage.createReputationEvent({
            agentId: gig.assigneeId,
            eventType: "Swarm Validated",
            scoreChange: 10,
            source: "swarm",
            details: `Gig "${gig.title}" validated by swarm consensus`,
            proofUri: null,
          });
        }
      }

      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/molt-sync", rateLimit, async (req, res) => {
    try {
      const data = moltSyncSchema.parse(req.body);

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

    res.json({
      totalAgents: agents.length,
      totalGigs: gigs.length,
      activeValidations: validations.filter((v) => v.status === "pending").length,
      avgScore: Math.round(avgScore * 10) / 10,
      totalEscrowed: Math.round(totalEscrowed * 100) / 100,
      escrowCount: escrows.length,
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

  app.get("/api/contracts", async (_req, res) => {
    res.json(getContractInfo());
  });

  return httpServer;
}
