import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";

function buildSecureApp(isProd = false) {
  const app = express();
  const scriptSrc = [
    "'self'",
    ...(!isProd ? ["'unsafe-inline'", "'unsafe-eval'"] : []),
    "https://telegram.org",
  ].join(" ");

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    if (isProd) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains; preload");
    }
    res.setHeader(
      "Content-Security-Policy",
      [
        "default-src 'self'",
        `script-src ${scriptSrc}`,
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com",
        "font-src 'self' https://fonts.gstatic.com https://api.fontshare.com https://cdn.fontshare.com",
        "img-src 'self' data: https: blob:",
        "connect-src 'self' https://sepolia.base.org https://testnet.skalenodes.com https://auth.privy.io https://*.privy.io wss: ws:",
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "upgrade-insecure-requests",
      ].join("; ")
    );
    next();
  });

  app.get("/health", (_req, res) => res.json({ ok: true }));
  return app;
}

describe("Security headers — dev mode", () => {
  const app = buildSecureApp(false);

  it("sets X-Content-Type-Options: nosniff", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("sets X-Frame-Options: DENY (clickjacking protection)", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });

  it("sets X-DNS-Prefetch-Control: off", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-dns-prefetch-control"]).toBe("off");
  });

  it("sets Referrer-Policy", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });

  it("sets Permissions-Policy locking cameras and payment", async () => {
    const res = await request(app).get("/health");
    const policy = res.headers["permissions-policy"] as string;
    expect(policy).toContain("camera=()");
    expect(policy).toContain("microphone=()");
    expect(policy).toContain("geolocation=()");
    expect(policy).toContain("payment=()");
  });

  it("sets Cross-Origin-Opener-Policy", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["cross-origin-opener-policy"]).toBe("same-origin");
  });

  it("sets Cross-Origin-Resource-Policy", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["cross-origin-resource-policy"]).toBe("same-origin");
  });

  it("does NOT set HSTS in dev mode (requires HTTPS)", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["strict-transport-security"]).toBeUndefined();
  });

  it("sets Content-Security-Policy with frame-src none", async () => {
    const res = await request(app).get("/health");
    const csp = res.headers["content-security-policy"] as string;
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self'");
  });

  it("allows unsafe-inline in dev script-src (Vite HMR)", async () => {
    const res = await request(app).get("/health");
    const csp = res.headers["content-security-policy"] as string;
    expect(csp).toContain("'unsafe-inline'");
  });
});

describe("Security headers — production mode", () => {
  const app = buildSecureApp(true);

  it("sets HSTS with max-age=31536000 in production", async () => {
    const res = await request(app).get("/health");
    const hsts = res.headers["strict-transport-security"] as string;
    expect(hsts).toContain("max-age=31536000");
    expect(hsts).toContain("includeSubDomains");
    expect(hsts).toContain("preload");
  });

  it("does NOT include unsafe-inline in production script-src", async () => {
    const res = await request(app).get("/health");
    const csp = res.headers["content-security-policy"] as string;
    const scriptSrc = csp.split(";").find(d => d.trim().startsWith("script-src")) || "";
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });
});

describe("Unrecognised origin rejection", () => {
  const app = express();
  const ALLOWED = ["https://clawtrust.org", "https://www.clawtrust.org"];

  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && !ALLOWED.includes(origin) && req.path.startsWith("/api")) {
      return res.status(403).json({ message: "Origin not allowed" });
    }
    next();
  });

  app.get("/api/test", (_req, res) => res.json({ ok: true }));
  app.get("/health", (_req, res) => res.json({ ok: true }));

  it("rejects requests from unknown origins on /api routes", async () => {
    const res = await request(app)
      .get("/api/test")
      .set("Origin", "https://evil-hacker.com");
    expect(res.status).toBe(403);
    expect(res.body.message).toBe("Origin not allowed");
  });

  it("allows requests with no origin (server-to-server, curl)", async () => {
    const res = await request(app).get("/api/test");
    expect(res.status).toBe(200);
  });

  it("allows non-api routes from any origin", async () => {
    const res = await request(app)
      .get("/health")
      .set("Origin", "https://evil-hacker.com");
    expect(res.status).toBe(200);
  });
});
