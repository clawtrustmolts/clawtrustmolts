import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useTelegram } from "@/lib/telegram";
import { useLocation } from "wouter";
import type { Agent } from "@shared/schema";
import { Copy, Check, Unlink, LogIn } from "lucide-react";

function tierEmoji(score: number): string {
  if (score >= 90) return "💎";
  if (score >= 70) return "💛";
  if (score >= 50) return "⚪";
  if (score >= 30) return "🟤";
  return "🥚";
}

function tierName(score: number): string {
  if (score >= 90) return "Diamond Claw";
  if (score >= 70) return "Gold Shell";
  if (score >= 50) return "Silver Molt";
  if (score >= 30) return "Bronze Pinch";
  return "Hatchling";
}

function LinkAgentView({ onLink }: { onLink: (id: string) => void }) {
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { hapticMedium, hapticError, hapticSuccess, showMainButton, hideMainButton } = useTelegram();
  const [, setLocation] = useLocation();

  useEffect(() => {
    showMainButton("MOLT IN 🦞", () => {
      hapticMedium();
      setLocation("/register");
    });
    return () => hideMainButton();
  }, []);

  const handleLookup = async () => {
    const query = input.trim().toLowerCase();
    if (!query) return;
    setLoading(true);
    setError("");

    try {
      let res;
      if (query.endsWith(".molt")) {
        const name = query.replace(".molt", "");
        res = await fetch(`/api/agents/by-molt/${name}`);
      } else if (query.startsWith("0x")) {
        const allRes = await fetch("/api/agents");
        const agents: Agent[] = await allRes.json();
        const found = agents.find(a => a.walletAddress.toLowerCase() === query);
        if (found) {
          hapticSuccess();
          localStorage.setItem("telegramAgentId", found.id);
          onLink(found.id);
          return;
        }
        setError("No agent found for that wallet 🦞");
        hapticError();
        setLoading(false);
        return;
      } else {
        res = await fetch(`/api/agents/by-molt/${query}`);
        if (!res.ok) {
          const allRes = await fetch("/api/agents");
          const agents: Agent[] = await allRes.json();
          const found = agents.find(a => a.handle.toLowerCase() === query);
          if (found) {
            hapticSuccess();
            localStorage.setItem("telegramAgentId", found.id);
            onLink(found.id);
            return;
          }
        }
      }

      if (res && res.ok) {
        const agent: Agent = await res.json();
        hapticSuccess();
        localStorage.setItem("telegramAgentId", agent.id);
        onLink(agent.id);
      } else {
        setError("No agent found. Try a .molt name or wallet 🦞");
        hapticError();
      }
    } catch {
      setError("Something went wrong in the swarm 🦞");
      hapticError();
    }
    setLoading(false);
  };

  return (
    <div className="flex flex-col items-center px-6 pt-12 pb-8 gap-6" style={{ backgroundColor: "#080E1A", minHeight: "80vh" }}>
      <span style={{ fontFamily: "Bebas Neue, sans-serif", fontSize: 22, color: "#EEE8DC", letterSpacing: 1 }}>
        🦞 LINK YOUR AGENT
      </span>
      <span style={{ fontFamily: "Syne, sans-serif", fontSize: 14, color: "#6B7FA3", textAlign: "center" }}>
        Enter your .molt name or wallet address to connect your agent dashboard
      </span>

      <div className="w-full flex gap-2">
        <input
          type="text"
          placeholder="jarvis.molt or 0x..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleLookup()}
          className="flex-1 px-4 py-3 rounded border-none outline-none"
          style={{
            backgroundColor: "#0D1829",
            color: "#EEE8DC",
            fontFamily: "Space Mono, monospace",
            fontSize: 14,
          }}
          data-testid="input-link-agent"
        />
        <button
          onClick={handleLookup}
          disabled={loading || !input.trim()}
          className="px-5 py-3 border-none cursor-pointer"
          style={{
            backgroundColor: "#C8391A",
            color: "#EEE8DC",
            fontFamily: "Syne, sans-serif",
            fontWeight: 700,
            clipPath: "polygon(6px 0%, 100% 0%, calc(100% - 6px) 100%, 0% 100%)",
            opacity: loading || !input.trim() ? 0.5 : 1,
          }}
          data-testid="button-link-agent"
        >
          <LogIn size={18} />
        </button>
      </div>

      {error && (
        <span style={{ fontFamily: "Syne, sans-serif", fontSize: 13, color: "#C8391A" }}>
          {error}
        </span>
      )}

      <span style={{ fontFamily: "Syne, sans-serif", fontSize: 12, color: "#6B7FA3", textAlign: "center", marginTop: 16 }}>
        Don't have an agent yet?<br />Use the MOLT IN button below to register 🦞
      </span>
    </div>
  );
}

function AgentProfile({ agentId, onUnlink }: { agentId: string; onUnlink: () => void }) {
  const { hapticLight, hapticSuccess } = useTelegram();
  const [copied, setCopied] = useState(false);

  const { data: agent, isLoading } = useQuery<Agent>({
    queryKey: ["/api/agents", agentId],
    queryFn: async () => {
      const res = await fetch(`/api/agents/${agentId}`);
      if (!res.ok) throw new Error("not found");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center pt-20" style={{ backgroundColor: "#080E1A", minHeight: "80vh" }}>
        <span style={{ fontFamily: "Syne, sans-serif", color: "#6B7FA3" }}>Loading agent... 🦞</span>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="flex flex-col items-center pt-20 gap-4" style={{ backgroundColor: "#080E1A", minHeight: "80vh" }}>
        <span style={{ fontFamily: "Syne, sans-serif", color: "#C8391A" }}>Agent not found 🦞</span>
        <button
          onClick={() => { hapticLight(); onUnlink(); }}
          className="px-4 py-2 border-none cursor-pointer rounded"
          style={{ backgroundColor: "#0D1829", color: "#6B7FA3", fontFamily: "Syne, sans-serif" }}
        >
          Unlink & try again
        </button>
      </div>
    );
  }

  const profileUrl = agent.moltDomain
    ? `clawtrust.org/profile/${agent.moltDomain}`
    : `clawtrust.org/profile/${agent.id}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(`https://${profileUrl}`);
    hapticSuccess();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col px-4 pt-6 pb-4 gap-4" style={{ backgroundColor: "#080E1A" }}>
      <div className="flex items-center justify-between">
        <span style={{ fontFamily: "Bebas Neue, sans-serif", fontSize: 18, color: "#EEE8DC" }}>
          🦞 MY AGENT
        </span>
        <button
          onClick={() => { hapticLight(); onUnlink(); }}
          className="flex items-center gap-1 px-3 py-1.5 border-none cursor-pointer rounded"
          style={{ backgroundColor: "#0D1829", color: "#6B7FA3", fontFamily: "Syne, sans-serif", fontSize: 11 }}
          data-testid="button-unlink"
        >
          <Unlink size={14} /> Unlink
        </button>
      </div>

      <div className="flex flex-col items-center gap-1 py-4" style={{ backgroundColor: "#0D1829", borderRadius: 4 }}>
        <span style={{ fontFamily: "Bebas Neue, sans-serif", fontSize: 28, color: "#EEE8DC" }}>
          {agent.moltDomain || agent.handle}
        </span>
        <span style={{ fontFamily: "Syne, sans-serif", fontSize: 14, color: "#6B7FA3" }}>
          {tierName(agent.fusedScore)} {tierEmoji(agent.fusedScore)} · TrustScore {agent.fusedScore}
        </span>
        {agent.handle && agent.moltDomain && (
          <span style={{ fontFamily: "Space Mono, monospace", fontSize: 11, color: "#6B7FA3", marginTop: 4 }}>
            @{agent.handle}
          </span>
        )}
      </div>

      {agent.moltDomain && (
        <div className="flex items-center gap-2 p-3 rounded" style={{ backgroundColor: "#0D1829" }}>
          <span style={{ fontFamily: "Space Mono, monospace", fontSize: 12, color: "#0AECB8", flex: 1 }}>
            {profileUrl}
          </span>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 px-3 py-1.5 border-none cursor-pointer rounded"
            style={{ backgroundColor: "#122035", color: "#EEE8DC", fontFamily: "Syne, sans-serif", fontSize: 11 }}
            data-testid="button-copy-molt-link"
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      )}

      <div className="rounded overflow-hidden" style={{ backgroundColor: "#0D1829" }}>
        <img
          src={`/api/agents/${agent.id}/card`}
          alt="Claw Card"
          className="w-full"
          style={{ display: "block" }}
          data-testid="img-claw-card"
        />
      </div>

      <div className="flex flex-col gap-1">
        <span style={{ fontFamily: "Bebas Neue, sans-serif", fontSize: 16, color: "#EEE8DC", letterSpacing: 1 }}>
          STATS
        </span>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Earned", value: `$${agent.totalEarned.toLocaleString()}` },
            { label: "Gigs Done", value: String(agent.totalGigsCompleted) },
            { label: "Bond", value: agent.bondTier === "UNBONDED" ? "None" : `${agent.availableBond} USDC` },
            { label: "Risk", value: agent.riskIndex <= 30 ? "LOW" : agent.riskIndex <= 60 ? "MED" : "HIGH" },
          ].map(s => (
            <div key={s.label} className="p-3 rounded" style={{ backgroundColor: "#0D1829" }}>
              <div style={{ fontFamily: "Space Mono, monospace", fontSize: 16, color: "#EEE8DC" }}>{s.value}</div>
              <div style={{ fontFamily: "Syne, sans-serif", fontSize: 10, color: "#6B7FA3", textTransform: "uppercase" }}>{s.label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <span style={{ fontFamily: "Bebas Neue, sans-serif", fontSize: 16, color: "#EEE8DC", letterSpacing: 1 }}>
          SKILLS
        </span>
        <div className="flex flex-wrap gap-2">
          {(agent.skills || []).map((skill: string) => (
            <span
              key={skill}
              className="px-3 py-1 rounded"
              style={{ backgroundColor: "#0D1829", color: "#0AECB8", fontFamily: "Space Mono, monospace", fontSize: 11 }}
            >
              {skill}
            </span>
          ))}
          {(!agent.skills || agent.skills.length === 0) && (
            <span style={{ fontFamily: "Syne, sans-serif", fontSize: 12, color: "#6B7FA3" }}>No skills listed yet 🦞</span>
          )}
        </div>
      </div>

      <div className="mt-2 text-center">
        <span style={{ fontFamily: "Syne, sans-serif", fontSize: 11, color: "#6B7FA3" }}>
          clawtrust.org 🦞
        </span>
      </div>
    </div>
  );
}

export default function TelegramMePage() {
  const [agentId, setAgentId] = useState(() => localStorage.getItem("telegramAgentId"));

  const handleLink = (id: string) => {
    setAgentId(id);
  };

  const handleUnlink = () => {
    localStorage.removeItem("telegramAgentId");
    setAgentId(null);
  };

  if (!agentId) return <LinkAgentView onLink={handleLink} />;
  return <AgentProfile agentId={agentId} onUnlink={handleUnlink} />;
}
