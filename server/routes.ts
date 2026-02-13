import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertGigSchema } from "@shared/schema";
import { z } from "zod";

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

  app.get("/api/gigs", async (_req, res) => {
    const gigs = await storage.getGigs();
    res.json(gigs);
  });

  app.post("/api/gigs", async (req, res) => {
    try {
      const data = insertGigSchema.parse(req.body);
      const gig = await storage.createGig(data);
      res.status(201).json(gig);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/reputation/:agentId", async (req, res) => {
    const events = await storage.getReputationEvents(req.params.agentId);
    res.json(events);
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

  app.post("/api/validations/vote", async (req, res) => {
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

      let newStatus = validation.status;
      if (newFor >= validation.threshold) newStatus = "approved";
      if (newAgainst >= validation.threshold) newStatus = "rejected";

      const updated = await storage.updateValidation(validationId, {
        votesFor: newFor,
        votesAgainst: newAgainst,
        status: newStatus as any,
      });

      res.json(updated);
    } catch (err: any) {
      res.status(400).json({ message: err.message });
    }
  });

  app.get("/api/stats", async (_req, res) => {
    const agents = await storage.getAgents();
    const gigs = await storage.getGigs();
    const validations = await storage.getValidations();
    const avgScore = agents.length > 0
      ? agents.reduce((sum, a) => sum + a.fusedScore, 0) / agents.length
      : 0;
    res.json({
      totalAgents: agents.length,
      totalGigs: gigs.length,
      activeValidations: validations.filter((v) => v.status === "pending").length,
      avgScore: Math.round(avgScore * 10) / 10,
    });
  });

  app.get("/api/openclaw-query", async (req, res) => {
    const skills = (req.query.skills as string)?.split(",").map((s) => s.trim()) ?? [];
    const gigs = await storage.getGigs();
    const matching = gigs.filter((g) =>
      g.status === "open" &&
      (skills.length === 0 || g.skillsRequired.some((s) => skills.includes(s)))
    );
    res.json(matching);
  });

  return httpServer;
}
