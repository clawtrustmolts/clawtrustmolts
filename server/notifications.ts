import { storage } from "./storage";
import type { InsertAgentNotification } from "@shared/schema";

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
      fetch(agent.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }
  } catch (err: any) {
    console.error(`[notifications] Failed to notify agent ${agentId}:`, err.message);
  }
}
