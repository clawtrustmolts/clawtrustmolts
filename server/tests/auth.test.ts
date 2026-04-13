import { describe, it, expect } from "vitest";
import express, { Request, Response, NextFunction } from "express";
import request from "supertest";

const FAKE_AGENT_ID = "550e8400-e29b-41d4-a716-446655440000";
const OTHER_AGENT_ID = "660e8400-e29b-41d4-a716-446655440001";

function buildAuthApp() {
  const app = express();
  app.use(express.json());

  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    const agentId = req.headers["x-agent-id"] as string;
    if (!agentId) return res.status(401).json({ message: "Authentication required" });
    (req as any).agentId = agentId;
    next();
  };

  const requireOwner = (paramKey: string) => (req: Request, res: Response, next: NextFunction) => {
    const resourceOwner = req.params[paramKey];
    const caller = (req as any).agentId;
    if (resourceOwner !== caller) {
      return res.status(403).json({ message: "Forbidden: you do not own this resource" });
    }
    next();
  };

  app.get("/api/public", (_req, res) => res.json({ ok: true }));
  app.get("/api/protected", requireAuth, (req: Request, res) =>
    res.json({ agentId: (req as any).agentId })
  );
  app.patch(
    "/api/agents/:agentId/profile",
    requireAuth,
    requireOwner("agentId"),
    (_req, res) => res.json({ updated: true })
  );
  app.delete(
    "/api/agents/:agentId",
    requireAuth,
    requireOwner("agentId"),
    (_req, res) => res.json({ deleted: true })
  );

  return app;
}

const app = buildAuthApp();

describe("Authentication middleware", () => {
  it("allows unauthenticated access to public routes", async () => {
    const res = await request(app).get("/api/public");
    expect(res.status).toBe(200);
  });

  it("blocks unauthenticated access to protected routes with 401", async () => {
    const res = await request(app).get("/api/protected");
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Authentication required");
  });

  it("allows authenticated access to protected routes", async () => {
    const res = await request(app)
      .get("/api/protected")
      .set("x-agent-id", FAKE_AGENT_ID);
    expect(res.status).toBe(200);
    expect(res.body.agentId).toBe(FAKE_AGENT_ID);
  });
});

describe("IDOR (Insecure Direct Object Reference) protection", () => {
  it("allows an agent to update their own profile", async () => {
    const res = await request(app)
      .patch(`/api/agents/${FAKE_AGENT_ID}/profile`)
      .set("x-agent-id", FAKE_AGENT_ID)
      .send({ bio: "Updated" });
    expect(res.status).toBe(200);
  });

  it("blocks an agent from updating another agent's profile (IDOR)", async () => {
    const res = await request(app)
      .patch(`/api/agents/${OTHER_AGENT_ID}/profile`)
      .set("x-agent-id", FAKE_AGENT_ID)
      .send({ bio: "Hacked" });
    expect(res.status).toBe(403);
    expect(res.body.message).toContain("Forbidden");
  });

  it("blocks an agent from deleting another agent (IDOR)", async () => {
    const res = await request(app)
      .delete(`/api/agents/${OTHER_AGENT_ID}`)
      .set("x-agent-id", FAKE_AGENT_ID);
    expect(res.status).toBe(403);
  });

  it("blocks unauthenticated IDOR attempts outright with 401", async () => {
    const res = await request(app)
      .patch(`/api/agents/${FAKE_AGENT_ID}/profile`)
      .send({ bio: "No auth" });
    expect(res.status).toBe(401);
  });
});

describe("Input injection via headers", () => {
  const attackApp = express();
  attackApp.use(express.json());

  attackApp.get("/api/echo", (req, res) => {
    const id = req.headers["x-agent-id"] as string || "";
    if (id.includes("<") || id.includes(">") || id.includes("'") || id.includes(";")) {
      return res.status(400).json({ message: "Invalid agent ID format" });
    }
    res.json({ id });
  });

  it("rejects XSS payloads in x-agent-id header", async () => {
    const res = await request(attackApp)
      .get("/api/echo")
      .set("x-agent-id", "<script>alert(1)</script>");
    expect(res.status).toBe(400);
  });

  it("rejects SQL injection in x-agent-id header", async () => {
    const res = await request(attackApp)
      .get("/api/echo")
      .set("x-agent-id", "'; DROP TABLE agents; --");
    expect(res.status).toBe(400);
  });

  it("accepts valid UUID agent IDs", async () => {
    const res = await request(attackApp)
      .get("/api/echo")
      .set("x-agent-id", FAKE_AGENT_ID);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(FAKE_AGENT_ID);
  });
});
