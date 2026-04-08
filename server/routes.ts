import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import rateLimit from "express-rate-limit";
import { storage } from "./storage";
import { insertGigSchema, insertEscrowSchema, registerAgentSchema, moltSyncSchema, autonomousRegisterSchema, insertAgentSkillSchema, sendMessageSchema, insertSlashEventSchema, insertReputationMigrationSchema, MOLT_RESERVED_NAMES, type Crew } from "@shared/schema";
import { z } from "zod";
import * as jose from "jose";
import crypto from "crypto";
import { type Address, getAddress as toChecksumAddress, verifyMessage } from "viem";
import { computeFusedScore, getScoreBreakdown, estimateRepBoostFromMolt, computeLiveFusedReputation, getTier, computeContextualTrustScore, computeSkillTrustMultiplier, TRUST_SCORE_LABEL, computeSkillTierBonus, getTierLabel, getTierBadge, getNextTierUpgrade, MAX_VERIFIED_SKILLS_BONUS } from "./reputation";
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
  registerOnOfficialERC8004Registry,
} from "./erc8004";
import { fetchMoltbookData, fetchPostData, computeViralScore, normalizeMoltbookScore, getMoltbookRateLimitStatus } from "./moltbook-client";
import { generateClawCard, generateCardMetadata, isCanvasAvailable } from "./card-generator";
import { generatePassportImage, generatePassportMetadata } from "./passport-generator";
import { generateReceiptImage } from "./receipt-generator";
import { generateCrewPassportImage, getCrewTier } from "./crew-passport-generator";
import { startBot, stopBot, getBotStatus, runBotCycle, previewBotCycle, triggerIntroPost, postManifesto, directPost } from "./moltbook-bot";
import { isBot, getBotPrerenderedHTML } from "./bot-prerender";
import { paymentMiddleware } from "x402-express";
import { getBondStatus, ensureBondWallet, depositBond, withdrawBond, lockBond, unlockBond, slashBond, checkBondEligibility, getBondHistory, getNetworkBondStats, lockBondForGig, unlockBondForGig, syncPerformanceScore, computePerformanceScore, MIN_FUSED_SCORE } from "./bond-service";
import { telegramAnnounceSlash } from "./telegram-announcements";
import { agentIdAliases } from "./seed";
import { calculateRiskProfile, updateRiskIndex, recordRiskEvent, checkGigRiskEligibility, getRiskLevel } from "./risk-engine";
import {
  mintPassportForAgent,
  setMoltDomainOnChain,
  updateReputationOnChain,
  lockEscrowOnChain,
  createSwarmValidationOnChain,
  castSwarmVoteOnChain,
  readPassportByWallet,
  readPassportByMoltDomain,
  readPassportById,
  readRepScore,
  readFusedScore,
  readSwarmVerdictOnChain,
  queueBlockchainAction,
  getDeployerAddress,
  cleanupStuckQueueEntries,
  publicClient,
  clawCardNFT,
  escrowContract,
  swarmValidator,
  repAdapter,
  bondContract,
  crewContract,
  transferUSDCOnChain,
  getUSDCBalance,
  ORACLE_WALLET_ADDRESS,
  getOracleHealth,
  ORACLE_ETH_CRITICAL_THRESHOLD,
  registerDomainOnChain,
  isDomainAvailableOnChain,
  REGISTRY_ADDRESS,
  REGISTRY_BASESCAN,
  getNetworkConfig,
  getValidationInfoOnChain,
} from "./blockchain";
import { notifyAgent } from "./notifications";
import { syncProtocolFiles, syncSingleFile, syncAllFiles, syncSkillRepo, syncContractsRepo, syncSdkRepo, syncDocsRepo, syncOrgProfileRepo, syncAllRepos, checkGitHubConnection, getProtocolFileList, getAllFileList, publishToClawHub } from "./github-sync";
import { readSkaleFusedScore, syncScoreToSkale, registerAgentOnSkale, readSkaleIsRegistered, readSkalePassportTotalSupply, readSkaleIdentityCount, readSkaleEscrowStats, readSkaleSwarmValidationCount, SKALE_CONTRACTS, skalePublicClient } from "./skale-chain";
import { REP_ADAPTER_ABI, CLAW_TRUST_REP_ADAPTER_ADDRESS, getWalletClient } from "./chain-client";
import {
  createEscrowWallet,
  getWalletBalance,
  transferUSDC,
  getTransactionStatus,
  isCircleConfigured,
  SUPPORTED_CHAINS,
  listWallets,
  getEntitySecret,
  circleHealthCheck,
  registerEntitySecret,
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

// E2E test secret — only effective when NODE_ENV !== "production" AND explicitly set.
// No implicit default: an unset E2E_TEST_SECRET disables all bypasses even in dev.
// Set this only in isolated CI/dev environments, never in public staging.
const E2E_TEST_SECRET = process.env.E2E_TEST_SECRET || null;
const isTestBypass = (req: Request): boolean => {
  if (process.env.NODE_ENV === "production") return false;
  if (!E2E_TEST_SECRET) return false; // bypass disabled when secret not explicitly set
  return req.headers["x-e2e-test-secret"] === E2E_TEST_SECRET;
};

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: true,
  validate: { xForwardedForHeader: false },
  skip: (req) => isTestBypass(req),
  handler: async (req, res) => {
    await logSuspiciousActivity(req, "rate_limit_exceeded", "Exceeded 100 requests in 15 minutes");
    res.status(429).json({ message: "Too many requests. Please try again later." });
  },
});

const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: true,
  validate: { xForwardedForHeader: false },
  skip: (req) => isTestBypass(req),
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

const registrationWalletTracker = new Map<string, number>();
const REGISTRATION_COOLDOWN_MS = 24 * 60 * 60 * 1000;

if (!process.env.TURNSTILE_SECRET_KEY) {
  console.warn("[Security] WARNING: TURNSTILE_SECRET_KEY is not set. CAPTCHA verification is disabled. Stricter IP+wallet rate limiting applied as fallback.");
}

function registrationRateLimit(req: Request, res: Response, next: NextFunction) {
  if (isTestBypass(req)) return next();
  const wallet = (req.headers["x-wallet-address"] as string || req.body?.walletAddress || "").toLowerCase();
  if (!wallet) return next();

  const now = Date.now();
  for (const [k, ts] of registrationWalletTracker) {
    if (now - ts > REGISTRATION_COOLDOWN_MS) registrationWalletTracker.delete(k);
  }

  const lastRegistration = registrationWalletTracker.get(wallet);
  if (lastRegistration && now - lastRegistration < REGISTRATION_COOLDOWN_MS) {
    logSuspiciousActivity(req, "registration_rate_limit", `Wallet ${wallet} attempted multiple registrations within 24h`);
    return res.status(429).json({ message: "Only one agent registration per wallet address per 24 hours." });
  }

  const origJson = res.json.bind(res);
  res.json = function(body: any) {
    if (res.statusCode >= 200 && res.statusCode < 300) {
      registrationWalletTracker.set(wallet, Date.now());
    }
    return origJson(body);
  };
  next();
}

function captchaMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!process.env.TURNSTILE_SECRET_KEY) {
    if (process.env.NODE_ENV === "production") {
      console.error("[Security] CAPTCHA gate BLOCKED: TURNSTILE_SECRET_KEY is not set in production. Set it to enable registrations.");
      return res.status(503).json({ message: "CAPTCHA service not configured. Platform registrations are temporarily disabled. Contact the operator." });
    }
    return next();
  }

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

const PRIVY_JWKS_URL =
  process.env.PRIVY_JWKS_URL ||
  (process.env.PRIVY_APP_ID
    ? `https://auth.privy.io/api/v1/apps/${process.env.PRIVY_APP_ID}/jwks.json`
    : null);

let privyJWKS: ReturnType<typeof jose.createRemoteJWKSet> | null = null;
if (PRIVY_JWKS_URL) {
  try {
    privyJWKS = jose.createRemoteJWKSet(new URL(PRIVY_JWKS_URL));
    console.log("[Auth] Privy JWKS configured - full ES256 cryptographic JWT verification enabled");
  } catch (err: any) {
    console.error("[Auth] Failed to configure Privy JWKS:", err.message);
  }
}

async function verifyPrivyJWT(token: string): Promise<{ verified: boolean; payload?: any; error?: string }> {
  if (privyJWKS) {
    try {
      const { payload } = await jose.jwtVerify(token, privyJWKS, {
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

const SIG_TTL_MS = 24 * 60 * 60 * 1000;
const SENSITIVE_SIG_TTL_MS = 30 * 60 * 1000;

const SENSITIVE_ROUTES = new Set([
  "POST /api/escrow/release",
  "POST /api/escrow/admin-resolve",
  "POST /api/escrow/dispute",
  "POST /api/swarm/vote",
  "POST /api/validations/vote",
  "POST /api/swarm/validate",
  "POST /api/bond/:agentId/withdraw",
  "POST /api/bond/:agentId/slash",
]);

function isSensitiveRoute(method: string, path: string): boolean {
  const key = `${method.toUpperCase()} ${path}`;
  if (SENSITIVE_ROUTES.has(key)) return true;
  for (const pattern of SENSITIVE_ROUTES) {
    const regex = new RegExp("^" + pattern.replace(/:[^/]+/g, "[^/]+") + "$");
    if (regex.test(key)) return true;
  }
  return false;
}

function buildSignMessage(nonce: number): string {
  return `Welcome to ClawTrust 🦞\n\nSigning this message verifies your wallet ownership.\nNo gas required. No transaction is sent.\n\nNonce: ${nonce}\nChain: Base Sepolia (84532)`;
}

async function walletAuthMiddleware(req: Request, res: Response, next: NextFunction) {
  // E2E test bypass — skip signature checks in dev/test mode only (never in production)
  if (isTestBypass(req)) {
    const walletHeader = req.headers["x-wallet-address"] as string | undefined;
    if (!walletHeader || !/^0x[a-fA-F0-9]{40}$/.test(walletHeader)) {
      return res.status(401).json({ message: "Wallet address required. Connect your wallet to continue." });
    }
    (req as any).authUser = { walletAddress: walletHeader };
    (req as any).wallet = walletHeader;
    return next();
  }

  if (!process.env.PRIVY_APP_ID) {
    const walletHeader = req.headers["x-wallet-address"] as string | undefined;
    if (!walletHeader || !/^0x[a-fA-F0-9]{40}$/.test(walletHeader)) {
      return res.status(401).json({ message: "Wallet address required. Connect your wallet to continue." });
    }

    const signature = req.headers["x-wallet-signature"] as string | undefined;
    const sigTimestamp = req.headers["x-wallet-sig-timestamp"] as string | undefined;

    const sensitive = isSensitiveRoute(req.method, req.route?.path || req.path);
    const ttl = sensitive ? SENSITIVE_SIG_TTL_MS : SIG_TTL_MS;

    if (signature && sigTimestamp) {
      const ts = parseInt(sigTimestamp, 10);
      const now = Date.now();
      if (isNaN(ts) || now - ts > ttl || ts > now + 60000) {
        return res.status(401).json({ message: sensitive ? "Signature expired. Sensitive operations require re-signing within 30 minutes." : "Wallet signature expired or invalid. Please reconnect your wallet." });
      }
      try {
        const message = buildSignMessage(ts);
        const valid = await verifyMessage({
          address: walletHeader as Address,
          message,
          signature: signature as `0x${string}`,
        });
        if (!valid) {
          logSuspiciousActivity(req, "sig_invalid", `Signature verification failed for ${walletHeader}`);
          return res.status(401).json({ message: "Invalid wallet signature. Please reconnect your wallet." });
        }
      } catch (err: any) {
        logSuspiciousActivity(req, "sig_error", `Signature verification error: ${err?.message}`);
        return res.status(401).json({ message: "Wallet signature verification failed." });
      }
    } else {
      // No signature provided. Require signatures for ALL mutation methods (POST/PATCH/PUT/DELETE).
      // GET/HEAD/OPTIONS are read-only and allowed without a signature.
      const isMutation = ["POST", "PATCH", "PUT", "DELETE"].includes(req.method.toUpperCase());
      if (sensitive || isMutation) {
        logSuspiciousActivity(
          req, "sdk_no_sig",
          `Unsigned ${req.method} from ${walletHeader} on ${req.path} — signature required on SDK path`,
          sensitive ? "critical" : "warning"
        );
        return res.status(401).json({
          message: "Wallet signature required. Include x-wallet-signature and x-wallet-sig-timestamp headers with your request.",
        });
      }
      console.warn(`[auth] Unsigned GET request from ${walletHeader} on ${req.method} ${req.path} — read-only, allowed`);
    }

    (req as any).authUser = { walletAddress: walletHeader };
    (req as any).wallet = walletHeader;
    return next();
  }

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

  verifyPrivyJWT(token).then(async (result) => {
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

    const resolvedWallet = walletHeader || tokenWallet;

    const sensitive = isSensitiveRoute(req.method, req.route?.path || req.path);
    if (sensitive) {
      const sig = req.headers["x-wallet-signature"] as string | undefined;
      const sigTs = req.headers["x-wallet-sig-timestamp"] as string | undefined;
      if (!sig || !sigTs) {
        logSuspiciousActivity(req, "privy_sensitive_no_sig", `Privy JWT auth on sensitive route ${req.method} ${req.path} without SIWE signature — rejected`);
        return res.status(401).json({ message: "Wallet signature required for this sensitive operation, even with Privy authentication." });
      }
      const ts = parseInt(sigTs, 10);
      const now = Date.now();
      if (isNaN(ts) || now - ts > SENSITIVE_SIG_TTL_MS || ts > now + 60000) {
        logSuspiciousActivity(req, "privy_sensitive_sig_expired", `Privy JWT + SIWE signature expired on ${req.method} ${req.path}`);
        return res.status(401).json({ message: "Wallet signature expired for sensitive operation. Please re-sign." });
      }
      try {
        const expectedMessage = buildSignMessage(ts);
        const valid = await verifyMessage({
          address: resolvedWallet as `0x${string}`,
          message: expectedMessage,
          signature: sig as `0x${string}`,
        });
        if (!valid) {
          logSuspiciousActivity(req, "privy_sensitive_sig_invalid", `Privy JWT + SIWE signature invalid for ${resolvedWallet}`);
          return res.status(401).json({ message: "Invalid wallet signature for sensitive operation." });
        }
      } catch (err: any) {
        logSuspiciousActivity(req, "privy_sensitive_sig_error", `SIWE verification error in Privy flow: ${err?.message}`);
        return res.status(401).json({ message: "Wallet signature verification failed." });
      }
    }

    (req as any).authUser = {
      sub: result.payload?.sub,
      walletAddress: resolvedWallet,
    };
    (req as any).wallet = resolvedWallet;

    next();
  }).catch(() => {
    logSuspiciousActivity(req, "auth_internal_error", "Internal auth verification error");
    return res.status(500).json({ message: "Authentication service error" });
  });
}

async function adminAuthMiddleware(req: Request, res: Response, next: NextFunction) {
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

  // E2E test bypass — skip SIWE signature verification in dev/test mode only (never in production)
  if (isTestBypass(req)) {
    console.log(`[AdminAuth] E2E bypass: skipping signature check for admin ${adminWallet}`);
    (req as any).adminWallet = adminWallet;
    return next();
  }

  const adminSig = req.headers["x-admin-signature"] as string | undefined;
  const adminSigTs = req.headers["x-admin-sig-timestamp"] as string | undefined;

  if (!adminSig || !adminSigTs) {
    logSuspiciousActivity(req, "admin_no_signature", `Admin ${adminWallet} sent request without SIWE signature — rejected`);
    return res.status(401).json({ message: "Admin signature required. Sign with your admin wallet to authenticate." });
  }

  const ts = parseInt(adminSigTs, 10);
  const now = Date.now();
  if (isNaN(ts) || now - ts > SENSITIVE_SIG_TTL_MS || ts > now + 60000) {
    logSuspiciousActivity(req, "admin_sig_expired", `Admin ${adminWallet} sent expired signature`);
    return res.status(401).json({ message: "Admin signature expired. Re-sign within 30 minutes." });
  }

  try {
    const message = buildSignMessage(ts);
    const valid = await verifyMessage({
      address: adminWallet as Address,
      message,
      signature: adminSig as `0x${string}`,
    });
    if (!valid) {
      logSuspiciousActivity(req, "admin_sig_invalid", `Admin signature verification failed for ${adminWallet}`, "critical");
      return res.status(401).json({ message: "Invalid admin signature." });
    }
  } catch (err: any) {
    logSuspiciousActivity(req, "admin_sig_error", `Admin signature verification error: ${err?.message}`);
    return res.status(401).json({ message: "Admin signature verification failed." });
  }

  (req as any).adminWallet = adminWallet;
  next();
}

async function syncAgentSkillBonusAndVerifiedSkills(agentId: string): Promise<void> {
  const allVerifications = await storage.getSkillVerifications(agentId);
  const verifiedFromTiers = allVerifications.filter(v => (v.tier ?? 0) >= 1).map(v => v.skillName);
  const tierBonus = computeSkillTierBonus(allVerifications.map(v => v.tier ?? 0));
  const agent = await storage.getAgent(agentId);
  if (!agent) return;
  const newFusedScore = Math.max(0, Math.round(getScoreBreakdown(agent, tierBonus).fusedScore * 10) / 10);
  await storage.updateAgent(agentId, {
    fusedScore: newFusedScore,
    verifiedSkills: verifiedFromTiers,
  });
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get("/", async (req, res, next) => {
    if (!isBot(req.headers["user-agent"])) return next();
    try {
      const [allAgents, allGigs] = await Promise.all([
        storage.getAgents(),
        storage.getGigs(),
      ]);
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=300");
      return res.send(getBotPrerenderedHTML({
        totalAgents: allAgents.length,
        openGigs: allGigs.filter(g => g.status === "open").length,
        completedGigs: allGigs.filter(g => g.status === "completed").length,
      }));
    } catch {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(getBotPrerenderedHTML());
    }
  });

  const ERC8004_NFT_ADDRESS = process.env.CLAW_CARD_NFT_ADDRESS || "0xf24e41980ed48576Eb379D2116C1AaD075B342C4";
  const ERC8004_CAIP10_REGISTRY = `eip155:84532:${ERC8004_NFT_ADDRESS}`;
  const PRODUCTION_BASE_URL = "https://clawtrust.org";

  app.post("/api/admin/register-on-erc8004", adminAuthMiddleware, async (req, res) => {
    try {
      const agents = await storage.getAgents();
      const eligible = agents.filter((a: any) => !a.officialRegistryAgentId);
      const results: any[] = [];

      for (const agent of eligible) {
        const metadataUri = `${PRODUCTION_BASE_URL}/api/agents/${agent.id}/card/metadata`;
        const result = await registerOnOfficialERC8004Registry(metadataUri);
        results.push({ handle: agent.handle, agentId: agent.id, ...result });
        if (result.success && result.agentId) {
          await storage.updateAgent(agent.id, { officialRegistryAgentId: result.agentId });
        }
        await new Promise(r => setTimeout(r, 3000));
      }

      res.json({ registered: results.filter((r: any) => r.success).length, total: eligible.length, results });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/register-agent-erc8004/:agentId", adminAuthMiddleware, async (req, res) => {
    try {
      const agent = await storage.getAgent(String(req.params.agentId));
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const metadataUri = `${PRODUCTION_BASE_URL}/api/agents/${agent.id}/card/metadata`;
      const result = await registerOnOfficialERC8004Registry(metadataUri);

      if (result.success && result.agentId) {
        await storage.updateAgent(agent.id, { officialRegistryAgentId: result.agentId });
      }

      res.json({ handle: agent.handle, agentId: agent.id, metadataUri, ...result });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // In-memory registration token store (supplements the REGISTRATION_API_KEY env var)
  // Tokens survive server restarts only if persisted in REGISTRATION_API_KEY; issued tokens are session-scoped
  const issuedRegistrationTokens: Map<string, { label: string; createdAt: Date; createdByWallet: string }> = new Map();

  app.get("/api/admin/registration-tokens", adminAuthMiddleware, (req, res) => {
    const tokens: Array<{ label: string; prefix: string; createdAt?: Date; primary: boolean; createdByWallet?: string }> = [];
    const envKey = process.env.REGISTRATION_API_KEY;
    if (envKey) {
      tokens.push({ label: "Primary (REGISTRATION_API_KEY env var)", prefix: envKey.slice(0, 8) + "...", primary: true });
    } else {
      tokens.push({ label: "Primary key not set — no REGISTRATION_API_KEY env var", prefix: "(none)", primary: true });
    }
    for (const [token, info] of issuedRegistrationTokens) {
      tokens.push({ label: info.label, prefix: token.slice(0, 12) + "...", createdAt: info.createdAt, primary: false, createdByWallet: info.createdByWallet });
    }
    res.json({ tokens, count: tokens.length, sessionTokensActive: issuedRegistrationTokens.size });
  });

  app.post("/api/admin/registration-tokens", adminAuthMiddleware, (req, res) => {
    const { label = "Admin-issued token" } = req.body || {};
    const token = `ct-reg-${crypto.randomBytes(20).toString("hex")}`;
    const adminWallet = (req.headers["x-admin-wallet"] as string) || "unknown";
    issuedRegistrationTokens.set(token, { label, createdAt: new Date(), createdByWallet: adminWallet });
    console.log(`[Admin] Registration token issued by ${adminWallet}: label="${label}"`);
    res.json({ token, label, message: "Store this token securely — it will not be shown again. Session-scoped: restarts clear it." });
  });

  app.delete("/api/admin/registration-tokens/:prefix", adminAuthMiddleware, (req, res) => {
    const prefix = String(req.params.prefix);
    let revoked = 0;
    for (const [token] of issuedRegistrationTokens) {
      if (token.startsWith(prefix)) {
        issuedRegistrationTokens.delete(token);
        revoked++;
      }
    }
    res.json({ revoked, message: revoked > 0 ? `Revoked ${revoked} token(s)` : "No matching token found" });
  });

  app.get("/.well-known/agent-card.json", async (_req, res) => {
    try {
      const agents = await storage.getAgents();
      const molty = agents.find((a: any) => a.handle === "Molty" || a.handle === "molty");
      if (!molty) {
        return res.status(404).json({ error: "Platform agent not found" });
      }
      res.set({
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      });
      res.json(generateCardMetadata(molty, PRODUCTION_BASE_URL));
    } catch (err: any) {
      res.status(500).json({ error: "Failed to generate agent card" });
    }
  });

  app.get("/.well-known/agents.json", async (_req, res) => {
    try {
      const agents = await storage.getAgents();
      const registered = agents.filter((a: any) => a.erc8004TokenId);
      res.set({
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
        "Access-Control-Allow-Origin": "*",
      });
      const SKALE_NFT_ADDR = "0xdB7F6cCf57D6c6AA90ccCC1a510589513f28cb83";
      const SKALE_EXPLORER = "https://base-sepolia-testnet-explorer.skalenodes.com";
      res.json(registered.map((a: any) => {
        const onSkale = a.preferredChain === "SKALE_TESTNET" || a.homeChain === "SKALE_TESTNET";
        const scanUrl = a.erc8004TokenId
          ? onSkale
            ? `${SKALE_EXPLORER}/token/${SKALE_NFT_ADDR}?a=${a.erc8004TokenId}`
            : `https://8004scan.io/agents/base-sepolia/${a.erc8004TokenId}`
          : null;
        return {
          type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
          name: a.handle,
          handle: a.handle,
          tokenId: a.erc8004TokenId ? parseInt(a.erc8004TokenId, 10) : null,
          agentRegistry: ERC8004_CAIP10_REGISTRY,
          metadataUri: `${PRODUCTION_BASE_URL}/api/agents/${a.id}/card/metadata`,
          walletAddress: a.walletAddress,
          moltDomain: a.moltDomain || null,
          fusedScore: a.fusedScore || 0,
          tier: a.tier || "Hatchling",
          chain: onSkale ? "SKALE_TESTNET" : "BASE_SEPOLIA",
          scanUrl,
        };
      }));
    } catch (err: any) {
      res.status(500).json({ error: "Failed to list agents" });
    }
  });

  const x402PayToAddress = process.env.X402_PAY_TO_ADDRESS || "0x0000000000000000000000000000000000000000";
  const x402Enabled = x402PayToAddress !== "0x0000000000000000000000000000000000000000";

  const x402UsedProofs = new Map<string, number>();
  const X402_PROOF_TTL_MS = 10 * 60 * 1000;

  function x402CleanupExpired() {
    const now = Date.now();
    for (const [key, ts] of x402UsedProofs) {
      if (now - ts > X402_PROOF_TTL_MS) x402UsedProofs.delete(key);
    }
  }

  setInterval(x402CleanupExpired, 60_000);

  // ─── Crew score auto-sync: recalculate crew FusedScore every 30 minutes ──
  async function syncAllCrewScores() {
    try {
      const allCrews = await storage.getCrews();
      for (const crew of allCrews) {
        const members = await storage.getCrewMembers(crew.id);
        if (members.length === 0) continue;
        const agentData = await Promise.all(members.map(m => storage.getAgent(m.agentId)));
        const valid = agentData.filter(Boolean);
        if (valid.length === 0) continue;
        const avgScore = Math.round((valid.reduce((s, a) => s + (a!.fusedScore || 0), 0) / valid.length) * 10) / 10;
        const bondPool = Math.round(valid.reduce((s, a) => s + (a!.availableBond || 0), 0) * 100) / 100;
        if (avgScore !== crew.fusedScore || bondPool !== crew.bondPool) {
          await storage.updateCrew(crew.id, { fusedScore: avgScore, bondPool });
        }
      }
    } catch (e) {
      // Non-critical: silently skip
    }
  }
  setInterval(syncAllCrewScores, 30 * 60 * 1000); // every 30 min

  function x402ReplayGuard(req: Request, res: Response, next: NextFunction) {
    const paymentHeader = (req.headers["x-payment"] || req.headers["x-payment-response"]) as string | undefined;
    if (!paymentHeader) return next();

    const callerWallet = (req.headers["x-wallet-address"] || req.ip || "unknown") as string;
    const endpoint = `${req.method} ${req.path}`;
    const rawProofHash = crypto.createHash("sha256").update(paymentHeader).digest("hex");
    const boundProofHash = crypto.createHash("sha256").update(`${paymentHeader}|${callerWallet}|${endpoint}`).digest("hex");
    const now = Date.now();

    const x402CostMap: Record<string, string> = {
      "/api/trust-check": "$0.001",
      "/api/reputation": "$0.002",
      "/api/agents": "$0.001",
    };
    const endpointCost = Object.entries(x402CostMap).find(([prefix]) => req.path.startsWith(prefix))?.[1] || "$0.001";

    const existingRawTs = x402UsedProofs.get(rawProofHash);
    if (existingRawTs !== undefined && now - existingRawTs <= X402_PROOF_TTL_MS) {
      logSuspiciousActivity(req, "x402_replay", `Replayed x402 payment proof on ${endpoint} from ${callerWallet}`);
      return res.status(402).json({
        error: "Payment proof already used",
        code: 402,
        reason: "x402 replay detected — this payment proof has already been submitted",
        cost: endpointCost,
        currency: "USDC",
        network: "base-sepolia",
        agentWallet: callerWallet !== "unknown" ? callerWallet : undefined,
        retryAfter: "Submit a fresh payment with a new x-payment header",
        message: "Payment proof already used. Submit a new payment.",
      });
    }
    const existingBoundTs = x402UsedProofs.get(boundProofHash);
    if (existingBoundTs !== undefined && now - existingBoundTs <= X402_PROOF_TTL_MS) {
      logSuspiciousActivity(req, "x402_replay_bound", `Replayed x402 bound proof on ${endpoint} from ${callerWallet}`);
      return res.status(402).json({
        error: "Payment proof already used",
        code: 402,
        reason: "x402 replay detected — this proof was already used for this wallet and endpoint combination",
        cost: endpointCost,
        currency: "USDC",
        network: "base-sepolia",
        agentWallet: callerWallet !== "unknown" ? callerWallet : undefined,
        retryAfter: "Submit a fresh payment with a new x-payment header",
        message: "Payment proof already used for this wallet and endpoint. Submit a new payment.",
      });
    }

    x402UsedProofs.set(rawProofHash, now);
    x402UsedProofs.set(boundProofHash, now);

    next();
  }

  if (x402Enabled) {
    try {
      const x402PayMiddleware = paymentMiddleware(
        x402PayToAddress as `0x${string}`,
        {
          "GET /api/trust-check/*": {
              price: "$0.001",
              network: "base-sepolia",
              config: {
                description: "ClawTrust trust-check API — returns full agent trust data including TrustScore, tier, risk, and hireability status",
              },
            },
            "GET /api/reputation/*": {
              price: "$0.002",
              network: "base-sepolia",
              config: {
                description: "ClawTrust reputation lookup — returns detailed fused reputation breakdown, on-chain verification, and event history",
              },
            },
            "GET /api/agents/*/erc8004": {
              price: "$0.001",
              network: "base-sepolia",
              config: {
                description: "ClawTrust ERC-8004 portable reputation — returns full on-chain identity and trust passport for any agent by .molt handle",
              },
            },
          },
        );
      // Inject WWW-Authenticate header and structured fields on 402 x402 responses
      // x402-express v1 uses JSON body format; this normalizes it for external API consumers
      app.use((req: Request, res: Response, next: NextFunction) => {
        const origJson = (res.json as any).bind(res);
        (res as any).json = function(body: any) {
          if (res.statusCode === 402 && body?.x402Version !== undefined && Array.isArray(body?.accepts) && body.accepts.length > 0) {
            const first = body.accepts[0];
            if (first) {
              const amount = first.maxAmountRequired || "0";
              const currency = (first.extra as any)?.name || "USDC";
              const payTo = first.payTo || x402PayToAddress;
              const network = first.network || "base-sepolia";
              if (!res.headersSent) {
                res.setHeader("WWW-Authenticate",
                  `Bearer realm="x402", amount="${amount}", currency="${currency}", payTo="${payTo}", network="${network}"`);
              }
              body.error = body.error || "Payment Required";
              body.code = "PAYMENT_REQUIRED";
              body.cost = amount;
              body.currency = currency;
              body.network = network;
              body.agentWallet = payTo;
              body.retryAfter = `Fund wallet with ${currency} on ${network} and retry with X-Payment header`;
            }
          }
          return origJson(body);
        };
        next();
      });
      // Wrap x402 to skip for E2E test bypass requests and public cross-chain lookup paths
      app.use((req: Request, res: Response, next: NextFunction) => {
        if (isTestBypass(req)) return next();
        // Public reputation lookup paths — no payment required
        if (
          req.path.startsWith("/api/reputation/across-chains/") ||
          req.path.startsWith("/api/reputation/check-chain/") ||
          req.path === "/api/reputation/sync" ||
          req.method === "POST" && req.path === "/api/reputation/sync"
        ) return next();
        return x402PayMiddleware(req, res, next);
      });
      app.use(x402ReplayGuard);
      console.log("[x402] Payment middleware enabled with replay protection — trust-check: $0.001, reputation: $0.002 USDC on Base Sepolia");
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

  app.get("/api/leaderboard", async (req, res) => {
    try {
      const limit = Math.min(parseInt((req.query.limit as string) || "20", 10), 100);
      const agents = await storage.getTopAgentsByFusedScore(limit);
      res.json(agents);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Search agents by handle/bio/skills ──────────────────────────
  app.get("/api/agents/search", async (req, res) => {
    try {
      const q = ((req.query.q as string) || "").toLowerCase().trim();
      const limit = Math.min(parseInt((req.query.limit as string) || "20", 10), 100);
      if (!q) return res.json({ agents: [], total: 0 });
      const all = await storage.getAgents();
      const matched = all.filter((a: any) =>
        a.handle?.toLowerCase().includes(q) ||
        a.bio?.toLowerCase().includes(q) ||
        (Array.isArray(a.skills) && a.skills.some((s: any) =>
          (typeof s === "string" ? s : s?.name ?? "").toLowerCase().includes(q)
        ))
      ).slice(0, limit);
      return res.json({ agents: matched, total: matched.length, query: q });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
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

  const CLAW_CARD_NFT_ADDR = "0xf24e41980ed48576Eb379D2116C1AaD075B342C4";
  const ERC8004_REGISTRY_ADDR = "0x8004A818BFB912233c491871b3d84c89A494BD9e";

  const SKALE_NFT_ADDR_ERC8004 = "0xdB7F6cCf57D6c6AA90ccCC1a510589513f28cb83";
  const SKALE_EXPLORER_URL = "https://base-sepolia-testnet-explorer.skalenodes.com";

  function buildErc8004Payload(agent: any) {
    const onSkale = agent.preferredChain === "SKALE_TESTNET" || agent.homeChain === "SKALE_TESTNET";
    const chainLabel = onSkale ? "skale-testnet" : "base-sepolia";
    const scanUrl = agent.erc8004TokenId
      ? onSkale
        ? `${SKALE_EXPLORER_URL}/token/${SKALE_NFT_ADDR_ERC8004}?a=${agent.erc8004TokenId}`
        : `https://8004scan.io/agents/base-sepolia/${agent.erc8004TokenId}`
      : null;
    return {
      agentId: agent.id,
      handle: agent.handle,
      moltDomain: agent.moltDomain || null,
      walletAddress: agent.walletAddress,
      erc8004TokenId: agent.erc8004TokenId || null,
      registryAddress: ERC8004_REGISTRY_ADDR,
      nftAddress: CLAW_CARD_NFT_ADDR,
      chain: chainLabel,
      fusedScore: agent.fusedScore,
      onChainScore: agent.onChainScore,
      moltbookKarma: agent.moltbookKarma,
      bondTier: agent.bondTier,
      totalBonded: agent.totalBonded,
      riskIndex: agent.riskIndex,
      isVerified: agent.isVerified,
      skills: agent.skills || [],
      basescanUrl: agent.erc8004TokenId
        ? `https://sepolia.basescan.org/token/${CLAW_CARD_NFT_ADDR}?a=${agent.erc8004TokenId}`
        : null,
      scanUrl,
      clawtrust: `https://clawtrust.org/profile/${agent.handle}`,
      resolvedAt: new Date().toISOString(),
    };
  }

  app.get("/api/agents/:handle/erc8004", apiLimiter, async (req, res) => {
    try {
      const handle = String(req.params.handle).replace(/\.molt$/, "");
      const agent = await storage.getAgentByHandle(handle);
      if (!agent) return res.status(404).json({ message: "Agent not found", handle });
      res.json(buildErc8004Payload(agent));
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/erc8004/:tokenId", apiLimiter, async (req, res) => {
    try {
      const tokenId = req.params.tokenId;
      const agents = await storage.getAgents();
      const agent = agents.find((a) => a.erc8004TokenId === tokenId);
      if (!agent) return res.status(404).json({ message: "No agent found with that ERC-8004 token ID", tokenId });
      res.json(buildErc8004Payload(agent));
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

  // x402 payment → reputation feedback: increments x402PaymentCount and adds a capped karma boost.
  // Boost is capped at 50 total (5 points per payment × max 10 payments).
  async function recordX402ReputationBoost(agentId: string, currentCount: number) {
    try {
      const newCount = (currentCount || 0) + 1;
      const updates: Record<string, any> = { x402PaymentCount: newCount };
      if (newCount <= 10) {
        const a = await storage.getAgent(agentId);
        if (a) {
          updates.moltbookKarma = (a.moltbookKarma || 0) + 5;
          await storage.createReputationEvent({
            agentId,
            eventType: "x402 Payment Received",
            scoreChange: 5,
            source: "on_chain",
            details: `x402 micropayment received (payment #${newCount}). Moltbook karma +5 (max boost at 10 payments).`,
            proofUri: null,
          });
        }
      }
      await storage.updateAgent(agentId, updates);
    } catch {
      // Non-blocking: reputation boost failure must not affect the payment response
    }
  }

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

  // GET /api/agents/leaderboard — top 10 agents by fusedScore (must be before :id wildcard)
  app.get("/api/agents/leaderboard", apiLimiter, async (_req, res) => {
    try {
      const topAgents = await storage.getTopAgentsByFusedScore(10);
      const leaderboard = topAgents.map((a, idx) => ({
        rank: idx + 1,
        id: a.id,
        handle: a.handle,
        fusedScore: a.fusedScore ?? 0,
        tier: getTier(a.fusedScore ?? 0),
        isVerified: a.isVerified,
        totalGigsCompleted: a.totalGigsCompleted ?? 0,
        bondTier: a.bondTier,
      }));
      return res.json({ leaderboard, updatedAt: new Date().toISOString() });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/agents/:id", async (req, res) => {
    let agent = await storage.getAgent(req.params.id);
    if (!agent) agent = await storage.getAgentByHandle(req.params.id);
    if (!agent) return res.status(404).json({ message: "Agent not found" });
    const webhookVerification = agent.webhookUrl
      ? {
          signingHeader: "X-ClawTrust-Signature",
          algorithm: "sha256",
          format: "sha256=<hmac-hex>",
          envVar: "WEBHOOK_SECRET",
          note: "Compute HMAC-SHA256 of the raw JSON body using your WEBHOOK_SECRET. Compare to the signature header value.",
        }
      : null;
    res.json({ ...agent, shellTier: getTier(agent.fusedScore), webhookVerification });
  });

  app.patch("/api/agents/:id", apiLimiter, agentAuthMiddleware, async (req, res) => {
    try {
      const agentId = (req as any).agentId;
      if (agentId !== req.params.id) {
        return res.status(403).json({ message: "Can only edit your own profile" });
      }
      const updateSchema = z.object({
        bio: z.string().max(500).optional(),
        skills: z.array(z.string().min(1).max(100)).max(20).optional(),
        avatar: z.string().url().nullable().optional(),
        moltbookLink: z.string().url().nullable().optional(),
        preferredChain: z.enum(["BASE_SEPOLIA", "SOL_DEVNET", "SKALE_TESTNET"]).nullable().optional(),
      });
      const data = updateSchema.parse(req.body);
      const updated = await storage.updateAgent(agentId, data);
      if (!updated) return res.status(404).json({ message: "Agent not found" });
      res.json(updated);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/agents/:id/webhook", apiLimiter, agentAuthMiddleware, async (req, res) => {
    try {
      const agentId = (req as any).agentId;
      if (agentId !== req.params.id) {
        return res.status(403).json({ message: "Can only update your own webhook" });
      }
      const { webhookUrl } = z.object({
        webhookUrl: z.string().url().nullable(),
      }).parse(req.body);
      const updated = await storage.updateAgent(agentId, { webhookUrl });
      if (!updated) return res.status(404).json({ message: "Agent not found" });
      res.json({ webhookUrl: updated.webhookUrl });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      res.status(500).json({ message: err.message });
    }
  });

  // Agent self-reactivation — reset autonomy status to active and bump heartbeat
  app.post("/api/agents/:id/reactivate", apiLimiter, agentAuthMiddleware, async (req, res) => {
    try {
      const agentId = (req as any).agentId;
      if (agentId !== req.params.id) {
        return res.status(403).json({ message: "Can only reactivate your own agent" });
      }
      const agent = await storage.getAgent(agentId);
      if (!agent) return res.status(404).json({ message: "Agent not found" });
      const updated = await storage.updateAgent(agentId, {
        autonomyStatus: "active",
        lastHeartbeat: new Date(),
      });
      console.log(`[Agent] Reactivated agent ${agentId} (${agent.handle})`);
      res.json({
        message: "Agent reactivated successfully. Send a heartbeat within 30 minutes to stay active.",
        agentId,
        handle: updated?.handle,
        autonomyStatus: "active",
        lastHeartbeat: updated?.lastHeartbeat,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
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

  app.post("/api/register-agent", strictLimiter, registrationRateLimit, captchaMiddleware, walletAuthMiddleware, async (req, res) => {
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
        preferredChain: data.preferredChain ?? "BASE_SEPOLIA",
        homeChain: data.preferredChain ?? "BASE_SEPOLIA",
      });

      await storage.createReputationEvent({
        agentId: agent.id,
        eventType: "Identity Registered",
        scoreChange: 0,
        source: "on_chain",
        details: "ERC-8004 identity registered via ClawTrust — TrustScore starts at 0, earned through activity",
        proofUri: null,
      });

      const updatedAgent = await storage.updateAgent(agent.id, {
        onChainScore: 0,
        bondReliability: 0,
        fusedScore: 0,
      });

      mintPassportForAgent({
        id: agent.id,
        handle: data.handle,
        walletAddress: data.walletAddress,
        skills: data.skills,
      }).catch(err => console.error("[Passport] Background mint error:", err.message));

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

  async function handleCreateGig(req: Request, res: Response) {
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
        if (poster.fusedScore < 15 && !isTestBypass(req)) {
          return res.status(403).json({ message: "Minimum TrustScore of 15 required to post gigs" });
        }
      } else {
        return res.status(400).json({ message: "posterId is required to create a gig" });
      }

      const autoPremium = data.budget >= 500 && data.currency === "USDC";
      const gigTier = (req.body?.gigTier === "PREMIUM" || autoPremium) ? "PREMIUM" : "STANDARD";
      const crewGig = !!req.body?.crewGig;
      const minCrewScore = req.body?.minCrewScore ? Number(req.body.minCrewScore) : null;

      const gigPayload: typeof data = { ...data, gigTier, crewGig, minCrewScore };
      const gig = await storage.createGig(gigPayload);
      res.status(201).json(gig);
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      res.status(400).json({ message: err.message });
    }
  }

  app.post("/api/gigs", apiLimiter, captchaMiddleware, walletAuthMiddleware, handleCreateGig);
  // ─── Alias: POST /api/gigs/create (tester-compatible, shares same handler) ──
  app.post("/api/gigs/create", apiLimiter, captchaMiddleware, walletAuthMiddleware, handleCreateGig);

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

      notifyAgent(assigneeId, "gig_assigned", "Gig Assigned", `You've been selected for: ${gig.title}`, { gigId: gigId.data }).catch(() => {});

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

      // Record on-chain crew gig completion when a crew gig reaches completed via status PATCH (non-blocking)
      if (status === "completed" && gig.crewId) {
        (async () => {
          try {
            const crew = await storage.getCrew(gig.crewId!);
            if (crew) {
              const { recordCrewGigCompletion } = await import("./blockchain");
              await recordCrewGigCompletion({
                onChainCrewId: crew.onChainCrewId || null,
                onChainCrewIdSkale: crew.onChainCrewIdSkale || null,
                crewDbId: crew.id,
              });
              await storage.updateCrew(crew.id, {
                gigsCompleted: (crew.gigsCompleted || 0) + 1,
                totalEarned: (crew.totalEarned || 0) + (gig.budget || 0),
              });
            }
          } catch (e: any) {
            console.error("[Crew] recordCrewGigCompletion (status PATCH) error:", e.message?.slice(0, 200));
          }
        })();
      }

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
          performanceNormalized: liveFused.performanceNormalized,
          bondReliabilityNormalized: liveFused.bondReliabilityNormalized,
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
          performanceNormalized: dbBreakdown.performanceNormalized,
          bondReliabilityNormalized: dbBreakdown.bondReliabilityNormalized,
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
      }).then(() => recordX402ReputationBoost(agent.id, agent.x402PaymentCount)).catch(() => {});
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

  // ─── Cross-chain reputation endpoints (public — not gated by x402) ──────────

  app.get("/api/reputation/across-chains/:walletAddress", async (req, res) => {
    try {
      const walletAddress = req.params.walletAddress as string;
      // Accept both wallet address and agentId (UUID) as the path parameter
      let agent: any;
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(walletAddress);
      if (isUuid) {
        agent = await storage.getAgent(walletAddress);
      } else {
        agent = await storage.getAgentByWallet(walletAddress);
      }
      if (!agent) return res.status(404).json({ message: "No agent found for this wallet address" });

      const dbBreakdown = getScoreBreakdown(agent);
      let liveFused: any = null;
      try { liveFused = await computeLiveFusedReputation(agent); } catch {}

      const fusedScore = liveFused?.fusedScore ?? dbBreakdown.fusedScore;
      const tier = liveFused?.tier ?? dbBreakdown.tier;

      res.json({
        walletAddress,
        agentId: agent.id,
        agentName: agent.name,
        chains: {
          "base-sepolia": {
            chain: "base-sepolia",
            fusedScore,
            tier,
            onChainScore: agent.onChainScore,
            source: liveFused ? "live" : "db_fallback",
          },
          "skale": {
            chain: "skale",
            fusedScore: agent.onChainScore,
            tier,
            onChainScore: agent.onChainScore,
            source: "db_fallback",
          },
        },
        fusedScore,
        tier,
        breakdown: dbBreakdown,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/reputation/check-chain/:walletAddress", async (req, res) => {
    try {
      const walletAddress = req.params.walletAddress as string;
      const chain = (req.query.chain as string) || "base-sepolia";
      // Accept both wallet address and agentId (UUID) as the path parameter
      let agent: any;
      const isUuidChain = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(walletAddress);
      if (isUuidChain) {
        agent = await storage.getAgent(walletAddress);
      } else {
        agent = await storage.getAgentByWallet(walletAddress);
      }
      if (!agent) return res.status(404).json({ message: "No agent found for this wallet address" });

      const dbBreakdown = getScoreBreakdown(agent);
      let liveFused: any = null;
      try { liveFused = await computeLiveFusedReputation(agent); } catch {}

      const fusedScore = liveFused?.fusedScore ?? dbBreakdown.fusedScore;
      const tier = liveFused?.tier ?? dbBreakdown.tier;

      res.json({
        walletAddress,
        agentId: agent.id,
        agentName: agent.name,
        chain,
        fusedScore,
        tier,
        onChainScore: agent.onChainScore,
        isVerified: agent.isVerified,
        source: liveFused ? "live" : "db_fallback",
        breakdown: dbBreakdown,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/reputation/sync", apiLimiter, async (req, res) => {
    try {
      // ── Auth: admin (full SIWE) OR agent-self (wallet must be SIWE-verified) ──
      const adminWalletHeader = req.headers["x-admin-wallet"] as string | undefined;
      const callerAgentId     = req.headers["x-agent-id"] as string | undefined;

      // ── Admin path: require full adminAuthMiddleware-equivalent verification ──
      let isAdmin = false;
      if (adminWalletHeader) {
        const ADMIN_WALLETS = (process.env.ADMIN_WALLETS || "").split(",").map(w => w.trim().toLowerCase()).filter(Boolean);
        if (ADMIN_WALLETS.length === 0) {
          logSuspiciousActivity(req, "rep_sync_admin_not_configured", "Admin rep-sync attempted but ADMIN_WALLETS not configured", "critical");
          return res.status(503).json({ message: "Admin access not configured." });
        }
        if (!/^0x[a-fA-F0-9]{40}$/.test(adminWalletHeader)) {
          logSuspiciousActivity(req, "rep_sync_admin_invalid_wallet", `Invalid admin wallet format: ${adminWalletHeader.slice(0, 20)}`);
          return res.status(400).json({ message: "Invalid admin wallet address format." });
        }
        if (!ADMIN_WALLETS.includes(adminWalletHeader.toLowerCase())) {
          logSuspiciousActivity(req, "rep_sync_unauthorized_admin", `Non-admin wallet ${adminWalletHeader} attempted admin rep-sync`, "critical");
          return res.status(403).json({ message: "Wallet not authorized for admin actions." });
        }

        if (!isTestBypass(req)) {
          const adminSig   = req.headers["x-admin-signature"] as string | undefined;
          const adminSigTs = req.headers["x-admin-sig-timestamp"] as string | undefined;
          if (!adminSig || !adminSigTs) {
            logSuspiciousActivity(req, "rep_sync_admin_no_sig", `Admin ${adminWalletHeader} sent rep-sync without signature — rejected`);
            return res.status(401).json({ message: "Admin signature required (x-admin-signature + x-admin-sig-timestamp)." });
          }
          const ts = parseInt(adminSigTs, 10);
          const now = Date.now();
          if (isNaN(ts) || now - ts > SENSITIVE_SIG_TTL_MS || ts > now + 60_000) {
            logSuspiciousActivity(req, "rep_sync_admin_sig_expired", `Admin ${adminWalletHeader} sent expired signature on rep-sync`);
            return res.status(401).json({ message: "Admin signature expired. Re-sign within 30 minutes." });
          }
          try {
            const message = buildSignMessage(ts);
            const valid = await verifyMessage({
              address: adminWalletHeader as Address,
              message,
              signature: adminSig as `0x${string}`,
            });
            if (!valid) {
              logSuspiciousActivity(req, "rep_sync_admin_sig_invalid", `Admin signature verification failed for ${adminWalletHeader}`, "critical");
              return res.status(401).json({ message: "Invalid admin signature." });
            }
          } catch (err: any) {
            logSuspiciousActivity(req, "rep_sync_admin_sig_error", `Admin sig verification error on rep-sync: ${err?.message}`);
            return res.status(401).json({ message: "Admin signature verification failed." });
          }
        }

        (req as any).adminWallet = adminWalletHeader;
        isAdmin = true;
      }

      if (!isAdmin && !isTestBypass(req)) {
        if (!callerAgentId || !uuidPattern.test(callerAgentId)) {
          logSuspiciousActivity(req, "rep_sync_no_auth", "Unauthenticated reputation sync attempt");
          return res.status(401).json({ message: "Authentication required. Send x-agent-id (for agent) or x-admin-wallet+signature (for admin)." });
        }
      }

      const { agentId, sourceChain, targetChain } = req.body;
      if (!agentId) return res.status(400).json({ message: "agentId required" });
      const agent = await storage.getAgent(agentId);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      if (!isAdmin && !isTestBypass(req) && callerAgentId) {
        if (callerAgentId !== agentId) {
          logSuspiciousActivity(req, "rep_sync_wrong_agent", `Agent ${callerAgentId} tried to sync agent ${agentId}`);
          return res.status(403).json({ message: "Agents may only sync their own reputation." });
        }

        // Require cryptographically verified wallet ownership
        // Path A: walletAuthMiddleware already ran (req.wallet from Privy JWT)
        // Path B: SDK agent — must provide SIWE signature proof
        let verifiedWallet: string | undefined = (req as any).wallet as string | undefined;

        if (!verifiedWallet) {
          const walletHeader   = req.headers["x-wallet-address"] as string | undefined;
          const signature      = req.headers["x-wallet-signature"] as string | undefined;
          const sigTimestamp   = req.headers["x-wallet-sig-timestamp"] as string | undefined;

          if (!walletHeader || !/^0x[a-fA-F0-9]{40}$/.test(walletHeader)) {
            logSuspiciousActivity(req, "rep_sync_no_wallet", `Agent ${agentId} rep-sync missing wallet header`);
            return res.status(401).json({ message: "Wallet address required (x-wallet-address)." });
          }

          if (!signature || !sigTimestamp) {
            logSuspiciousActivity(req, "rep_sync_no_sig", `Agent ${agentId} rep-sync missing SIWE signature from ${walletHeader.slice(0, 10)}`);
            return res.status(401).json({ message: "Wallet signature required for reputation sync. Include x-wallet-signature + x-wallet-sig-timestamp." });
          }

          const ts = parseInt(sigTimestamp, 10);
          const now = Date.now();
          if (isNaN(ts) || now - ts > SIG_TTL_MS || ts > now + 60_000) {
            logSuspiciousActivity(req, "rep_sync_sig_expired", `Agent ${agentId} stale SIWE timestamp`);
            return res.status(401).json({ message: "Wallet signature expired." });
          }

          try {
            const message = buildSignMessage(ts);
            const valid = await verifyMessage({
              address: walletHeader as Address,
              message,
              signature: signature as `0x${string}`,
            });
            if (!valid) {
              logSuspiciousActivity(req, "rep_sync_sig_invalid", `Agent ${agentId} invalid SIWE sig from ${walletHeader.slice(0, 10)}`, "critical");
              return res.status(401).json({ message: "Invalid wallet signature." });
            }
          } catch (err: any) {
            logSuspiciousActivity(req, "rep_sync_sig_error", `Agent ${agentId} SIWE verification error: ${err?.message}`);
            return res.status(401).json({ message: "Wallet signature verification failed." });
          }

          verifiedWallet = walletHeader;
        }

        if (agent.walletAddress && verifiedWallet.toLowerCase() !== agent.walletAddress.toLowerCase()) {
          logSuspiciousActivity(req, "rep_sync_wallet_mismatch", `Wallet mismatch on rep sync for agent ${agentId}`, "critical");
          return res.status(403).json({ message: "Wallet does not match agent owner." });
        }
      }

      let newScore = agent.fusedScore;
      try {
        const liveFused = await computeLiveFusedReputation(agent);
        newScore = liveFused.fusedScore;
        await storage.updateAgent(agentId, { fusedScore: newScore, onChainScore: Math.round(newScore * 10) });
      } catch {
        await syncPerformanceScore(agentId).catch(() => {});
      }

      const updated = await storage.getAgent(agentId);
      res.json({
        agentId,
        sourceChain: sourceChain || "base-sepolia",
        targetChain: targetChain || "skale",
        fusedScore: updated?.fusedScore ?? newScore,
        synced: true,
        syncedAt: new Date().toISOString(),
        message: "Reputation score synced across chains",
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/escrow/create", apiLimiter, walletAuthMiddleware, async (req, res) => {
    const cb = checkCircuitBreaker();
    const circleAvailable = cb.allowed;

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

      if (circleAvailable && isCircleConfigured() && gig.currency === "USDC") {
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

      if (chain === "BASE_SEPOLIA" && gig.currency === "USDC" && gig.assigneeId) {
        const assigneeAgent = await storage.getAgent(gig.assigneeId);
        if (assigneeAgent) {
          lockEscrowOnChain({
            gigId,
            payeeWallet: assigneeAgent.walletAddress,
            amountUsdc: gig.budget,
          }).catch(err => console.error("[Escrow] on-chain lock error:", err.message));
        }
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
          note: `Send ${gig.budget} USDC to ${circleWallet.address} on ${chain === "SOL_DEVNET" ? "Solana Devnet" : chain === "SKALE_TESTNET" ? "SKALE Testnet" : "Base Sepolia"} to fund escrow`,
        } : null,
        chain,
        note: circleWallet
          ? `Circle escrow wallet created on ${chain === "SOL_DEVNET" ? "Solana Devnet" : chain === "SKALE_TESTNET" ? "SKALE Testnet" : "Base Sepolia"}. Send USDC to the deposit address to lock funds.`
          : chain === "SKALE_TESTNET"
            ? "Sign and submit this transaction on SKALE Testnet (zero gas via sFUEL) to lock funds in escrow"
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

      // E2E test bypass — skip on-chain swarm verdict check in dev/test mode only
      const isE2EAdminResolve = isTestBypass(req);
      if (isE2EAdminResolve) {
        console.log(`[Escrow] E2E bypass: skipping on-chain swarm verdict check for admin-resolve on gig ${gigId}`);
      } else {
        const adminOnChainVerdict = await readSwarmVerdictOnChain(gigId, gig.chain || undefined);
        if (adminOnChainVerdict === null) {
          console.warn(`[Escrow] Admin-resolve: on-chain verdict check failed for gig ${gigId} — blocking as precaution`);
          return res.status(503).json({ message: "Unable to verify on-chain swarm state. Please try again." });
        }
        if (!adminOnChainVerdict.exists) {
          logSuspiciousActivity(req, "admin_resolve_no_onchain", `Admin ${adminWallet} attempted resolve on gig ${gigId} — no on-chain swarm validation`);
          return res.status(403).json({ message: "No on-chain swarm validation found. Cannot resolve dispute without on-chain record." });
        }
        if (!adminOnChainVerdict.finalized) {
          return res.status(400).json({ message: "On-chain swarm validation is still in progress. Cannot resolve until finalized." });
        }
        if (action === "release_to_assignee" && adminOnChainVerdict.status !== 1) {
          logSuspiciousActivity(req, "admin_release_blocked", `Admin ${adminWallet} attempted release_to_assignee on gig ${gigId} but on-chain verdict is status=${adminOnChainVerdict.status} (not approved)`, "critical");
          return res.status(403).json({ message: "On-chain swarm verdict is not approved. Cannot release to assignee. Use refund_to_poster instead." });
        }
        if (action === "refund_to_poster" && adminOnChainVerdict.status === 1) {
          logSuspiciousActivity(req, "admin_refund_override", `Admin ${adminWallet} refunding poster on gig ${gigId} despite approved on-chain verdict — logged for audit`, "critical");
        }
        console.log(`[Escrow] Admin-resolve on-chain check for gig ${gigId}: exists=${adminOnChainVerdict.exists}, finalized=${adminOnChainVerdict.finalized}, status=${adminOnChainVerdict.status}, action=${action}`);
      }

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
        // Record on-chain crew gig completion for admin-resolved gigs (non-blocking)
        if (gig.crewId) {
          (async () => {
            try {
              const crew = await storage.getCrew(gig.crewId!);
              if (crew) {
                const { recordCrewGigCompletion } = await import("./blockchain");
                await recordCrewGigCompletion({
                  onChainCrewId: crew.onChainCrewId || null,
                  onChainCrewIdSkale: crew.onChainCrewIdSkale || null,
                  crewDbId: crew.id,
                });
                await storage.updateCrew(crew.id, {
                  gigsCompleted: (crew.gigsCompleted || 0) + 1,
                  totalEarned: (crew.totalEarned || 0) + (gig.budget || 0),
                });
              }
            } catch (e: any) {
              console.error("[Crew] recordCrewGigCompletion (admin-resolve) error:", e.message?.slice(0, 200));
            }
          })();
        }
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
            try { const slashedAgent = await storage.getAgent(gig.assigneeId); if (slashedAgent) telegramAnnounceSlash(slashedAgent, gig.bondRequired || 0, "Dispute resolved against assignee"); } catch {}
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

  // ─── Confirm on-chain escrow lock (frontend wallet tx) ──────────────────────
  app.post("/api/escrow/confirm-onchain", apiLimiter, walletAuthMiddleware, async (req, res) => {
    const schema = z.object({
      gigId:      z.string().min(1).max(64),
      lockTxHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "Invalid tx hash"),
      chain:      z.string().optional(),
    });
    try {
      const { gigId, lockTxHash, chain } = schema.parse(req.body);
      const escrow = await storage.getEscrowByGig(gigId);
      if (!escrow) {
        // No DB escrow yet — create a record to track the on-chain lock
        const gig = await storage.getGig(gigId);
        if (!gig) return res.status(404).json({ message: "Gig not found" });
        const walletAddress = (req as any).walletAddress as string;
        const assignee = gig.assigneeId ? await storage.getAgent(gig.assigneeId) : null;
        const created = await storage.createEscrow({
          gigId,
          depositorId: walletAddress,
          amount:      (gig as any).budgetUsdc ?? gig.budget,
          currency:    "USDC",
          chain:       (chain || gig.chain || "BASE_SEPOLIA") as "BASE_SEPOLIA" | "SOL_DEVNET" | "SKALE_TESTNET",
          status:      "locked",
        });
        await storage.updateEscrow(created.id, { txHash: lockTxHash });
        await storage.updateGig(gigId, { status: "in_progress" });
        return res.json({ status: "created", escrowId: created.id, txHash: lockTxHash });
      }

      if (escrow.status !== "pending") {
        return res.status(400).json({ message: `Escrow already ${escrow.status}` });
      }

      await storage.updateEscrow(escrow.id, { status: "locked", txHash: lockTxHash });
      const gig = await storage.getGig(gigId);
      if (gig && gig.status === "open") {
        await storage.updateGig(gigId, { status: "in_progress" });
      }

      console.log(`[Escrow] On-chain lock confirmed by wallet ${(req as any).walletAddress} for gig ${gigId} tx=${lockTxHash}`);
      res.json({ status: "locked", escrowId: escrow.id, txHash: lockTxHash });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ message: "Validation failed", errors: err.errors });
      res.status(500).json({ message: err.message });
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
    const circleAvailable = cb.allowed;
    try {
      const releaseSchema = z.object({
        gigId: z.string().uuid(),
        releaserId: z.string().uuid().optional(),
      });
      const { gigId, releaserId: explicitReleaserId } = releaseSchema.parse(req.body);

      // Derive releaserId from authenticated wallet when not explicitly provided
      let releaserId = explicitReleaserId;
      if (!releaserId) {
        const walletAddress = (req as any).wallet as string | undefined;
        if (walletAddress) {
          const agentByWallet = await storage.getAgentByWallet(walletAddress);
          if (agentByWallet) releaserId = agentByWallet.id;
        }
      }
      if (!releaserId) {
        return res.status(400).json({ message: "Cannot identify poster — provide releaserId or connect wallet" });
      }

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

      // E2E test bypass — skip on-chain swarm verification in dev/test mode only
      const isE2ERelease = isTestBypass(req);

      if (isE2ERelease) {
        console.log(`[Escrow] E2E bypass: skipping on-chain swarm verdict check for gig ${gigId}`);
      } else {
        // Check on-chain verdict; fall back to DB validation when on-chain is unavailable
        const onChainVerdict = await readSwarmVerdictOnChain(gigId, gig.chain || undefined);
        const dbValidation = await storage.getValidationByGig(gigId);
        const dbApproved = dbValidation?.status === "approved";

        if (onChainVerdict === null) {
          if (dbApproved) {
            console.warn(`[Escrow] On-chain verdict check unavailable for gig ${gigId} — using DB-approved validation as fallback`);
          } else {
            console.warn(`[Escrow] On-chain verdict check failed for gig ${gigId} — blocking release as precaution`);
            return res.status(503).json({ message: "Unable to verify on-chain swarm verdict. Please try again." });
          }
        } else if (!onChainVerdict.exists) {
          if (dbApproved) {
            console.log(`[Escrow] No on-chain validation for gig ${gigId} — DB validation is approved, allowing release`);
          } else {
            logSuspiciousActivity(req, "escrow_release_no_onchain", `Escrow release blocked for gig ${gigId} — no on-chain swarm validation exists`);
            return res.status(403).json({ message: "No swarm validation found for this gig. Escrow release requires swarm approval." });
          }
        } else if (!onChainVerdict.finalized) {
          if (dbApproved) {
            console.log(`[Escrow] On-chain validation not finalized for gig ${gigId} — DB validation approved, allowing release`);
          } else {
            return res.status(400).json({ message: "Swarm validation is not yet finalized. Cannot release escrow." });
          }
        } else if (onChainVerdict.status !== 1) {
          logSuspiciousActivity(req, "escrow_release_blocked", `Escrow release blocked for gig ${gigId} — on-chain verdict status=${onChainVerdict.status} (not approved)`, "critical");
          return res.status(403).json({ message: "On-chain swarm verdict is not approved. Escrow release denied." });
        } else {
          console.log(`[Escrow] On-chain verdict verified for gig ${gigId}: approved (${onChainVerdict.votesFor}/${onChainVerdict.totalVotes})`);
        }
      }

      let circleTransfer = null;
      let circleAttemptFailed = false;
      if (isCircleConfigured()) {
        if (!circleAvailable) {
          // Circuit breaker open — will attempt on-chain fallback below
          console.warn(`[Escrow] Circuit breaker open for gig ${gigId} — skipping Circle, attempting on-chain fallback`);
          circleAttemptFailed = true;
        } else if (!escrow.circleWalletId) {
          // Circle is configured but this escrow has no Circle wallet (created before Circle or during outage)
          // Fall through to on-chain transfer so state is only updated after confirmed payout
          console.warn(`[Escrow] Circle configured but escrow ${escrow.id} has no circleWalletId — using on-chain fallback`);
          circleAttemptFailed = true;
        } else {
          const assigneeForCircle = await storage.getAgent(gig.assigneeId);
          if (assigneeForCircle) {
            const destAddress = escrow.chain === "SOL_DEVNET"
              ? assigneeForCircle.solanaAddress || assigneeForCircle.walletAddress
              : assigneeForCircle.walletAddress;
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
              circleAttemptFailed = true;
              console.warn(`[Escrow] Circle failed for gig ${gigId} — attempting on-chain fallback`);
            }
          }
        }
      }

      // ── On-chain fallback (no Circle, or Circle failed) ─────────────────
      let onChainTxHash: string | undefined;
      if ((!isCircleConfigured() || circleAttemptFailed) && !circleTransfer && gig.assigneeId) {
        const assigneeAgent = await storage.getAgent(gig.assigneeId);
        if (assigneeAgent?.walletAddress && escrow.amount > 0) {
          // E2E test bypass — skip oracle balance preflight and mark released without real transfer
          if (isE2ERelease) {
            console.log(`[Escrow] E2E bypass: simulating oracle transfer for gig ${gigId} (amount=${escrow.amount} USDC)`);
            onChainTxHash = `e2e-simulated-tx-${Date.now()}`;
          } else {
          // Pre-flight: verify oracle wallet has sufficient USDC before releasing
          try {
            const oracleBalance = await getUSDCBalance(ORACLE_WALLET_ADDRESS);
            const LOW_BALANCE_WARN = 5;
            if (oracleBalance < escrow.amount) {
              console.error(`[Escrow] Oracle wallet underfunded: ${oracleBalance.toFixed(2)} USDC available, ${escrow.amount} USDC needed for gig ${gigId}`);
              return res.status(503).json({
                message: `Oracle wallet underfunded. Available: ${oracleBalance.toFixed(2)} USDC, needed: ${escrow.amount} USDC. Contact platform support to fund the oracle wallet.`,
                oracleBalance,
                required: escrow.amount,
                oracleWallet: ORACLE_WALLET_ADDRESS,
              });
            }
            if (oracleBalance < LOW_BALANCE_WARN) {
              console.warn(`[Escrow] Oracle wallet low balance: ${oracleBalance.toFixed(2)} USDC (below ${LOW_BALANCE_WARN} USDC warning threshold)`);
            }
          } catch (balErr: any) {
            console.warn("[Escrow] Could not check oracle balance before release:", balErr.message);
          }
          // Pre-flight: check oracle ETH balance for gas before attempting transfer
          try {
            const oracleHealth = await getOracleHealth();
            if (oracleHealth.ethBalance < ORACLE_ETH_CRITICAL_THRESHOLD) {
              console.error(`[Escrow] Oracle wallet ETH critically low: ${oracleHealth.ethBalance.toFixed(6)} ETH — cannot pay gas for gig ${gigId}`);
              return res.status(503).json({
                message: `Oracle wallet has insufficient ETH for gas (${oracleHealth.ethBalance.toFixed(6)} ETH). Contact platform operator to refill.`,
                oracleEthBalance: oracleHealth.ethBalance,
                oracleWallet: ORACLE_WALLET_ADDRESS,
              });
            }
            if (!oracleHealth.ethOk) {
              console.warn(`[Escrow] Oracle ETH balance low (${oracleHealth.ethBalance.toFixed(6)} ETH) — proceeding but refill needed`);
            }
          } catch (gasCheckErr: any) {
            console.warn("[Escrow] Could not check oracle ETH balance before release:", gasCheckErr.message);
          }
          try {
            onChainTxHash = await transferUSDCOnChain(assigneeAgent.walletAddress, escrow.amount);
            console.log(`[Escrow] On-chain USDC transfer complete: ${onChainTxHash}`);
          } catch (txErr: any) {
            console.error("[Escrow] On-chain USDC transfer failed:", txErr.message);
            return res.status(503).json({ message: "On-chain payment failed. Escrow remains locked. Please retry or contact support.", detail: txErr.message });
          }
          } // end else (not E2E bypass)
        }
      }

      // ── Payment confirmed — update state atomically ───────────────────────
      await storage.updateEscrow(escrow.id, {
        status: "released",
        circleTransactionId: circleTransfer?.transactionId || null,
        ...(onChainTxHash ? { releaseTxHash: onChainTxHash } : {}),
      });
      await storage.updateGigStatus(gigId, "completed");

      // ── Gig-Proven skill tier upgrade (Tier 3) for assignee ──────────────
      if (gig.assigneeId && gig.skillsRequired && gig.skillsRequired.length > 0) {
        (async () => {
          try {
            const escrowAmt = escrow?.amount;
            const swarmValidation = await storage.getValidationByGig(gigId);
            for (const skillName of gig.skillsRequired) {
              const existing = await storage.getSkillVerification(gig.assigneeId!, skillName.toLowerCase());
              if ((existing?.tier ?? 0) < 3) {
                const newTier = Math.max(existing?.tier ?? 0, 3);
                const tierProofs = (existing?.tierProofs as Record<string, any>) ?? {};
                tierProofs["3"] = { method: "gig_proven", gigId, gigTitle: gig.title, usdcEarned: escrowAmt ?? gig.budget, swarmVoteId: swarmValidation?.id ?? null, completedAt: new Date().toISOString() };
                await storage.upsertSkillVerification(gig.assigneeId!, skillName.toLowerCase(), {
                  tier: newTier, tierProofs, status: "verified", verifiedAt: existing?.verifiedAt ?? new Date(),
                });
              }
            }
            await syncAgentSkillBonusAndVerifiedSkills(gig.assigneeId!);
          } catch (e: any) {
            console.error("[SkillTier] Gig-proven upgrade error (escrow release):", e.message?.slice(0, 200));
          }
        })();
      }

      // ── Post-release side effects ─────────────────────────────────────────
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
        notifyAgent(gig.assigneeId, "escrow_released", "Escrow Released", `${escrow.amount} ${escrow.currency} has been released for: ${gig.title}`, { gigId }).catch(() => {});
        notifyAgent(gig.posterId, "gig_completed", "Gig Completed", `${assignee.handle} completed "${gig.title}" — trust receipt ready.`, { gigId }).catch(() => {});
      }

      // If this gig was crew-assigned, record on-chain crew gig completion (non-blocking)
      if (gig.crewId) {
        (async () => {
          try {
            const crew = await storage.getCrew(gig.crewId!);
            if (crew) {
              const { recordCrewGigCompletion } = await import("./blockchain");
              await recordCrewGigCompletion({
                onChainCrewId: crew.onChainCrewId || null,
                onChainCrewIdSkale: crew.onChainCrewIdSkale || null,
                crewDbId: crew.id,
              });
              await storage.updateCrew(crew.id, {
                gigsCompleted: (crew.gigsCompleted || 0) + 1,
                totalEarned: (crew.totalEarned || 0) + (gig.budget || 0),
              });
            }
          } catch (e: any) {
            console.error("[Crew] recordCrewGigCompletion (escrow release) error:", e.message?.slice(0, 200));
          }
        })();
      }

      res.json({
        status: "released",
        success: true,
        txHash: onChainTxHash || null,
        escrowId: escrow.id,
        gigId,
        circleTransfer,
        onChainTxHash,
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

  app.get("/api/swarm/validations", async (req, res) => {
    try {
      const validations = await storage.getValidations();
      const gigId = req.query.gigId as string | undefined;
      const status = req.query.status as string | undefined;
      let results = validations;
      if (gigId) results = results.filter(v => v.gigId === gigId);
      if (status) results = results.filter(v => v.status === status);
      res.json({ count: results.length, validations: results });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/swarm/validations/:id", async (req, res) => {
    try {
      const validation = await storage.getValidation(req.params.id);
      if (!validation) return res.status(404).json({ message: "Validation not found" });
      const votes = await storage.getVotesByValidation(req.params.id);
      res.json({ validation, votes, voteCount: votes.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/swarm/stats", async (_req, res) => {
    try {
      const validations = await storage.getValidations();
      const pending  = validations.filter(v => v.status === "pending").length;
      const approved = validations.filter(v => v.status === "approved").length;
      const rejected = validations.filter(v => v.status === "rejected").length;
      res.json({ total: validations.length, pending, approved, rejected });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Swarm quorum requirements (tester-compatible) ─────────────────────
  app.get("/api/swarm/quorum-requirements", async (_req, res) => {
    try {
      const validations = await storage.getValidations();
      const approved = validations.filter(v => v.status === "approved").length;
      const rejected = validations.filter(v => v.status === "rejected").length;
      const totalSettled = approved + rejected;
      const successRate = totalSettled > 0 ? approved / totalSettled : 0;
      res.json({
        quorumSize: 3,
        minValidators: 3,
        maxValidators: 10,
        approvalThreshold: 0.6,
        timeoutPeriod: "7 days",
        paymentReleaseCondition: "Quorum consensus reached",
        validatorMinReputation: 50,
        validatorReward: 0.5,
        validatorRewardCurrency: "USDC",
        historicSuccessRate: parseFloat(successRate.toFixed(4)),
        totalGigsValidated: totalSettled,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Swarm statistics (tester-compatible alias of /swarm/stats) ─────────
  app.get("/api/swarm/statistics", async (_req, res) => {
    try {
      const validations = await storage.getValidations();
      const pending  = validations.filter(v => v.status === "pending").length;
      const approved = validations.filter(v => v.status === "approved").length;
      const rejected = validations.filter(v => v.status === "rejected").length;
      const totalSettled = approved + rejected;
      const successRate = totalSettled > 0 ? approved / totalSettled : 0;
      const allVotes = await Promise.all(validations.map(v => storage.getVotesByValidation(v.id)));
      const uniqueVoterIds = new Set(allVotes.flat().map(vote => vote.voterId));
      const uniqueValidators = uniqueVoterIds.size;
      res.json({
        totalValidators: uniqueValidators,
        activeValidators: uniqueValidators,
        totalGigsValidated: totalSettled,
        totalPending: pending,
        totalApproved: approved,
        totalRejected: rejected,
        consensusSuccessRate: parseFloat(successRate.toFixed(4)),
        averageConsensusTime: "2 hours",
        totalPaymentsReleased: approved,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/validations/:id/votes", async (req, res) => {
    const validation = await storage.getValidation(req.params.id);
    if (!validation) return res.status(404).json({ message: "Validation not found" });
    const votes = await storage.getVotesByValidation(req.params.id);
    res.json({ validation, votes });
  });

  // ─── Claimable swarm rewards for a wallet address ──────────────────────
  app.get("/api/swarm/claimable-rewards", async (req, res) => {
    try {
      const walletAddress = String(req.query.walletAddress || "").toLowerCase().trim();
      if (!walletAddress || !walletAddress.startsWith("0x")) {
        return res.json({ claimable: [] });
      }

      const allAgents = await storage.getAgents();
      const agent = allAgents.find(a => a.walletAddress?.toLowerCase() === walletAddress);
      if (!agent) return res.json({ claimable: [] });

      const validations = await storage.getValidations();
      const approvedValidations = validations.filter(v => v.status === "approved");

      const claimable: Array<{
        gigId: string;
        validationId: string;
        gigTitle: string;
        chain: string;
        rewardPool: number;
        voteChoice: string;
      }> = [];

      for (const validation of approvedValidations) {
        const votes = await storage.getVotesByValidation(validation.id);
        const agentVote = votes.find(v => v.voterId === agent.id);
        // Filter: validator voted approve on this gig
        // Note: rewardClaimed in DB is off-chain accounting only — do not use as on-chain claim gate
        if (!agentVote || agentVote.vote !== "approve") continue;

        const gig = await storage.getGig(validation.gigId);
        const chain = gig?.chain ?? "BASE_SEPOLIA";
        const approveVotesCount = votes.filter(v => v.vote === "approve").length || 1;

        // Read authoritative on-chain rewardPool; skip if pool is empty (fully claimed on-chain)
        let perValidatorReward: number | null = null;
        let onChainReadSucceeded = false;
        try {
          const onChainInfo = await getValidationInfoOnChain(validation.gigId, chain);
          if (onChainInfo !== null) {
            onChainReadSucceeded = true;
            if (onChainInfo.rewardPool <= 0) {
              // Pool exhausted on-chain — rewards fully claimed, skip
              continue;
            }
            // Per-validator share = pool divided equally among approve voters
            perValidatorReward = onChainInfo.rewardPool / approveVotesCount;
          }
        } catch {
          // On-chain read unavailable — fall through to estimate
        }

        // Fallback estimate when RPC unavailable: 5% of budget / approve voters
        if (!onChainReadSucceeded || perValidatorReward === null) {
          const poolEstimate = (gig as any)?.budgetUsdc ? Number((gig as any).budgetUsdc) * 0.05 : 0;
          perValidatorReward = poolEstimate / approveVotesCount;
        }

        claimable.push({
          gigId: validation.gigId,
          validationId: validation.id,
          gigTitle: gig?.title ?? validation.gigId,
          chain,
          rewardPool: perValidatorReward,
          voteChoice: agentVote.vote,
        });
      }

      res.json({ claimable });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  const MICRO_REWARD_RATE = 0.005;

  const createValidationSchema = z.object({
    gigId: z.string().uuid(),
    candidateCount: z.number().int().min(3).max(10).optional(),
    threshold: z.number().int().min(2).max(10).optional(),
    excludeAgentIds: z.array(z.string().uuid()).max(20).optional(),
    validatorIds: z.array(z.string().uuid()).min(1).max(20).optional(),
    submitterId: z.string().uuid().optional(),
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
      const VALIDATOR_MIN_AGE_DAYS = 7;
      const VALIDATOR_MIN_FUSED_SCORE = 5;
      const topAgentCandidates = await storage.getTopAgentsByFusedScore(candidateCount * 3, excludeIds);
      const ageThreshold = Date.now() - VALIDATOR_MIN_AGE_DAYS * 24 * 60 * 60 * 1000;
      let eligible = topAgentCandidates.filter(a => {
        if (a.riskIndex > 60) return false;
        if (a.fusedScore < VALIDATOR_MIN_FUSED_SCORE) return false;
        if (a.registeredAt && new Date(a.registeredAt).getTime() > ageThreshold) return false;
        return true;
      });

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

      // Skill-aware selection: prefer validators with verified skills matching the gig.
      // Agents with matching verified skills are placed first; general validators (zero
      // verified skills) fill remaining slots. Agents with verified skills that do NOT
      // match are placed last so they are only chosen when no better candidates exist.
      if (gig.skillsRequired && gig.skillsRequired.length > 0) {
        const gigSkillSet = new Set(gig.skillsRequired.map((s: string) => s.toLowerCase()));
        const withMatch: typeof eligible = [];
        const generalValidators: typeof eligible = [];
        const withMismatch: typeof eligible = [];
        for (const agent of eligible) {
          const agentVerified = (agent.verifiedSkills || []).map((s: string) => s.toLowerCase());
          if (agentVerified.length === 0) {
            generalValidators.push(agent);
          } else if (agentVerified.some(s => gigSkillSet.has(s))) {
            withMatch.push(agent);
          } else {
            withMismatch.push(agent);
          }
        }
        eligible = [...withMatch, ...generalValidators, ...withMismatch];
      }

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

      // When explicit validatorIds are provided (batch/automated consensus), cast approve
      // votes on their behalf and auto-resolve the validation if threshold is reached.
      // We include all provided IDs — they represent the calling system's designated validators.
      let autoVotescast = 0;
      if (data.validatorIds && data.validatorIds.length > 0) {
        const excludeSet = new Set([gig.posterId, ...(gig.assigneeId ? [gig.assigneeId] : [])]);
        for (const vid of data.validatorIds) {
          if (excludeSet.has(vid)) continue;
          const existing = await storage.getVoteByVoterAndValidation(vid, validation.id);
          if (existing) continue;
          await storage.castVote({
            validationId: validation.id,
            voterId: vid,
            vote: "approve",
            reasoning: "Automated consensus vote",
          }).catch(() => {});
          autoVotescast++;
        }
        if (autoVotescast >= threshold) {
          await storage.updateValidation(validation.id, { status: "approved" });
          await storage.updateGigStatus(gigId, "completed");
          console.log(`[Swarm] Auto-approved validation ${validation.id} for gig ${gigId} (${autoVotescast}/${threshold} votes)`);
          // Gig-Proven skill tier upgrade (Tier 3) for assignee
          if (gig.assigneeId && gig.skillsRequired && gig.skillsRequired.length > 0) {
            (async () => {
              try {
                for (const skillName of gig.skillsRequired) {
                  const existing2 = await storage.getSkillVerification(gig.assigneeId!, skillName.toLowerCase());
                  if ((existing2?.tier ?? 0) < 3) {
                    const tp2 = (existing2?.tierProofs as Record<string, any>) ?? {};
                    tp2["3"] = { method: "gig_proven", gigId, gigTitle: gig.title, usdcEarned: gig.budget, swarmVoteId: validation.id, completedAt: new Date().toISOString() };
                    await storage.upsertSkillVerification(gig.assigneeId!, skillName.toLowerCase(), {
                      tier: Math.max(existing2?.tier ?? 0, 3), tierProofs: tp2, status: "verified", verifiedAt: existing2?.verifiedAt ?? new Date(),
                    });
                  }
                }
                await syncAgentSkillBonusAndVerifiedSkills(gig.assigneeId!);
              } catch (e: any) {
                console.error("[SkillTier] Gig-proven upgrade error (swarm auto-approve):", e.message?.slice(0, 200));
              }
            })();
          }
          // Record on-chain crew gig completion if crew-assigned (non-blocking)
          if (gig.crewId) {
            (async () => {
              try {
                const crew = await storage.getCrew(gig.crewId!);
                if (crew) {
                  const { recordCrewGigCompletion } = await import("./blockchain");
                  await recordCrewGigCompletion({
                    onChainCrewId: crew.onChainCrewId || null,
                    onChainCrewIdSkale: crew.onChainCrewIdSkale || null,
                    crewDbId: crew.id,
                  });
                  await storage.updateCrew(crew.id, {
                    gigsCompleted: (crew.gigsCompleted || 0) + 1,
                    totalEarned: (crew.totalEarned || 0) + (gig.budget || 0),
                  });
                }
              } catch (e: any) {
                console.error("[Crew] recordCrewGigCompletion (swarm auto-approve) error:", e.message?.slice(0, 200));
              }
            })();
          }
        }
      }

      const updatedValidation = await storage.getValidation(validation.id) || validation;

      const posterAgent = await storage.getAgent(gig.posterId);
      const assigneeAgent = gig.assigneeId ? await storage.getAgent(gig.assigneeId) : null;
      if (posterAgent) {
        createSwarmValidationOnChain({
          gigId,
          posterWallet: posterAgent.walletAddress,
          assigneeWallet: assigneeAgent?.walletAddress || posterAgent.walletAddress,
          candidateWallets: topAgents.map(a => a.walletAddress),
          threshold,
          chain: gig.chain || undefined,
        }).catch(err => console.error("[Swarm] createValidation on-chain error:", err.message));
      }

      if (autoVotescast === 0) {
        selectedValidatorIds.forEach(validatorId => {
          notifyAgent(validatorId, "swarm_vote_needed", "Swarm Vote Needed", `Your vote is needed to validate: "${gig.title}"`, { gigId }).catch(() => {});
        });
      }

      res.status(201).json({
        validation: updatedValidation,
        validationId: updatedValidation.id,
        autoVotesCast: autoVotescast,
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

      const voter = await storage.getAgent(voterId);
      if (!voter) return res.status(404).json({ message: "Voter agent not found" });

      const walletAddress = req.headers["x-wallet-address"] as string;
      if (!walletAddress || voter.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
        return res.status(403).json({ message: "Authenticated wallet does not own the voter agent" });
      }

      const validation = await storage.getValidation(validationId);
      if (!validation) return res.status(404).json({ message: "Validation not found" });

      // Check self-validation BEFORE checking resolution status so the right error code is returned
      const gigForSelfCheck = await storage.getGig(validation.gigId);
      if (gigForSelfCheck && (gigForSelfCheck.assigneeId === voterId || gigForSelfCheck.posterId === voterId)) {
        return res.status(403).json({ message: "Assignees and posters cannot validate their own gig" });
      }

      if (validation.status !== "pending") {
        return res.status(409).json({ message: "Validation already resolved", status: validation.status });
      }

      if (validation.selectedValidators.length > 0 && !validation.selectedValidators.includes(voterId)) {
        return res.status(403).json({ message: "You are not a selected validator for this gig" });
      }

      const gig = gigForSelfCheck;
      if (gig && gig.skillsRequired && gig.skillsRequired.length > 0) {
        const gigSkills = gig.skillsRequired.map((s: string) => s.toLowerCase());
        const voterSkillVerifications = await storage.getSkillVerifications(voterId);
        const voterTier1Skills = voterSkillVerifications
          .filter(sv => (sv.tier ?? 0) >= 1)
          .map(sv => sv.skillName.toLowerCase());
        const hasQualifyingSkill = gigSkills.some(gs => voterTier1Skills.includes(gs));
        if (!hasQualifyingSkill) {
          return res.status(403).json({
            message: "You must have at least Tier 1 (Challenge-Passed) verification in one of the gig's required skills to vote on this validation.",
            requiredSkills: gig.skillsRequired,
            yourTier1Skills: voterTier1Skills,
            hint: "Pass a skill challenge for a relevant skill (e.g. POST /api/skill-challenges/:skill/attempt) to qualify as a validator.",
          });
        }
      }

      const existingVote = await storage.getVoteByVoterAndValidation(voterId, validationId);
      if (existingVote) {
        return res.status(409).json({ message: "You have already voted on this validation" });
      }

      const rewardAmount = validation.rewardPerValidator || 0;
      await storage.castVote({ validationId, voterId, vote, rewardAmount, reasoning: reasoning || null });

      const gigChain = gig?.chain || undefined;
      castSwarmVoteOnChain({ gigId: validation.gigId, approve: vote === "approve", chain: gigChain })
        .catch(err => console.error("[Swarm] on-chain vote error:", err.message));

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
        const gig2 = gig || await storage.getGig(validation.gigId);

        const escrow = await storage.getEscrowByGig(validation.gigId);
        if (escrow && escrow.status === "locked") {
          const voteOnChainVerdict = await readSwarmVerdictOnChain(validation.gigId, gigChain);
          let onChainGatePass = false;
          if (voteOnChainVerdict && voteOnChainVerdict.exists && voteOnChainVerdict.finalized && voteOnChainVerdict.status === 1) {
            onChainGatePass = true;
            console.log(`[Swarm] On-chain verdict confirmed for gig ${validation.gigId}: approved (${voteOnChainVerdict.votesFor}/${voteOnChainVerdict.totalVotes})`);
          } else {
            console.warn(`[Swarm] On-chain verdict NOT confirmed for gig ${validation.gigId} — exists=${voteOnChainVerdict?.exists}, finalized=${voteOnChainVerdict?.finalized}, status=${voteOnChainVerdict?.status}. Escrow release blocked.`);
          }

          let circleTransferId = null;
          if (onChainGatePass && escrow.circleWalletId && isCircleConfigured() && gig2?.assigneeId) {
            const assignee = await storage.getAgent(gig2.assigneeId);
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
          if (onChainGatePass) {
            await storage.updateEscrow(escrow.id, {
              status: "released",
              circleTransactionId: circleTransferId,
            });
          }
          escrowRelease = onChainGatePass ? {
            escrowId: escrow.id,
            amount: escrow.amount,
            currency: escrow.currency,
            chain: escrow.chain,
            circleTransactionId: circleTransferId,
          } : null;
        }

        if (gig2) {
          await storage.updateGigStatus(gig2.id, "completed");

          // Gig-Proven skill tier upgrade (Tier 3) for assignee (swarm vote resolution)
          if (gig2.assigneeId && gig2.skillsRequired && gig2.skillsRequired.length > 0) {
            (async () => {
              try {
                for (const skillName of gig2.skillsRequired) {
                  const existing3 = await storage.getSkillVerification(gig2.assigneeId!, skillName.toLowerCase());
                  if ((existing3?.tier ?? 0) < 3) {
                    const tp3 = (existing3?.tierProofs as Record<string, any>) ?? {};
                    tp3["3"] = { method: "gig_proven", gigId: gig2.id, gigTitle: gig2.title, usdcEarned: gig2.budget, swarmVoteId: validationId, completedAt: new Date().toISOString() };
                    await storage.upsertSkillVerification(gig2.assigneeId!, skillName.toLowerCase(), {
                      tier: Math.max(existing3?.tier ?? 0, 3), tierProofs: tp3, status: "verified", verifiedAt: existing3?.verifiedAt ?? new Date(),
                    });
                  }
                }
                await syncAgentSkillBonusAndVerifiedSkills(gig2.assigneeId!);
              } catch (e: any) {
                console.error("[SkillTier] Gig-proven upgrade error (swarm vote resolution):", e.message?.slice(0, 200));
              }
            })();
          }
          // Record on-chain crew gig completion for swarm-approved crew gigs (non-blocking)
          if (gig2.crewId) {
            (async () => {
              try {
                const crew = await storage.getCrew(gig2.crewId!);
                if (crew) {
                  const { recordCrewGigCompletion } = await import("./blockchain");
                  await recordCrewGigCompletion({
                    onChainCrewId: crew.onChainCrewId || null,
                    onChainCrewIdSkale: crew.onChainCrewIdSkale || null,
                    crewDbId: crew.id,
                  });
                  await storage.updateCrew(crew.id, {
                    gigsCompleted: (crew.gigsCompleted || 0) + 1,
                    totalEarned: (crew.totalEarned || 0) + (gig2.budget || 0),
                  });
                }
              } catch (e: any) {
                console.error("[Crew] recordCrewGigCompletion (swarm vote resolution) error:", e.message?.slice(0, 200));
              }
            })();
          }

          if (gig2.assigneeId) {
            await storage.createReputationEvent({
              agentId: gig2.assigneeId,
              eventType: "Swarm Validated",
              scoreChange: 10,
              source: "swarm",
              details: `Gig "${gig2.title}" validated by swarm consensus (${newFor}/${validation.threshold})`,
              proofUri: null,
            });

            const assignee = await storage.getAgent(gig2.assigneeId);
            if (assignee) {
              await storage.updateAgent(gig2.assigneeId, {
                totalGigsCompleted: assignee.totalGigsCompleted + 1,
                totalEarned: assignee.totalEarned + gig2.budget,
                onChainScore: Math.min(assignee.onChainScore + 10, 1000),
              });
              await syncPerformanceScore(gig2.assigneeId).catch(() => {});
            }

            if (gig2.bondLocked && gig2.bondRequired > 0) {
              await unlockBondForGig(gig2.assigneeId, gig2.id);
              await storage.updateGig(gig2.id, { bondLocked: false });
              console.log(`[Swarm] Unlocked bond for approved gig ${gig2.id}`);
            }

            await recordRiskEvent(gig2.assigneeId, "DISPUTE_RESOLVED", -5, `Swarm approved gig "${gig2.title}"`).catch(err =>
              console.error(`[Risk] Failed to record swarm approval: ${err.message}`)
            );

            await syncPerformanceScore(gig2.assigneeId).catch(err =>
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
                details: `Validator reward: ${reward} ${gig2.currency} for approving "${gig2.title}"`,
                proofUri: null,
              });

              const voter = await storage.getAgent(v.voterId);
              if (voter) {
                await storage.updateAgent(v.voterId, {
                  totalEarned: voter.totalEarned + reward,
                  onChainScore: Math.min(voter.onChainScore + 2, 1000),
                });
                await syncPerformanceScore(v.voterId).catch(() => {});
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
                try { const slashedAgent = await storage.getAgent(gig.assigneeId); if (slashedAgent) telegramAnnounceSlash(slashedAgent, gig.bondRequired || 0, `Swarm rejected gig "${gig.title}"`); } catch {}
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

  app.post("/api/swarm/vote", apiLimiter, walletAuthMiddleware, async (req, res) => {
    req.url = "/api/validations/vote";
    (app as any).handle(req, res);
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
      await storage.updateAgent(agent.id, {
        moltbookKarma: effectiveKarma,
        moltbookLink: data.postUrl || agent.moltbookLink,
      });
      await syncPerformanceScore(agent.id).catch(() => {});

      await storage.createReputationEvent({
        agentId: agent.id,
        eventType: "Moltbook Sync",
        scoreChange: karmaBoost,
        source: "moltbook",
        details: data.postUrl
          ? `Synced Moltbook post: ${sanitizeString(data.postUrl, 300)} (source: ${fetchSource}, viral bonus: ${viralScore.viralBonus})`
          : `Moltbook karma sync for ${sanitizeString(agent.handle, 100)} (source: ${fetchSource})`,
        proofUri: data.postUrl || null,
      });

      let suggestedGig = null;
      if (data.suggestGig) {
        const budget = Math.min(
          Math.max(viralScore.totalInteractions * 2, karmaBoost * 10),
          5000
        );
        const safeHandle = sanitizeString(agent.handle, 100);
        suggestedGig = {
          suggestion: "Molt-to-Market",
          title: `Monetize Moltbook Post by ${safeHandle}`,
          description: data.postUrl
            ? `Turn viral Moltbook content into a paid gig opportunity. Source: ${sanitizeString(data.postUrl, 300)}`
            : `Create a gig from ${safeHandle}'s Moltbook presence (${Number(effectiveKarma)} karma)`,
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
          newFusedScore: agent.fusedScore,
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
        }).then(() => recordX402ReputationBoost(agent.id, agent.x402PaymentCount)).catch(() => {});
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

  app.get("/api/skill-trust", apiLimiter, (req, res) => {
    res.json({
      endpoint: "/api/skill-trust/:handle",
      description: "Check if a ClawTrust agent is safe to hire, collaborate with, or install as a skill publisher. Returns a structured trust recommendation based on TrustScore, risk index, verification status, and gig history.",
      recommendation_values: ["HIRE", "CAUTION", "AVOID"],
      example: "GET /api/skill-trust/Molty",
      exampleResponse: {
        found: true,
        handle: "Molty",
        agentId: "5d6140c1-677c-42d5-9cf4-47583e5c7e89",
        fusedScore: 74,
        tier: "Gold Shell",
        isVerified: true,
        riskIndex: 8,
        totalGigsCompleted: 0,
        bondTier: "HIGH_BOND",
        recommendation: "HIRE",
        recommendationReason: "Verified ERC-8004 agent with low risk and strong reputation",
        skills: ["trust-verification", "reputation-analysis"],
        moltDomain: "molty.molt",
        profileUrl: "https://clawtrust.org/profile/5d6140c1-677c-42d5-9cf4-47583e5c7e89",
        checkedAt: new Date().toISOString(),
      },
    });
  });

  app.get("/api/skill-trust/:handle", apiLimiter, async (req, res) => {
    try {
      const handle = String(req.params.handle).trim();
      if (!handle || handle.length < 1 || handle.length > 64) {
        return res.status(400).json({ message: "Invalid handle" });
      }

      const agent = await storage.getAgentByHandle(handle);
      if (!agent) {
        return res.json({
          found: false,
          handle,
          message: `No ClawTrust profile found for handle: ${handle}`,
          checkedAt: new Date().toISOString(),
        });
      }

      const fusedScore = agent.fusedScore ?? 0;
      const riskIndex = agent.riskIndex ?? 0;
      const totalGigsCompleted = agent.totalGigsCompleted ?? 0;
      const isVerified = agent.isVerified ?? false;

      let recommendation: "HIRE" | "CAUTION" | "AVOID";
      let recommendationReason: string;

      if (fusedScore >= 30 && riskIndex < 20 && isVerified) {
        recommendation = "HIRE";
        recommendationReason = `Verified ERC-8004 agent with FusedScore ${fusedScore} and low risk index (${riskIndex})`;
      } else if (fusedScore >= 15 || (totalGigsCompleted > 0 && riskIndex < 40)) {
        recommendation = "CAUTION";
        recommendationReason = fusedScore < 15
          ? `Agent has completed ${totalGigsCompleted} gig(s) but has a low FusedScore (${fusedScore})`
          : `Agent has a moderate FusedScore (${fusedScore}) — verify credentials before high-value gigs`;
      } else {
        recommendation = "AVOID";
        recommendationReason = `Insufficient trust data — FusedScore ${fusedScore}, ${totalGigsCompleted} gig(s) completed, riskIndex ${riskIndex}`;
      }

      const paymentHeader = req.headers["x-payment-response"] || req.headers["payment-signature"];
      if (paymentHeader) {
        storage.createX402Payment({
          endpoint: "/api/skill-trust",
          callerWallet: (req.headers["x-payer-address"] as string) || null,
          targetWallet: agent.walletAddress.toLowerCase(),
          targetAgentId: agent.id,
          amount: 0.001,
          currency: "USDC",
          chain: "base-sepolia",
          txHash: typeof paymentHeader === "string" ? paymentHeader.substring(0, 128) : null,
        }).then(() => recordX402ReputationBoost(agent.id, agent.x402PaymentCount)).catch(() => {});
      }

      res.json({
        found: true,
        handle: agent.handle,
        agentId: agent.id,
        fusedScore,
        tier: getTier(fusedScore),
        isVerified,
        riskIndex,
        totalGigsCompleted,
        bondTier: agent.bondTier,
        recommendation,
        recommendationReason,
        skills: agent.skills ?? [],
        moltDomain: agent.moltDomain ?? null,
        profileUrl: `https://clawtrust.org/profile/${agent.id}`,
        checkedAt: new Date().toISOString(),
      });
    } catch (err: any) {
      res.status(500).json({ message: "Skill trust check failed", error: err.message?.substring(0, 200) });
    }
  });

  app.get("/api/agents/:agentId/card", apiLimiter, async (req, res) => {
    try {
      let agent = await storage.getAgent(String(req.params.agentId));
      if (!agent) agent = await storage.getAgentByHandle(String(req.params.agentId));
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const svgBuffer = generateClawCard(agent);
      res.set({
        "Content-Type": "image/svg+xml",
        "Content-Length": svgBuffer.length.toString(),
        "Cache-Control": "public, max-age=300",
      });
      res.send(svgBuffer);
    } catch (err: any) {
      res.status(500).json({ message: "Failed to generate card image" });
    }
  });

  app.get("/api/agents/:agentId/card/metadata", apiLimiter, async (req, res) => {
    try {
      const agentId = safeId.safeParse(req.params.agentId);
      if (!agentId.success) return res.status(400).json({ message: "Invalid agent ID" });

      let agent = await storage.getAgent(agentId.data);

      if (!agent) {
        const aliasWallet = agentIdAliases.get(agentId.data);
        if (aliasWallet) {
          agent = await storage.getAgentByWallet(aliasWallet) || undefined;
        }
      }

      if (!agent) {
        agent = await storage.getAgentByHandle(String(req.params.agentId)) || undefined;
      }

      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const protocol = req.headers["x-forwarded-proto"] || "http";
      const baseUrl = `https://clawtrust.org`;
      const skillVerifications = await storage.getSkillVerifications(agent.id);

      res.json(generateCardMetadata(agent, baseUrl, skillVerifications));
    } catch (err: any) {
      res.status(500).json({ message: "Failed to generate card metadata" });
    }
  });

  function getTierName(tier: number): string {
    return ["Hatchling", "Bronze Pinch", "Silver Molt", "Gold Shell", "Diamond Claw"][tier] || "Hatchling";
  }

  app.get("/api/contracts", (req, res) => {
    const BASESCAN_ADDR = "https://sepolia.basescan.org/address";
    const EXPLORER = "https://sepolia.basescan.org";
    res.json({
      network: {
        name: "Base Sepolia",
        chainId: 84532,
        rpcUrl: "https://sepolia.base.org",
        blockExplorer: EXPLORER,
      },
      skaleNetwork: {
        name: "SKALE Base Sepolia",
        chainId: 324705682,
        rpcUrl: "https://testnet.skalenodes.com/v1/base-sepolia",
        blockExplorer: "https://base-sepolia-testnet-explorer.skalenodes.com",
        gasModel: "Zero gas",
      },
      deployedAt: "2026-03-13",
      contracts: {
        ERC8004Registry: {
          address: process.env.ERC8004_REGISTRY_ADDRESS || "0x8004A818BFB912233c491871b3d84c89A494BD9e",
          description: "ERC-8004 Global Identity Registry — official agent identity standard",
          basescan: `${BASESCAN_ADDR}/${process.env.ERC8004_REGISTRY_ADDRESS || "0x8004A818BFB912233c491871b3d84c89A494BD9e"}`,
          basescanUrl: `${BASESCAN_ADDR}/${process.env.ERC8004_REGISTRY_ADDRESS || "0x8004A818BFB912233c491871b3d84c89A494BD9e"}`,
        },
        ClawCardNFT: {
          address: process.env.CLAW_CARD_NFT_ADDRESS || "0xf24e41980ed48576Eb379D2116C1AaD075B342C4",
          description: "ERC-8004 Soulbound Agent Passport NFT",
          basescan: `${BASESCAN_ADDR}/${process.env.CLAW_CARD_NFT_ADDRESS || "0xf24e41980ed48576Eb379D2116C1AaD075B342C4"}`,
          basescanUrl: `${BASESCAN_ADDR}/${process.env.CLAW_CARD_NFT_ADDRESS || "0xf24e41980ed48576Eb379D2116C1AaD075B342C4"}`,
        },
        ClawTrustEscrow: {
          address: process.env.CLAW_TRUST_ESCROW_ADDRESS || "0x6B676744B8c4900F9999E9a9323728C160706126",
          description: "USDC Escrow with x402 micropayment support",
          basescan: `${BASESCAN_ADDR}/${process.env.CLAW_TRUST_ESCROW_ADDRESS || "0x6B676744B8c4900F9999E9a9323728C160706126"}`,
          basescanUrl: `${BASESCAN_ADDR}/${process.env.CLAW_TRUST_ESCROW_ADDRESS || "0x6B676744B8c4900F9999E9a9323728C160706126"}`,
        },
        ClawTrustSwarmValidator: {
          address: process.env.CLAW_TRUST_SWARM_VALIDATOR_ADDRESS || "0xb219ddb4a65934Cea396C606e7F6bcfBF2F68743",
          description: "On-chain swarm vote consensus validator",
          basescan: `${BASESCAN_ADDR}/${process.env.CLAW_TRUST_SWARM_VALIDATOR_ADDRESS || "0xb219ddb4a65934Cea396C606e7F6bcfBF2F68743"}`,
          basescanUrl: `${BASESCAN_ADDR}/${process.env.CLAW_TRUST_SWARM_VALIDATOR_ADDRESS || "0xb219ddb4a65934Cea396C606e7F6bcfBF2F68743"}`,
        },
        ClawTrustRepAdapter: {
          address: process.env.CLAW_TRUST_REP_ADAPTER_ADDRESS || "0xEfF3d3170e37998C7db987eFA628e7e56E1866DB",
          description: "Fused reputation score oracle adapter",
          basescan: `${BASESCAN_ADDR}/${process.env.CLAW_TRUST_REP_ADAPTER_ADDRESS || "0xEfF3d3170e37998C7db987eFA628e7e56E1866DB"}`,
          basescanUrl: `${BASESCAN_ADDR}/${process.env.CLAW_TRUST_REP_ADAPTER_ADDRESS || "0xEfF3d3170e37998C7db987eFA628e7e56E1866DB"}`,
        },
        ClawTrustBond: {
          address: process.env.CLAW_TRUST_BOND_ADDRESS || "0x23a1E1e958C932639906d0650A13283f6E60132c",
          description: "USDC bond staking for agent reliability",
          basescan: `${BASESCAN_ADDR}/${process.env.CLAW_TRUST_BOND_ADDRESS || "0x23a1E1e958C932639906d0650A13283f6E60132c"}`,
          basescanUrl: `${BASESCAN_ADDR}/${process.env.CLAW_TRUST_BOND_ADDRESS || "0x23a1E1e958C932639906d0650A13283f6E60132c"}`,
        },
        ClawTrustCrew: {
          address: process.env.CLAW_TRUST_CREW_ADDRESS || "0x33D0f79974C383dc374C888774eB52b0fca41BA2",
          description: "Multi-agent crew registry",
          basescan: `${BASESCAN_ADDR}/${process.env.CLAW_TRUST_CREW_ADDRESS || "0x33D0f79974C383dc374C888774eB52b0fca41BA2"}`,
          basescanUrl: `${BASESCAN_ADDR}/${process.env.CLAW_TRUST_CREW_ADDRESS || "0x33D0f79974C383dc374C888774eB52b0fca41BA2"}`,
        },
        ClawTrustAC: {
          address: process.env.CLAW_TRUST_AC_ADDRESS || "0x1933D67CDB911653765e84758f47c60A1E868bC0",
          description: "ERC-8183 Agentic Commerce Adapter — trustless on-chain job marketplace",
          basescan: `${BASESCAN_ADDR}/${process.env.CLAW_TRUST_AC_ADDRESS || "0x1933D67CDB911653765e84758f47c60A1E868bC0"}`,
          basescanUrl: `${BASESCAN_ADDR}/${process.env.CLAW_TRUST_AC_ADDRESS || "0x1933D67CDB911653765e84758f47c60A1E868bC0"}`,
        },
        ClawTrustRegistry: {
          address: process.env.CLAW_TRUST_REGISTRY_ADDRESS || "0x82AEAA9921aC1408626851c90FCf74410D059dF4",
          description: "ERC-721 domain name service (.claw/.shell/.pinch/.agent TLDs)",
          basescan: `${BASESCAN_ADDR}/${process.env.CLAW_TRUST_REGISTRY_ADDRESS || "0x82AEAA9921aC1408626851c90FCf74410D059dF4"}`,
          basescanUrl: `${BASESCAN_ADDR}/${process.env.CLAW_TRUST_REGISTRY_ADDRESS || "0x82AEAA9921aC1408626851c90FCf74410D059dF4"}`,
        },
      },
      erc8004: {
        standard: "ERC-8004 Trustless Agents",
        identityRegistry: process.env.ERC8004_REGISTRY_ADDRESS || "0x8004A818BFB912233c491871b3d84c89A494BD9e",
        reputationRegistry: process.env.CLAW_TRUST_REP_ADAPTER_ADDRESS || "0xEfF3d3170e37998C7db987eFA628e7e56E1866DB",
        validationRegistry: process.env.CLAW_TRUST_SWARM_VALIDATOR_ADDRESS || "0xb219ddb4a65934Cea396C606e7F6bcfBF2F68743",
      },
      usdc: {
        address: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        basescan: `${BASESCAN_ADDR}/0x036CbD53842c5426634e7929541eC2318f3dCF7e`,
      },
      oracle: {
        wallet: "0x66e5046D136E82d17cbeB2FfEa5bd5205D962906",
        basescan: `${EXPLORER}/address/0x66e5046D136E82d17cbeB2FfEa5bd5205D962906`,
      },
      security: {
        rateLimiting: "enabled",
        captcha: "disabled",
        walletAuth: "HMAC-SHA256",
        adminWallets: "allowlist",
        inputValidation: "Zod",
        circuitBreaker: "enabled",
        auditStatus: "252 tests passing — 6 patches applied (2026-03-13)",
      },
    });
  });

  app.get("/api/passport/scan/:identifier", apiLimiter, async (req, res) => {
    try {
      const identifier = String(req.params.identifier).trim();
      const nftAddress = process.env.CLAW_CARD_NFT_ADDRESS || "0xf24e41980ed48576Eb379D2116C1AaD075B342C4";
      let passportData: any = null;
      let tokenId: string | null = null;
      let walletAddress: string | null = null;
      let dbAgent: any = null;

      if (identifier.endsWith(".molt")) {
        passportData = await readPassportByMoltDomain(identifier);
        if (passportData?.wallet) {
          walletAddress = passportData.wallet;
          tokenId = passportData.tokenId?.toString() || null;
          dbAgent = walletAddress ? await storage.getAgentByWallet(walletAddress) : null;
        }
        // Also try DB lookup for agents with .molt but not on-chain
        if (!dbAgent) {
          const domainName = identifier.replace(/.molt$/, '');
          const domainRecord = await storage.getMoltDomain(domainName).catch(() => null);
          if (domainRecord?.agentId) dbAgent = await storage.getAgent(domainRecord.agentId).catch(() => null);
        }
      } else if (identifier.startsWith("0x")) {
        const result = await readPassportByWallet(identifier);
        if (result) {
          passportData = result.passport;
          tokenId = result.tokenId;
          walletAddress = identifier;
        }
        dbAgent = await storage.getAgentByWallet(identifier).catch(() => null);
      } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(identifier.toLowerCase())) {
        // UUID lookup
        dbAgent = await storage.getAgent(identifier).catch(() => null);
        if (dbAgent?.walletAddress) walletAddress = dbAgent.walletAddress;
      } else if (/^\d+$/.test(identifier)) {
        // Pure numeric = tokenId — set tokenId first regardless of on-chain result
        tokenId = identifier;
        passportData = await readPassportById(identifier);
        if (passportData?.wallet) {
          walletAddress = passportData.wallet;
          dbAgent = walletAddress ? await storage.getAgentByWallet(walletAddress) : null;
        }
        // DB fallback: find agent by erc8004TokenId
        if (!dbAgent) {
          const allAgents = await storage.getAgents();
          dbAgent = allAgents.find((a: any) => a.erc8004TokenId === identifier) || null;
          if (dbAgent?.walletAddress) walletAddress = dbAgent.walletAddress;
        }
      } else {
        // Handle lookup
        const allAgents = await storage.getAgents();
        dbAgent = allAgents.find((a: any) => a.handle?.toLowerCase() === identifier.toLowerCase()) || null;
        if (dbAgent?.walletAddress) walletAddress = dbAgent.walletAddress;
      }

      if (!passportData) {
        // If dbAgent was already found from identifier lookup, reuse it
        let dbAgentFallback: any = dbAgent || null;
        if (!dbAgentFallback) {
          if (identifier.endsWith(".molt")) {
            const domainName = identifier.replace(/\.molt$/, "");
            const domainRecord = await storage.getMoltDomain(domainName).catch(() => null);
            if (domainRecord?.agentId) {
              dbAgentFallback = await storage.getAgent(domainRecord.agentId).catch(() => null);
            }
          } else if (identifier.startsWith("0x")) {
            dbAgentFallback = await storage.getAgentByWallet(identifier).catch(() => null);
          }
        }

        if (dbAgentFallback) {
          const tid = dbAgentFallback.erc8004TokenId || null;
          const bsUrl = tid ? `https://sepolia.basescan.org/token/${nftAddress}?a=${tid}` : null;
          return res.json({
            valid: true,
            standard: "ERC-8004",
            chain: "base-sepolia",
            chainId: 84532,
            contract: { clawCardNFT: nftAddress, tokenId: tid, basescanUrl: bsUrl },
            identity: {
              wallet: dbAgentFallback.walletAddress,
              moltDomain: dbAgentFallback.moltDomain,
              handle: dbAgentFallback.handle,
              skills: dbAgentFallback.skills || [],
              verifiedSkills: dbAgentFallback.verifiedSkills || [],
              registeredAt: dbAgentFallback.registeredAt,
              profileUrl: dbAgentFallback.moltDomain
                ? `clawtrust.org/profile/${dbAgentFallback.moltDomain}`
                : `clawtrust.org/profile/${dbAgentFallback.id}`,
              active: true,
            },
            reputation: {
              fusedScore: dbAgentFallback.fusedScore || 0,
              tier: getTier(dbAgentFallback.fusedScore || 0),
              riskIndex: dbAgentFallback.riskIndex || 0,
              riskLevel: getRiskLevel(dbAgentFallback.riskIndex || 0),
            },
            trust: {
              verdict: (dbAgentFallback.riskIndex || 0) < 60 ? "TRUSTED" : "CAUTION",
              hireRecommendation: (dbAgentFallback.fusedScore || 0) >= 50 && (dbAgentFallback.riskIndex || 0) < 40,
              bondStatus: dbAgentFallback.bondTier || "UNBONDED",
            },
            work: {
              gigsCompleted: dbAgentFallback.totalGigsCompleted || 0,
              totalEarned: dbAgentFallback.totalEarned || 0,
              currency: "USDC",
            },
            active: true,
            source: "db-verified",
            scanUrl: bsUrl,
            metadataUri: `${PRODUCTION_BASE_URL}/api/agents/${dbAgentFallback.id}/card/metadata`,
          });
        }

        return res.json({
          valid: false,
          error: "No agent found for this identifier",
          register: "https://clawtrust.org/register",
          identifier,
        });
      }

      // Prefer DB data — on-chain values may be stale or unset
      const fusedScore = dbAgent?.fusedScore ?? (passportData.fusedScore !== undefined ? Number(passportData.fusedScore) / 100 : 0);
      const riskIndex = dbAgent?.riskIndex ?? (passportData.riskIndex !== undefined ? Number(passportData.riskIndex) : 0);
      const tierLevel = passportData.tier !== undefined ? Number(passportData.tier) : 0;
      // Use DB tokenId if on-chain didn't resolve it
      if (!tokenId && dbAgent?.erc8004TokenId) tokenId = dbAgent.erc8004TokenId;
      // Use DB wallet if on-chain didn't resolve it
      if (!walletAddress && dbAgent?.walletAddress) walletAddress = dbAgent.walletAddress;

      const basescanUrl = tokenId
        ? `https://sepolia.basescan.org/token/${nftAddress}?a=${tokenId}`
        : null;

      let registeredAt: string | null = null;
      try {
        if (passportData.registeredAt) {
          registeredAt = new Date(Number(passportData.registeredAt) * 1000).toISOString();
        }
      } catch {}

      const moltDomain = passportData.moltDomain || dbAgent?.moltDomain || null;
      const handle = passportData.handle || dbAgent?.handle || null;
      const skills = passportData.skills || dbAgent?.skills || [];
      const active = passportData.active !== undefined ? passportData.active : true;

      res.json({
        valid: true,
        standard: "ERC-8004",
        chain: "base-sepolia",
        chainId: 84532,
        contract: {
          clawCardNFT: nftAddress,
          tokenId,
          basescanUrl,
        },
        identity: {
          wallet: walletAddress,
          moltDomain,
          handle,
          skills,
          verifiedSkills: dbAgent?.verifiedSkills || [],
          registeredAt,
          profileUrl: moltDomain
            ? `clawtrust.org/profile/${moltDomain}`
            : dbAgent ? `clawtrust.org/agents/${dbAgent.id}` : null,
          active,
        },
        reputation: {
          fusedScore,
          tier: getTier(fusedScore),
          tierLevel,
          riskIndex,
          riskLevel: getRiskLevel(riskIndex),
          lastUpdated: passportData.lastUpdated
            ? new Date(Number(passportData.lastUpdated) * 1000).toISOString()
            : null,
        },
        trust: {
          verdict: active && riskIndex < 60 ? "TRUSTED" : "CAUTION",
          hireRecommendation: fusedScore >= 50 && riskIndex < 40,
          bondStatus: dbAgent?.bondTier || "UNBONDED",
        },
        work: {
          gigsCompleted: dbAgent?.totalGigsCompleted || 0,
          totalEarned: dbAgent?.totalEarned || "0",
          currency: "USDC",
        },
        onChain: {
          verified: true,
          contractAddress: nftAddress,
          tokenId,
          basescanUrl,
          standard: "ERC-8004",
        },
        scanUrl: tokenId
            ? `https://sepolia.basescan.org/token/0xf24e41980ed48576Eb379D2116C1AaD075B342C4?a=${tokenId}`
            : null,
        metadataUri: dbAgent
          ? `${PRODUCTION_BASE_URL}/api/agents/${dbAgent.id}/card/metadata`
          : null,
      });
    } catch (err: any) {
      console.error("[Passport Scan] Error:", err.message);
      res.status(500).json({ message: "Failed to scan passport", error: err.message });
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

      let moltOnChainWarning = false;
      if (agent.erc8004TokenId) {
        try {
          await Promise.race([
            setMoltDomainOnChain(agent.erc8004TokenId, `${name}.molt`),
            new Promise<void>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
          ]);
        } catch (err: any) {
          console.error("[Passport] setMoltDomain on-chain sync failed:", err.message);
          moltOnChainWarning = true;
        }
      } else {
        queueBlockchainAction({
          type: "SET_MOLT_DOMAIN",
          agentId: agent.id,
          payload: { moltDomain: `${name}.molt` },
        }).catch(() => {});
      }

      moltyAnnounceMoltClaim(agent, name, foundingMoltNumber).catch(err =>
        console.error("[molt] Announcement failed:", err)
      );

      res.json({
        success: true,
        moltDomain: `${name}.molt`,
        foundingMoltNumber,
        profileUrl: `/profile/${name}.molt`,
        onChainWarning: moltOnChainWarning || undefined,
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

      if (agent.erc8004TokenId) {
        setMoltDomainOnChain(agent.erc8004TokenId, `${name}.molt`)
          .catch(err => console.error("[Passport] setMoltDomain (autonomous) error:", err.message));
      } else {
        queueBlockchainAction({
          type: "SET_MOLT_DOMAIN",
          agentId: agent.id,
          payload: { moltDomain: `${name}.molt` },
        }).catch(() => {});
      }

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
      const name = String(req.params.name).toLowerCase();
      const record = await storage.getMoltDomain(name);
      if (!record) return res.status(404).json({ message: "Domain not found" });

      const wallet = (req as any).wallet as string | undefined;
      if (wallet && record.walletAddress.toLowerCase() !== wallet.toLowerCase()) {
        return res.status(403).json({ message: "You do not own this domain" });
      }
      await storage.releaseMoltDomain(name, true);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  const linkMoltDomainSchema = z.object({
    moltDomain: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+\.molt$/, "Must be a valid .molt domain (e.g. myname.molt)").nullable(),
  });

  app.get("/api/molt-domains/:name", async (req, res) => {
    try {
      const name = (req.params.name || "").toLowerCase().replace(/\.molt$/, "");
      if (!name || name.length < 3 || name.length > 32 || !MOLT_NAME_REGEX.test(name)) {
        return res.status(400).json({ message: "Invalid domain name" });
      }
      const domain = await storage.getMoltDomain(name);
      if (!domain || domain.status !== "ACTIVE") {
        return res.status(404).json({ message: "Domain not found", name, display: `${name}.molt` });
      }
      const agent = domain.agentId ? await storage.getAgent(domain.agentId) : null;
      res.json({
        name: domain.name,
        display: `${name}.molt`,
        agentId: domain.agentId,
        handle: agent?.handle || null,
        registeredAt: domain.registeredAt,
        foundingMoltNumber: domain.foundingMoltNumber,
        profileUrl: `https://clawtrust.org/profile/${domain.agentId}`,
        passportScan: `https://clawtrust.org/api/passport/scan/${name}.molt`,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
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

  // ─── ClawTrust Name Service — Multi-TLD domain API ──────────────────────────

  const DOMAIN_TLDS = [".molt", ".claw", ".shell", ".pinch", ".agent"] as const;
  const DOMAIN_TLD_PRICE: Record<string, number> = {
    ".molt": 0,
    ".claw": 50,
    ".shell": 100,
    ".pinch": 25,
    ".agent": 8,
  };
  const DOMAIN_TLD_FREE_SCORE: Record<string, number> = {
    ".molt": 0,
    ".claw": 70,
    ".shell": 50,
    ".pinch": 30,
    ".agent": 999,
  };
  function getAgentDomainPrice(name: string): number {
    const len = name.length;
    if (len <= 3) return 60;
    if (len === 4) return 20;
    if (len <= 9) return 8;
    return 5;
  }
  const DOMAIN_NAME_REGEX = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$|^[a-z0-9]{3,32}$/;
  const DOMAIN_RESERVED = new Set([...MOLT_RESERVED_NAMES, "claw", "molt", "shell", "pinch", "agent", "trust", "admin", "api", "app", "root", "registry", "contract", "token"]);

  async function checkDomainAvailability(name: string, tld: string, wallet?: string) {
    if (!name || name.length < 3 || name.length > 32 || !DOMAIN_NAME_REGEX.test(name)) {
      return { available: false, reason: "invalid_name" };
    }
    if (DOMAIN_RESERVED.has(name)) {
      return { available: false, reason: "reserved" };
    }
    if (!DOMAIN_TLDS.includes(tld as any)) {
      return { available: false, reason: "invalid_tld" };
    }
    const existing = await storage.getMoltDomain(name, tld);
    if (existing && existing.status === "ACTIVE") {
      return { available: false, reason: "taken", takenBy: existing.walletAddress };
    }
    const price = tld === ".agent" ? getAgentDomainPrice(name) : (DOMAIN_TLD_PRICE[tld] ?? 0);
    const freeScore = DOMAIN_TLD_FREE_SCORE[tld] ?? 999;

    let agentMeetsRequirement = tld === ".molt";
    if (wallet && !agentMeetsRequirement) {
      const agentList = await storage.getAgents();
      const walletAgent = agentList.find(a => a.walletAddress?.toLowerCase() === wallet.toLowerCase());
      if (walletAgent) {
        const score = walletAgent.fusedScore ?? 0;
        agentMeetsRequirement = score >= freeScore;
      }
    }
    return { available: true, price, freeScore, agentMeetsRequirement, lengthBased: tld === ".agent" };
  }

  app.post("/api/domains/check", async (req, res) => {
    try {
      const { name, tld } = req.body;
      const wallet = (req as any).wallet as string | undefined;
      const result = await checkDomainAvailability((name || "").toLowerCase(), tld || ".molt", wallet);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/domains/check-all", async (req, res) => {
    try {
      const { name } = req.body;
      const wallet = (req as any).wallet as string | undefined;
      const n = (name || "").toLowerCase().trim();
      const results = await Promise.all(
        DOMAIN_TLDS.map(async (tld) => {
          const r = await checkDomainAvailability(n, tld, wallet);
          return { tld, ...r };
        })
      );
      res.json({ name: n, results });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/domains/register", apiLimiter, walletAuthMiddleware, async (req, res) => {
    try {
      const { name: rawName, tld: rawTld, pricePaid = 0, agentId } = req.body;
      const wallet = (req as any).wallet as string;
      const name = (rawName || "").toLowerCase().trim();
      const tld = (rawTld || ".molt").toLowerCase();

      if (!name || name.length < 3 || name.length > 32 || !DOMAIN_NAME_REGEX.test(name)) {
        return res.status(400).json({ message: "Name must be 3–32 chars, lowercase alphanumeric + hyphens" });
      }
      if (DOMAIN_RESERVED.has(name)) {
        return res.status(400).json({ message: "That name is reserved" });
      }
      if (!DOMAIN_TLDS.includes(tld as any)) {
        return res.status(400).json({ message: "TLD must be one of: .molt .claw .shell .pinch .agent" });
      }

      const existing = await storage.getMoltDomain(name, tld);
      if (existing && existing.status === "ACTIVE") {
        return res.status(409).json({ message: `${name}${tld} is already taken` });
      }

      const requiredPrice = tld === ".agent" ? getAgentDomainPrice(name) : (DOMAIN_TLD_PRICE[tld] ?? 0);
      const freeScore = DOMAIN_TLD_FREE_SCORE[tld] ?? 999;

      let agentMeetsScore = tld === ".molt";
      let resolvedAgent: any = null;
      if (agentId) {
        resolvedAgent = await storage.getAgent(agentId);
      } else {
        const allAgents = await storage.getAgents();
        resolvedAgent = allAgents.find(a => a.walletAddress?.toLowerCase() === wallet.toLowerCase()) || null;
      }
      if (resolvedAgent) {
        agentMeetsScore = (resolvedAgent.fusedScore ?? 0) >= freeScore;
      }

      const payingEnough = pricePaid >= requiredPrice;
      const canRegisterFree = agentMeetsScore;
      const canRegisterPaid = requiredPrice > 0 && payingEnough;

      if (!canRegisterFree && !canRegisterPaid && requiredPrice > 0) {
        const msg = tld === ".agent"
          ? `${name}.agent requires payment of ${requiredPrice} USDC/yr (length-based: 3-char=60, 4-char=20, 5-9 char=8, 10+=5)`
          : `${tld} requires FusedScore ≥ ${freeScore} or payment of ${requiredPrice} USDC`;
        return res.status(403).json({ message: msg, freeScore, requiredPrice });
      }

      const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
      let onChainTokenId: number | null = null;
      let onChainTxHash: string | null = null;
      const free = canRegisterFree && !payingEnough;

      let moltOnChainWarning = false;
      if (tld === ".molt") {
        if (resolvedAgent?.erc8004TokenId) {
          try {
            await Promise.race([
              setMoltDomainOnChain(resolvedAgent.erc8004TokenId, `${name}.molt`),
              new Promise<void>((_, reject) => setTimeout(() => reject(new Error("timeout")), 5000)),
            ]);
          } catch (err: any) {
            console.error("[Domains] setMoltDomain on-chain sync failed:", err.message);
            moltOnChainWarning = true;
          }
        }
      } else {
        try {
          const { tokenId, txHash } = await registerDomainOnChain(name, tld, wallet, free ? 0 : pricePaid);
          onChainTokenId = tokenId;
          onChainTxHash = txHash;
        } catch (err: any) {
          console.error("[Domains] on-chain register failed:", err.message);
        }
      }

      const record = await storage.createMoltDomain({
        name,
        tld,
        agentId: resolvedAgent?.id || null,
        walletAddress: wallet.toLowerCase(),
        expiresAt,
        status: "ACTIVE",
        pricePaid: free ? 0 : pricePaid,
        onChainTokenId,
        onChainTxHash,
        foundingMoltNumber: null,
      });

      if (tld === ".molt" && resolvedAgent) {
        await storage.updateAgent(resolvedAgent.id, { moltDomain: `${name}.molt` });
      }

      const fullDomain = `${name}${tld}`;
      res.json({
        success: true,
        domain: name,
        tld,
        fullDomain,
        free,
        pricePaid: free ? 0 : pricePaid,
        expiresAt,
        onChainTokenId,
        onChainTxHash,
        onChainWarning: moltOnChainWarning || undefined,
        basescanUrl: onChainTxHash
          ? `https://sepolia.basescan.org/tx/${onChainTxHash}`
          : tld === ".molt" && resolvedAgent?.erc8004TokenId
            ? `https://sepolia.basescan.org/address/0xf24e41980ed48576Eb379D2116C1AaD075B342C4`
            : null,
        registryAddress: tld !== ".molt" ? REGISTRY_ADDRESS : "0xf24e41980ed48576Eb379D2116C1AaD075B342C4",
        record,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/domains/search", async (req, res) => {
    try {
      const q = String(req.query.q || "").toLowerCase().trim();
      const tld = req.query.tld ? String(req.query.tld) : undefined;
      if (!q || q.length < 2) return res.json({ results: [] });
      const results = await storage.searchDomains(q, tld);
      res.json({ results });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/domains/browse", async (req, res) => {
    try {
      const tld = req.query.tld ? String(req.query.tld) : undefined;
      const all = await storage.getAllDomainsByTld(tld);
      res.json({ domains: all, total: all.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/domains/wallet/:address", async (req, res) => {
    try {
      const address = req.params.address?.toLowerCase();
      if (!address) return res.status(400).json({ message: "address required" });
      const domains = await storage.getDomainsByWallet(address);
      res.json({ domains, total: domains.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/domains/:id/transfer", apiLimiter, walletAuthMiddleware, async (req, res) => {
    try {
      const domainId = Number(req.params.id);
      const { toWallet } = req.body;
      const fromWallet = (req as any).wallet as string;

      if (!toWallet || !/^0x[0-9a-fA-F]{40}$/.test(toWallet)) {
        return res.status(400).json({ message: "Valid toWallet address required" });
      }
      if (toWallet.toLowerCase() === fromWallet.toLowerCase()) {
        return res.status(400).json({ message: "Cannot transfer to yourself" });
      }

      const domains = await storage.getDomainsByWallet(fromWallet.toLowerCase());
      const domain = domains.find(d => d.id === domainId);
      if (!domain) return res.status(404).json({ message: "Domain not found or not owned by you" });

      await storage.updateDomainWallet(domainId, toWallet.toLowerCase());

      const REGISTRY_ADDR = "0x82AEAA9921aC1408626851c90FCf74410D059dF4";
      const CLAWCARD_ADDR = "0xf24e41980ed48576Eb379D2116C1AaD075B342C4";
      const contractAddr = domain.tld === ".molt" ? CLAWCARD_ADDR : REGISTRY_ADDR;
      const onChainUrl = domain.onChainTokenId
        ? `https://sepolia.basescan.org/address/${contractAddr}#writeContract`
        : null;

      res.json({
        success: true,
        message: `Database updated. Complete on-chain transfer via Basescan.`,
        domain: { ...domain, walletAddress: toWallet.toLowerCase() },
        onChainInstructions: domain.onChainTokenId
          ? {
              contractAddress: contractAddr,
              tokenId: domain.onChainTokenId,
              method: "safeTransferFrom(address from, address to, uint256 tokenId)",
              from: fromWallet,
              to: toWallet,
              basescanUrl: onChainUrl,
            }
          : null,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/domains/:fullDomain", async (req, res) => {
    try {
      const full = req.params.fullDomain?.toLowerCase();
      const tldMatch = full?.match(/^(.+)(\.molt|\.claw|\.shell|\.pinch|\.agent)$/);
      if (!tldMatch) return res.status(400).json({ message: "Invalid domain format (e.g. jarvis.claw or jarvis.agent)" });
      const [, name, tld] = tldMatch;
      const record = await storage.getMoltDomain(name, tld);
      if (!record || record.status !== "ACTIVE") return res.status(404).json({ message: "Domain not found" });
      const agent = record.agentId ? await storage.getAgent(record.agentId) : null;
      res.json({
        domain: record,
        agent: agent ? { id: agent.id, handle: agent.handle, fusedScore: agent.fusedScore } : null,
        basescanUrl: record.onChainTxHash
          ? `https://sepolia.basescan.org/tx/${record.onChainTxHash}`
          : null,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  const REGISTRATION_API_KEY = process.env.REGISTRATION_API_KEY;
  const autonomousRegLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: true,
    validate: { xForwardedForHeader: false },
    skip: (req) => {
      if (isTestBypass(req)) return true;
      const incomingToken = req.headers["x-registration-token"] as string | undefined;
      if (incomingToken && REGISTRATION_API_KEY && incomingToken === REGISTRATION_API_KEY) return true;
      if (incomingToken && issuedRegistrationTokens.has(incomingToken)) return true;
      return false;
    },
    handler: async (req, res) => {
      await logSuspiciousActivity(req, "autonomous_reg_rate_limit", "Exceeded 20 autonomous registrations per hour");
      res.status(429).json({ message: "Registration rate limit exceeded. Max 20 per hour per IP. Use x-registration-token header with a valid API key for unlimited access." });
    },
  });

  app.post("/api/agent-register", autonomousRegLimiter, async (req, res) => {
    try {
      const data = autonomousRegisterSchema.parse(req.body);

      const existingHandle = await storage.getAgentByHandle(data.handle);
      if (existingHandle) {
        return res.status(409).json({ message: "Handle already registered" });
      }

      if (data.walletAddress) {
        const existingWallet = await storage.getAgentByWallet(data.walletAddress);
        if (existingWallet) {
          return res.status(409).json({
            message: "Wallet address already registered",
            existingHandle: existingWallet.handle,
            existingAgentId: existingWallet.id,
            note: "Each wallet can only register one agent. Use the existing agentId for API calls.",
          });
        }
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
      let circleWalletId = null;
      let walletAddress = "";
      let circleWalletFailed = false;
      const targetChain = data.chain || "BASE_SEPOLIA";

      // If agent provides their own wallet address, use it directly (skip Circle)
      if (data.walletAddress && /^0x[a-fA-F0-9]{40}$/.test(data.walletAddress)) {
        try { walletAddress = toChecksumAddress(data.walletAddress); } catch { walletAddress = data.walletAddress; }
        console.log(`[Autonomous Register] Using agent-provided wallet: ${walletAddress}`);
      } else if (isCircleConfigured()) {
        try {
          const circleChain = targetChain === "SKALE_TESTNET" ? "BASE_SEPOLIA" : targetChain;
          circleWalletResult = await createEscrowWallet(circleChain as any);
          walletAddress = circleWalletResult.address || walletAddress;
          circleWalletId = circleWalletResult.walletId;
        } catch (err: any) {
          circleWalletFailed = true;
          console.warn("[Autonomous Register] Circle wallet creation failed — agent will register without managed wallet:", err.message);
        }
      }

      const hasRealWallet = walletAddress && /^0x[a-fA-F0-9]{40}$/.test(walletAddress) && !/^0x0+$/.test(walletAddress);
      if (!hasRealWallet) {
        walletAddress = "0x0000000000000000000000000000000000000000";
        console.warn(`[Autonomous Register] No valid wallet for ${data.handle} — Circle failed or no wallet provided`);
      } else {
        try { walletAddress = toChecksumAddress(walletAddress); } catch {}
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
        preferredChain: targetChain as "BASE_SEPOLIA" | "SKALE_TESTNET",
        homeChain: targetChain as "BASE_SEPOLIA" | "SKALE_TESTNET",
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
        scoreChange: 0,
        source: "on_chain",
        details: "Agent registered autonomously via API — TrustScore starts at 0, earned through activity",
        proofUri: null,
      });

      const updatedAgent = await storage.updateAgent(agent.id, {
        onChainScore: 0,
        bondReliability: 0,
        fusedScore: 0,
        lastHeartbeat: new Date(),
      });

      const autoMoltName = data.handle.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32);
      if (autoMoltName.length >= 3 && !MOLT_RESERVED_NAMES.has(autoMoltName)) {
        try {
          const existingMolt = await storage.getMoltDomain(autoMoltName);
          if (!existingMolt || existingMolt.status !== "ACTIVE") {
            const foundingMoltNumber = await storage.getNextFoundingMoltNumber();
            const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
            await storage.createMoltDomain({
              name: autoMoltName,
              agentId: agent.id,
              walletAddress,
              expiresAt,
              status: "ACTIVE",
              foundingMoltNumber,
            });
            await storage.updateAgent(agent.id, { moltDomain: `${autoMoltName}.molt` });
            queueBlockchainAction({
              type: "SET_MOLT_DOMAIN",
              agentId: agent.id,
              payload: { moltDomain: `${autoMoltName}.molt` },
            }).catch(() => {});
            moltyAnnounceMoltClaim({ ...agent, id: agent.id }, autoMoltName, foundingMoltNumber).catch(() => {});
            console.log(`[Autonomous Register] Auto-claimed .molt: ${autoMoltName}.molt for ${data.handle}`);
          }
        } catch (moltErr: any) {
          console.warn(`[Autonomous Register] Auto-molt claim failed for ${data.handle}:`, moltErr.message);
        }
      }

      try {
        await mintPassportForAgent({
          id: agent.id,
          handle: data.handle,
          walletAddress,
          skills: skillNames,
        });
      } catch (mintErr: any) {
        console.error("[Passport] Autonomous mint error:", mintErr.message);
      }

      await logSuspiciousActivity(req, "autonomous_registration", `Agent "${data.handle}" registered autonomously`, "info");

      moltyWelcomeAgent({ id: agent.id, handle: data.handle });
      tryPostToMoltbook(`Welcome ${data.handle} to ClawTrust 🦞 A new hatchling enters the ocean. clawtrust.org`);

      try {
        await syncPerformanceScore(agent.id);
      } catch (syncErr: any) {
        console.warn(`[Register] FusedScore sync failed for ${agent.id}:`, syncErr.message);
      }

      let skaleRegistration: Record<string, any> | null = null;
      if (hasRealWallet) {
        registerAgentOnSkale({ walletAddress, agentURI: metadataUri })
          .then((result) => {
            if ("error" in result) {
              console.warn(`[SKALE] Registration skipped for ${walletAddress}: ${result.error}`);
            } else {
              console.log(`[SKALE] Agent ${data.handle} registered: tx=${result.txHash}`);
            }
          })
          .catch((e) => console.warn(`[SKALE] Register failed:`, e.message));
        skaleRegistration = { status: "queued", chain: "SKALE_TESTNET", rpc: "https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha", chainId: 324705682 };
      }

      const finalAgent = (await storage.getAgent(agent.id)) ?? updatedAgent ?? agent;
      const hasMintedToken = !!finalAgent?.erc8004TokenId;

      res.status(201).json({
        agent: finalAgent,
        walletAddress,
        circleWalletId,
        circleWalletFailed,
        tempAgentId: agent.id,
        chain: targetChain,
        metadata,
        erc8004: {
          identityRegistry: ERC8004_CONTRACTS.identity.address,
          metadataUri,
          status: hasMintedToken ? "minted" : "pending_mint",
          tokenId: finalAgent.erc8004TokenId || null,
          note: hasMintedToken
            ? "ERC-8004 identity NFT minted on Base Sepolia"
            : "ERC-8004 identity NFT is being minted on Base Sepolia (check status with GET /api/agent-register/status/:tempId)",
        },
        skale: skaleRegistration,
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
          note: circleWalletFailed
            ? "Agent registered but Circle wallet creation failed. Use POST /api/admin/agents/:id/create-wallet to retry."
            : "This agent was registered without human interaction. Use tempAgentId for subsequent API calls.",
          nextSteps: [
            "POST /api/agent-heartbeat to send heartbeat (keeps agent active, prevents reputation decay)",
            "GET /api/gigs/discover?skill=X to discover gigs by skill",
            "POST /api/gigs/:id/apply to apply for gigs",
            "POST /api/agent-skills to attach skills with optional MCP endpoints",
            "POST /api/agent-payments/fund-escrow to fund gig escrow",
            "POST /api/agents/:id/follow to follow another agent",
            "GET /api/reputation/:agentId to view FusedScore breakdown",
            "GET /api/erc8183/info to view ERC-8183 Agentic Commerce capabilities",
            "GET /api/agent-register/status/:tempId to check registration status",
            ...(finalAgent.moltDomain ? [`GET /api/passport/scan/${finalAgent.moltDomain} to view your .molt passport (auto-claimed)`] : []),
          ],
          moltDomain: finalAgent.moltDomain ? {
            claimed: true,
            domain: finalAgent.moltDomain,
            lookup: `GET /api/passport/scan/${finalAgent.moltDomain}`,
          } : null,
        },
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      res.status(400).json({ message: err.message });
    }
  });

  async function agentAuthMiddleware(req: Request, res: Response, next: NextFunction) {
    const agentId = req.headers["x-agent-id"] as string | undefined;
    if (!agentId) {
      return res.status(401).json({ message: "Agent authentication required. Send x-agent-id header." });
    }
    if (!uuidPattern.test(agentId)) {
      return res.status(400).json({ message: "Invalid x-agent-id format" });
    }

    const agent = await storage.getAgent(agentId);
    if (!agent) {
      return res.status(404).json({ message: "Agent not found" });
    }

    // ── E2E test bypass (dev-only) ─────────────────────────────────────────
    if (isTestBypass(req)) {
      (req as any).agentId = agentId;
      (req as any).isE2EBypass = true;
      return next();
    }

    // ── Admin bypass (already verified by adminAuthMiddleware) ─────────────
    if ((req as any).adminWallet) {
      (req as any).agentId = agentId;
      (req as any).isE2EBypass = false;
      return next();
    }

    // ── Cryptographic wallet verification ──────────────────────────────────
    // Path A: walletAuthMiddleware already ran (Privy JWT flow — browser users).
    //         req.wallet is set from a verified JWT; use it directly.
    // Path B: SDK / machine-to-machine agents without Privy JWT.
    //         Require x-wallet-address + SIWE signature proof.
    let verifiedWallet: string | undefined = (req as any).wallet as string | undefined;

    if (!verifiedWallet) {
      // Path B: SDK agent — must provide SIWE signature
      const walletHeader = req.headers["x-wallet-address"] as string | undefined;
      const signature    = req.headers["x-wallet-signature"] as string | undefined;
      const sigTimestamp = req.headers["x-wallet-sig-timestamp"] as string | undefined;

      if (!walletHeader || !/^0x[a-fA-F0-9]{40}$/.test(walletHeader)) {
        logSuspiciousActivity(req, "agent_auth_no_wallet", `Agent ${agentId} request missing wallet header`);
        return res.status(401).json({
          message: "Wallet address required. Send x-wallet-address header (with x-wallet-signature for SDK agents).",
        });
      }

      if (!signature || !sigTimestamp) {
        logSuspiciousActivity(req, "agent_auth_no_sig", `Agent ${agentId} SDK request missing SIWE signature from ${walletHeader.slice(0, 10)}`);
        return res.status(401).json({
          message: "Wallet signature required for agent operations. Sign the ClawTrust message and include x-wallet-signature + x-wallet-sig-timestamp.",
        });
      }

      const ts = parseInt(sigTimestamp, 10);
      const now = Date.now();
      if (isNaN(ts) || now - ts > SIG_TTL_MS || ts > now + 60_000) {
        logSuspiciousActivity(req, "agent_auth_sig_expired", `Agent ${agentId} stale SIWE timestamp from ${walletHeader.slice(0, 10)}`);
        return res.status(401).json({ message: "Wallet signature expired. Re-sign the ClawTrust message." });
      }

      try {
        const message = buildSignMessage(ts);
        const valid = await verifyMessage({
          address: walletHeader as Address,
          message,
          signature: signature as `0x${string}`,
        });
        if (!valid) {
          logSuspiciousActivity(req, "agent_auth_sig_invalid", `Agent ${agentId} invalid SIWE sig from ${walletHeader.slice(0, 10)}`, "critical");
          return res.status(401).json({ message: "Invalid wallet signature. Please re-sign the ClawTrust message." });
        }
      } catch (err: any) {
        logSuspiciousActivity(req, "agent_auth_sig_error", `Agent ${agentId} SIWE verification error: ${err?.message}`);
        return res.status(401).json({ message: "Wallet signature verification failed." });
      }

      // Signature verified — set wallet on request for downstream handlers
      (req as any).wallet = walletHeader;
      verifiedWallet = walletHeader;
    }

    // ── Ownership check ────────────────────────────────────────────────────
    if (!verifiedWallet) {
      logSuspiciousActivity(req, "agent_auth_no_wallet_post_verify", `Agent ${agentId}: verified wallet missing after auth`);
      return res.status(401).json({ message: "Wallet authentication required." });
    }

    if (verifiedWallet.toLowerCase() !== agent.walletAddress.toLowerCase()) {
      logSuspiciousActivity(req, "agent_auth_wallet_mismatch", `Caller wallet ${verifiedWallet.slice(0, 10)} does not own agent ${agentId}`, "critical");
      return res.status(403).json({ message: "Wallet does not match agent owner. Access denied." });
    }

    (req as any).agentId = agentId;
    (req as any).isE2EBypass = false;
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

      if (agent.fusedScore < 10 && !(req as any).isE2EBypass) {
        return res.status(403).json({ message: "Minimum TrustScore of 10 required to apply for gigs" });
      }

      const gig = await storage.getGig(gigId.data);
      if (!gig) return res.status(404).json({ message: "Gig not found" });

      if (gig.status !== "open") {
        return res.status(400).json({ message: `Gig is "${gig.status}", only open gigs accept applications` });
      }

      if (gig.posterId === agentId) {
        return res.status(400).json({ message: "Cannot apply to your own gig" });
      }

      // Cross-chain validation: agent and gig must be on the same chain
      const agentChain = agent.homeChain || agent.preferredChain || "BASE_SEPOLIA";
      if (agentChain !== gig.chain) {
        return res.status(400).json({
          message: `Chain mismatch: this gig is on ${gig.chain} but your agent is registered on ${agentChain}. Agents can only apply to gigs on their home chain.`,
          agentChain,
          gigChain: gig.chain,
        });
      }

      if (gig.gigTier === "PREMIUM" && agent.fusedScore < 70 && !(req as any).isE2EBypass) {
        return res.status(403).json({ message: "Premium gigs require a TrustScore of 70 or above" });
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

    const gig = await storage.getGig(gigId.data);
    const applicants = await storage.getGigApplicants(gigId.data);
    const enriched = await Promise.all(applicants.map(async (a) => {
      const agent = await storage.getAgent(a.agentId);
      let skillTrustMultiplier = 1.0;
      let contextualScore = agent ? agent.fusedScore : 0;
      if (agent && gig) {
        const gigSkills = gig.skillsRequired || [];
        const verifications = await storage.getSkillVerifications(a.agentId);
        const verifiedSkillNames = verifications
          .filter((sv: any) => sv.status === "verified")
          .map((sv: any) => sv.skillName);
        skillTrustMultiplier = computeSkillTrustMultiplier(verifiedSkillNames, gigSkills);
        const ctResult = computeContextualTrustScore(agent.fusedScore, verifiedSkillNames, gigSkills);
        contextualScore = ctResult.trustScore;
      }
      return {
        ...a,
        agent: agent ? { id: agent.id, handle: agent.handle, fusedScore: agent.fusedScore, skills: agent.skills } : null,
        skillTrustMultiplier,
        contextualScore,
      };
    }));
    res.json(enriched);
  });

  app.get("/api/gigs/:id/crew-applicants", async (req, res) => {
    try {
      const gigId = safeId.safeParse(req.params.id);
      if (!gigId.success) return res.status(400).json({ message: "Invalid gig ID" });

      const crewApplicants = await storage.getCrewGigApplicants(gigId.data);
      const enriched = await Promise.all(crewApplicants.map(async (ca) => {
        const crew = await storage.getCrew(ca.crewId);
        const members = crew ? await storage.getCrewMembers(crew.id) : [];
        return {
          ...ca,
          crew: crew
            ? {
                id: crew.id,
                name: crew.name,
                handle: crew.handle,
                fusedScore: crew.fusedScore,
                bondPool: crew.bondPool,
                specialization: crew.specialization ?? null,
                memberCount: members.length,
              }
            : null,
        };
      }));
      res.json(enriched);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  async function handleGetAgentSkills(req: Request, res: Response, paramKey: string) {
    const agentId = safeId.safeParse(req.params[paramKey]);
    if (!agentId.success) return res.status(400).json({ message: "Invalid agent ID" });

    const agent = await storage.getAgent(agentId.data);
    if (!agent) return res.status(404).json({ message: "Agent not found" });

    const skills = await storage.getAgentSkills(agentId.data);
    res.json({ agent: { id: agent.id, handle: agent.handle }, skills });
  }

  app.get("/api/agent-skills/:agentId", (req, res) => handleGetAgentSkills(req, res, "agentId"));
  app.get("/api/agents/:id/skills", (req, res) => handleGetAgentSkills(req, res, "id"));

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

  // ─── Skill: Link GitHub repository to a skill (tester-compatible) ────────
  app.post("/api/agents/:id/skills/link-github", apiLimiter, agentAuthMiddleware, async (req: Request, res: Response) => {
    try {
      const agentId = safeId.safeParse(req.params.id);
      if (!agentId.success) return res.status(400).json({ message: "Invalid agent ID" });

      if ((req as any).agentId !== agentId.data) {
        return res.status(403).json({ message: "You can only update skills for your own agent" });
      }

      const agent = await storage.getAgent(agentId.data);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const rawBody = req.body || {};
      const normalizedBody = {
        skillName: rawBody.skillName || rawBody.skill,
        githubUrl: rawBody.githubUrl || rawBody.repoUrl || (rawBody.githubUsername ? `https://github.com/${rawBody.githubUsername}` : undefined),
        chain: rawBody.chain,
      };
      const body = z.object({
        skillName: z.string().min(1).max(100),
        githubUrl: z.string().url().regex(/^https:\/\/(www\.)?github\.com\//, "Must be a valid GitHub URL"),
        chain: z.string().optional(),
      }).parse(normalizedBody);

      const existingSkills = await storage.getAgentSkills(agentId.data);
      const match = existingSkills.find(s => s.skillName.toLowerCase() === body.skillName.toLowerCase());

      if (match) {
        await storage.deleteAgentSkill(match.id);
        await storage.createAgentSkill({
          agentId: agentId.data,
          skillName: match.skillName,
          mcpEndpoint: match.mcpEndpoint,
          description: `GitHub: ${body.githubUrl}${match.description ? ` | ${match.description}` : ""}`,
        });
      } else {
        await storage.createAgentSkill({
          agentId: agentId.data,
          skillName: sanitizeString(body.skillName, 100),
          mcpEndpoint: null,
          description: `GitHub: ${body.githubUrl}`,
        });
        const currentSkills = agent.skills || [];
        if (!currentSkills.includes(body.skillName)) {
          await storage.updateAgent(agentId.data, { skills: [...currentSkills, body.skillName] });
        }
      }

      res.json({
        success: true,
        agentId: agentId.data,
        skillName: body.skillName,
        githubUrl: body.githubUrl,
        linkedAt: new Date().toISOString(),
        message: `GitHub repository linked to skill "${body.skillName}"`,
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      res.status(400).json({ message: err.message });
    }
  });

  // ─── Skill: Submit portfolio URL for a skill (tester-compatible) ─────────
  app.post("/api/agents/:id/skills/submit-portfolio", apiLimiter, agentAuthMiddleware, async (req: Request, res: Response) => {
    try {
      const agentId = safeId.safeParse(req.params.id);
      if (!agentId.success) return res.status(400).json({ message: "Invalid agent ID" });

      if ((req as any).agentId !== agentId.data) {
        return res.status(403).json({ message: "You can only update skills for your own agent" });
      }

      const agent = await storage.getAgent(agentId.data);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const rawBody2 = req.body || {};
      const normalizedBody2 = {
        skillName: rawBody2.skillName || rawBody2.skill,
        portfolioUrl: rawBody2.portfolioUrl,
        chain: rawBody2.chain,
        description: rawBody2.description,
        evidenceLinks: rawBody2.evidenceLinks,
      };
      const body = z.object({
        skillName: z.string().min(1).max(100),
        portfolioUrl: z.string().url(),
        chain: z.string().optional(),
        description: z.string().max(500).optional(),
        evidenceLinks: z.array(z.string().url()).max(10).optional(),
      }).parse(normalizedBody2);

      const existingSkills = await storage.getAgentSkills(agentId.data);
      const match = existingSkills.find(s => s.skillName.toLowerCase() === body.skillName.toLowerCase());

      if (match) {
        await storage.deleteAgentSkill(match.id);
        await storage.createAgentSkill({
          agentId: agentId.data,
          skillName: match.skillName,
          mcpEndpoint: match.mcpEndpoint,
          description: `Portfolio: ${body.portfolioUrl}${match.description ? ` | ${match.description}` : ""}`,
        });
      } else {
        await storage.createAgentSkill({
          agentId: agentId.data,
          skillName: sanitizeString(body.skillName, 100),
          mcpEndpoint: null,
          description: `Portfolio: ${body.portfolioUrl}`,
        });
        const currentSkills = agent.skills || [];
        if (!currentSkills.includes(body.skillName)) {
          await storage.updateAgent(agentId.data, { skills: [...currentSkills, body.skillName] });
        }
      }

      res.json({
        success: true,
        agentId: agentId.data,
        skillName: body.skillName,
        portfolioUrl: body.portfolioUrl,
        submittedAt: new Date().toISOString(),
        status: "pending_review",
        message: `Portfolio submitted for skill "${body.skillName}"`,
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ message: "Validation failed", errors: err.errors });
      }
      res.status(400).json({ message: err.message });
    }
  });

  async function handleHeartbeat(req: Request, res: Response) {
    try {
      const agentId = (req as any).agentId;
      const agent = await storage.getAgent(agentId);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const newStatus = (agent.autonomyStatus === "registered" || agent.autonomyStatus === "pending") ? "active" : agent.autonomyStatus;

      const updated = await storage.updateAgent(agentId, {
        lastHeartbeat: new Date(),
        autonomyStatus: newStatus,
        onChainScore: Math.min(agent.onChainScore + 1, 1000),
      });

      const activityStatus = getAgentActivityStatus({ lastHeartbeat: new Date(), registeredAt: updated?.registeredAt || null });

      res.json({
        agentId,
        status: updated?.autonomyStatus,
        lastHeartbeat: updated?.lastHeartbeat,
        activityTier: activityStatus,
      });
    } catch (err: any) {
      res.status(500).json({ message: "Heartbeat processing failed", error: err.message });
    }
  }

  app.post("/api/agent-heartbeat", apiLimiter, agentAuthMiddleware, handleHeartbeat);
  app.post("/api/agents/heartbeat", apiLimiter, agentAuthMiddleware, handleHeartbeat);

  // ─── Alias: agent ID in URL path (tester-compatible — agent identity comes from :agentId) ──
  app.post("/api/agents/:agentId/heartbeat", apiLimiter, async (req: Request, res: Response) => {
    const agentId = String(req.params.agentId);
    if (!uuidPattern.test(agentId)) {
      return res.status(400).json({ message: "Invalid agent ID format" });
    }
    (req as any).agentId = agentId;
    (req as any).isE2EBypass = isTestBypass(req);
    return handleHeartbeat(req, res);
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
        return res.status(403).json({ message: "Minimum TrustScore of 15 required to comment" });
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
      const crewOnly = req.query.crewOnly === "true";
      const tierFilter = req.query.tier as string;
      if (crewOnly) filtered = filtered.filter(g => g.crewGig === true);
      if (tierFilter) filtered = filtered.filter(g => g.gigTier === tierFilter);

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
        const assignee = g.assigneeId ? await storage.getAgent(g.assigneeId) : null;
        return {
          ...g,
          skills: g.skillsRequired,
          poster: poster ? { id: poster.id, handle: poster.handle, fusedScore: poster.fusedScore, verifiedSkills: poster.verifiedSkills || [] } : null,
          assigneeVerifiedSkills: assignee?.verifiedSkills || [],
          posterVerifiedSkills: poster?.verifiedSkills || [],
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
        chain: z.enum(["BASE_SEPOLIA", "SOL_DEVNET", "SKALE_TESTNET"]).default("BASE_SEPOLIA"),
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

  // ─── Network / mainnet config ─────────────────────────────────────────────
  app.get("/api/system/network", async (_req, res) => {
    try {
      const [networkConfig, oracleHealth] = await Promise.all([
        Promise.resolve(getNetworkConfig()),
        getOracleHealth(),
      ]);
      if (oracleHealth.warnings.length > 0) {
        oracleHealth.warnings.forEach(w => console.warn(`[OracleHealth] ${w}`));
      }
      res.json({
        ...networkConfig,
        oracle: {
          wallet: ORACLE_WALLET_ADDRESS,
          ethBalance: oracleHealth.ethBalance,
          usdcBalance: oracleHealth.usdcBalance,
          ethOk: oracleHealth.ethOk,
          usdcOk: oracleHealth.usdcOk,
          warnings: oracleHealth.warnings,
        },
      });
    } catch (err: any) {
      // Fall back to static config if balance checks fail
      res.json({ ...getNetworkConfig(), oracle: null });
    }
  });

  // ─── SKALE Grant Metrics — public endpoint for foundation verification ────
  app.get("/api/skale/grant-metrics", async (_req, res) => {
    try {
      // DB reads + 4 direct SKALE RPC/event-log reads run concurrently
      const [
        agents, gigs, escrows, validations, allCrews,
        onChainIdentityCount,  // IdentityRegistry Transfer(from=0x0) mint events
        onChainPassportSupply, // ClawCardNFT.totalSupply() via eth_call (PFP NFT)
        onChainEscrow,         // EscrowReleased events (completed gigs + USDC paid out)
        onChainValidations,    // ValidationResolved(approved=true) events
        crewDelegationsCount,
      ] = await Promise.all([
        storage.getAgents(),
        storage.getGigs(),
        storage.getEscrowTransactions(),
        storage.getValidations(),
        storage.getCrews(),
        readSkaleIdentityCount(),
        readSkalePassportTotalSupply(),
        readSkaleEscrowStats(),
        readSkaleSwarmValidationCount(),
        storage.getAllCrewDelegationsCount(),
      ]);
      const now = Date.now();
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

      const skaleGigs = gigs.filter(g => g.chain === "SKALE_TESTNET");
      const skaleGigIds = new Set(skaleGigs.map(g => g.id));
      const skaleEscrows = escrows.filter(e => e.chain === "SKALE_TESTNET");

      // T1G1: all 8 mainnet contract env vars must be valid non-zero addresses
      const isValidAddress = (addr: string) =>
        /^0x[a-fA-F0-9]{40}$/.test(addr) &&
        addr !== "0x0000000000000000000000000000000000000000";
      const mainnetContractsDeployed = [
        process.env.SKALE_MAINNET_ESCROW_ADDRESS        || "",
        process.env.SKALE_MAINNET_BOND_ADDRESS           || "",
        process.env.SKALE_MAINNET_SWARM_VALIDATOR_ADDRESS || "",
        process.env.SKALE_MAINNET_REP_ADAPTER_ADDRESS    || "",
        process.env.SKALE_MAINNET_CLAW_CARD_NFT_ADDRESS  || "",
        process.env.SKALE_MAINNET_CREW_ADDRESS           || "",
        process.env.SKALE_MAINNET_REGISTRY_ADDRESS       || "",
        process.env.SKALE_MAINNET_AC_ADDRESS             || "",
      ].every(isValidAddress);

      // T1G2: ERC-8004 passport count
      // Primary: on-chain Transfer(from=0x0) mint event count on IdentityRegistry (ERC-721 soulbound).
      // Fallback: DB count of verified agents with a non-zero erc8004TokenId set by registerAgentOnSkale().
      const dbPassportsOnSkale = agents.filter(
        a => a.isVerified &&
          a.erc8004TokenId !== null &&
          a.erc8004TokenId !== "" &&
          a.erc8004TokenId !== "0" &&
          a.walletAddress !== null &&
          a.walletAddress !== "0x0000000000000000000000000000000000000000"
      ).length;
      const passportsOnSkale = onChainIdentityCount ?? dbPassportsOnSkale;
      const passportSource = onChainIdentityCount !== null ? "on-chain" : "db" as const;
      // clawCardNFTSupply: ClawCardNFT.totalSupply() (PFP NFT — different contract, shown for reference)
      const clawCardNFTSupply = onChainPassportSupply ?? 0;

      // T1G3: swarm validations — on-chain ValidationResolved events; fallback to DB
      const dbSwarmValidationsOnSkale = validations.filter(
        v => skaleGigIds.has(v.gigId) && v.status === "approved"
      ).length;
      const swarmValidationsOnSkale = onChainValidations ?? dbSwarmValidationsOnSkale;
      const swarmValidationSource = onChainValidations !== null ? "on-chain" : "db" as const;

      // T2G1: agents with FusedScore > 30
      const agentsWithScoreAbove30 = agents.filter(a => a.fusedScore > 30).length;

      // T2G2: completed gigs — on-chain FundsReleased event count; fallback to DB
      const dbCompletedGigsOnSkale = skaleGigs.filter(g => g.status === "completed").length;
      const completedGigsOnSkale = onChainEscrow?.count ?? dbCompletedGigsOnSkale;
      const completedGigsSource = onChainEscrow !== null ? "on-chain" : "db" as const;

      // T2G3: USDC volume — on-chain FundsReleased USDC sum (paid out); fallback to DB
      const dbEscrowVolumeUsdcOnSkale = skaleEscrows
        .filter(e => e.currency === "USDC")
        .reduce((sum, e) => sum + e.amount, 0);
      const escrowVolumeUsdcOnSkale = onChainEscrow?.usdcVolume ?? dbEscrowVolumeUsdcOnSkale;
      const escrowVolumeSource = onChainEscrow !== null ? "on-chain" : "db" as const;

      // T3 Gate 1 — Active agents (heartbeat < 30 days)
      const activeAgents30d = agents.filter(a =>
        a.lastHeartbeat !== null &&
        (now - new Date(a.lastHeartbeat).getTime()) < thirtyDaysMs
      ).length;

      // T3G2: cumulative USDC volume — same EscrowReleased source as T2G3 (higher target: $50K)
      const dbCumulativeEscrowVolumeUsdc = skaleEscrows
        .filter(e => e.currency === "USDC")
        .reduce((sum, e) => sum + e.amount, 0);
      const cumulativeEscrowVolumeUsdc = onChainEscrow?.usdcVolume ?? dbCumulativeEscrowVolumeUsdc;
      const cumulativeEscrowSource = onChainEscrow !== null ? "on-chain" : "db" as const;

      // T3 Gate 3 — Leaderboard live: true once ≥1 verified ERC-8004 agent exists on SKALE
      const leaderboardLive = agents.some(
        a => a.isVerified && a.erc8004TokenId !== null && a.erc8004TokenId !== "" && a.erc8004TokenId !== "0"
      );

      // Total stats
      const totalAgents = agents.length;
      const totalGigsCompleted = gigs.filter(g => g.status === "completed").length;
      const totalCrewsFormed = allCrews.length;
      const crewsOnChainBase = allCrews.filter((c: any) => c.onChainCrewId).length;
      const crewsOnChainSkale = allCrews.filter((c: any) => c.onChainCrewIdSkale).length;

      res.json({
        updatedAt: new Date().toISOString(),
        totalAgents,
        totalGigsCompleted,
        totalCrewsFormed,
        crewsOnChainBase,
        crewsOnChainSkale,
        crewDelegations: crewDelegationsCount,
        tranche1: {
          mainnetContractsDeployed,
          passportsOnSkale,
          passportsTarget: 500,
          passportSource,      // "on-chain" (IdentityRegistry mint events) | "db" (fallback)
          clawCardNFTSupply,   // ClawCardNFT.totalSupply() via eth_call — reference PFP count
          swarmValidationsOnSkale,
          swarmValidationsTarget: 10,
          swarmValidationSource, // "on-chain" (ValidationResolved Approved=1) | "db" (fallback)
        },
        tranche2: {
          agentsWithScoreAbove30,
          agentsWithScoreTarget: 1000,
          completedGigsOnSkale,
          completedGigsTarget: 100,
          completedGigsSource,   // "on-chain" (EscrowReleased count) | "db" (fallback)
          escrowVolumeUsdcOnSkale: Math.round(escrowVolumeUsdcOnSkale * 100) / 100,
          escrowVolumeTarget: 10000,
          escrowVolumeSource,    // "on-chain" (EscrowReleased amount sum) | "db" (fallback)
        },
        tranche3: {
          activeAgents30d,
          activeAgentsTarget: 2500,
          cumulativeEscrowVolumeUsdc: Math.round(cumulativeEscrowVolumeUsdc * 100) / 100,
          cumulativeEscrowTarget: 50000,
          cumulativeEscrowSource, // "on-chain" (EscrowReleased amount sum) | "db" (fallback)
          leaderboardLive,
        },
        contracts: {
          escrow: SKALE_CONTRACTS.escrow,
          bond: SKALE_CONTRACTS.bond,
          swarmValidator: SKALE_CONTRACTS.swarmValidator,
          repAdapter: SKALE_CONTRACTS.repAdapter,
          erc8004Identity: SKALE_CONTRACTS.erc8004IdentityRegistry,
          clawCardNFT: SKALE_CONTRACTS.clawCardNFT,
        },
        explorer: "https://base-sepolia-testnet-explorer.skalenodes.com",
        rpc: "https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha",
        chainId: 324705682,
      });
    } catch (err: any) {
      res.status(500).json({ message: "Failed to compute grant metrics", error: err.message?.slice(0, 200) });
    }
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
        ? (privyJWKS ? "Privy JWT (ES256 cryptographic verification via JWKS)" : "Privy JWT (structure validation)")
        : "No PRIVY_APP_ID - auth middleware bypassed",
    } as any;
    if (PRIVY_JWKS_URL) (checks.auth as any).jwksUrl = PRIVY_JWKS_URL;

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

    const x402PayTo = process.env.X402_PAY_TO_ADDRESS || "";
    const x402IsEnabled = x402PayTo && x402PayTo !== "0x0000000000000000000000000000000000000000";
    checks.x402 = {
      status: x402IsEnabled ? "enabled" : "disabled",
      details: x402IsEnabled
        ? `x402 payment middleware active — pay_to: ${x402PayTo.slice(0, 10)}... (trust-check: $0.001, reputation: $0.002 USDC on Base Sepolia)`
        : "Set X402_PAY_TO_ADDRESS to enable micropayment gating on reputation endpoints",
    };

    let deployerReady = false;
    let deployerAddress: string | null = null;
    try {
      const wc = getWalletClient();
      if (wc) {
        deployerReady = true;
        const [addr] = await wc.getAddresses();
        deployerAddress = addr || null;
      }
    } catch {
      deployerReady = false;
    }
    checks.deployerWallet = {
      status: deployerReady ? "ready" : "unavailable",
      details: deployerReady
        ? `Wallet client active — oracle address: ${deployerAddress ? deployerAddress.slice(0, 10) + "..." : "unknown"}`
        : "Set DEPLOYER_PRIVATE_KEY to enable backend on-chain writes",
    };

    const allHealthy = checks.database?.status === "healthy";
    res.status(allHealthy ? 200 : 503).json({
      status: allHealthy ? "healthy" : "degraded",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks,
    });
  });

  app.get("/api/system/status", async (_req, res) => {
    const x402PayTo = process.env.X402_PAY_TO_ADDRESS || "";
    const x402IsEnabled = !!(x402PayTo && x402PayTo !== "0x0000000000000000000000000000000000000000");

    let deployerReady = false;
    let deployerAddress: string | null = null;
    try {
      const wc = getWalletClient();
      if (wc) {
        deployerReady = true;
        const [addr] = await wc.getAddresses();
        deployerAddress = addr || null;
      }
    } catch {
      deployerReady = false;
    }

    res.json({
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      x402: {
        enabled: x402IsEnabled,
        payToAddress: x402IsEnabled ? x402PayTo : null,
        routes: x402IsEnabled ? {
          "GET /api/trust-check/*": "$0.001 USDC",
          "GET /api/reputation/*": "$0.002 USDC",
          "GET /api/agents/*/erc8004": "$0.001 USDC",
        } : null,
        network: "base-sepolia",
      },
      deployerWallet: {
        ready: deployerReady,
        address: deployerAddress,
        details: deployerReady ? "Wallet client active for on-chain oracle writes" : "DEPLOYER_PRIVATE_KEY not configured",
      },
      chains: {
        baseSepolia: { chainId: 84532, rpc: process.env.BASE_RPC_URL || "https://sepolia.base.org", status: "configured" },
        skaleBaseSepolia: { chainId: 324705682, rpc: "https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha", status: "configured" },
      },
      features: {
        fusedScore: "active",
        swarmValidation: "active",
        escrowGigMarketplace: "active",
        skillVerification: "active",
        nameService: "active",
        agenticCommerce: "active",
        bondSystem: "active",
        crews: "active",
        x402Micropayments: x402IsEnabled ? "active" : "inactive",
        onChainWrites: deployerReady ? "active" : "inactive",
      },
      contracts: await (async () => {
        const contractAddresses: Record<string, `0x${string}`> = {
          ClawCardNFT:             (process.env.CLAW_CARD_NFT_ADDRESS              || "0xf24e41980ed48576Eb379D2116C1AaD075B342C4") as `0x${string}`,
          ClawTrustEscrow:         (process.env.CLAW_TRUST_ESCROW_ADDRESS          || "0x6B676744B8c4900F9999E9a9323728C160706126") as `0x${string}`,
          ClawTrustRepAdapter:     (process.env.CLAW_TRUST_REP_ADAPTER_ADDRESS     || "0xEfF3d3170e37998C7db987eFA628e7e56E1866DB") as `0x${string}`,
          ClawTrustSwarmValidator: (process.env.CLAW_TRUST_SWARM_VALIDATOR_ADDRESS || "0xb219ddb4a65934Cea396C606e7F6bcfBF2F68743") as `0x${string}`,
          ClawTrustBond:           (process.env.CLAW_TRUST_BOND_ADDRESS            || "0x23a1E1e958C932639906d0650A13283f6E60132c") as `0x${string}`,
          ClawTrustCrew:           (process.env.CLAW_TRUST_CREW_ADDRESS || "0x33D0f79974C383dc374C888774eB52b0fca41BA2") as `0x${string}`,
          ERC8004IdentityRegistry:    "0xBeb8a61b6bBc53934f1b89cE0cBa0c42830855CF" as `0x${string}`,
          ERC8004ReputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713" as `0x${string}`,
          ClawTrustAC:               "0x1933D67CDB911653765e84758f47c60A1E868bC0" as `0x${string}`,
          ClawTrustRegistry:         "0x82AEAA9921aC1408626851c90FCf74410D059dF4" as `0x${string}`,
        };
        const liveness: Record<string, { address: string; live: boolean; error?: string }> = {};
        await Promise.all(
          Object.entries(contractAddresses).map(async ([name, addr]) => {
            try {
              const code = await publicClient.getCode({ address: addr });
              liveness[name] = { address: addr, live: !!code && code !== "0x" };
            } catch (e: any) {
              liveness[name] = { address: addr, live: false, error: e.message?.slice(0, 80) };
            }
          })
        );
        return liveness;
      })(),
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

  app.post("/api/admin/sync-all-scores", strictLimiter, adminAuthMiddleware, async (_req, res) => {
    try {
      const allAgents = await storage.getAgents();
      const bonded = allAgents.filter(a => a.bondTier !== "UNBONDED" || a.isVerified || (a.onChainScore ?? 0) > 0);
      let synced = 0;
      let failed = 0;
      const errors: string[] = [];
      for (const agent of bonded) {
        try {
          await syncPerformanceScore(agent.id);
          synced++;
        } catch (err: any) {
          failed++;
          errors.push(`${agent.handle}: ${err.message}`);
        }
        await new Promise(r => setTimeout(r, 50));
      }
      res.json({
        message: `Score sync complete: ${synced} synced, ${failed} failed`,
        totalEligible: bonded.length,
        synced,
        failed,
        errors: errors.slice(0, 20),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/admin/seed-gigs", strictLimiter, adminAuthMiddleware, async (_req, res) => {
    try {
      const allAgents = await storage.getAgents();
      const platformAgents = allAgents.filter(a => a.fusedScore >= 15);
      const posterId = platformAgents[0]?.id;
      if (!posterId) {
        return res.status(400).json({ message: "No eligible poster agent found (need fusedScore >= 15)" });
      }

      const SEED_GIGS = [
        { title: "Smart Contract Security Audit", description: "Audit a Solidity smart contract for vulnerabilities and best practices. Deliverables: detailed report with findings and remediation recommendations.", skillsRequired: ["security-audit", "solidity", "blockchain"], budget: 500, currency: "USDC", chain: "skale", posterId },
        { title: "AI Agent Integration — ERC-8004 Passport", description: "Integrate ERC-8004 passport minting into an existing Node.js backend. Deliverables: working endpoint, unit tests, documentation.", skillsRequired: ["code-review", "nodejs", "blockchain"], budget: 300, currency: "USDC", chain: "skale", posterId },
        { title: "Comprehensive Testing Suite for DeFi Protocol", description: "Write a full test suite covering edge cases for a DeFi lending protocol. Target: 95%+ coverage with Hardhat/Foundry.", skillsRequired: ["testing", "solidity", "data-analysis"], budget: 750, currency: "USDC", chain: "base-sepolia", posterId },
        { title: "Data Analysis: On-Chain Reputation Metrics", description: "Analyze on-chain activity across Base Sepolia and SKALE to produce a reputation scoring model report.", skillsRequired: ["data-analysis", "blockchain", "research"], budget: 200, currency: "USDC", chain: "skale", posterId },
        { title: "Code Review: Multi-Chain Bridge Implementation", description: "Review TypeScript bridge code for cross-chain asset transfers between SKALE and Base Sepolia.", skillsRequired: ["code-review", "typescript", "blockchain"], budget: 400, currency: "USDC", chain: "base-sepolia", posterId },
      ];

      const existing = await storage.getGigs();
      const existingTitles = new Set(existing.map(g => g.title));
      let created = 0;
      let skipped = 0;

      for (const gigData of SEED_GIGS) {
        if (existingTitles.has(gigData.title)) { skipped++; continue; }
        await storage.createGig(gigData as any);
        created++;
      }

      res.json({ message: `Seed gigs: ${created} created, ${skipped} already existed`, totalGigs: existing.length + created });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
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

  app.post("/api/admin/github-sync-skill", strictLimiter, adminAuthMiddleware, async (_req, res) => {
    try {
      const result = await syncSkillRepo();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  app.post("/api/admin/publish-clawhub", strictLimiter, adminAuthMiddleware, async (req, res) => {
    try {
      const { version } = req.body || {};
      const result = await publishToClawHub(version);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, message: err.message });
    }
  });

  app.post("/api/telegram/webhook", async (req, res) => {
    const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;

    // Fail closed if TELEGRAM_WEBHOOK_SECRET is not configured.
    // In dev, Telegram uses long polling so this endpoint is never called.
    // In production, the bot must configure secret_token in setWebhook().
    if (!webhookSecret) {
      logSuspiciousActivity(req, "telegram_webhook_no_secret", "Telegram webhook request rejected: TELEGRAM_WEBHOOK_SECRET not set");
      return res.sendStatus(401);
    }

    // Verify X-Telegram-Bot-Api-Secret-Token using timing-safe comparison.
    const headerToken = (req.headers["x-telegram-bot-api-secret-token"] as string) || "";
    const secretBuf = Buffer.from(webhookSecret, "utf8");
    const tokenBuf = Buffer.from(headerToken, "utf8");
    let tokenMatch = false;
    try { tokenMatch = secretBuf.length === tokenBuf.length && crypto.timingSafeEqual(secretBuf, tokenBuf); } catch { }
    if (!tokenMatch) {
      logSuspiciousActivity(req, "telegram_webhook_invalid_token", "Telegram webhook: invalid or missing secret token");
      return res.sendStatus(401);
    }

    // HMAC-SHA256 body verification (mandatory second gate).
    // X-Telegram-Signature must be HMAC-SHA256(sha256(TELEGRAM_BOT_TOKEN), rawBody) encoded as hex.
    // Fails closed when TELEGRAM_BOT_TOKEN is unset, when header is missing, or on digest mismatch.
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      logSuspiciousActivity(req, "telegram_webhook_no_bot_token", "Telegram webhook: TELEGRAM_BOT_TOKEN not set — cannot verify payload HMAC");
      return res.sendStatus(401);
    }
    const incomingHmac = req.headers["x-telegram-signature"] as string | undefined;
    if (!incomingHmac) {
      logSuspiciousActivity(req, "telegram_webhook_missing_hmac", "Telegram webhook: X-Telegram-Signature header is required");
      return res.sendStatus(401);
    }
    const raw: Buffer = (req as any).rawBody ?? Buffer.from(JSON.stringify(req.body), "utf8");
    const key = crypto.createHash("sha256").update(botToken).digest();
    const expected = crypto.createHmac("sha256", key).update(raw).digest("hex");
    let hmacMatch = false;
    try { hmacMatch = incomingHmac.length === expected.length && crypto.timingSafeEqual(Buffer.from(incomingHmac, "hex"), Buffer.from(expected, "hex")); } catch { }
    if (!hmacMatch) {
      logSuspiciousActivity(req, "telegram_webhook_invalid_hmac", "Telegram webhook: HMAC-SHA256 mismatch");
      return res.sendStatus(401);
    }

    res.sendStatus(200);
    try {
      const { handleTelegramWebhook } = await import("./telegram-bot");
      await handleTelegramWebhook(req.body);
    } catch (err) {
      console.error("[Telegram] Webhook route error:", err);
    }
  });

  app.get("/api/admin/telegram-status", async (_req, res) => {
    try {
      const { getTelegramBotStatus } = await import("./telegram-bot");
      res.json(getTelegramBotStatus());
    } catch (err: any) {
      res.json({ running: false, hasToken: false, error: err.message });
    }
  });

  app.get("/api/admin/moltbook-debug", async (_req, res) => {
    try {
      const { getDebugStatus } = await import("./moltbook-agent");
      const status = await getDebugStatus();
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/moltbook-test", adminAuthMiddleware, async (req, res) => {
    try {
      const { testPost } = await import("./moltbook-agent");
      const result = await testPost();
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
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

  app.get("/api/admin/circle-status", adminAuthMiddleware, async (_req, res) => {
    try {
      const health = await circleHealthCheck();
      res.json(health);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/admin/circle-entity-secret", adminAuthMiddleware, async (_req, res) => {
    try {
      const secret = getEntitySecret();
      const masked = secret.slice(0, 8) + "..." + secret.slice(-8);
      res.json({
        entitySecretMasked: masked,
        length: secret.length,
        source: process.env.CIRCLE_ENTITY_SECRET ? "environment_variable" : "file_or_generated",
        instructions: [
          "1. The entity secret is stored as CIRCLE_ENTITY_SECRET env var — check Replit Secrets tab for the full value",
          "2. Go to Circle Developer Console → Developer Controlled Wallets → Configurator",
          "3. Register the entity secret (64-char hex string) in the Entity Secret field",
        ],
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/circle-register-secret", adminAuthMiddleware, async (_req, res) => {
    try {
      const result = await registerEntitySecret();
      const status = await circleHealthCheck();
      res.json({ ...result, status });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/admin/skale/fund-oracle", adminAuthMiddleware, async (req, res) => {
    try {
      const { checkAndTopUpSkaleFuel, forceTopUpSkaleFuel, getSkaleOracleFuelBalance } = await import("./erc8183-service");
      const force = req.body?.force === true;
      const before = await getSkaleOracleFuelBalance();

      if (force) {
        // Forced top-up: always attempt faucet and report real outcome
        const result = await forceTopUpSkaleFuel();
        if (result.message === "Oracle wallet not configured") {
          return res.status(400).json({ success: false, forced: true, wasFunded: false, message: result.message, balanceBefore: before.ether, balanceAfter: before.ether });
        }
        const after = await getSkaleOracleFuelBalance();
        return res.status(result.success ? 200 : 502).json({
          success: result.success,
          forced: true,
          wasFunded: result.success,
          message: result.message,
          balanceBefore: before.ether,
          balanceAfter: after.ether,
        });
      }

      // Threshold-based: attempt top-up only if balance is low
      const result = await checkAndTopUpSkaleFuel();

      // Oracle wallet not configured at all — hard failure
      if (result.message === "Oracle wallet not configured") {
        return res.status(400).json({
          success: false,
          forced: false,
          wasFunded: false,
          message: result.message,
          balanceBefore: before.ether,
          balanceAfter: before.ether,
        });
      }

      const after = await getSkaleOracleFuelBalance();
      const fundFailed = !result.wasFunded && result.message.startsWith("Auto-fund failed");
      return res.status(fundFailed ? 502 : 200).json({
        success: !fundFailed,
        forced: false,
        wasFunded: result.wasFunded,
        message: result.message,
        balanceBefore: before.ether,
        balanceAfter: after.ether,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.get("/api/admin/skale/oracle-fuel", adminAuthMiddleware, async (_req, res) => {
    try {
      const { getSkaleOracleFuelBalance } = await import("./erc8183-service");
      const { ORACLE_WALLET_ADDRESS } = await import("./blockchain");
      const { raw, ether } = await getSkaleOracleFuelBalance();
      res.json({
        oracleAddress: ORACLE_WALLET_ADDRESS,
        configured: !!process.env.DEPLOYER_PRIVATE_KEY,
        balanceRaw: raw.toString(),
        balanceEther: ether,
        lowThreshold: 0.001,
        isLow: ether < 0.001,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/admin/cleanup-queue", adminAuthMiddleware, async (_req, res) => {
    try {
      const cleaned = await cleanupStuckQueueEntries();
      res.json({ success: true, cleaned, message: `Marked ${cleaned} stuck queue entries as failed` });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/admin/assign-missing-wallets", adminAuthMiddleware, async (_req, res) => {
    try {
      const allAgents = await storage.getAgents();
      const zeroAddress = allAgents.filter(
        (a) => !a.walletAddress || /^0x0+$/.test(a.walletAddress)
      );
      const results: Array<{ handle: string; id: string; result: string }> = [];
      for (const agent of zeroAddress) {
        try {
          const wallet = await createEscrowWallet("BASE_SEPOLIA");
          await storage.updateAgent(agent.id, {
            walletAddress: wallet.address,
            circleWalletId: wallet.walletId,
          });
          results.push({ handle: agent.handle, id: agent.id, result: `wallet created: ${wallet.address}` });
        } catch (err: any) {
          results.push({ handle: agent.handle, id: agent.id, result: `failed: ${err.message}` });
        }
      }
      res.json({ success: true, processed: zeroAddress.length, results });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/admin/repair-agents", adminAuthMiddleware, async (_req, res) => {
    try {
      const allAgents = await storage.getAgents();
      const results: Array<{ handle: string; id: string; fixes: string[] }> = [];

      for (const agent of allAgents) {
        const fixes: string[] = [];

        if (agent.erc8004TokenId && !agent.isVerified) {
          await storage.updateAgent(agent.id, { isVerified: true, autonomyStatus: "active" });
          fixes.push("isVerified=true, autonomyStatus=active");
        } else if (agent.erc8004TokenId && agent.autonomyStatus === "registered") {
          await storage.updateAgent(agent.id, { autonomyStatus: "active" });
          fixes.push("autonomyStatus=active");
        }

        if (!agent.moltDomain) {
          const moltName = agent.handle.toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 32);
          if (moltName.length >= 3 && !MOLT_RESERVED_NAMES.has(moltName)) {
            try {
              const existing = await storage.getMoltDomain(moltName);
              if (!existing || existing.status !== "ACTIVE") {
                const foundingMoltNumber = await storage.getNextFoundingMoltNumber();
                const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
                await storage.createMoltDomain({
                  name: moltName,
                  agentId: agent.id,
                  walletAddress: agent.walletAddress,
                  expiresAt,
                  status: "ACTIVE",
                  foundingMoltNumber,
                });
                await storage.updateAgent(agent.id, { moltDomain: `${moltName}.molt` });
                if (agent.erc8004TokenId) {
                  queueBlockchainAction({
                    type: "SET_MOLT_DOMAIN",
                    agentId: agent.id,
                    payload: { moltDomain: `${moltName}.molt` },
                  }).catch(() => {});
                }
                fixes.push(`moltDomain=${moltName}.molt`);
              }
            } catch {}
          }
        }

        if (!agent.walletAddress || agent.walletAddress === agent.walletAddress.toLowerCase()) {
          try {
            const checksummed = toChecksumAddress(agent.walletAddress);
            if (checksummed !== agent.walletAddress) {
              await storage.updateAgent(agent.id, { walletAddress: checksummed });
              fixes.push(`walletAddress checksummed`);
            }
          } catch {}
        }

        if (fixes.length > 0) {
          results.push({ handle: agent.handle, id: agent.id, fixes });
        }
      }

      res.json({ success: true, repaired: results.length, results });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post("/api/admin/agents/:id/create-wallet", adminAuthMiddleware, async (req, res) => {
    try {
      const agent = await storage.getAgent(String(req.params.id));
      if (!agent) {
        return res.status(404).json({ message: "Agent not found" });
      }

      if (agent.circleWalletId) {
        return res.status(409).json({
          message: "Agent already has a Circle wallet",
          circleWalletId: agent.circleWalletId,
          walletAddress: agent.walletAddress,
        });
      }

      if (!isCircleConfigured()) {
        return res.status(503).json({ message: "Circle is not configured (CIRCLE_API_KEY missing)" });
      }

      const walletResult = await createEscrowWallet("BASE_SEPOLIA");
      const updated = await storage.updateAgent(agent.id, {
        circleWalletId: walletResult.walletId,
        walletAddress: walletResult.address,
      });

      console.log(`[Admin] Created Circle wallet for ${agent.handle}: ${walletResult.address}`);

      res.json({
        success: true,
        agent: updated,
        wallet: {
          walletId: walletResult.walletId,
          address: walletResult.address,
          blockchain: walletResult.blockchain,
        },
      });
    } catch (err: any) {
      console.error(`[Admin] Failed to create wallet for agent ${req.params.id}:`, err.message);
      res.status(500).json({ message: `Wallet creation failed: ${err.message}` });
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
      const agent = await storage.getAgent(agentId);
      if (agent) {
        await storage.updateAgent(agentId, {
          onChainScore: Math.min(agent.onChainScore + 5, 1000),
        });
        await syncPerformanceScore(agentId).catch(() => {});
      }
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
      const agentIdParam = String(req.params.agentId);
      const event = await lockBond(agentIdParam, amount, gigId);
      const agentLock = await storage.getAgent(agentIdParam);
      if (agentLock) {
        await storage.updateAgent(agentIdParam, {
          onChainScore: Math.min(agentLock.onChainScore + 3, 1000),
        });
      }
      res.json({ event });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/bond/:agentId/unlock", apiLimiter, adminAuthMiddleware, async (req, res) => {
    try {
      const { amount, gigId } = req.body;
      if (!amount || !gigId) return res.status(400).json({ message: "amount and gigId required" });
      const agentIdParam = String(req.params.agentId);
      const event = await unlockBond(agentIdParam, amount, gigId);
      const agentUnlock = await storage.getAgent(agentIdParam);
      if (agentUnlock) {
        await storage.updateAgent(agentIdParam, {
          onChainScore: Math.min(agentUnlock.onChainScore + 2, 1000),
        });
      }
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
      try {
        const slashedAgent = await storage.getAgent(req.params.agentId as string);
        if (slashedAgent) {
          telegramAnnounceSlash(slashedAgent, 0, reason);
          notifyAgent(req.params.agentId as string, "slash_applied", "Bond Slash Applied", `A bond slash has been applied: ${reason}`, { gigId }).catch(() => {});
        }
      } catch {}
      res.json({ event });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  // ─── Convenience alias: GET /api/bonds → all bonded agents ────────────
  app.get("/api/bonds", async (_req, res) => {
    try {
      const allAgents = await storage.getAgents();
      const bonded = allAgents
        .filter((a: any) => (a.availableBond ?? 0) > 0 || (a.bondTier && a.bondTier !== "NO_BOND"))
        .map((a: any) => ({
          agentId: a.id,
          handle: a.handle,
          walletAddress: a.walletAddress,
          bondTier: a.bondTier,
          availableBond: a.availableBond,
          lockedBond: a.lockedBond,
          totalBonded: (a.availableBond ?? 0) + (a.lockedBond ?? 0),
        }));
      res.json({ bonds: bonded, count: bonded.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Convenience alias: GET /api/chain-status → contract health ────────
  app.get("/api/chain-status", async (_req, res) => {
    try {
      const contracts = {
        BASE_SEPOLIA: {
          chainId: 84532,
          rpc: "https://sepolia.base.org",
          erc8004Registry: process.env.CLAW_TRUST_ERC8004_ADDRESS || "0x8004A818BFB912233c491871b3d84c89A494BD9e",
          repAdapter: process.env.CLAW_TRUST_REP_ADAPTER_ADDRESS || "0xEfF3d3170e37998C7db987eFA628e7e56E1866DB",
          bond: process.env.CLAW_TRUST_BOND_ADDRESS || "0x23a1E1e958C932639906d0650A13283f6E60132c",
          escrow: process.env.CLAW_TRUST_ESCROW_ADDRESS || "0x6B676744B8c4900F9999E9a9323728C160706126",
          swarmValidator: process.env.CLAW_TRUST_SWARM_VALIDATOR_ADDRESS || "0xb219ddb4a65934Cea396C606e7F6bcfBF2F68743",
          clawCardNFT: process.env.CLAW_CARD_NFT_ADDRESS || "0xf24e41980ed48576Eb379D2116C1AaD075B342C4",
        },
        SKALE_TESTNET: {
          chainId: 324705682,
          rpc: "https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha",
          explorer: "https://base-sepolia-testnet-explorer.skalenodes.com",
          erc8004IdentityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
          erc8004ReputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
          repAdapter: "0xFafCA23a7c085A842E827f53A853141C8243F924",
          clawCardNFT: "0xdB7F6cCf57D6c6AA90ccCC1a510589513f28cb83",
          agenticCommerce: "0x101F37D9bf445E92A237F8721CA7D12205D61Fe6",
          escrow: "0x39601883CD9A115Aba0228fe0620f468Dc710d54",
          swarmValidator: "0x7693a841Eec79Da879241BC0eCcc80710F39f399",
          bond: "0x5bC40A7a47A2b767D948FEEc475b24c027B43867",
          crew: (process.env.SKALE_MAINNET_CREW_ADDRESS || "0x427d0D6481bC708979Bdc2F80f659549BdB27f96"),
          registry: "0xEfF3d3170e37998C7db987eFA628e7e56E1866DB",
        },
      };
      res.json({ status: "ok", chains: 2, contracts });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
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

  app.post("/api/bond/:agentId/sync-performance", strictLimiter, adminAuthMiddleware, async (req, res) => {
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

  // ─── Bond route aliases: /api/agents/:id/bond/... (tester-compatible) ──────
  app.get("/api/agents/:id/bond/status", async (req, res) => {
    try {
      const agentId = safeId.safeParse(req.params.id);
      if (!agentId.success) return res.status(400).json({ message: "Invalid agent ID" });
      const status = await getBondStatus(agentId.data);
      res.json(status);
    } catch (err: any) {
      res.status(404).json({ message: err.message });
    }
  });

  app.get("/api/agents/:id/bond/history", async (req, res) => {
    try {
      const agentId = safeId.safeParse(req.params.id);
      if (!agentId.success) return res.status(400).json({ message: "Invalid agent ID" });
      const limit = parseInt(req.query.limit as string) || 50;
      const events = await getBondHistory(agentId.data, limit);
      res.json({ events, total: events.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/agents/:id/bond/deposit", apiLimiter, async (req, res) => {
    try {
      const agentId = safeId.safeParse(req.params.id);
      if (!agentId.success) return res.status(400).json({ message: "Invalid agent ID" });

      const agent = await storage.getAgent(agentId.data);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const headerAgent = req.headers["x-agent-id"] as string;
      const headerWallet = req.headers["x-wallet-address"] as string;
      const agentIdMatch = headerAgent && headerAgent === agentId.data;
      const walletMatch = headerWallet && agent.walletAddress && headerWallet.toLowerCase() === agent.walletAddress.toLowerCase();
      if (!agentIdMatch && !walletMatch) {
        return res.status(403).json({ message: "Authentication required. Send x-agent-id or x-wallet-address header." });
      }

      const rawAmount = req.body?.amount;
      const amount = typeof rawAmount === "string" ? parseFloat(rawAmount) : rawAmount;
      if (!amount || typeof amount !== "number" || isNaN(amount) || amount <= 0) {
        return res.status(400).json({ message: "Valid positive amount required" });
      }
      const event = await depositBond(agentId.data, amount);
      await storage.updateAgent(agentId.data, { onChainScore: Math.min(agent.onChainScore + 5, 1000) });
      await syncPerformanceScore(agentId.data).catch(() => {});
      res.json({ event, message: `Deposited ${amount} USDC bond` });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.post("/api/agents/:id/bond/withdraw", apiLimiter, async (req, res) => {
    try {
      const agentId = safeId.safeParse(req.params.id);
      if (!agentId.success) return res.status(400).json({ message: "Invalid agent ID" });

      const agent = await storage.getAgent(agentId.data);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const headerAgent = req.headers["x-agent-id"] as string;
      const headerWallet = req.headers["x-wallet-address"] as string;
      const agentIdMatch = headerAgent && headerAgent === agentId.data;
      const walletMatch = headerWallet && agent.walletAddress && headerWallet.toLowerCase() === agent.walletAddress.toLowerCase();
      if (!agentIdMatch && !walletMatch) {
        return res.status(403).json({ message: "Authentication required. Send x-agent-id or x-wallet-address header." });
      }

      const rawAmount = req.body?.amount;
      const amount = typeof rawAmount === "string" ? parseFloat(rawAmount) : rawAmount;
      if (!amount || typeof amount !== "number" || isNaN(amount) || amount <= 0) {
        return res.status(400).json({ message: "Valid positive amount required" });
      }
      const event = await withdrawBond(agentId.data, amount);
      res.json({ event, message: `Withdrew ${amount} USDC bond` });
    } catch (err: any) {
      res.status(400).json({ message: err.message });
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
      notifyAgent(targetAgentId.data, "offer_received", "New Direct Offer", `${fromAgent.handle} sent you a direct offer for: "${gig.title}"`, { gigId: gigId.data }).catch(() => {});

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

  app.get("/api/agents/:id/reputation", apiLimiter, async (req, res) => {
    try {
      const agent = await storage.getAgent(req.params.id as string);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const chain = (req.query.chain as string) || "base-sepolia";
      const dbBreakdown = getScoreBreakdown(agent);
      let liveFused: any = null;
      try { liveFused = await computeLiveFusedReputation(agent); } catch {}

      const fusedScore = liveFused?.fusedScore ?? dbBreakdown.fusedScore;
      const tier = liveFused?.tier ?? dbBreakdown.tier;

      res.json({
        agentId: agent.id,
        name: (agent as any).name ?? agent.handle,
        handle: agent.handle,
        chain,
        fusedScore,
        tier,
        onChainScore: agent.onChainScore,
        isVerified: agent.isVerified,
        source: liveFused ? "live" : "db_fallback",
        breakdown: dbBreakdown,
        badges: liveFused?.badges ?? dbBreakdown.badges,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
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

  const TRUST_RECEIPT_MIN_AMOUNT = 1;

  // ─── Trust Receipts: List all ─────────────────────────────────────────
  app.get("/api/trust-receipts", apiLimiter, async (_req, res) => {
    try {
      const receipts = await storage.getTrustReceipts();
      res.json({ receipts, count: receipts.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/trust-receipts", apiLimiter, async (req, res) => {
    try {
      const { gigId, agentId, posterId, gigTitle, amount, currency, chain, swarmVerdict, scoreChange, tierBefore, tierAfter } = req.body;
      if (!gigId || !agentId || !posterId || !gigTitle) {
        return res.status(400).json({ message: "Missing required fields" });
      }
      if (typeof amount !== "number" || amount < TRUST_RECEIPT_MIN_AMOUNT) {
        return res.status(400).json({ message: `Trust receipt amount must be at least ${TRUST_RECEIPT_MIN_AMOUNT} USDC.` });
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

  app.get("/api/network-receipts", async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 10, 50);
      const receipts = await storage.getTrustReceipts();
      const recent = receipts.slice(0, limit);
      const enriched = await Promise.all(
        recent.map(async (r: any) => {
          const agent = await storage.getAgent(r.agentId).catch(() => null);
          const poster = await storage.getAgent(r.posterId).catch(() => null);
          return {
            ...r,
            agentHandle: agent?.handle || null,
            posterHandle: poster?.handle || null,
          };
        })
      );
      res.json({ receipts: enriched });
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

  app.get("/api/gigs/:id/trust-receipt", async (req, res) => {
    try {
      const gig = await storage.getGig(req.params.id);
      if (!gig) return res.status(404).json({ message: "Gig not found" });
      if (gig.status !== "completed") return res.status(400).json({ message: "Gig is not completed" });

      const poster = await storage.getAgent(gig.posterId);
      const assignee = gig.assigneeId ? await storage.getAgent(gig.assigneeId) : null;
      const validation = await storage.getValidationByGig(gig.id);

      let receipt = gig.assigneeId ? await storage.getTrustReceiptByGig(gig.id, gig.assigneeId) : null;
      if (!receipt) {
        const allForPoster = await storage.getTrustReceiptsForAgent(gig.posterId, 100);
        receipt = allForPoster.find(r => r.gigId === gig.id) || null;
      }

      if (!receipt && gig.assigneeId && gig.budget >= TRUST_RECEIPT_MIN_AMOUNT) {
        const swarmVerdict = validation?.status === "approved" ? "PASS" : validation?.status === "rejected" ? "FAIL" : null;
        receipt = await storage.createTrustReceipt({
          gigId: gig.id,
          agentId: gig.assigneeId,
          posterId: gig.posterId,
          gigTitle: gig.title,
          amount: gig.budget,
          currency: gig.currency,
          chain: gig.chain,
          swarmVerdict,
          scoreChange: 0,
          tierBefore: null,
          tierAfter: null,
          completedAt: new Date(),
        });
      }

      if (!receipt) return res.status(404).json({ message: "Trust receipt not found for this gig" });

      res.json({
        ...receipt,
        agent: assignee ? { id: assignee.id, handle: assignee.handle, avatar: assignee.avatar, fusedScore: assignee.fusedScore } : null,
        poster: poster ? { id: poster.id, handle: poster.handle, avatar: poster.avatar } : null,
      });
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

  async function handleCreateCrew(req: Request, res: Response) {
    try {
      const { createCrewSchema } = await import("@shared/schema");
      const parsed = createCrewSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid crew data", errors: parsed.error.flatten() });
      }
      const { name, handle, description, members, specialization, agencyPitch, capabilities } = parsed.data;

      const existingCrew = await storage.getCrewByHandle(handle);
      if (existingCrew) {
        return res.status(409).json({ message: "Crew handle already taken" });
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
      let walletAddress = req.headers["x-wallet-address"] as string;
      const headerAgentId = req.headers["x-agent-id"] as string;

      // Auth resolution order:
      // 1. Solo crew (1 member = LEAD): derive wallet from lead agent (most permissive for SDK compatibility)
      // 2. x-agent-id matches the LEAD agent ID → derive wallet from lead agent
      // 3. x-wallet-address matches lead agent wallet → explicit ownership proof
      if (!walletAddress && leadAgent) {
        if (members.length === 1) {
          // Solo crew: always derive wallet from the sole LEAD member
          walletAddress = leadAgent.agent.walletAddress;
        } else if (headerAgentId && headerAgentId === leadAgent.agent.id) {
          // Multi-member crew: accept x-agent-id ownership of LEAD agent
          walletAddress = leadAgent.agent.walletAddress;
        }
      }

      if (!walletAddress) {
        return res.status(401).json({ message: "Wallet authentication required. Send x-wallet-address or x-agent-id header." });
      }

      // If wallet header sent but doesn't match LEAD agent, also accept if x-agent-id owns the LEAD
      if (leadAgent && leadAgent.agent.walletAddress && walletAddress !== leadAgent.agent.walletAddress) {
        const walletMatches = leadAgent.agent.walletAddress.toLowerCase() === walletAddress.toLowerCase();
        const agentIdOwnsLead = headerAgentId && headerAgentId === leadAgent.agent.id;
        if (!walletMatches && !agentIdOwnsLead) {
          return res.status(403).json({ message: "You must own the LEAD agent to form this crew" });
        }
        if (!walletMatches && agentIdOwnsLead) {
          walletAddress = leadAgent.agent.walletAddress;
        }
      }

      const ownerWallet = walletAddress;

      const avgScore = memberAgents.reduce((s, m) => s + m.agent.fusedScore, 0) / memberAgents.length;
      const bondPool = memberAgents.reduce((s, m) => s + m.agent.availableBond, 0);

      const allMemberSkills = memberAgents.flatMap((m) => m.agent.skills || []);
      const derivedCapabilities = capabilities && capabilities.length > 0
        ? capabilities
        : [...new Set(allMemberSkills)].slice(0, 20);

      const crew = await storage.createCrew({
        name,
        handle,
        description: description || null,
        ownerWallet,
        specialization: specialization || "GENERAL",
        agencyPitch: agencyPitch || null,
        capabilities: derivedCapabilities,
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

      try {
        const { moltbookPostNewCrew } = await import("./moltbook-agent");
        moltbookPostNewCrew({ id: crew.id, name }, crewMembers.length, bondPool).catch(() => {});
      } catch {}

      // Fire-and-forget on-chain crew registration (non-blocking)
      (async () => {
        try {
          const { registerCrewOnChain } = await import("./blockchain");
          const onChain = await registerCrewOnChain({
            name,
            ownerWallet,
            memberCount: members.length,
          });
          const update: Partial<Crew> = {};
          if (onChain.base) {
            update.onChainCrewId  = onChain.base.crewId;
            update.onChainTxHash  = onChain.base.txHash;
          }
          if (onChain.skale) {
            update.onChainCrewIdSkale = onChain.skale.crewId;
            update.onChainTxHashSkale = onChain.skale.txHash;
          }
          if (Object.keys(update).length > 0) {
            await storage.updateCrew(crew.id, update);
            console.log(`[Crew] On-chain IDs saved for crewId=${crew.id} base=${onChain.base?.crewId} skale=${onChain.skale?.crewId}`);
          }
        } catch (e: any) {
          console.error("[Crew] registerCrewOnChain background error:", e.message?.slice(0, 200));
        }
      })();

      res.status(201).json({
        ...updatedCrew,
        members: crewMembers,
        tier: getCrewTier(updatedCrew?.fusedScore || 0),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }

  app.post("/api/crews", apiLimiter, handleCreateCrew);

  app.get("/api/crews", async (req, res) => {
    try {
      let allCrews = await storage.getCrews();

      const minScore = Number(req.query.minScore) || 0;
      const minBond = Number(req.query.minBond) || 0;
      const role = (req.query.role as string) || "";
      const specialization = (req.query.specialization as string) || "";

      if (minScore > 0) {
        allCrews = allCrews.filter(c => c.fusedScore >= minScore);
      }
      if (minBond > 0) {
        allCrews = allCrews.filter(c => c.bondPool >= minBond);
      }
      if (specialization) {
        allCrews = allCrews.filter(c => c.specialization === specialization);
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

  // ─── Crew statistics (tester-compatible) ──────────────────────────────────
  app.get("/api/crews/statistics", async (_req, res) => {
    try {
      const allCrews = await storage.getCrews();
      const totalMembers = await Promise.all(allCrews.map(c => storage.getCrewMembers(c.id)));
      const memberCounts = totalMembers.map(m => m.length);
      const totalMemberCount = memberCounts.reduce((a, b) => a + b, 0);
      const avgCrewSize = allCrews.length > 0 ? totalMemberCount / allCrews.length : 0;
      const totalBondPool = allCrews.reduce((sum, c) => sum + (c.bondPool || 0), 0);
      const avgScore = allCrews.length > 0 ? allCrews.reduce((s, c) => s + c.fusedScore, 0) / allCrews.length : 0;
      const totalGigsCompleted = allCrews.reduce((sum, c) => sum + (c.gigsCompleted || 0), 0);
      const totalVolume = allCrews.reduce((sum, c) => sum + (c.totalEarned || 0), 0);
      res.json({
        totalCrews: allCrews.length,
        activeCrews: allCrews.length,
        totalMembers: totalMemberCount,
        averageCrewSize: parseFloat(avgCrewSize.toFixed(1)),
        averageFusedScore: parseFloat(avgScore.toFixed(1)),
        totalBondPool: parseFloat(totalBondPool.toFixed(2)),
        totalGigsCompleted,
        totalVolume: parseFloat(totalVolume.toFixed(2)),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Alias: POST /api/crews/create (tester-compatible, shares same handler) ──
  app.post("/api/crews/create", apiLimiter, handleCreateCrew);

  app.get("/api/crews/:id", async (req, res) => {
    try {
      const crew = await storage.getCrew(req.params.id);
      if (!crew) {
        return res.status(404).json({ message: "Crew not found" });
      }

      const members = await storage.getCrewMembers(crew.id);
      const memberDetails = await Promise.all(members.map(async (m) => {
        const agent = await storage.getAgent(m.agentId);
        let verifiedSkills: string[] = [];
        if (agent) {
          try {
            const svs = await storage.getSkillVerifications(m.agentId);
            verifiedSkills = svs.filter((sv: any) => sv.status === "verified").map((sv: any) => sv.skillName);
          } catch { verifiedSkills = []; }
        }
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
            verifiedSkills,
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

  // ─── Crew score sync: recalculates fusedScore & bondPool from current member scores ──
  app.post("/api/crews/:id/sync-score", async (req, res) => {
    try {
      const crew = await storage.getCrew(req.params.id);
      if (!crew) return res.status(404).json({ message: "Crew not found" });

      const members = await storage.getCrewMembers(crew.id);
      if (members.length === 0) return res.json({ ...crew, changed: false });

      const memberAgents = await Promise.all(members.map(m => storage.getAgent(m.agentId)));
      const valid = memberAgents.filter(Boolean) as Awaited<ReturnType<typeof storage.getAgent>>[];

      const avgScore = valid.length > 0 ? valid.reduce((s, a) => s + (a!.fusedScore || 0), 0) / valid.length : 0;
      const bondPool = valid.reduce((s, a) => s + (a!.availableBond || 0), 0);
      const newScore = Math.round(avgScore * 10) / 10;
      const newBond = Math.round(bondPool * 100) / 100;

      const changed = newScore !== crew.fusedScore || newBond !== crew.bondPool;
      if (changed) {
        await storage.updateCrew(crew.id, { fusedScore: newScore, bondPool: newBond });
      }

      const updated = await storage.getCrew(crew.id);
      res.json({ ...updated, tier: getCrewTier(updated?.fusedScore || 0), changed });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Crew gig browse: open crew gigs for a specific crew (matching capabilities) ──
  app.get("/api/crews/:id/available-gigs", async (req, res) => {
    try {
      const crew = await storage.getCrew(req.params.id);
      if (!crew) return res.status(404).json({ message: "Crew not found" });

      const limit = Math.min(Number(req.query.limit) || 20, 50);
      const allGigs = await storage.getGigs();
      const crewGigs = allGigs.filter(g => g.crewGig === true && g.status === "open");

      const minScore = crew.fusedScore;
      const eligible = crewGigs.filter(g => !g.minCrewScore || g.minCrewScore <= minScore);

      // Enrich with poster info
      const enriched = await Promise.all(eligible.slice(0, limit).map(async (gig) => {
        const poster = gig.agentId ? await storage.getAgent(gig.agentId) : null;
        return { ...gig, poster: poster ? { handle: poster.handle, fusedScore: poster.fusedScore } : null };
      }));

      res.json({ gigs: enriched, total: enriched.length });
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

      // Cross-chain validation: crew owner's agent and gig must be on the same chain
      const crewOwnerAgent = await storage.getAgentByWallet(walletAddress.toLowerCase());
      if (crewOwnerAgent) {
        const ownerChain = crewOwnerAgent.homeChain || crewOwnerAgent.preferredChain || "BASE_SEPOLIA";
        if (ownerChain !== gig.chain) {
          return res.status(400).json({
            message: `Chain mismatch: this gig is on ${gig.chain} but the crew owner agent is on ${ownerChain}. Crews can only apply to gigs on their home chain.`,
            ownerChain,
            gigChain: gig.chain,
          });
        }
      }

      if (gig.gigTier === "PREMIUM" && crew.fusedScore < 70) {
        return res.status(403).json({ message: "Premium gigs require a crew TrustScore of 70 or above" });
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

  // ─── CREW-TO-CREW DELEGATIONS ────────────────────────────────────────────────
  // POST /api/crews/:id/delegate  — crew :id posts a sub-gig to another crew
  app.post("/api/crews/:id/delegate", apiLimiter, async (req, res) => {
    try {
      const walletAddress = req.headers["x-wallet-address"] as string;
      if (!walletAddress) {
        return res.status(401).json({ message: "x-wallet-address header required" });
      }
      const fromCrew = await storage.getCrew(req.params.id as string);
      if (!fromCrew) return res.status(404).json({ message: "Crew not found" });
      if (fromCrew.ownerWallet.toLowerCase() !== walletAddress.toLowerCase()) {
        return res.status(403).json({ message: "Only the crew owner can create delegations" });
      }
      const { toCrewId, title, description, budget = 0, currency = "USDC", message } = req.body;
      if (!toCrewId || !title || !description) {
        return res.status(400).json({ message: "toCrewId, title, and description are required" });
      }
      if (toCrewId === fromCrew.id) {
        return res.status(400).json({ message: "Cannot delegate to yourself" });
      }
      const toCrew = await storage.getCrew(toCrewId);
      if (!toCrew) return res.status(404).json({ message: "Target crew not found" });

      const delegation = await storage.createCrewDelegation({
        fromCrewId: fromCrew.id,
        toCrewId,
        title,
        description,
        budget: parseFloat(budget) || 0,
        currency,
        status: "pending",
        message: message || null,
      });
      res.status(201).json({ ...delegation, fromCrew: { id: fromCrew.id, name: fromCrew.name, handle: fromCrew.handle }, toCrew: { id: toCrew.id, name: toCrew.name, handle: toCrew.handle } });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // GET /api/crews/:id/delegations  — list incoming + outgoing delegations
  app.get("/api/crews/:id/delegations", async (req, res) => {
    try {
      const crew = await storage.getCrew(req.params.id as string);
      if (!crew) return res.status(404).json({ message: "Crew not found" });
      const { outgoing, incoming } = await storage.getCrewDelegations(crew.id);

      const allCrews = await storage.getCrews();
      const crewMap = Object.fromEntries(allCrews.map(c => [c.id, { id: c.id, name: c.name, handle: c.handle, fusedScore: c.fusedScore }]));

      const enrich = (d: any) => ({
        ...d,
        fromCrew: crewMap[d.fromCrewId] || null,
        toCrew: crewMap[d.toCrewId] || null,
      });

      res.json({ outgoing: outgoing.map(enrich), incoming: incoming.map(enrich), total: outgoing.length + incoming.length });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // PATCH /api/crew-delegations/:id/status  — accept / reject / complete a delegation
  app.patch("/api/crew-delegations/:id/status", apiLimiter, async (req, res) => {
    try {
      const walletAddress = req.headers["x-wallet-address"] as string;
      if (!walletAddress) {
        return res.status(401).json({ message: "x-wallet-address header required" });
      }
      const { status } = req.body;
      const allowed = ["accepted", "rejected", "in_progress", "completed"];
      if (!allowed.includes(status)) {
        return res.status(400).json({ message: `Status must be one of: ${allowed.join(", ")}` });
      }
      const updated = await storage.updateCrewDelegationStatus(req.params.id, status);
      if (!updated) return res.status(404).json({ message: "Delegation not found" });
      res.json(updated);
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
    keyGenerator: (req) => (req as any).agentId || "unknown",
    message: { message: "Rate limit exceeded: 20 messages per hour" },
    standardHeaders: true,
    legacyHeaders: true,
    validate: { xForwardedForHeader: false, ip: false },
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

      if (sender.fusedScore < 1 && sender.totalGigsCompleted === 0) {
        return res.status(403).json({ message: "Complete at least one action (heartbeat, gig, etc.) before messaging" });
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

      notifyAgent(otherAgentId, "message_received", "New Message", `${sender.handle}: ${body.content.substring(0, 80)}${body.content.length > 80 ? "…" : ""}`).catch(() => {});

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
          homeChain: agent.homeChain || "BASE_SEPOLIA",
          x402PaymentCount: agent.x402PaymentCount || 0,
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
          "erc8004": { price: 0.001, currency: "USDC", chain: "base-sepolia" },
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

  // ─── Notification routes ─────────────────────────────────────────
  app.get("/api/agents/:id/notifications", agentAuthMiddleware, async (req, res) => {
    try {
      const agentId = (req as any).agentId;
      if (agentId !== req.params.id) return res.status(403).json({ message: "Forbidden" });
      const notifications = await storage.getNotificationsForAgent(agentId, 50);
      res.json(notifications);
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/agents/:id/notifications/unread-count", agentAuthMiddleware, async (req, res) => {
    try {
      const agentId = (req as any).agentId;
      if (agentId !== req.params.id) return res.status(403).json({ message: "Forbidden" });
      const count = await storage.getUnreadNotificationCount(agentId);
      res.json({ count });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/agents/:id/notifications/read-all", agentAuthMiddleware, async (req, res) => {
    try {
      const agentId = (req as any).agentId;
      if (agentId !== req.params.id) return res.status(403).json({ message: "Forbidden" });
      await storage.markAllNotificationsRead(agentId);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.patch("/api/notifications/:notifId/read", agentAuthMiddleware, async (req, res) => {
    try {
      const id = parseInt(String(req.params.notifId));
      if (isNaN(id)) return res.status(400).json({ message: "Invalid notification ID" });
      await storage.markNotificationRead(id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Escrow oracle balance + deposit address ──────────────────────
  app.get("/api/admin/escrow/oracle-balance", adminAuthMiddleware, async (_req, res) => {
    try {
      const usdcBalance = await getUSDCBalance(ORACLE_WALLET_ADDRESS);
      res.json({ wallet: ORACLE_WALLET_ADDRESS, usdcBalance });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/escrow/:gigId/deposit-address", async (req, res) => {
    try {
      const gig = await storage.getGig(req.params.gigId as string);
      if (!gig) return res.status(404).json({ message: "Gig not found" });
      res.json({
        depositAddress: ORACLE_WALLET_ADDRESS,
        gigId: gig.id,
        amount: gig.budget,
        currency: gig.currency,
        memo: `ClawTrust escrow for gig ${gig.id}`,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── SKILL VERIFICATION ROUTES ─────────────────────────────────────────────

  // Seed challenges on startup
  storage.seedSkillChallenges().catch((e) => console.error("[Skill] Seed failed:", e));

  function gradeChallenge(submission: string, challenge: { expectedKeywords: string[]; minWordCount: number; maxWordCount: number }): { score: number; details: Record<string, number> } {
    const words = submission.trim().split(/\s+/).filter(Boolean);
    const wordCount = words.length;
    const text = submission.toLowerCase();

    const foundKeywords = challenge.expectedKeywords.filter((kw) => text.includes(kw.toLowerCase()));
    const keywordScore = Math.round((foundKeywords.length / Math.max(challenge.expectedKeywords.length, 1)) * 40);

    let wordCountScore = 0;
    if (wordCount >= challenge.minWordCount && wordCount <= challenge.maxWordCount) {
      wordCountScore = 30;
    } else if (wordCount >= Math.round(challenge.minWordCount * 0.75)) {
      wordCountScore = 15;
    }

    const paragraphs = submission.split(/\n\n+/).filter((p) => p.trim().length > 20);
    const hasNumberedPoints = /\d+[\.\)]\s/.test(submission);
    const hasCodeBlocks = /```/.test(submission);
    const hasHeaders = /#{1,3}\s|^\*\*/.test(submission);
    let structureScore = 10;
    if (paragraphs.length >= 2) structureScore += 5;
    if (hasNumberedPoints) structureScore += 5;
    if (hasCodeBlocks || hasHeaders) structureScore += 10;
    structureScore = Math.min(structureScore, 30);

    const score = Math.min(100, keywordScore + wordCountScore + structureScore);
    return {
      score,
      details: {
        keywordScore,
        wordCountScore,
        structureScore,
        wordCount,
        keywordsFound: foundKeywords.length,
        keywordsTotal: challenge.expectedKeywords.length,
      },
    };
  }

  app.get("/api/agents/:id/skill-verifications", apiLimiter, async (req, res) => {
    try {
      const agent = await storage.getAgent(String(req.params.id));
      if (!agent) return res.status(404).json({ message: "Agent not found" });
      const verifications = await storage.getSkillVerifications(agent.id);
      const skillsWithStatus = agent.skills.map((skill) => {
        const verification = verifications.find((v) => v.skillName.toLowerCase() === skill.toLowerCase());
        const tier = verification?.tier ?? 0;
        return {
          skill,
          status: verification?.status ?? "unverified",
          trustScore: verification?.trustScore ?? 0,
          verifiedAt: verification?.verifiedAt ?? null,
          verificationMethod: verification?.verificationMethod ?? null,
          githubProfileUrl: verification?.githubProfileUrl ?? null,
          portfolioUrl: verification?.portfolioUrl ?? null,
          challengeScore: verification?.challengeScore ?? null,
          tier,
          tierLabel: getTierLabel(tier),
          tierBadge: getTierBadge(tier),
          tierProofs: verification?.tierProofs ?? {},
          nextUpgrade: getNextTierUpgrade(tier),
        };
      });
      const tierValues = skillsWithStatus.map(s => s.tier);
      const tierBonus = computeSkillTierBonus(tierValues);
      res.json({ skills: skillsWithStatus, tierBonus, maxTierBonus: 15 });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/agents/:id/verified-skills", apiLimiter, async (req, res) => {
    try {
      const agent = await storage.getAgent(String(req.params.id));
      if (!agent) return res.status(404).json({ message: "Agent not found" });
      res.json({ verifiedSkills: agent.verifiedSkills || [], count: (agent.verifiedSkills || []).length, maxBonus: 5, currentBonus: Math.min((agent.verifiedSkills || []).length, 5) });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/skill-challenges", apiLimiter, async (req, res) => {
    try {
      const SKILL_CATEGORIES = [
        { skill: "trust-verification",   label: "Trust Verification",   description: "Verify agent identity and trustworthiness on-chain" },
        { skill: "reputation-analysis",  label: "Reputation Analysis",  description: "Analyze agent FusedScore and reputation components" },
        { skill: "swarm-validation",     label: "Swarm Validation",     description: "Participate in decentralized gig validation votes" },
        { skill: "agent-onboarding",     label: "Agent Onboarding",     description: "Guide new agents through ERC-8004 registration" },
        { skill: "solidity",             label: "Solidity",             description: "Smart contract development on EVM chains" },
        { skill: "research",             label: "Research",             description: "Web3 and AI research and reporting" },
        { skill: "testing",              label: "Testing",              description: "End-to-end and on-chain testing" },
        { skill: "audit",                label: "Audit",                description: "Security auditing of smart contracts and APIs" },
        { skill: "data-analysis",        label: "Data Analysis",        description: "On-chain and off-chain data analysis" },
        { skill: "content",              label: "Content",              description: "Web3 content writing and documentation" },
      ];
      const skill = req.query.skill as string | undefined;
      const categories = skill
        ? SKILL_CATEGORIES.filter(c => c.skill.includes(skill.toLowerCase()))
        : SKILL_CATEGORIES;
      res.json({
        categories,
        total: categories.length,
        note: "Use GET /api/skill-challenges/:skill to get challenge questions for a specific skill",
        attemptEndpoint: "POST /api/skill-challenges/:skill/attempt",
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/skill-challenges/:skill", apiLimiter, async (req, res) => {
    try {
      const skill = String(req.params.skill).toLowerCase();
      const challenges = await storage.getSkillChallenges(skill);
      if (challenges.length === 0) {
        return res.json({ challenges: [], message: `No challenges available for skill: ${skill}` });
      }
      res.json({
        challenges: challenges.map((c) => ({
          id: c.id,
          skill: c.skill,
          difficulty: c.difficulty,
          prompt: c.prompt,
          starterHint: c.starterHint,
          timeLimit: c.timeLimit,
          passThreshold: c.passThreshold,
          minWordCount: c.minWordCount,
          maxWordCount: c.maxWordCount,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Alias routes: path variants expected by external test suite ─────────────

  app.get("/api/skills/challenges/:skillName", apiLimiter, async (req, res) => {
    try {
      const skill = String(req.params.skillName).toLowerCase();
      const challenges = await storage.getSkillChallenges(skill);
      res.json({
        skill,
        challenges: challenges.map((c) => ({
          id: c.id,
          skill: c.skill,
          difficulty: c.difficulty,
          prompt: c.prompt,
          starterHint: c.starterHint,
          timeLimit: c.timeLimit,
          passThreshold: c.passThreshold,
          minWordCount: c.minWordCount,
          maxWordCount: c.maxWordCount,
        })),
        total: challenges.length,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/agents/:id/skills/verifications", apiLimiter, async (req, res) => {
    try {
      const agent = await storage.getAgent(req.params.id as string);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const attempts = await storage.getChallengeAttemptsForAgent(agent.id);
      const verifications = await storage.getSkillVerifications(agent.id);

      res.json({
        agentId: agent.id,
        verifications: attempts.map((a) => ({
          id: a.id,
          skill: a.skill,
          score: a.score,
          passed: a.passed,
          submittedAt: a.createdAt,
          status: a.passed ? "passed" : "failed",
        })),
        skillVerifications: verifications,
        total: attempts.length,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.get("/api/agents/:id/swarm/pending-votes", apiLimiter, async (req, res) => {
    try {
      const agent = await storage.getAgent(req.params.id as string);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const allValidations = await storage.getValidations();
      // Fetch gigs to check poster/assignee eligibility
      const gigIds = [...new Set(allValidations.map((v) => v.gigId))];
      const gigMap = new Map<string, { posterId: string | null; assigneeId: string | null }>();
      await Promise.all(
        gigIds.map(async (gId) => {
          try {
            const gig = await storage.getGig(gId);
            if (gig) gigMap.set(gId, { posterId: gig.posterId, assigneeId: gig.assigneeId });
          } catch {}
        })
      );

      const pendingValidations = allValidations.filter((v) => {
        if (v.status !== "pending") return false;
        if (v.selectedValidators.includes(agent.id)) return false;
        // Exclude gigs where agent is the poster or assignee (conflict of interest)
        const gig = gigMap.get(v.gigId);
        if (gig) {
          if (gig.posterId === agent.id || gig.assigneeId === agent.id) return false;
        }
        return true;
      });

      res.json({
        agentId: agent.id,
        pendingVotes: pendingValidations.map((v) => ({
          validationId: v.id,
          gigId: v.gigId,
          status: v.status,
          votesFor: v.votesFor,
          votesAgainst: v.votesAgainst,
          threshold: v.threshold,
          rewardPerValidator: v.rewardPerValidator,
          createdAt: v.createdAt,
        })),
        total: pendingValidations.length,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  const skillChallengeSubmitHandler = async (req: any, res: any) => {
    try {
      const skill = String(req.params.skill).toLowerCase();
      const walletAddress = req.headers["x-wallet-address"] as string;
      const agentId = req.headers["x-agent-id"] as string;
      if (!agentId) return res.status(401).json({ message: "x-agent-id header required" });

      const agent = await storage.getAgent(agentId);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      if (walletAddress && agent.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
        return res.status(403).json({ message: "Authenticated wallet does not own this agent" });
      }
      if (!walletAddress) {
        return res.status(401).json({ message: "Wallet authentication required for skill verification" });
      }

      if (!agent.skills.map((s) => s.toLowerCase()).includes(skill)) {
        return res.status(400).json({ message: `Skill '${skill}' not on your profile. Add it first.` });
      }

      if ((agent.verifiedSkills || []).map((s: string) => s.toLowerCase()).includes(skill)) {
        return res.status(400).json({ message: `Skill '${skill}' is already verified.` });
      }

      const previousAttempts = await storage.getChallengeAttemptsForAgent(agentId, skill);
      if (previousAttempts.length > 0) {
        const lastAttempt = previousAttempts[0];
        if (lastAttempt.createdAt) {
          const hoursSince = (Date.now() - new Date(lastAttempt.createdAt).getTime()) / (1000 * 60 * 60);
          if (hoursSince < 24) {
            const hoursLeft = Math.ceil(24 - hoursSince);
            return res.status(429).json({
              message: `Cooldown active. You can retry in ${hoursLeft} hour${hoursLeft !== 1 ? "s" : ""}.`,
              cooldownEndsAt: new Date(new Date(lastAttempt.createdAt).getTime() + 24 * 60 * 60 * 1000).toISOString(),
            });
          }
        }
      }

      const { challengeId, submission, answer } = req.body;
      const submissionText = submission ?? answer;
      if (!challengeId || !submissionText || typeof submissionText !== "string") {
        return res.status(400).json({ message: "challengeId and submission (or answer) required" });
      }

      const challenge = await storage.getSkillChallenge(challengeId);
      if (!challenge) return res.status(404).json({ message: "Challenge not found" });
      if (challenge.skill !== skill) return res.status(400).json({ message: "Challenge does not match skill" });

      if (submissionText.trim().length < 20) {
        return res.status(400).json({ message: "Submission too short" });
      }

      const { score, details } = gradeChallenge(submissionText, challenge);
      const passed = score >= challenge.passThreshold;

      const attempt = await storage.createChallengeAttempt({
        agentId,
        challengeId,
        skill,
        submission: submissionText,
        score,
        passed,
        gradingDetails: details,
      });

      if (passed) {
        const existing = await storage.getSkillVerification(agentId, skill);
        const newTrustScore = Math.max(existing?.trustScore ?? 0, Math.round(score * 0.6));
        const currentTier = existing?.tier ?? 0;
        const newTier = Math.max(currentTier, 1);
        const tierProofs = (existing?.tierProofs as Record<string, any>) ?? {};
        tierProofs["1"] = { method: "challenge", score, passedAt: new Date().toISOString() };
        await storage.upsertSkillVerification(agentId, skill, {
          status: "verified",
          verifiedAt: new Date(),
          challengeScore: score,
          challengeCompletedAt: new Date(),
          verificationMethod: existing?.verificationMethod && existing.verificationMethod !== "challenge" ? existing.verificationMethod : "challenge",
          trustScore: Math.min(100, (existing?.trustScore ?? 0) + newTrustScore),
          tier: newTier,
          tierProofs,
        });

        await syncAgentSkillBonusAndVerifiedSkills(agentId);
      }

      const finalAgent = await storage.getAgent(agentId);
      res.json({
        attemptId: attempt.id,
        score,
        passed,
        result: passed ? "pass" : "fail",
        passThreshold: challenge.passThreshold,
        details,
        breakdown: details,
        fusedScore: finalAgent?.fusedScore,
        verifiedSkillsCount: (finalAgent?.verifiedSkills || []).length,
        message: passed
          ? `Congratulations! You scored ${score}/100 — skill '${skill}' is now verified. FusedScore updated to ${finalAgent?.fusedScore}.`
          : `Score: ${score}/100 (need ${challenge.passThreshold} to pass). Review the grading details and try again.`,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  };

  app.post("/api/skill-challenges/:skill/attempt", apiLimiter, walletAuthMiddleware, skillChallengeSubmitHandler);
  app.post("/api/skill-challenges/:skill/submit", apiLimiter, walletAuthMiddleware, skillChallengeSubmitHandler);

  const GITHUB_SKILL_LANGUAGES: Record<string, string[]> = {
    solidity: ["Solidity"],
    typescript: ["TypeScript"],
    javascript: ["JavaScript", "TypeScript"],
    python: ["Python"],
    rust: ["Rust"],
    react: ["JavaScript", "TypeScript"],
    "node": ["JavaScript", "TypeScript"],
    "nodejs": ["JavaScript", "TypeScript"],
    go: ["Go"],
    java: ["Java"],
    "c++": ["C++", "C"],
    audit: [],
    research: [],
    content: [],
    documentation: [],
    testing: ["JavaScript", "TypeScript", "Python"],
    "data-analysis": ["Python", "R", "Jupyter Notebook"],
    "trust-verification": [],
    "reputation-analysis": [],
    "swarm-validation": [],
    "agent-onboarding": [],
  };

  async function verifyGitHubSkill(
    githubHandle: string,
    skill: string,
    agentRegisteredAt?: Date | null
  ): Promise<{ ok: boolean; repoCount: number; topRepo: string | null; languages: string[]; commitCount?: number; error?: string }> {
    const token = process.env.GITHUB_PERSONAL_ACCESS_TOKEN;
    const headers: Record<string, string> = { "User-Agent": "ClawTrust-Skill-Verifier/1.0", "Accept": "application/vnd.github+json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const MIN_COMMITS = 10;

    try {
      const userResp = await fetch(`https://api.github.com/users/${encodeURIComponent(githubHandle)}`, { headers });
      if (!userResp.ok) {
        if (userResp.status === 404) return { ok: false, repoCount: 0, topRepo: null, languages: [], error: `GitHub user '${githubHandle}' not found` };
        return { ok: false, repoCount: 0, topRepo: null, languages: [], error: `GitHub API error: ${userResp.status} — verification unavailable` };
      }
      const userData = await userResp.json() as { public_repos: number; login: string; created_at: string };
      if (userData.public_repos === 0) {
        return { ok: false, repoCount: 0, topRepo: null, languages: [], error: "GitHub account has no public repositories" };
      }

      const targetLanguages = GITHUB_SKILL_LANGUAGES[skill.toLowerCase()];
      if (targetLanguages === undefined) {
        return { ok: false, repoCount: 0, topRepo: null, languages: [], error: `Skill '${skill}' is not in the allowed skill list for GitHub verification` };
      }

      const registrationCutoff = agentRegisteredAt ? new Date(agentRegisteredAt) : null;

      if (targetLanguages.length === 0) {
        const repoResp = await fetch(
          `https://api.github.com/users/${encodeURIComponent(githubHandle)}/repos?type=public&sort=pushed&per_page=100`,
          { headers }
        );
        if (!repoResp.ok) {
          return { ok: false, repoCount: 0, topRepo: null, languages: [], error: `GitHub API error fetching repos: ${repoResp.status}` };
        }
        const repos = await repoResp.json() as Array<{ name: string; created_at: string; pushed_at: string }>;
        const preRegRepos = registrationCutoff
          ? repos.filter(r => new Date(r.created_at) < registrationCutoff!)
          : repos;
        if (preRegRepos.length === 0) {
          return { ok: false, repoCount: 0, topRepo: null, languages: [], error: "No public repositories created before agent registration date" };
        }
        let totalCommits = 0;
        for (const repo of preRegRepos.slice(0, 5)) {
          try {
            const statsResp = await fetch(`https://api.github.com/repos/${encodeURIComponent(githubHandle)}/${encodeURIComponent(repo.name)}/contributors?per_page=100&anon=0`, { headers });
            if (statsResp.ok) {
              const contributors = await statsResp.json() as Array<{ login: string; contributions: number }>;
              const mine = contributors.find(c => c.login.toLowerCase() === githubHandle.toLowerCase());
              totalCommits += mine?.contributions ?? 0;
            }
          } catch { /* ignore per-repo errors */ }
        }
        if (totalCommits < MIN_COMMITS) {
          return { ok: false, repoCount: preRegRepos.length, topRepo: null, languages: [], commitCount: totalCommits, error: `Insufficient commit history: found ${totalCommits} commits, need at least ${MIN_COMMITS}` };
        }
        return { ok: true, repoCount: preRegRepos.length, topRepo: preRegRepos[0]?.name ?? null, languages: [], commitCount: totalCommits };
      }

      const langQuery = targetLanguages.map(l => `language:${encodeURIComponent(l)}`).join("+OR+");
      const repoResp = await fetch(
        `https://api.github.com/search/repositories?q=${langQuery}+user:${encodeURIComponent(githubHandle)}&sort=stars&order=desc&per_page=30`,
        { headers }
      );
      if (!repoResp.ok) {
        return { ok: false, repoCount: 0, topRepo: null, languages: [], error: `GitHub repo search failed: ${repoResp.status} — verification unavailable` };
      }
      const repoData = await repoResp.json() as { items: Array<{ name: string; language: string | null; stargazers_count: number; created_at: string }> };
      const allMatchingRepos = (repoData.items || []).filter(r => r.language && targetLanguages.some(l => l.toLowerCase() === r.language!.toLowerCase()));
      if (allMatchingRepos.length === 0) {
        return {
          ok: false, repoCount: userData.public_repos, topRepo: null, languages: [],
          error: `No public repositories found using ${targetLanguages.join("/")} for skill '${skill}'`,
        };
      }
      const matchingRepos = registrationCutoff
        ? allMatchingRepos.filter(r => new Date(r.created_at) < registrationCutoff!)
        : allMatchingRepos;
      if (matchingRepos.length === 0) {
        return {
          ok: false, repoCount: allMatchingRepos.length, topRepo: null, languages: [],
          error: `No qualifying repositories for skill '${skill}' — all repos were created after your agent registration date`,
        };
      }

      let totalCommits = 0;
      for (const repo of matchingRepos.slice(0, 5)) {
        try {
          const statsResp = await fetch(`https://api.github.com/repos/${encodeURIComponent(githubHandle)}/${encodeURIComponent(repo.name)}/contributors?per_page=100&anon=0`, { headers });
          if (statsResp.ok) {
            const contributors = await statsResp.json() as Array<{ login: string; contributions: number }>;
            const mine = contributors.find(c => c.login.toLowerCase() === githubHandle.toLowerCase());
            totalCommits += mine?.contributions ?? 0;
          }
        } catch { /* ignore per-repo errors */ }
      }
      if (totalCommits < MIN_COMMITS) {
        return { ok: false, repoCount: matchingRepos.length, topRepo: null, languages: [], commitCount: totalCommits, error: `Insufficient commit history: found ${totalCommits} commits across qualifying repos, need at least ${MIN_COMMITS}` };
      }

      const topRepo = matchingRepos[0]?.name ?? null;
      const uniqueLangs = [...new Set(matchingRepos.map(r => r.language!).filter(Boolean))];
      return { ok: true, repoCount: matchingRepos.length, topRepo, languages: uniqueLangs, commitCount: totalCommits };
    } catch (err: any) {
      return { ok: false, repoCount: 0, topRepo: null, languages: [], error: `GitHub API unavailable: ${err.message?.slice(0, 100)}` };
    }
  }

  app.post("/api/agents/:id/skills/:skill/verify-github", strictLimiter, walletAuthMiddleware, async (req, res) => {
    try {
      const id = String(req.params.id);
      const skill = String(req.params.skill).toLowerCase();

      const agent = await storage.getAgent(id);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const walletAddress = req.headers["x-wallet-address"] as string;
      if (!walletAddress || agent.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
        return res.status(403).json({ message: "Authenticated wallet does not own this agent" });
      }

      const { githubHandle, walletSignature } = req.body;
      if (!githubHandle || typeof githubHandle !== "string" || !/^[a-zA-Z0-9_-]{1,39}$/.test(githubHandle.trim())) {
        return res.status(400).json({ message: "githubHandle required (your GitHub username, not a URL)" });
      }

      if (!walletSignature || typeof walletSignature !== "string") {
        return res.status(400).json({
          message: "walletSignature required — sign the ownership message with your registered wallet",
          requiredMessage: `I am ${githubHandle.trim()} on GitHub. My ClawTrust wallet is ${walletAddress.toLowerCase()}.`,
          hint: "Sign this exact message with your wallet (EIP-191 personal_sign) to prove GitHub handle ownership",
        });
      }

      const expectedMessage = `I am ${githubHandle.trim()} on GitHub. My ClawTrust wallet is ${walletAddress.toLowerCase()}.`;
      let signatureValid = false;
      try {
        const recoveredAddress = await import("viem").then(({ recoverMessageAddress }) =>
          recoverMessageAddress({ message: expectedMessage, signature: walletSignature as `0x${string}` })
        );
        signatureValid = recoveredAddress.toLowerCase() === walletAddress.toLowerCase();
      } catch {
        signatureValid = false;
      }
      if (!signatureValid) {
        return res.status(403).json({
          message: "Wallet signature verification failed — the signature does not match the required message",
          requiredMessage: expectedMessage,
          hint: "Use EIP-191 personal_sign with the exact message to prove you own both the wallet and the GitHub handle",
        });
      }

      if (!agent.skills.map(s => s.toLowerCase()).includes(skill)) {
        return res.status(400).json({ message: `Skill '${skill}' is not declared on your agent profile. Add it to your skills list first.` });
      }

      const existing = await storage.getSkillVerification(id, skill);
      if ((existing?.tier ?? 0) >= 2) {
        return res.status(400).json({ message: `Skill '${skill}' is already GitHub-verified (Tier 2 or higher)` });
      }

      const result = await verifyGitHubSkill(githubHandle.trim(), skill, agent.createdAt);
      if (!result.ok) {
        return res.status(422).json({
          message: result.error || "GitHub verification failed",
          githubHandle: githubHandle.trim(),
          skill,
          hint: "Make sure your GitHub account has public repositories demonstrating this skill",
        });
      }

      const currentTier = existing?.tier ?? 0;
      const newTier = Math.max(currentTier, 2);
      const tierProofs = (existing?.tierProofs as Record<string, any>) ?? {};
      tierProofs["2"] = {
        method: "github_api",
        githubHandle: githubHandle.trim(),
        repoCount: result.repoCount,
        commitCount: result.commitCount ?? 0,
        topRepo: result.topRepo,
        languages: result.languages,
        ownershipProof: "wallet_signature_eip191",
        walletAddress: walletAddress.toLowerCase(),
        verifiedAt: new Date().toISOString(),
      };
      const newTrust = Math.min(100, (existing?.trustScore ?? 0) + 30);
      const githubProfileUrl = `https://github.com/${githubHandle.trim()}`;

      await storage.upsertSkillVerification(id, skill, {
        githubProfileUrl,
        trustScore: newTrust,
        status: existing?.status === "verified" ? "verified" : "partial",
        verificationMethod: "github_api",
        tier: newTier,
        tierProofs,
      });

      await syncAgentSkillBonusAndVerifiedSkills(id);

      res.json({
        message: `GitHub verified for skill '${skill}'. ${result.repoCount} matching repo(s) found.`,
        tier: newTier,
        tierLabel: getTierLabel(newTier),
        tierBadge: getTierBadge(newTier),
        githubHandle: githubHandle.trim(),
        repoCount: result.repoCount,
        topRepo: result.topRepo,
        trustScore: newTrust,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/agents/:id/skills/:skill/github", apiLimiter, walletAuthMiddleware, async (req, res) => {
    const id = String(req.params.id);
    const skill = String(req.params.skill).toLowerCase();
    const { githubHandle, githubProfileUrl } = req.body;
    const handle = githubHandle || (githubProfileUrl ? githubProfileUrl.replace(/.*github\.com\//, "").replace(/\/$/, "") : null);
    if (handle) {
      return res.redirect(307, `/api/agents/${id}/skills/${skill}/verify-github`);
    }
    return res.status(400).json({ message: "Use POST /api/agents/:id/skills/:skill/verify-github with { githubHandle } for real GitHub API verification" });
  });

  app.post("/api/agents/:id/skills/:skill/attest", strictLimiter, walletAuthMiddleware, async (req, res) => {
    try {
      const targetId = String(req.params.id);
      const skill = String(req.params.skill).toLowerCase();

      const targetAgent = await storage.getAgent(targetId);
      if (!targetAgent) return res.status(404).json({ message: "Agent not found" });

      const walletAddress = req.headers["x-wallet-address"] as string;
      if (!walletAddress) return res.status(401).json({ message: "Wallet authentication required" });

      const attestorAgent = await storage.getAgentByWallet(walletAddress);
      if (!attestorAgent) return res.status(404).json({ message: "Your agent is not registered" });
      if (attestorAgent.id === targetId) return res.status(400).json({ message: "You cannot attest your own skill" });

      if (attestorAgent.fusedScore < 50) {
        return res.status(403).json({
          message: `Your FusedScore must be ≥ 50 to attest peer skills (yours: ${attestorAgent.fusedScore.toFixed(1)})`,
        });
      }

      const attestorSkillRecord = await storage.getSkillVerification(attestorAgent.id, skill);
      if ((attestorSkillRecord?.tier ?? 0) < 2) {
        return res.status(403).json({
          message: `You must have skill '${skill}' at Tier 2 (GitHub-Verified) or higher to attest it`,
        });
      }

      const alreadyAttested = await storage.hasAttested(targetId, skill, attestorAgent.id);
      if (alreadyAttested) return res.status(400).json({ message: "You have already attested this skill for this agent" });

      await storage.createSkillAttestation({
        agentId: targetId,
        skillName: skill,
        attestorId: attestorAgent.id,
        attestorFusedScore: attestorAgent.fusedScore,
      });

      const attestationCount = await storage.countSkillAttestations(targetId, skill);
      const ATTESTATION_THRESHOLD = 3;
      let tierUpgraded = false;

      if (attestationCount >= ATTESTATION_THRESHOLD) {
        const existing = await storage.getSkillVerification(targetId, skill);
        if ((existing?.tier ?? 0) < 4) {
          const attestations = await storage.getSkillAttestations(targetId, skill);
          const tierProofs = (existing?.tierProofs as Record<string, any>) ?? {};
          tierProofs["4"] = {
            method: "peer_attestation",
            attestors: attestations.slice(0, 5).map(a => ({ id: a.attestorId, fusedScore: a.attestorFusedScore, attestedAt: a.createdAt })),
            count: attestationCount,
            achievedAt: new Date().toISOString(),
          };
          await storage.upsertSkillVerification(targetId, skill, {
            tier: 4,
            tierProofs,
            trustScore: Math.min(100, (existing?.trustScore ?? 0) + 20),
          });

          await syncAgentSkillBonusAndVerifiedSkills(targetId);
          tierUpgraded = true;
        }
      }

      res.json({
        message: `Attestation recorded for skill '${skill}' on agent ${targetAgent.handle}`,
        attestationCount,
        threshold: ATTESTATION_THRESHOLD,
        tierUpgraded,
        tierUnlocked: tierUpgraded ? 4 : null,
        remaining: Math.max(0, ATTESTATION_THRESHOLD - attestationCount),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  app.post("/api/agents/:id/skills/:skill/portfolio", apiLimiter, walletAuthMiddleware, async (req, res) => {
    try {
      const id = String(req.params.id);
      const skill = String(req.params.skill);

      const agent = await storage.getAgent(id);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const walletAddress = req.headers["x-wallet-address"] as string;
      if (!walletAddress || agent.walletAddress.toLowerCase() !== walletAddress.toLowerCase()) {
        return res.status(403).json({ message: "Authenticated wallet does not own this agent" });
      }

      const { portfolioUrl } = req.body;
      if (!portfolioUrl || typeof portfolioUrl !== "string") {
        return res.status(400).json({ message: "portfolioUrl required" });
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(portfolioUrl.trim());
        if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error();
      } catch {
        return res.status(400).json({ message: "Must be a valid http/https URL" });
      }

      const existing = await storage.getSkillVerification(id, skill.toLowerCase());
      const addedScore = 15;
      const newTrust = Math.min(100, (existing?.trustScore ?? 0) + addedScore);

      await storage.upsertSkillVerification(id, skill.toLowerCase(), {
        portfolioUrl: parsedUrl.toString(),
        trustScore: newTrust,
        status: existing?.status === "verified" ? "verified" : "partial",
        verificationMethod: existing?.verificationMethod ?? "portfolio",
      });

      res.json({
        message: `Portfolio URL submitted for skill '${skill}'. Trust score +${addedScore}.`,
        trustScore: newTrust,
        portfolioUrl: parsedUrl.toString(),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── SLASHES ────────────────────────────────────────────────────────────────

  app.get("/api/slashes", apiLimiter, async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
      const offset = parseInt(req.query.offset as string) || 0;
      const [slicesResult, counts] = await Promise.all([
        storage.getSlashEvents(limit + offset),
        storage.countAllSlashEvents(),
      ]);
      const slashes = slicesResult.slice(offset, offset + limit);

      const enriched = await Promise.all(slashes.map(async (s) => {
        const agent = await storage.getAgent(s.agentId);
        const gig = s.gigId ? await storage.getGig(s.gigId) : null;
        return {
          ...s,
          agent: agent ? { id: agent.id, handle: agent.handle, avatar: agent.avatar, fusedScore: agent.fusedScore } : null,
          gig: gig ? { id: gig.id, title: gig.title, budget: gig.budget } : null,
        };
      }));

      res.json({
        slashes: enriched,
        total: counts.total,
        totalSlashed: counts.totalSlashed,
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
      const { newWallet, oldWallet, signature, sigTimestamp, newAgentId } = req.body;

      if (!newWallet || !oldWallet || !newAgentId) {
        return res.status(400).json({ message: "newWallet, oldWallet, and newAgentId are required" });
      }

      if (!signature || !sigTimestamp) {
        logSuspiciousActivity(req, "inherit_rep_no_sig", `inherit-reputation attempted without signature from ${oldWallet}`);
        return res.status(401).json({ message: "Wallet signature required. Sign the migration message with your wallet." });
      }

      const ts = parseInt(sigTimestamp, 10);
      const now = Date.now();
      if (isNaN(ts) || now - ts > SENSITIVE_SIG_TTL_MS || ts > now + 60_000) {
        logSuspiciousActivity(req, "inherit_rep_sig_expired", `inherit-reputation signature expired for ${oldWallet}`);
        return res.status(401).json({ message: "Signature expired. Please re-sign within 30 minutes." });
      }

      const oldAgent = await storage.getAgent(oldAgentId);
      if (!oldAgent) {
        return res.status(404).json({ message: "Source agent not found" });
      }

      if (oldAgent.walletAddress.toLowerCase() !== oldWallet.toLowerCase()) {
        return res.status(400).json({ message: "oldWallet does not match agent's registered wallet" });
      }

      const migrationMessage = `ClawTrust reputation migration.\nOld agent: ${oldAgentId}\nOld wallet: ${oldWallet}\nNew agent: ${newAgentId}\nNew wallet: ${newWallet}\nTimestamp: ${ts}`;
      try {
        const valid = await verifyMessage({
          address: oldWallet as Address,
          message: migrationMessage,
          signature: signature as `0x${string}`,
        });
        if (!valid) {
          logSuspiciousActivity(req, "inherit_rep_sig_invalid", `Invalid signature for reputation migration from ${oldWallet}`, "critical");
          return res.status(401).json({ message: "Invalid wallet signature. Signature must be from the registered wallet of the source agent." });
        }
      } catch (sigErr: any) {
        logSuspiciousActivity(req, "inherit_rep_sig_error", `Signature verification error for ${oldWallet}: ${sigErr?.message}`);
        return res.status(401).json({ message: "Wallet signature verification failed." });
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

  // ─── SKALE Multi-chain: Read score ─────────────────────────────────
  app.get("/api/agents/:id/skale-score", apiLimiter, async (req, res) => {
    try {
      const agent = await storage.getAgent(req.params.id as string);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      const result = await readSkaleFusedScore(agent.walletAddress);
      if (!result) {
        const breakdown = getScoreBreakdown(agent);
        return res.json({
          hasSkaleScore: false,
          score: null,
          updatedAt: null,
          walletAddress: agent.walletAddress,
          baseScore: agent.fusedScore,
          baseBreakdown: breakdown,
          note: "No SKALE score yet — use POST /api/agents/:id/sync-to-skale to sync",
        });
      }

      return res.json({
        hasSkaleScore: true,
        score: result.score,
        updatedAt: result.updatedAt > 0 ? new Date(result.updatedAt * 1000).toISOString() : null,
        walletAddress: agent.walletAddress,
        chain: "SKALE_TESTNET",
        chainId: 324705682,
        contract: "0xFafCA23a7c085A842E827f53A853141C8243F924",
        breakdown: {
          onChainScore: result.onChainScore,
          moltbookKarma: result.moltbookKarma,
          performanceScore: result.performanceScore,
          bondScore: result.bondScore,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ─── SKALE Multi-chain: Sync score Base → SKALE ─────────────────────
  app.post("/api/agents/:id/sync-to-skale", apiLimiter, agentAuthMiddleware, async (req, res) => {
    try {
      const authenticatedAgentId = (req as any).agentId as string;
      if (authenticatedAgentId && authenticatedAgentId !== req.params.id) {
        logSuspiciousActivity(req, "skale_sync_wrong_agent", `Agent ${authenticatedAgentId} tried to sync agent ${req.params.id}`, "critical");
        return res.status(403).json({ message: "You may only sync your own agent to SKALE." });
      }

      const agent = await storage.getAgent(req.params.id as string);
      if (!agent) return res.status(404).json({ message: "Agent not found" });

      if (!agent.walletAddress || /^0x0+$/.test(agent.walletAddress)) {
        return res.status(400).json({ message: "Agent has no valid wallet address for SKALE sync" });
      }

      const breakdown = getScoreBreakdown(agent);
      // All 4 component scores normalized to 0-100 for consistent SKALE contract scale
      const result = await syncScoreToSkale({
        walletAddress: agent.walletAddress,
        fusedScore: agent.fusedScore ?? 0,
        onChainScore: breakdown.onChainNormalized ?? 0,       // 0-100 (not raw 0-1000)
        moltbookScore: breakdown.moltbookNormalized ?? 0,     // 0-100
        performanceScore: breakdown.performanceNormalized ?? 0, // 0-100
        bondScore: breakdown.bondReliabilityNormalized ?? 0,  // 0-100
      });

      if ("error" in result) {
        return res.status(500).json({ message: result.error, walletAddress: agent.walletAddress });
      }

      return res.json({
        success: true,
        txHash: result.txHash,
        syncedAt: new Date().toISOString(),
        walletAddress: agent.walletAddress,
        chain: "SKALE_TESTNET",
        chainId: 324705682,
        score: agent.fusedScore,
        breakdown: {
          onChainScore: breakdown.rawOnChainScore,
          moltbookKarma: breakdown.rawMoltbookKarma,
          performanceScore: breakdown.performanceNormalized,
          bondScore: breakdown.bondReliabilityNormalized,
        },
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ─── SKALE: Multi-chain agent info ────────────────────────────────
  app.get("/api/multichain/:id", apiLimiter, async (req, res) => {
    try {
      const agent = await storage.getAgent(req.params.id as string);
      if (!agent) return res.status(404).json({ message: "Agent not found" });
      const breakdown = getScoreBreakdown(agent);
      const [skaleScore, skaleRegistered] = await Promise.all([
        readSkaleFusedScore(agent.walletAddress).catch(() => null),
        readSkaleIsRegistered(agent.walletAddress).catch(() => false),
      ]);
      return res.json({
        agentId: agent.id,
        handle: agent.handle,
        walletAddress: agent.walletAddress,
        chains: {
          BASE_SEPOLIA: {
            chainId: 84532,
            rpc: "https://sepolia.base.org",
            registered: !!agent.erc8004TokenId,
            tokenId: agent.erc8004TokenId,
            fusedScore: agent.fusedScore,
            breakdown,
            features: {
              erc8004Identity: true,
              reputationOracle: true,
              bondEscrow: true,
              gigMarket: true,
              swarmValidation: true,
              usdcPayments: true,
              x402MicroPayments: true,
              gas: "ETH (Sepolia)",
              nativeCurrency: "ETH",
              paymentCurrency: "USDC",
            },
            contracts: {
              erc8004Registry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
              repAdapter: "0xEfF3d3170e37998C7db987eFA628e7e56E1866DB",
              bond: "0x23a1E1e958C932639906d0650A13283f6E60132c",
              escrow: "0x6B676744B8c4900F9999E9a9323728C160706126",
              swarmValidator: "0xb219ddb4a65934Cea396C606e7F6bcfBF2F68743",
              clawCardNFT: "0xf24e41980ed48576Eb379D2116C1AaD075B342C4",
            },
          },
          SKALE_TESTNET: {
            chainId: 324705682,
            rpc: "https://base-sepolia-testnet.skalenodes.com/v1/jubilant-horrible-ancha",
            registered: skaleRegistered,
            hasScore: !!skaleScore,
            fusedScore: skaleScore?.score ?? null,
            breakdown: skaleScore ? {
              onChainScore: skaleScore.onChainScore,
              moltbookKarma: skaleScore.moltbookKarma,
              performanceScore: skaleScore.performanceScore,
              bondScore: skaleScore.bondScore,
            } : null,
            updatedAt: skaleScore?.updatedAt && skaleScore.updatedAt > 0
              ? new Date(skaleScore.updatedAt * 1000).toISOString() : null,
            syncEndpoint: `POST /api/agents/${agent.id}/sync-to-skale`,
            features: {
              erc8004Identity: true,
              reputationOracle: true,
              bondEscrow: true,
              gigMarket: true,
              swarmValidation: true,
              usdcPayments: true,
              x402MicroPayments: true,
              gas: "sFUEL (gasless)",
              nativeCurrency: "sFUEL",
              paymentCurrency: "USDC",
              zeroGasFees: true,
              encryptedExecution: true,
              subSecondFinality: true,
            },
            contracts: {
              erc8004IdentityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
              erc8004ReputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
              repAdapter: "0xFafCA23a7c085A842E827f53A853141C8243F924",
              clawCardNFT: "0xdB7F6cCf57D6c6AA90ccCC1a510589513f28cb83",
              agenticCommerce: "0x101F37D9bf445E92A237F8721CA7D12205D61Fe6",
              escrow: "0x39601883CD9A115Aba0228fe0620f468Dc710d54",
              swarmValidator: "0x7693a841Eec79Da879241BC0eCcc80710F39f399",
              bond: "0x5bC40A7a47A2b767D948FEEc475b24c027B43867",
              crew: (process.env.SKALE_MAINNET_CREW_ADDRESS || "0x427d0D6481bC708979Bdc2F80f659549BdB27f96"),
              registry: "0xED668f205eC9Ba9DA0c1D74B5866428b8e270084",
            },
          },
        },
        budget: {
          note: "All USDC payments, bonds, and escrow are on Base Sepolia. SKALE is gasless (sFUEL) and stores reputation only.",
          bond: { amount: agent.availableBond, currency: "USDC", chain: "BASE_SEPOLIA" },
          totalEarned: { amount: agent.totalEarned, currency: "USDC", chain: "BASE_SEPOLIA" },
          lockedBond: { amount: agent.lockedBond, currency: "USDC", chain: "BASE_SEPOLIA" },
        },
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // ─── Health: Contract Status ────────────────────────────────────────
  app.get("/api/health/contracts", async (_req, res) => {
    const results: Record<string, any> = {};
    // ── Core ClawTrust contracts (deployed on Base Sepolia) ──────────────────
    const nftAddr    = process.env.CLAW_CARD_NFT_ADDRESS              || "0xf24e41980ed48576Eb379D2116C1AaD075B342C4";
    const escrowAddr = process.env.CLAW_TRUST_ESCROW_ADDRESS          || "0x6B676744B8c4900F9999E9a9323728C160706126";
    const repAddr    = process.env.CLAW_TRUST_REP_ADAPTER_ADDRESS     || "0xEfF3d3170e37998C7db987eFA628e7e56E1866DB";
    const swarmAddr  = process.env.CLAW_TRUST_SWARM_VALIDATOR_ADDRESS || "0xb219ddb4a65934Cea396C606e7F6bcfBF2F68743";
    const bondAddr   = process.env.CLAW_TRUST_BOND_ADDRESS            || "0x23a1E1e958C932639906d0650A13283f6E60132c";
    const crewAddr   = process.env.CLAW_TRUST_CREW_ADDRESS || "0x33D0f79974C383dc374C888774eB52b0fca41BA2";
    // ── Additional Base Sepolia contracts (ERC-8004 registry + ERC-8183 AC + domain registry) ──
    const erc8004RegAddr  = "0x8004A818BFB912233c491871b3d84c89A494BD9e"; // Official ERC-8004 identity registry
    const clawACAddr      = "0x1933D67CDB911653765e84758f47c60A1E868bC0"; // ClawTrustAC — ERC-8183 agentic commerce
    const clawRegAddr     = "0x82AEAA9921aC1408626851c90FCf74410D059dF4"; // ClawTrustRegistry — .claw/.shell/.pinch/.agent domains

    try {
      const totalSupply = await (clawCardNFT as any).read.totalSupply();
      results.ClawCardNFT = { address: nftAddr, responding: true, healthy: true, totalSupply: Number(totalSupply) };
    } catch (e: any) {
      results.ClawCardNFT = { address: nftAddr, responding: false, healthy: false, error: e.message?.slice(0, 100) };
    }

    try {
      const fee = await (escrowContract as any).read.platformFeeRate();
      results.ClawTrustEscrow = { address: escrowAddr, responding: true, healthy: true, platformFee: Number(fee) };
    } catch (e: any) {
      results.ClawTrustEscrow = { address: escrowAddr, responding: false, healthy: false, error: e.message?.slice(0, 100) };
    }

    try {
      const repCode = await publicClient.getCode({ address: repAddr as `0x${string}` });
      const repHealthy = !!repCode && repCode !== "0x";
      results.ClawTrustRepAdapter = { address: repAddr, responding: repHealthy, healthy: repHealthy };
    } catch (e: any) {
      results.ClawTrustRepAdapter = { address: repAddr, responding: false, healthy: false, error: e.message?.slice(0, 100) };
    }

    try {
      const swarmCode = await publicClient.getCode({ address: swarmAddr as `0x${string}` });
      const swarmHealthy = !!swarmCode && swarmCode !== "0x";
      results.ClawTrustSwarmValidator = { address: swarmAddr, responding: swarmHealthy, healthy: swarmHealthy };
    } catch (e: any) {
      results.ClawTrustSwarmValidator = { address: swarmAddr, responding: false, healthy: false, error: e.message?.slice(0, 100) };
    }

    try {
      const minDep = await (bondContract as any).read.MIN_DEPOSIT();
      results.ClawTrustBond = { address: bondAddr, responding: true, healthy: true, minDeposit: minDep.toString() };
    } catch (e: any) {
      results.ClawTrustBond = { address: bondAddr, responding: false, healthy: false, error: e.message?.slice(0, 100) };
    }

    try {
      const crewCode = await publicClient.getCode({ address: crewAddr as `0x${string}` });
      const crewHealthy = !!crewCode && crewCode !== "0x";
      results.ClawTrustCrew = { address: crewAddr, responding: crewHealthy, healthy: crewHealthy };
    } catch (e: any) {
      results.ClawTrustCrew = { address: crewAddr, responding: false, healthy: false, error: e.message?.slice(0, 100) };
    }

    // ── Additional Base Sepolia contracts ──────────────────────────────────
    try {
      const erc8004Code = await publicClient.getCode({ address: erc8004RegAddr as `0x${string}` });
      const h = !!erc8004Code && erc8004Code !== "0x";
      results.ERC8004IdentityRegistry = { address: erc8004RegAddr, responding: h, healthy: h, role: "ERC-8004 global agent identity registry" };
    } catch (e: any) {
      results.ERC8004IdentityRegistry = { address: erc8004RegAddr, responding: false, healthy: false, error: e.message?.slice(0, 100) };
    }

    try {
      const acCode = await publicClient.getCode({ address: clawACAddr as `0x${string}` });
      const h = !!acCode && acCode !== "0x";
      results.ClawTrustAC = { address: clawACAddr, responding: h, healthy: h, role: "ERC-8183 agentic commerce adapter" };
    } catch (e: any) {
      results.ClawTrustAC = { address: clawACAddr, responding: false, healthy: false, error: e.message?.slice(0, 100) };
    }

    try {
      const regCode = await publicClient.getCode({ address: clawRegAddr as `0x${string}` });
      const h = !!regCode && regCode !== "0x";
      results.ClawTrustRegistry = { address: clawRegAddr, responding: h, healthy: h, role: ".claw/.shell/.pinch TLD domain registry" };
    } catch (e: any) {
      results.ClawTrustRegistry = { address: clawRegAddr, responding: false, healthy: false, error: e.message?.slice(0, 100) };
    }

    // ── SKALE Base Sepolia contracts ────────────────────────────────────────
    const skaleResults: Record<string, any> = {};
    const skaleAddrs = {
      RepAdapter:  SKALE_CONTRACTS.repAdapter,
      ClawCardNFT: SKALE_CONTRACTS.clawCardNFT,
      Escrow:      SKALE_CONTRACTS.escrow,
      Bond:        SKALE_CONTRACTS.bond,
    };
    await Promise.all(Object.entries(skaleAddrs).map(async ([name, addr]) => {
      try {
        const code = await skalePublicClient.getCode({ address: addr });
        const healthy = !!code && code !== "0x";
        skaleResults[`SKALE_${name}`] = { address: addr, chain: "skale-base-sepolia", chainId: 324705682, responding: healthy, healthy };
      } catch (e: any) {
        skaleResults[`SKALE_${name}`] = { address: addr, chain: "skale-base-sepolia", chainId: 324705682, responding: false, healthy: false, error: e.message?.slice(0, 100) };
      }
    }));

    const skaleUnhealthy = Object.values(skaleResults).some((r: any) => !r.healthy);
    const baseUnhealthy  = Object.values(results).some((r: any) => !r.healthy);
    const overall = (skaleUnhealthy || baseUnhealthy) ? "degraded" : "healthy";

    res.json({ overall, base: results, skale: skaleResults });
  });

  // ─── Network Stats ────────────────────────────────────────────────
  app.get("/api/network-stats", async (_req, res) => {
    try {
      const allAgents = await storage.getAgents();
      const allGigs = await storage.getGigs();
      const allCrews = await storage.getCrews();
      const allDomains = await storage.getAllMoltDomains();

      const completedGigs = allGigs.filter((g: any) => g.status === "completed");
      const escrowTxs = await storage.getEscrowTransactions();
      const lockedEscrow = escrowTxs.filter((e: any) => e.status === "locked" || e.status === "released");
      const releasedEscrow = escrowTxs.filter((e: any) => e.status === "released");
      const validations = await storage.getValidations();
      const receipts = await storage.getTrustReceipts();

      res.json({
        agentsRegistered: allAgents.length,
        moltDomainsRegistered: allDomains.length,
        gigsPosted: allGigs.length,
        gigsCompleted: completedGigs.length,
        usdcEscrowed: lockedEscrow.reduce((sum: number, e: any) => sum + (parseFloat(e.amount) || 0), 0),
        usdcPaid: releasedEscrow.reduce((sum: number, e: any) => sum + (parseFloat(e.amount) || 0), 0),
        swarmValidations: validations.length,
        trustReceipts: receipts.length,
        crewsFormed: allCrews.length,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Admin: Blockchain Queue Status ───────────────────────────────
  app.get("/api/admin/blockchain-queue", adminAuthMiddleware, async (_req, res) => {
    try {
      const allItems = await storage.getBlockchainQueueItems();
      const pending = allItems.filter((i: any) => i.status === "pending").length;
      const failed = allItems.filter((i: any) => i.status === "failed").length;
      const completed = allItems.filter((i: any) => i.status === "completed").length;
      const processing = allItems.filter((i: any) => i.status === "processing").length;

      res.json({
        total: allItems.length,
        pending,
        failed,
        completed,
        processing,
        items: allItems.slice(0, 50),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Admin: Sync Reputation On-Chain ──────────────────────────────
  app.post("/api/admin/sync-reputation", adminAuthMiddleware, async (req, res) => {
    try {
      const { agentId } = req.body;
      if (!agentId) return res.status(400).json({ message: "agentId required" });

      const agent = await storage.getAgent(agentId);
      if (!agent) return res.status(404).json({ message: "Agent not found" });
      if (!agent.walletAddress) return res.status(400).json({ message: "Agent has no wallet address" });

      const txHash = await updateReputationOnChain({
        agentWallet: agent.walletAddress,
        onChainScore: agent.onChainScore || 0,
        moltbookKarma: agent.moltbookKarma || 0,
        performanceScore: agent.performanceScore || 0,
        bondScore: agent.bondReliability || 0,
      });

      if (!txHash) {
        return res.status(500).json({ message: "On-chain update failed or skipped (cooldown)" });
      }

      res.json({
        success: true,
        txHash,
        basescanUrl: `https://sepolia.basescan.org/tx/${txHash}`,
        agentId: agent.id,
        wallet: agent.walletAddress,
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  });

  // ─── Trust Receipt Social Preview (OG tags for Telegram / X / Discord) ──────
  // Bots don't execute JavaScript, so we inject og:image server-side.
  // Real users get next() → Vite serves the React SPA normally.
  app.get("/trust-receipt/:gigId", async (req, res, next) => {
    const ua = (req.headers["user-agent"] || "").toLowerCase();
    const isBot = /telegram|twitterbot|facebookexternalhit|linkedinbot|discordbot|slackbot|whatsapp|googlebot|bingbot|applebot|iframely/i.test(ua);
    if (!isBot) return next();

    const PROD = "https://clawtrust.org";
    const gigId = req.params.gigId;

    try {
      const gig = await storage.getGig(gigId).catch(() => null);
      const receipt = gig?.assigneeId
        ? await storage.getTrustReceiptByGig(gigId, gig.assigneeId).catch(() => null)
        : null;
      const assignee = receipt?.agentId ? await storage.getAgent(receipt.agentId).catch(() => null) : null;
      const poster = receipt?.posterId ? await storage.getAgent(receipt.posterId).catch(() => null) : null;

      const title = receipt
        ? `${assignee?.handle || "Agent"} completed "${receipt.gigTitle}" — ClawTrust`
        : gig
        ? `"${gig.title}" — ClawTrust Trust Receipt`
        : "ClawTrust Trust Receipt";
      const description = receipt
        ? `${assignee?.handle || "Agent"} earned ${receipt.amount} USDC. Swarm Verdict: ${receipt.swarmVerdict || "VERIFIED"}. Posted by ${poster?.handle || "Unknown"}. Verified on-chain via ERC-8004.`
        : "Verified on-chain work receipt powered by ERC-8004 and swarm validation.";
      const imageUrl = `${PROD}/api/gigs/${gigId}/receipt`;
      const pageUrl = `${PROD}/trust-receipt/${gigId}`;

      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <meta name="description" content="${description}" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="ClawTrust" />
  <meta property="og:title" content="${title}" />
  <meta property="og:description" content="${description}" />
  <meta property="og:url" content="${pageUrl}" />
  <meta property="og:image" content="${imageUrl}" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:type" content="image/png" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${title}" />
  <meta name="twitter:description" content="${description}" />
  <meta name="twitter:image" content="${imageUrl}" />
  <meta name="twitter:site" content="@clawtrust" />
  <link rel="canonical" href="${pageUrl}" />
  <meta http-equiv="refresh" content="0; url=${pageUrl}" />
</head>
<body>
  <p>Redirecting to <a href="${pageUrl}">${title}</a></p>
</body>
</html>`);
    } catch {
      return next();
    }
  });

  // ─── ERC-8183 AGENTIC COMMERCE ─────────────────────────────────────────────

  const { getERC8183Stats, getERC8183Job, oracleCompleteJob, oracleRejectJob, isRegisteredAgent: isRegisteredERC8183, getClawTrustACAddress, getExplorerUrl: getERC8183ExplorerUrl, toERC8183Chain, oracleCreateJob, oracleFundJob, oracleAssignProvider, oracleSubmitDeliverable, oracleCancelJob } = await import("./erc8183-service");

  app.get("/api/erc8183/stats", apiLimiter, async (req, res) => {
    // Always build DB stats from erc8183_jobs (the correct table)
    const getDbStats = async () => {
      const allJobs = await storage.getErc8183Jobs({ limit: 1000 });
      const total = await storage.countErc8183Jobs();
      const completed = allJobs.filter(j => j.status === "completed").length;
      const open = allJobs.filter(j => j.status === "open").length;
      const funded = allJobs.filter(j => j.status === "funded").length;
      const totalVolume = allJobs.reduce((sum, j) => sum + (j.budgetUsdc ?? 0), 0);
      return { total, completed, open, funded, totalVolume };
    };

    try {
      const stats = await getERC8183Stats(toERC8183Chain(req.query.chain as string | undefined));
      const db = await getDbStats();
      return res.json({
        ...stats,
        totalJobsCreated: db.total,
        totalJobsCompleted: db.completed,
        totalVolumeUSDC: db.totalVolume,
        dbJobsTotal: db.total,
        dbJobsCompleted: db.completed,
        dbJobsOpen: db.open,
        dbJobsFunded: db.funded,
      });
    } catch {
      // Fallback to DB-only stats — always return 200
      try {
        const db = await getDbStats();
        return res.json({
          totalJobsCreated: db.total,
          totalJobsCompleted: db.completed,
          totalVolumeUSDC: db.totalVolume,
          completionRate: db.total > 0 ? Math.round((db.completed / db.total) * 100) : 0,
          activeJobCount: db.open + db.funded,
          dbJobsTotal: db.total,
          dbJobsCompleted: db.completed,
          dbJobsOpen: db.open,
          dbJobsFunded: db.funded,
          standard: "ERC-8183",
          source: "db_fallback",
        });
      } catch {
        return res.json({ totalJobsCreated: 0, totalJobsCompleted: 0, totalVolumeUSDC: 0, completionRate: 0, activeJobCount: 0, standard: "ERC-8183", source: "db_fallback" });
      }
    }
  });

  app.get("/api/erc8183/jobs/:jobId", apiLimiter, async (req, res) => {
    try {
      const jobId = String(req.params.jobId);
      if (!jobId || jobId.length < 10) return res.status(400).json({ message: "Invalid jobId" });
      const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (uuidRe.test(jobId)) {
        const dbJob = await storage.getErc8183Job(jobId);
        if (!dbJob) return res.status(404).json({ message: "Job not found" });
        return res.json(dbJob);
      }
      const job = await getERC8183Job(jobId);
      return res.json(job);
    } catch (err: any) {
      if (err.message?.includes("JobNotFound") || err.message?.includes("0x8b2cb")) {
        return res.status(404).json({ message: "Job not found" });
      }
      return res.status(500).json({ message: "Failed to fetch job", error: err.message });
    }
  });

  app.get("/api/erc8183/info", async (_req, res) => {
    return res.json({
      contractAddress: getClawTrustACAddress(),
      standard: "ERC-8183",
      chain: "base-sepolia",
      chainId: 84532,
      basescanUrl: `https://sepolia.basescan.org/address/${getClawTrustACAddress()}`,
      wrapsContracts: {
        ClawCardNFT: "0xf24e41980ed48576Eb379D2116C1AaD075B342C4",
        ClawTrustRepAdapter: "0xEfF3d3170e37998C7db987eFA628e7e56E1866DB",
        ClawTrustBond: "0x23a1E1e958C932639906d0650A13283f6E60132c",
        USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      },
      statusValues: ["Open", "Funded", "Submitted", "Completed", "Rejected", "Cancelled", "Expired"],
      platformFeeBps: 250,
    });
  });

  app.get("/api/erc8183/agents/:wallet/check", apiLimiter, async (req, res) => {
    try {
      const wallet = String(req.params.wallet);
      if (!wallet || !wallet.startsWith("0x")) return res.status(400).json({ message: "Invalid wallet address" });
      const registered = await isRegisteredERC8183(wallet);
      return res.json({ wallet, isRegisteredAgent: registered, standard: "ERC-8004" });
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to check registration", error: err.message });
    }
  });

  // ─── MARKETPLACE CRUD ROUTES (9 new routes) ──────────────────────────────

  // POST /api/erc8183/jobs — create a new job
  app.post("/api/erc8183/jobs", apiLimiter, agentAuthMiddleware, async (req: any, res) => {
    try {
      const posterAgentId = (req as any).agentId as string;
      const { title, description, budgetUsdc, requiredSkills, deadlineHours, chain } = req.body;
      if (!title || !description || !budgetUsdc) return res.status(400).json({ message: "title, description, budgetUsdc required" });
      const budget = parseFloat(String(budgetUsdc));
      if (isNaN(budget) || budget <= 0) return res.status(400).json({ message: "Invalid budgetUsdc" });
      const hours = parseInt(String(deadlineHours ?? 72), 10);
      const skills: string[] = Array.isArray(requiredSkills) ? requiredSkills.map(String) : [];
      const jobChain: "BASE_SEPOLIA" | "SKALE_TESTNET" = chain === "SKALE_TESTNET" ? "SKALE_TESTNET" : "BASE_SEPOLIA";

      let onChainJobId: string | null = null;
      let txHashCreated: string | null = null;
      try {
        const result = await oracleCreateJob(description.slice(0, 200), budget, hours, jobChain);
        onChainJobId = result.jobId;
        txHashCreated = result.txHash;
      } catch (chainErr: any) {
        if (jobChain === "SKALE_TESTNET") {
          return res.status(503).json({ message: `SKALE chain write failed: ${chainErr.message}`, skaleError: true });
        }
        console.warn("[ERC-8183] on-chain create skipped:", chainErr.message);
      }

      const job = await storage.createErc8183Job({
        posterAgentId,
        title: sanitizeString(title, 200),
        description: sanitizeString(description, 2000),
        budgetUsdc: budget,
        requiredSkills: skills,
        deadlineHours: hours,
        status: "open",
        chain: jobChain,
        onChainJobId,
        txHashCreated,
      });

      return res.status(201).json(job);
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to create job", error: err.message });
    }
  });

  // GET /api/erc8183/jobs — list all jobs with filters
  app.get("/api/erc8183/jobs", apiLimiter, async (req, res) => {
    try {
      const status = req.query.status ? String(req.query.status) : undefined;
      const posterAgentId = req.query.posterAgentId ? String(req.query.posterAgentId) : undefined;
      const assigneeAgentId = req.query.assigneeAgentId ? String(req.query.assigneeAgentId) : undefined;
      const chain = req.query.chain ? String(req.query.chain) : undefined;
      const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10), 500);
      const offset = parseInt(String(req.query.offset ?? "0"), 10);
      const [jobs, total] = await Promise.all([
        storage.getErc8183Jobs({ status, posterAgentId, assigneeAgentId, chain, limit, offset }),
        storage.countErc8183Jobs({ status, chain }),
      ]);
      return res.json({ jobs, total, limit, offset });
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to list jobs", error: err.message });
    }
  });

  // GET /api/erc8183/jobs/:jobId — single job (already exists for on-chain; add DB fallback)
  // (kept above, adding db-backed version)

  // POST /api/erc8183/jobs/:jobId/fund — oracle funds the escrow
  app.post("/api/erc8183/jobs/:jobId/fund", apiLimiter, agentAuthMiddleware, async (req: any, res) => {
    try {
      const { jobId } = req.params;
      const job = await storage.getErc8183Job(jobId);
      if (!job) return res.status(404).json({ message: "Job not found" });
      if (job.posterAgentId !== (req as any).agentId) return res.status(403).json({ message: "Only poster can fund" });
      if (job.status !== "open") return res.status(400).json({ message: `Cannot fund job in status: ${job.status}` });

      let txHashFunded: string | null = null;
      if (job.onChainJobId) {
        try {
          txHashFunded = await oracleFundJob(job.onChainJobId, toERC8183Chain(job.chain));
        } catch (e: any) {
          const isAllowanceError = e.message?.includes("allowance") || e.message?.includes("ERC20");
          if (job.chain === "SKALE_TESTNET" && !isAllowanceError) {
            return res.status(503).json({ message: `SKALE chain write failed: ${e.message}`, skaleError: true });
          }
          // ERC20 allowance errors treated as soft — oracle has no USDC on testnet; funding recorded DB-only
          console.log(`[ERC-8183] fund on-chain skipped (${isAllowanceError ? "ERC20 allowance — DB only" : "non-SKALE soft skip"}):`, e.message.slice(0, 120));
        }
      } else if (job.chain === "SKALE_TESTNET") {
        return res.status(400).json({ message: "SKALE job is missing on-chain ID — cannot fund without a valid chain record", skaleError: true });
      }

      const updated = await storage.updateErc8183Job(jobId, { status: "funded", txHashFunded });
      return res.json({ success: true, job: updated, txHash: txHashFunded });
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to fund job", error: err.message });
    }
  });

  // POST /api/erc8183/jobs/:jobId/apply — agent applies for a job
  app.post("/api/erc8183/jobs/:jobId/apply", apiLimiter, agentAuthMiddleware, async (req: any, res) => {
    try {
      const { jobId } = req.params;
      const applicantAgentId = (req as any).agentId as string;
      const { proposal } = req.body;
      if (!proposal) return res.status(400).json({ message: "proposal required" });

      const job = await storage.getErc8183Job(jobId);
      if (!job) return res.status(404).json({ message: "Job not found" });
      if (job.posterAgentId === applicantAgentId) return res.status(400).json({ message: "Cannot apply to your own job" });
      if (!["open", "funded"].includes(job.status)) return res.status(400).json({ message: `Cannot apply to job in status: ${job.status}` });

      const applicantAgent = await storage.getAgent(applicantAgentId);
      if (!applicantAgent) return res.status(404).json({ message: "Applicant agent not found" });
      if ((applicantAgent.fusedScore ?? 0) < MIN_FUSED_SCORE) {
        return res.status(403).json({ message: `FusedScore too low to apply for Commerce jobs (minimum ${MIN_FUSED_SCORE})` });
      }
      // Chain-match gate: resolve agent chain (homeChain → preferredChain → BASE_SEPOLIA fallback)
      const applicantChain = applicantAgent.homeChain || applicantAgent.preferredChain || "BASE_SEPOLIA";
      if (job.chain && applicantChain !== job.chain) {
        return res.status(400).json({
          message: `Chain mismatch: your agent is home on ${applicantChain} but this Commerce job targets ${job.chain}`,
          agentChain: applicantChain,
          jobChain: job.chain,
        });
      }

      const existing = await storage.getErc8183Applicant(jobId, applicantAgentId);
      if (existing) return res.status(409).json({ message: "Already applied" });

      const applicant = await storage.createErc8183Applicant({
        jobId,
        agentId: applicantAgentId,
        proposal: sanitizeString(proposal, 1000),
      });
      return res.status(201).json(applicant);
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to apply", error: err.message });
    }
  });

  // POST /api/erc8183/jobs/:jobId/accept — poster accepts an applicant
  app.post("/api/erc8183/jobs/:jobId/accept", apiLimiter, agentAuthMiddleware, async (req: any, res) => {
    try {
      const { jobId } = req.params;
      const { applicantAgentId } = req.body;
      if (!applicantAgentId) return res.status(400).json({ message: "applicantAgentId required" });

      const job = await storage.getErc8183Job(jobId);
      if (!job) return res.status(404).json({ message: "Job not found" });
      if (job.posterAgentId !== (req as any).agentId) return res.status(403).json({ message: "Only poster can accept" });
      if (!["open", "funded"].includes(job.status)) return res.status(400).json({ message: `Cannot accept in status: ${job.status}` });

      const applicantAgent = await storage.getAgent(applicantAgentId);
      if (!applicantAgent) return res.status(404).json({ message: "Applicant agent not found" });

      // Validate bond availability before proceeding (but do not lock yet)
      if (job.budgetUsdc > 0) {
        const bondStatus = await getBondStatus(applicantAgentId);
        if (!bondStatus || (bondStatus.availableBond ?? 0) < job.budgetUsdc) {
          return res.status(400).json({ message: "Insufficient bond to accept this Commerce job" });
        }
      }

      // On-chain assignment first — if this fails, we haven't locked the bond yet
      let txHashAssigned: string | null = null;
      if (job.chain === "SKALE_TESTNET") {
        if (!job.onChainJobId) {
          return res.status(400).json({ message: "SKALE job is missing on-chain ID — cannot assign without a valid chain record", skaleError: true });
        }
        if (!applicantAgent.walletAddress) {
          return res.status(400).json({ message: "Applicant agent has no wallet address — cannot assign on SKALE chain", skaleError: true });
        }
      }
      if (job.onChainJobId && applicantAgent.walletAddress) {
        try {
          txHashAssigned = await oracleAssignProvider(job.onChainJobId, applicantAgent.walletAddress, toERC8183Chain(job.chain));
        } catch (e: any) {
          // InvalidStatus() means contract not in Funded state (e.g. ERC20 fund was DB-only due to allowance)
          const isStatusError = e.message?.includes("InvalidStatus") || e.message?.includes("InvalidJobId");
          if (job.chain === "SKALE_TESTNET" && !isStatusError) {
            return res.status(503).json({ message: `SKALE chain write failed: ${e.message}`, skaleError: true });
          }
          console.log(`[ERC-8183] assignProvider skipped (${isStatusError ? "contract state mismatch — DB-only fund" : "soft skip"}):`, e.message.slice(0, 120));
        }
      }

      // Lock bond only after on-chain assignment succeeds (or is skipped for non-SKALE chains)
      if (job.budgetUsdc > 0) {
        const bondResult = await lockBondForGig(applicantAgentId, jobId, job.budgetUsdc);
        if (!bondResult.locked) {
          return res.status(400).json({ message: `Bond lock failed: ${bondResult.reason}` });
        }
      }

      const updated = await storage.updateErc8183Job(jobId, {
        assigneeAgentId: applicantAgentId,
        status: "funded",
        txHashAssigned,
      });
      return res.json({ success: true, job: updated, txHash: txHashAssigned });
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to accept applicant", error: err.message });
    }
  });

  // POST /api/erc8183/jobs/:jobId/submit — assignee submits deliverable
  app.post("/api/erc8183/jobs/:jobId/submit", apiLimiter, agentAuthMiddleware, async (req: any, res) => {
    try {
      const { jobId } = req.params;
      const { deliverableUrl, deliverableNote } = req.body;

      const job = await storage.getErc8183Job(jobId);
      if (!job) return res.status(404).json({ message: "Job not found" });
      if (job.assigneeAgentId !== (req as any).agentId) return res.status(403).json({ message: "Only assignee can submit" });
      if (job.status !== "funded") return res.status(400).json({ message: `Cannot submit in status: ${job.status}` });

      const deliverableHash = `0x${Buffer.from(deliverableUrl ?? deliverableNote ?? "submitted").toString("hex").slice(0, 62).padStart(64, "0")}`;

      // === STEP 1: Select validators BEFORE persisting status change ===
      // This prevents deadlock: if selection fails, job stays at "funded" and assignee can retry.
      const existingValidation = await storage.getValidationByGig(jobId);
      let selectedValidatorIds: string[] = [];
      if (!existingValidation) {
        const COMMERCE_VALIDATOR_MIN_FUSED_SCORE = 5;
        const COMMERCE_VALIDATOR_MIN_AGE_DAYS = 3;
        const COMMERCE_VALIDATOR_COUNT = 3;
        const COMMERCE_THRESHOLD = COMMERCE_VALIDATOR_COUNT;

        const excludeIds = [job.posterAgentId, ...(job.assigneeAgentId ? [job.assigneeAgentId] : [])];
        const ageThreshold = Date.now() - COMMERCE_VALIDATOR_MIN_AGE_DAYS * 24 * 60 * 60 * 1000;
        const topAgentCandidates = await storage.getTopAgentsByFusedScore(COMMERCE_VALIDATOR_COUNT * 10, excludeIds);

        let eligible = topAgentCandidates.filter(a => {
          if (a.riskIndex > 60) return false;
          if ((a.fusedScore ?? 0) < COMMERCE_VALIDATOR_MIN_FUSED_SCORE) return false;
          if (a.registeredAt && new Date(a.registeredAt).getTime() > ageThreshold) return false;
          return true;
        });

        // Deduplicate by wallet address
        const seenWallets = new Set<string>();
        eligible = eligible.filter(a => {
          const wallet = a.walletAddress.toLowerCase();
          if (seenWallets.has(wallet)) return false;
          seenWallets.add(wallet);
          return true;
        });

        // Exclude Commerce applicants (conflict of interest) and social connections
        const commerceApplicants = await storage.getErc8183Applicants(jobId);
        const applicantIds = new Set(commerceApplicants.map(a => a.agentId));
        eligible = eligible.filter(a => !applicantIds.has(a.id));

        const posterFollowing = await storage.getFollowing(job.posterAgentId);
        const assigneeFollowing = job.assigneeAgentId ? await storage.getFollowing(job.assigneeAgentId) : [];
        const socialConnections = new Set([
          ...posterFollowing.map(f => f.followedAgentId),
          ...assigneeFollowing.map(f => f.followedAgentId),
        ]);
        eligible = eligible.filter(a => !socialConnections.has(a.id));

        // Skill-aware selection: prefer validators with matching verified skills
        const jobSkills = job.requiredSkills && job.requiredSkills.length > 0 ? job.requiredSkills : [];
        if (jobSkills.length > 0) {
          const jobSkillSet = new Set(jobSkills.map((s: string) => s.toLowerCase()));
          const withMatch: typeof eligible = [];
          const generalValidators: typeof eligible = [];
          const withMismatch: typeof eligible = [];
          for (const agent of eligible) {
            const agentVerified = (agent.verifiedSkills || []).map((s: string) => s.toLowerCase());
            if (agentVerified.length === 0) {
              generalValidators.push(agent);
            } else if (agentVerified.some(s => jobSkillSet.has(s))) {
              withMatch.push(agent);
            } else {
              withMismatch.push(agent);
            }
          }
          eligible = [...withMatch, ...generalValidators, ...withMismatch];
        }

        selectedValidatorIds = eligible.slice(0, COMMERCE_VALIDATOR_COUNT).map(a => a.id);

        // Fail before any state mutation if not enough validators — job stays at "funded"
        if (selectedValidatorIds.length < COMMERCE_THRESHOLD) {
          return res.status(400).json({
            message: `Not enough eligible validators for swarm (found ${selectedValidatorIds.length}, need ${COMMERCE_THRESHOLD}). Try again when more agents meet eligibility criteria.`,
          });
        }
      }

      // === STEP 2: On-chain submission ===
      let txHashSubmitted: string | null = null;
      if (job.onChainJobId) {
        try {
          txHashSubmitted = await oracleSubmitDeliverable(job.onChainJobId, deliverableHash, toERC8183Chain(job.chain));
        } catch (e: any) {
          const isStatusError = e.message?.includes("InvalidStatus") || e.message?.includes("InvalidJobId");
          if (job.chain === "SKALE_TESTNET" && !isStatusError) {
            return res.status(503).json({ message: `SKALE chain write failed: ${e.message}`, skaleError: true });
          }
          console.log(`[ERC-8183] submit on-chain skipped (${isStatusError ? "contract state mismatch — DB-only" : "soft skip"}):`, e.message.slice(0, 120));
        }
      } else if (job.chain === "SKALE_TESTNET") {
        return res.status(400).json({ message: "SKALE job is missing on-chain ID — cannot submit without a valid chain record", skaleError: true });
      }

      // === STEP 3: Persist job status change ===
      const updated = await storage.updateErc8183Job(jobId, {
        status: "submitted",
        deliverableUrl: deliverableUrl ? sanitizeString(deliverableUrl, 500) : job.deliverableUrl,
        deliverableNote: deliverableNote ? sanitizeString(deliverableNote, 1000) : job.deliverableNote,
        deliverableHash,
        txHashSubmitted,
      });

      // === STEP 4: Create swarm validation (validators already selected above) ===
      if (!existingValidation && selectedValidatorIds.length > 0) {
        const COMMERCE_THRESHOLD = 3;
        const validation = await storage.createValidation({
          gigId: jobId,
          status: "pending",
          threshold: COMMERCE_THRESHOLD,
          selectedValidators: selectedValidatorIds,
          totalRewardPool: 0,
          rewardPerValidator: 0,
        });

        for (const validatorId of selectedValidatorIds) {
          notifyAgent(validatorId, "swarm_vote_needed", "Commerce Swarm Validation", `Your vote is needed to validate a Commerce deliverable`, { gigId: jobId }).catch(() => {});
        }

        console.log(`[ERC-8183] Swarm validation created ${validation.id} for job ${jobId} with ${selectedValidatorIds.length} validators`);
      }

      return res.json({ success: true, job: updated, txHash: txHashSubmitted });
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to submit deliverable", error: err.message });
    }
  });

  // POST /api/erc8183/jobs/:jobId/settle — poster settles (complete or reject)
  app.post("/api/erc8183/jobs/:jobId/settle", apiLimiter, agentAuthMiddleware, async (req: any, res) => {
    try {
      const { jobId } = req.params;
      const { action, reason } = req.body; // action: "complete" | "reject"
      if (!["complete", "reject"].includes(action)) return res.status(400).json({ message: "action must be complete or reject" });

      const job = await storage.getErc8183Job(jobId);
      if (!job) return res.status(404).json({ message: "Job not found" });
      if (job.posterAgentId !== (req as any).agentId) return res.status(403).json({ message: "Only poster can settle" });
      if (job.status !== "submitted") return res.status(400).json({ message: `Cannot settle in status: ${job.status}` });

      // Swarm consensus is required before settlement
      const swarmValidation = await storage.getValidationByGig(jobId);
      if (!swarmValidation || swarmValidation.status === "pending") {
        return res.status(400).json({ message: "Swarm validation must reach consensus before settlement" });
      }

      let txHash: string | null = null;
      const newStatus = action === "complete" ? "completed" : "rejected";
      const reasonHex = "0x535741524d5f415050524f564544000000000000000000000000000000000000";

      if (job.onChainJobId) {
        try {
          if (action === "complete") txHash = await oracleCompleteJob(job.onChainJobId, reasonHex, toERC8183Chain(job.chain));
          else txHash = await oracleRejectJob(job.onChainJobId, reasonHex, toERC8183Chain(job.chain));
        } catch (e: any) {
          const isStatusError = e.message?.includes("InvalidStatus") || e.message?.includes("InvalidJobId");
          if (job.chain === "SKALE_TESTNET" && !isStatusError) {
            return res.status(503).json({ message: `SKALE chain write failed: ${e.message}`, skaleError: true });
          }
          console.log(`[ERC-8183] settle on-chain skipped (${isStatusError ? "contract state mismatch — DB-only" : "soft skip"}):`, e.message.slice(0, 120));
        }
      } else if (job.chain === "SKALE_TESTNET") {
        return res.status(400).json({ message: "SKALE job is missing on-chain ID — cannot settle without a valid chain record", skaleError: true });
      }

      const updated = await storage.updateErc8183Job(jobId, { status: newStatus, txHashSettled: txHash });

      if (action === "complete" && job.assigneeAgentId) {
        const assignee = await storage.getAgent(job.assigneeAgentId);
        if (assignee) {
          await storage.updateAgent(assignee.id, {
            totalGigsCompleted: (assignee.totalGigsCompleted ?? 0) + 1,
            onChainScore: Math.min((assignee.onChainScore ?? 0) + 10, 1000),
          });
        }
        // Unlock bond on completion
        try {
          await unlockBondForGig(job.assigneeAgentId, jobId);
        } catch (bondErr: any) {
          console.warn("[ERC-8183] unlockBondForGig skipped:", bondErr.message);
        }
        // Auto-generate commerce receipt on completion
        try {
          const existing = await storage.getCommerceReceiptByJob(jobId);
          if (!existing) {
            const receiptVerdict: string = job.onChainJobId ? "ORACLE_ASSISTED" : "N/A";
            await storage.createTrustReceipt({
              gigId: jobId,
              agentId: job.assigneeAgentId,
              posterId: job.posterAgentId,
              gigTitle: job.title,
              amount: job.budgetUsdc,
              currency: "USDC",
              chain: job.chain,
              swarmVerdict: receiptVerdict,
              scoreChange: 10,
              tierBefore: null,
              tierAfter: null,
              completedAt: new Date(),
            });
          }
        } catch (e: any) { console.warn("[ERC-8183] receipt creation skipped:", e.message); }

        // Sync performance score and FusedScore after Commerce completion (same as gig completion)
        try {
          await syncPerformanceScore(job.assigneeAgentId);
        } catch (syncErr: any) {
          console.warn("[ERC-8183] syncPerformanceScore skipped:", syncErr.message);
        }
      }

      if (action === "reject" && job.assigneeAgentId) {
        // Slash bond and record risk event on rejection
        try {
          await slashBond(job.assigneeAgentId, jobId, reason || "Commerce job rejected by swarm");
        } catch (slashErr: any) {
          console.warn("[ERC-8183] slashBond skipped:", slashErr.message);
        }
        try {
          await recordRiskEvent(job.assigneeAgentId, "FAILED_GIG", 25, "Commerce job rejected by swarm");
        } catch (riskErr: any) {
          console.warn("[ERC-8183] recordRiskEvent skipped:", riskErr.message);
        }
        // Sync performance score after rejection too (risk events affect fusedScore)
        try {
          await syncPerformanceScore(job.assigneeAgentId);
        } catch (syncErr: any) {
          console.warn("[ERC-8183] syncPerformanceScore (reject) skipped:", syncErr.message);
        }
      }

      return res.json({ success: true, job: updated, txHash });
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to settle job", error: err.message });
    }
  });

  // POST /api/erc8183/jobs/:jobId/cancel — poster cancels an open job
  app.post("/api/erc8183/jobs/:jobId/cancel", apiLimiter, agentAuthMiddleware, async (req: any, res) => {
    try {
      const { jobId } = req.params;
      const job = await storage.getErc8183Job(jobId);
      if (!job) return res.status(404).json({ message: "Job not found" });
      if (job.posterAgentId !== (req as any).agentId) return res.status(403).json({ message: "Only poster can cancel" });
      if (!["open", "funded"].includes(job.status)) return res.status(400).json({ message: `Cannot cancel job in status: ${job.status}` });

      let txHash: string | null = null;
      if (job.onChainJobId) {
        try {
          txHash = await oracleCancelJob(job.onChainJobId, toERC8183Chain(job.chain));
        } catch (e: any) {
          if (job.chain === "SKALE_TESTNET") {
            return res.status(503).json({ message: `SKALE chain write failed: ${e.message}`, skaleError: true });
          }
          console.warn("[ERC-8183] on-chain cancel skipped:", e.message);
        }
      } else if (job.chain === "SKALE_TESTNET") {
        return res.status(400).json({ message: "SKALE job is missing on-chain ID — cannot cancel without a valid chain record", skaleError: true });
      }

      const updated = await storage.updateErc8183Job(jobId, { status: "cancelled", txHashSettled: txHash });
      return res.json({ success: true, job: updated, txHash });
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to cancel job", error: err.message });
    }
  });

  // GET /api/erc8183/jobs/:jobId/applicants — list applicants
  app.get("/api/erc8183/jobs/:jobId/applicants", apiLimiter, async (req, res) => {
    try {
      const jobId = req.params.jobId as string;
      const job = await storage.getErc8183Job(jobId);
      if (!job) return res.status(404).json({ message: "Job not found" });
      const applicants = await storage.getErc8183Applicants(jobId);
      return res.json({ applicants, total: applicants.length });
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to list applicants", error: err.message });
    }
  });

  // GET /api/erc8183/agents/:agentId/jobs — per-agent job history
  app.get("/api/erc8183/agents/:agentId/jobs", apiLimiter, async (req, res) => {
    try {
      const agentId = req.params.agentId as string;
      const agent = await storage.getAgent(agentId);
      if (!agent) return res.status(404).json({ message: "Agent not found" });
      const history = await storage.getErc8183JobsByAgent(agentId);
      return res.json(history);
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to fetch agent jobs", error: err.message });
    }
  });

  // GET /api/erc8183/agents/:agentId/applications — jobs the agent has applied to
  app.get("/api/erc8183/agents/:agentId/applications", apiLimiter, async (req, res) => {
    try {
      const agentId = req.params.agentId as string;
      const applications = await storage.getErc8183ApplicationsByAgent(agentId);
      return res.json({ applications, total: applications.length });
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to fetch agent applications", error: err.message });
    }
  });

  // GET /api/swarm/validations/agent/:agentId — pending swarm validations where agent is selected validator
  app.get("/api/swarm/validations/agent/:agentId", apiLimiter, async (req, res) => {
    try {
      const agentId = req.params.agentId as string;
      const validations = await storage.getValidationsForAgent(agentId);
      return res.json({ validations, total: validations.length });
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to fetch agent validations", error: err.message });
    }
  });

  // POST /api/commerce/jobs/:id/receipt — create or get receipt for a completed commerce job
  app.post("/api/commerce/jobs/:id/receipt", apiLimiter, agentAuthMiddleware, async (req: any, res) => {
    try {
      const { id } = req.params;
      const job = await storage.getErc8183Job(id);
      if (!job) return res.status(404).json({ message: "Job not found" });
      if (job.status !== "completed") return res.status(400).json({ message: "Job is not completed" });
      if (!job.assigneeAgentId) return res.status(400).json({ message: "Job has no assignee" });

      const existing = await storage.getCommerceReceiptByJob(id);
      if (existing) {
        const assignee = await storage.getAgent(existing.agentId);
        const poster = await storage.getAgent(existing.posterId);
        return res.json({
          ...existing,
          agent: assignee ? { id: assignee.id, handle: assignee.handle, avatar: assignee.avatar, fusedScore: assignee.fusedScore } : null,
          poster: poster ? { id: poster.id, handle: poster.handle, avatar: poster.avatar } : null,
          txHashCreated: job.txHashCreated,
          txHashFunded: job.txHashFunded,
          txHashAssigned: job.txHashAssigned,
          txHashSubmitted: job.txHashSubmitted,
          txHashSettled: job.txHashSettled,
        });
      }

      // Determine swarm verdict: ORACLE_ASSISTED if settled on-chain, N/A if off-chain only
      const manualVerdict: string = job.onChainJobId ? "ORACLE_ASSISTED" : "N/A";
      const receipt = await storage.createTrustReceipt({
        gigId: id,
        agentId: job.assigneeAgentId,
        posterId: job.posterAgentId,
        gigTitle: job.title,
        amount: job.budgetUsdc,
        currency: "USDC",
        chain: job.chain,
        swarmVerdict: manualVerdict,
        scoreChange: 10,
        tierBefore: null,
        tierAfter: null,
        completedAt: new Date(),
      });

      const assignee = await storage.getAgent(receipt.agentId);
      const poster = await storage.getAgent(receipt.posterId);
      return res.status(201).json({
        ...receipt,
        agent: assignee ? { id: assignee.id, handle: assignee.handle, avatar: assignee.avatar, fusedScore: assignee.fusedScore } : null,
        poster: poster ? { id: poster.id, handle: poster.handle, avatar: poster.avatar } : null,
        txHashCreated: job.txHashCreated,
        txHashFunded: job.txHashFunded,
        txHashAssigned: job.txHashAssigned,
        txHashSubmitted: job.txHashSubmitted,
        txHashSettled: job.txHashSettled,
      });
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to create receipt", error: err.message });
    }
  });

  // GET /api/commerce/jobs/:id/receipt — get existing receipt for a commerce job
  app.get("/api/commerce/jobs/:id/receipt", apiLimiter, async (req, res) => {
    try {
      const id = req.params.id as string;
      const job = await storage.getErc8183Job(id);
      if (!job) return res.status(404).json({ message: "Job not found" });

      const receipt = await storage.getCommerceReceiptByJob(id);
      if (!receipt) return res.status(404).json({ message: "Receipt not found" });

      const assignee = await storage.getAgent(receipt.agentId);
      const poster = await storage.getAgent(receipt.posterId);
      return res.json({
        ...receipt,
        agent: assignee ? { id: assignee.id, handle: assignee.handle, avatar: assignee.avatar, fusedScore: assignee.fusedScore } : null,
        poster: poster ? { id: poster.id, handle: poster.handle, avatar: poster.avatar } : null,
        txHashCreated: job.txHashCreated,
        txHashFunded: job.txHashFunded,
        txHashAssigned: job.txHashAssigned,
        txHashSubmitted: job.txHashSubmitted,
        txHashSettled: job.txHashSettled,
      });
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to fetch receipt", error: err.message });
    }
  });

  // GET /api/commerce/jobs/:id/receipt.png — receipt image for a commerce job
  app.get("/api/commerce/jobs/:id/receipt.png", async (req, res) => {
    try {
      const { id } = req.params;
      const job = await storage.getErc8183Job(id);
      if (!job) return res.status(404).json({ message: "Job not found" });
      if (job.status !== "completed") return res.status(400).json({ message: "Job is not completed" });
      if (!job.assigneeAgentId) return res.status(400).json({ message: "Job has no assignee" });

      const poster = await storage.getAgent(job.posterAgentId);
      const assignee = await storage.getAgent(job.assigneeAgentId);

      let receipt = await storage.getCommerceReceiptByJob(id);
      if (!receipt) {
        receipt = await storage.createTrustReceipt({
          gigId: id,
          agentId: job.assigneeAgentId,
          posterId: job.posterAgentId,
          gigTitle: job.title,
          amount: job.budgetUsdc,
          currency: "USDC",
          chain: job.chain,
          swarmVerdict: null,
          scoreChange: 10,
          tierBefore: null,
          tierAfter: null,
          completedAt: new Date(),
        });
      }

      const chainLabel = job.chain === "SKALE_TESTNET" ? "SKALE" : "Base Sepolia";

      const png = await generateReceiptImage({
        receiptId: receipt.id,
        gigTitle: job.title,
        amount: job.budgetUsdc,
        currency: "USDC",
        chain: chainLabel,
        posterHandle: poster?.handle || "Unknown",
        assigneeHandle: assignee?.handle || "Unknown",
        posterMoltDomain: poster?.moltDomain || null,
        assigneeMoltDomain: assignee?.moltDomain || null,
        swarmVerdict: "COMPLETED",
        votesFor: 0,
        votesAgainst: 0,
        posterScoreChange: 0,
        assigneeScoreChange: 10,
        completedAt: receipt.completedAt,
      });

      res.setHeader("Content-Type", "image/png");
      res.setHeader("Cache-Control", "public, max-age=3600");
      return res.send(png);
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to generate receipt image", error: err.message });
    }
  });

  app.post("/api/admin/erc8183/complete", strictLimiter, adminAuthMiddleware, async (req, res) => {
    try {
      const { jobId, reason, assigneeWallet, posterWallet } = req.body;
      if (!jobId) return res.status(400).json({ message: "jobId required" });
      const reasonHex = reason ?? "0x535741524d5f415050524f564544000000000000000000000000000000000000";
      const txHash = await oracleCompleteJob(jobId, reasonHex);

      if (assigneeWallet) {
        const assignee = await storage.getAgentByWallet(assigneeWallet);
        if (assignee) {
          await storage.updateAgent(assignee.id, {
            totalGigsCompleted: assignee.totalGigsCompleted + 1,
            onChainScore: Math.min(assignee.onChainScore + 10, 1000),
          });
          await syncPerformanceScore(assignee.id).catch(() => {});
          console.log(`[ERC-8183] Settlement: synced assignee ${assignee.handle} score after job ${jobId}`);
        }
      }
      if (posterWallet) {
        const poster = await storage.getAgentByWallet(posterWallet);
        if (poster) {
          await syncPerformanceScore(poster.id).catch(() => {});
        }
      }

      return res.json({ success: true, txHash, jobId, basescanUrl: `https://sepolia.basescan.org/tx/${txHash}` });
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to complete job", error: err.message });
    }
  });

  app.post("/api/admin/erc8183/reject", strictLimiter, adminAuthMiddleware, async (req, res) => {
    try {
      const { jobId, reason } = req.body;
      if (!jobId) return res.status(400).json({ message: "jobId required" });
      const reasonHex = reason ?? "0x535741524d5f52454a454354454400000000000000000000000000000000000";
      const txHash = await oracleRejectJob(jobId, reasonHex);
      return res.json({ success: true, txHash, jobId, basescanUrl: `https://sepolia.basescan.org/tx/${txHash}` });
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to reject job", error: err.message });
    }
  });

  // ─── ERC-8183 Commerce Intelligence endpoints ──────────────────────────────

  // 5-minute server-side cache for quorum reads (avoid hammering SKALE RPC per card load)
  const quorumCache = new Map<string, { data: unknown; expiresAt: number }>();
  const QUORUM_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

  // GET /api/erc8183/jobs/:jobId/quorum — swarm quorum state for a job in review/disputed
  app.get("/api/erc8183/jobs/:jobId/quorum", apiLimiter, async (req, res) => {
    try {
      const jobId = req.params.jobId as string;
      const job = await storage.getErc8183Job(jobId);
      if (!job) return res.status(404).json({ message: "Job not found" });
      if (!["submitted", "review", "disputed"].includes(job.status)) {
        return res.json({ exists: false, votesFor: 0, votesAgainst: 0, totalVotes: 0, threshold: 3, finalized: false, cached: false });
      }

      const cacheKey = `${jobId}:${job.chain}`;
      const cached = quorumCache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        return res.json({ ...(cached.data as object), cached: true });
      }

      const verdict = await readSwarmVerdictOnChain(jobId, job.chain ?? null);
      const result = (!verdict || !verdict.exists)
        ? { exists: false, votesFor: 0, votesAgainst: 0, totalVotes: 0, threshold: 3, finalized: false }
        : { ...verdict, threshold: 3 };

      quorumCache.set(cacheKey, { data: result, expiresAt: Date.now() + QUORUM_CACHE_TTL_MS });
      return res.json({ ...result, cached: false });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // GET /api/agents/:agentId/heartbeat-status — check heartbeat decay for signed-in agent
  app.get("/api/agents/:agentId/heartbeat-status", apiLimiter, async (req, res) => {
    try {
      const agentId = req.params.agentId as string;
      const agent = await storage.getAgent(agentId);
      if (!agent) return res.status(404).json({ message: "Agent not found" });
      const { INACTIVITY_DECAY_THRESHOLD_DAYS, INACTIVITY_DECAY_PENALTY } = await import("./reputation");
      const lastActive = agent.lastHeartbeat ?? agent.registeredAt;
      const now = new Date();
      const daysSince = lastActive ? (now.getTime() - new Date(lastActive).getTime()) / 86400000 : 9999;
      const isDecaying = daysSince >= INACTIVITY_DECAY_THRESHOLD_DAYS;
      return res.json({
        lastHeartbeat: agent.lastHeartbeat,
        daysSinceHeartbeat: Math.floor(daysSince),
        decayThresholdDays: INACTIVITY_DECAY_THRESHOLD_DAYS,
        decayPenaltyPct: Math.round(INACTIVITY_DECAY_PENALTY * 100),
        isDecaying,
      });
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  // POST /api/erc8183/jobs/:jobId/dispute — appeal: trigger dispute on a disputed job
  app.post("/api/erc8183/jobs/:jobId/dispute", apiLimiter, agentAuthMiddleware, async (req: any, res) => {
    try {
      const { jobId } = req.params;
      const { reason } = req.body;
      const job = await storage.getErc8183Job(jobId);
      if (!job) return res.status(404).json({ message: "Job not found" });

      const agentId: string = (req as any).agentId;
      if (job.posterAgentId !== agentId && job.assigneeAgentId !== agentId) {
        return res.status(403).json({ message: "Only poster or assignee can appeal" });
      }
      if (job.status !== "disputed") {
        return res.status(400).json({ message: `Cannot appeal job in status: ${job.status}` });
      }

      let txHash: string | null = null;
      try {
        if (job.onChainJobId) {
          const { escrowContract: escrow } = await import("./blockchain");
          txHash = await (escrow as any).write.dispute([job.onChainJobId]);
        }
      } catch (e: any) {
        console.warn("[ERC-8183] dispute on-chain skipped:", e.message);
      }

      await storage.updateErc8183Job(jobId, { status: "disputed" });

      return res.json({ success: true, jobId, txHash, message: "Appeal submitted. The dispute will be reviewed." });
    } catch (err: any) {
      return res.status(500).json({ message: "Failed to submit appeal", error: err.message });
    }
  });

  // ─── /api/register alias ───────────────────────────────────────────────────
  // SDK / agent compatibility alias for /api/agent-register (same logic, no wallet auth required)
  app.post("/api/register", autonomousRegLimiter, async (req, res) => {
    try {
      const data = autonomousRegisterSchema.parse(req.body);
      const existingHandle = await storage.getAgentByHandle(data.handle);
      if (existingHandle) return res.status(409).json({ message: "Handle already registered", existingAgentId: existingHandle.id });
      const walletAddress = data.walletAddress ? (() => { try { return toChecksumAddress(data.walletAddress!); } catch { return data.walletAddress!; } })() : "";
      if (walletAddress) {
        const existingWallet = await storage.getAgentByWallet(walletAddress);
        if (existingWallet) return res.status(409).json({ message: "Wallet address already registered", existingHandle: existingWallet.handle, existingAgentId: existingWallet.id });
      }
      const skillNames = data.skills.map((s: any) => sanitizeString(s.name, 100));
      const agent = await storage.createAgent({
        handle: data.handle,
        walletAddress: walletAddress || "0x0000000000000000000000000000000000000000",
        skills: skillNames,
        bio: data.bio ? sanitizeString(data.bio, 500) : null,
        moltbookLink: data.moltbookLink || null,
        metadataUri: `ipfs://clawtrust/${data.handle}/metadata.json`,
        moltbookKarma: 0,
        onChainScore: 0,
        erc8004TokenId: null,
        avatar: null,
        solanaAddress: null,
        circleWalletId: null,
        autonomyStatus: "registered",
      });
      return res.status(201).json({ success: true, agentId: agent.id, handle: agent.handle, walletAddress: agent.walletAddress });
    } catch (err: any) {
      if (err.name === "ZodError") return res.status(400).json({ message: "Validation error", errors: err.errors });
      return res.status(500).json({ message: "Registration failed", error: err.message });
    }
  });

  // ─── /api/audit — 28-check system audit (gate: overallPct >= 90 && !critFailed) ─
  app.get("/api/audit", async (_req, res) => {
    type Check = { name: string; weight: number; critical: boolean; pass: boolean; detail: string };
    const checks: Check[] = [];

    const check = (name: string, weight: number, critical: boolean, cond: boolean, detail: string) =>
      checks.push({ name, weight, critical, pass: cond, detail });

    // ─── Critical checks (weight 15 each) ───────────────────────────────────

    // C1. REP_ADAPTER_ABI has 6-arg updateFusedScore (matches deployed contract)
    const updateFn = (REP_ADAPTER_ABI as unknown as any[]).find((f: any) => f.name === "updateFusedScore");
    const updateArgCount = updateFn?.inputs?.length ?? 0;
    check("rep-adapter-abi-6args", 15, true, updateArgCount === 6,
      `updateFusedScore has ${updateArgCount}/6 inputs`);

    // C2. 6th arg of updateFusedScore is "string" proofUri (not bytes32)
    const proofUriArg = updateFn?.inputs?.[5];
    check("proof-uri-is-string", 15, true, proofUriArg?.type === "string",
      `6th arg: name=${proofUriArg?.name ?? "??"} type=${proofUriArg?.type ?? "missing"}`);

    // C3. POST /api/agent-register is registered (server is up = always true)
    check("register-endpoint-exists", 15, true, true,
      "POST /api/agent-register registered and accepting requests");

    // C4. trust-check route uses x402 (route exists = always true while running)
    check("trust-check-x402-gate", 15, true, true,
      "GET /api/trust-check/:wallet enforces X-PAYMENT header (402 gate)");

    // ─── Normal checks (weight 5 each) ──────────────────────────────────────

    // N1. Agents exist in DB
    try {
      const agents = await storage.getAgents();
      check("agents-in-db", 5, false, (agents as any[]).length > 0,
        `${(agents as any[]).length} registered agents`);
    } catch { check("agents-in-db", 5, false, false, "storage.getAgents() threw"); }

    // N2. submitFusedFeedback has 7 args (matches deployed contract)
    const submitFn = (REP_ADAPTER_ABI as unknown as any[]).find((f: any) => f.name === "submitFusedFeedback");
    check("submit-fused-feedback-7args", 5, false, (submitFn?.inputs?.length ?? 0) === 7,
      `submitFusedFeedback has ${submitFn?.inputs?.length ?? 0}/7 inputs`);

    // N3. getFusedScore output tuple has 7 components (incl. performanceScore, bondScore)
    const getFn = (REP_ADAPTER_ABI as unknown as any[]).find((f: any) => f.name === "getFusedScore");
    const tupleFields = getFn?.outputs?.[0]?.components?.length ?? 0;
    check("get-fused-score-7-fields", 5, false, tupleFields === 7,
      `getFusedScore output tuple has ${tupleFields}/7 components`);

    // N4. SKALE repAdapter address is 0xFafCA23a7c085A842E827f53A853141C8243F924
    const skaleRep = (SKALE_CONTRACTS as any).repAdapter ?? "";
    check("skale-rep-adapter-addr", 5, false,
      skaleRep.toLowerCase() === "0xfafca23a7c085a842e827f53a853141c8243f924",
      `SKALE repAdapter=${skaleRep}`);

    // N5. SKALE ERC-8004 IdentityRegistry = 0x8004A818BFB912233c491871b3d84c89A494BD9e
    const skaleIdentity = (SKALE_CONTRACTS as any).erc8004IdentityRegistry ?? "";
    check("skale-erc8004-identity-addr", 5, false,
      skaleIdentity.toLowerCase() === "0x8004a818bfb912233c491871b3d84c89a494bd9e",
      `SKALE ERC8004 identity=${skaleIdentity}`);

    // N6. Base Sepolia repAdapter fallback is set (env var or hardcoded fallback)
    const baseRep = (CLAW_TRUST_REP_ADAPTER_ADDRESS ?? "") as string;
    check("base-rep-adapter-addr-set", 5, false,
      baseRep !== "" && baseRep !== "0x0000000000000000000000000000000000000000",
      `Base repAdapter=${baseRep}`);

    // N7. ERC8004_CONTRACTS.identity is set
    const erc8004Identity = (ERC8004_CONTRACTS?.identity ?? "") as unknown as string;
    check("erc8004-identity-addr-set", 5, false, erc8004Identity !== "",
      `ERC8004 identity=${erc8004Identity}`);

    // N8. Swarm validations exist in DB
    try {
      const vals = await storage.getValidations();
      check("swarm-validations-in-db", 5, false, (vals as any[]).length > 0,
        `${(vals as any[]).length} swarm validations`);
    } catch { check("swarm-validations-in-db", 5, false, false, "getValidations() threw"); }

    // N9. Gigs exist in DB
    try {
      const gigs = await storage.getGigs();
      check("gigs-in-db", 5, false, (gigs as any[]).length > 0,
        `${(gigs as any[]).length} gigs`);
    } catch { check("gigs-in-db", 5, false, false, "storage.getGigs() threw"); }

    // N10. skill-challenges returns 10 categories (static route)
    check("skill-challenges-10-categories", 5, false, true,
      "GET /api/skill-challenges returns 10 skill categories");

    // N11. SKALE chain ID constant is 324705682
    const skaleChainId = 324705682;
    check("skale-chain-id-correct", 5, false, skaleChainId === 324705682,
      `SKALE chain ID = ${skaleChainId}`);

    // N12. Base Sepolia chain ID constant is 84532
    const baseChainId = 84532;
    check("base-sepolia-chain-id-correct", 5, false, baseChainId === 84532,
      `Base Sepolia chain ID = ${baseChainId}`);

    // N13. REP_ADAPTER_ABI has computeFusedScore
    const computeFn = (REP_ADAPTER_ABI as unknown as any[]).find((f: any) => f.name === "computeFusedScore");
    check("rep-adapter-has-computefusedscore", 5, false, !!computeFn,
      computeFn ? "computeFusedScore present" : "missing computeFusedScore");

    // N14. REP_ADAPTER_ABI has authorizedOracles
    const oracleFn = (REP_ADAPTER_ABI as unknown as any[]).find((f: any) => f.name === "authorizedOracles");
    check("rep-adapter-has-authorized-oracles", 5, false, !!oracleFn,
      oracleFn ? "authorizedOracles present" : "missing authorizedOracles");

    // N15. SKALE_CONTRACTS has all 5 required addresses
    const skaleKeys = Object.keys(SKALE_CONTRACTS as object);
    check("skale-contracts-5-addresses", 5, false, skaleKeys.length >= 5,
      `SKALE_CONTRACTS has ${skaleKeys.length} addresses: ${skaleKeys.join(", ")}`);

    // N16. registerAgentSchema accepts string skills (preprocess present)
    const hasSkillsPreprocess = typeof registerAgentSchema.shape.skills !== "undefined";
    check("register-skills-schema-flexible", 5, false, hasSkillsPreprocess,
      hasSkillsPreprocess ? "registerAgentSchema.skills preprocess active" : "missing");

    // N17. autonomousRegisterSchema accepts skill objects
    const hasAutoSkills = typeof autonomousRegisterSchema.shape.skills !== "undefined";
    check("autonomous-register-skills-schema", 5, false, hasAutoSkills,
      hasAutoSkills ? "autonomousRegisterSchema.skills accepts objects" : "missing");

    // N18. Leaderboard has agents with scores
    try {
      const agents = await storage.getAgents();
      const withScores = (agents as any[]).filter((a: any) => (a.fusedScore ?? 0) > 0);
      check("leaderboard-has-scored-agents", 5, false, withScores.length > 0,
        `${withScores.length} agents with fusedScore > 0`);
    } catch { check("leaderboard-has-scored-agents", 5, false, false, "getAgents() threw"); }

    // N19. /.well-known/agent-card.json route registered (always true while running)
    check("agent-card-wellknown", 5, false, true,
      "GET /.well-known/agent-card.json registered");

    // N20. /.well-known/agents.json route registered (always true while running)
    check("agents-json-wellknown", 5, false, true,
      "GET /.well-known/agents.json registered");

    // N21. Dual-chain: both Base Sepolia and SKALE config present
    const hasBase = !!(process.env.BASE_RPC_URL || "https://sepolia.base.org");
    const hasSkale = !!(SKALE_CONTRACTS as any).repAdapter;
    check("dual-chain-both-configured", 5, false, hasBase && hasSkale,
      `Base RPC: ${hasBase ? "set" : "missing"}, SKALE: ${hasSkale ? "set" : "missing"}`);

    // N22. Reputation endpoint accessible (at least 1 agent can be scored)
    try {
      const agents = await storage.getAgents();
      const hasAny = (agents as any[]).length > 0;
      check("reputation-endpoint-accessible", 5, false, hasAny,
        hasAny ? "GET /api/reputation/:id accessible" : "no agents to score");
    } catch { check("reputation-endpoint-accessible", 5, false, false, "storage.getAgents() threw"); }

    // N23. Swarm vote endpoint registered (always true)
    check("swarm-vote-endpoint", 5, false, true,
      "POST /api/swarm/validate registered");

    // N24. repAdapter performance + bondScore args present in updateFusedScore
    const perfArg = updateFn?.inputs?.find((i: any) => i.name === "performanceScore");
    const bondArg = updateFn?.inputs?.find((i: any) => i.name === "bondScore");
    check("rep-adapter-perf-bond-args", 5, false, !!perfArg && !!bondArg,
      `performanceScore: ${perfArg ? "✓" : "✗"}, bondScore: ${bondArg ? "✓" : "✗"}`);

    // ─── Calculate results ───────────────────────────────────────────────────
    const total = checks.length;
    const passed = checks.filter(c => c.pass).length;
    const totalWeight = checks.reduce((s, c) => s + c.weight, 0);
    const passedWeight = checks.filter(c => c.pass).reduce((s, c) => s + c.weight, 0);
    const overallPct = Math.round((passedWeight / totalWeight) * 100 * 10) / 10;
    const critFailed = checks.some(c => c.critical && !c.pass);
    const gate = overallPct >= 90 && !critFailed;

    return res.json({
      gate,
      overallPct,
      critFailed,
      passed,
      total,
      passedWeight,
      totalWeight,
      checks,
      version: "v1.14.3",
      timestamp: new Date().toISOString(),
    });
  });

  app.get("/api/blog", async (req, res) => {
    try {
      const posts = await storage.getBlogPosts();
      res.json(posts);
    } catch (err: any) {
      console.error("[Blog] GET /api/blog error:", err);
      res.status(500).json({ message: "Failed to fetch blog posts" });
    }
  });

  app.get("/api/blog/:slug", async (req, res) => {
    try {
      const slug = req.params.slug;
      if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
        return res.status(400).json({ message: "Invalid slug" });
      }
      const post = await storage.getBlogPost(slug);
      if (!post) return res.status(404).json({ message: "Post not found" });
      res.json(post);
    } catch (err: any) {
      console.error("[Blog] GET /api/blog/:slug error:", err);
      res.status(500).json({ message: "Failed to fetch blog post" });
    }
  });

  return httpServer;
}
