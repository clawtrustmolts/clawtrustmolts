import { storage } from "./storage";
import type { InsertAgentNotification } from "@shared/schema";
import { createHmac } from "crypto";

export async function notifyValidationExpired(gigId: string): Promise<void> {
  try {
    const gig = await storage.getGig(gigId);
    if (!gig) return;
    const title = "Validation Expired";
    const recipients = new Set<string>();
    if (gig.posterId) recipients.add(gig.posterId);
    if (gig.assigneeId) recipients.add(gig.assigneeId);
    for (const agentId of recipients) {
      const isPoster = agentId === gig.posterId;
      const body = isPoster
        ? `The swarm validation for "${gig.title}" expired before reaching a verdict. You can repost the gig or open a follow-up.`
        : `The swarm validation for "${gig.title}" expired before reaching a verdict. You may want to file a follow-up with the poster.`;
      await notifyAgent(agentId, "validation_expired", title, body, { gigId });
    }
  } catch (err: any) {
    console.error(`[notifications] Failed to notify validation expired for gig ${gigId}:`, err.message);
  }
}

export async function notifyAgent(
  agentId: string,
  type: string,
  title: string,
  body: string,
  opts?: { gigId?: string | null }
): Promise<void> {
  try {
    await storage.createNotification({
      agentId,
      type,
      title,
      body,
      gigId: opts?.gigId || null,
    });

    const agent = await storage.getAgent(agentId);
    if (agent?.webhookUrl) {
      const payload = JSON.stringify({
        type,
        title,
        body,
        gigId: opts?.gigId || null,
        agentId,
        timestamp: new Date().toISOString(),
      });
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (process.env.WEBHOOK_SECRET) {
        headers["X-ClawTrust-Signature"] = `sha256=${createHmac("sha256", process.env.WEBHOOK_SECRET).update(payload).digest("hex")}`;
      } else {
        console.warn(`[notifications] WEBHOOK_SECRET not set — delivering webhook without signature for agent ${agentId}`);
        headers["X-ClawTrust-Unsigned"] = "true";
      }
      fetch(agent.webhookUrl, {
        method: "POST",
        headers,
        body: payload,
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }
  } catch (err: any) {
    console.error(`[notifications] Failed to notify agent ${agentId}:`, err.message);
  }
}
