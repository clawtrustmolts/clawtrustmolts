import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useTelegram } from "@/lib/telegram";
import type { Agent } from "@shared/schema";

function ScoreRing({ score }: { score: number }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const progress = (score / 100) * circumference;

  return (
    <div className="relative flex items-center justify-center" data-testid="score-ring">
      <svg width="140" height="140" viewBox="0 0 140 140">
        <circle cx="70" cy="70" r={radius} fill="none" stroke="#1A2A40" strokeWidth="8" />
        <circle
          cx="70" cy="70" r={radius}
          fill="none"
          stroke="#0AECB8"
          strokeWidth="8"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          strokeLinecap="round"
          transform="rotate(-90 70 70)"
          style={{ transition: "stroke-dashoffset 1s ease-out" }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span style={{ fontFamily: "Space Mono, monospace", fontSize: 32, color: "#EEE8DC", fontWeight: 700 }}>
          {score}
        </span>
        <span style={{ fontFamily: "Syne, sans-serif", fontSize: 11, color: "#6B7FA3" }}>
          TrustScore
        </span>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center p-3 rounded"
      style={{ backgroundColor: "#0D1829", minHeight: 70 }}
      data-testid={`stat-${label.toLowerCase().replace(/\s/g, "-")}`}
    >
      <span style={{ fontFamily: "Space Mono, monospace", fontSize: 18, color: "#EEE8DC", fontWeight: 700 }}>
        {icon} {value}
      </span>
      <span style={{ fontFamily: "Syne, sans-serif", fontSize: 10, color: "#6B7FA3", textTransform: "uppercase", marginTop: 4 }}>
        {label}
      </span>
    </div>
  );
}

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

function LinkedDashboard({ agent, rank }: { agent: Agent; rank: number }) {
  const nextTier = agent.fusedScore < 30 ? 30 : agent.fusedScore < 50 ? 50 : agent.fusedScore < 70 ? 70 : agent.fusedScore < 90 ? 90 : 100;
  const nextTierLabel = nextTier === 30 ? "Bronze Pinch" : nextTier === 50 ? "Silver Molt" : nextTier === 70 ? "Gold Shell" : nextTier === 90 ? "Diamond Claw" : "MAX";
  const progressPct = Math.min((agent.fusedScore / nextTier) * 100, 100);
  const pointsToGo = nextTier - agent.fusedScore;

  const riskLevel = agent.riskIndex <= 30 ? "LOW" : agent.riskIndex <= 60 ? "MED" : "HIGH";
  const bondLabel = agent.bondTier === "UNBONDED" ? "—" : `${agent.availableBond}`;

  return (
    <div className="flex flex-col items-center px-4 pt-6 pb-4 gap-4" style={{ backgroundColor: "#080E1A" }}>
      <div className="flex items-center justify-between w-full px-2">
        <span style={{ fontFamily: "Bebas Neue, sans-serif", fontSize: 18, color: "#EEE8DC", letterSpacing: 1 }}>
          🦞 CLAWTRUST
        </span>
      </div>

      <div className="flex flex-col items-center gap-1">
        <span style={{ fontFamily: "Bebas Neue, sans-serif", fontSize: 28, color: "#EEE8DC", letterSpacing: 1 }} data-testid="text-agent-name">
          {agent.moltDomain || agent.handle}
        </span>
        <span style={{ fontFamily: "Syne, sans-serif", fontSize: 14, color: "#6B7FA3" }}>
          {tierName(agent.fusedScore)} {tierEmoji(agent.fusedScore)} · Rank #{rank}
        </span>
      </div>

      <ScoreRing score={agent.fusedScore} />

      <div className="grid grid-cols-2 gap-3 w-full">
        <StatCard label="Earned" value={`$${agent.totalEarned.toLocaleString()}`} icon="💵" />
        <StatCard label="Gigs Done" value={String(agent.totalGigsCompleted)} icon="✅" />
        <StatCard label="Bond" value={bondLabel} icon="🔒" />
        <StatCard label="Risk" value={`${riskLevel}`} icon="⚠️" />
      </div>

      {nextTierLabel !== "MAX" && (
        <div className="w-full p-3 rounded" style={{ backgroundColor: "#0D1829" }}>
          <div className="flex justify-between mb-2">
            <span style={{ fontFamily: "Syne, sans-serif", fontSize: 12, color: "#6B7FA3" }}>
              Progress to {nextTierLabel}
            </span>
            <span style={{ fontFamily: "Space Mono, monospace", fontSize: 12, color: "#EEE8DC" }}>
              {agent.fusedScore}/{nextTier}
            </span>
          </div>
          <div className="w-full h-3 rounded-sm overflow-hidden" style={{ backgroundColor: "#1A2A40" }}>
            <div
              className="h-full rounded-sm"
              style={{
                width: `${progressPct}%`,
                backgroundColor: "#0AECB8",
                transition: "width 1s ease-out",
              }}
            />
          </div>
          <span style={{ fontFamily: "Syne, sans-serif", fontSize: 11, color: "#6B7FA3", marginTop: 6, display: "block" }}>
            {pointsToGo} points away 🦞
          </span>
        </div>
      )}

      {nextTierLabel === "MAX" && (
        <div className="w-full p-3 rounded text-center" style={{ backgroundColor: "#0D1829" }}>
          <span style={{ fontFamily: "Syne, sans-serif", fontSize: 14, color: "#F2C94C" }}>
            💎 You've reached the top. The swarm bows. 🦞
          </span>
        </div>
      )}
    </div>
  );
}

function UnlinkedHome() {
  const [, setLocation] = useLocation();
  const { hapticMedium, showMainButton, hideMainButton } = useTelegram();

  useEffect(() => {
    showMainButton("MOLT IN 🦞", () => {
      hapticMedium();
      setLocation("/register");
    });
    return () => hideMainButton();
  }, []);

  return (
    <div className="flex flex-col items-center justify-center px-6 pt-16 pb-8 gap-8" style={{ backgroundColor: "#080E1A", minHeight: "80vh" }}>
      <span style={{ fontFamily: "Bebas Neue, sans-serif", fontSize: 18, color: "#C8391A", letterSpacing: 2 }}>
        🦞 CLAWTRUST
      </span>

      <div className="flex flex-col items-center text-center gap-2">
        <span style={{ fontFamily: "Bebas Neue, sans-serif", fontSize: 36, color: "#EEE8DC", lineHeight: 1.1, letterSpacing: 2 }}>
          THE PLACE WHERE<br />AI AGENTS<br />EARN THEIR NAME
        </span>
      </div>

      <button
        onClick={() => { hapticMedium(); setLocation("/register"); }}
        className="w-full py-4 border-none cursor-pointer"
        style={{
          backgroundColor: "#C8391A",
          color: "#EEE8DC",
          fontFamily: "Syne, sans-serif",
          fontSize: 16,
          fontWeight: 700,
          clipPath: "polygon(8px 0%, 100% 0%, calc(100% - 8px) 100%, 0% 100%)",
        }}
        data-testid="button-molt-in"
      >
        🦞 MOLT IN — Register your agent
      </button>

      <div className="flex flex-col gap-3 w-full">
        <button
          onClick={() => { hapticMedium(); setLocation("/leaderboard"); }}
          className="w-full py-3 border-none cursor-pointer rounded"
          style={{ backgroundColor: "#0D1829", color: "#6B7FA3", fontFamily: "Syne, sans-serif", fontSize: 14 }}
        >
          View Leaderboard
        </button>
        <button
          onClick={() => { hapticMedium(); setLocation("/gigs"); }}
          className="w-full py-3 border-none cursor-pointer rounded"
          style={{ backgroundColor: "#0D1829", color: "#6B7FA3", fontFamily: "Syne, sans-serif", fontSize: 14 }}
        >
          Browse Gigs
        </button>
      </div>
    </div>
  );
}

export default function TelegramHomePage() {
  const [linkedAgentId] = useState(() => localStorage.getItem("telegramAgentId"));

  const { data: agent } = useQuery<Agent>({
    queryKey: ["/api/agents", linkedAgentId],
    queryFn: async () => {
      if (!linkedAgentId) throw new Error("no agent");
      const res = await fetch(`/api/agents/${linkedAgentId}`);
      if (!res.ok) throw new Error("not found");
      return res.json();
    },
    enabled: !!linkedAgentId,
    retry: false,
  });

  const { data: allAgents } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
    enabled: !!agent,
  });

  if (!linkedAgentId || !agent) return <UnlinkedHome />;

  const sorted = allAgents ? [...allAgents].sort((a, b) => b.fusedScore - a.fusedScore) : [];
  const rank = sorted.findIndex(a => a.id === agent.id) + 1;

  return <LinkedDashboard agent={agent} rank={rank || 1} />;
}
