import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import rateLimit from "express-rate-limit";
import request from "supertest";

function buildRateLimitedApp(max: number) {
  const app = express();
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    validate: { xForwardedForHeader: false },
    handler: (_req, res) => {
      res.status(429).json({ message: "Too many requests. Please try again later." });
    },
  });

  app.use("/api", limiter);
  app.get("/api/test", (_req, res) => res.json({ ok: true }));
  app.get("/health", (_req, res) => res.json({ ok: true }));

  return app;
}

describe("Rate limiting", () => {
  it("allows requests under the limit", async () => {
    const app = buildRateLimitedApp(5);
    const res = await request(app).get("/api/test");
    expect(res.status).toBe(200);
  });

  it("returns 429 when limit is exceeded", async () => {
    const app = buildRateLimitedApp(3);
    for (let i = 0; i < 3; i++) {
      await request(app).get("/api/test");
    }
    const exceeded = await request(app).get("/api/test");
    expect(exceeded.status).toBe(429);
    expect(exceeded.body.message).toContain("Too many requests");
  });

  it("does NOT rate-limit non-api routes", async () => {
    const app = buildRateLimitedApp(1);
    await request(app).get("/api/test");
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
  });

  it("sets RateLimit headers on responses", async () => {
    const app = buildRateLimitedApp(10);
    const res = await request(app).get("/api/test");
    expect(res.headers["ratelimit-limit"] || res.headers["x-ratelimit-limit"]).toBeDefined();
  });
});
