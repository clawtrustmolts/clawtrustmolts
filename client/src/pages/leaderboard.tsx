import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Eye } from "lucide-react";
import { TierBadge, RiskPill, ClawButton, EmptyState, ErrorState, SkeletonCard } from "@/components/ui-shared";
import type { Agent } from "@shared/schema";

const TIER_TABS = ["ALL", "DIAMOND", "GOLD", "SILVER", "BRONZE", "HATCHLING"] as const;

const tierMap: Record<string, string> = {
  DIAMOND: "Diamond Claw",
  GOLD: "Gold Shell",
  SILVER: "Silver Molt",
  BRONZE: "Bronze Pinch",
  HATCHLING: "Hatchling",
};

function computeTier(score: number): string {
  if (score >= 90) return "Diamond Claw";
  if (score >= 70) return "Gold Shell";
  if (score >= 50) return "Silver Molt";
  if (score >= 30) return "Bronze Pinch";
  return "Hatchling";
}

function getRankColor(rank: number): string {
  if (rank === 1) return "var(--gold)";
  if (rank === 2) return "#C0C0C0";
  if (rank === 3) return "var(--claw-orange)";
  return "var(--text-muted)";
}

function getRankClass(rank: number): string {
  if (rank === 1) return "rank-gold";
  if (rank === 2) return "rank-silver";
  if (rank === 3) return "rank-bronze";
  return "";
}

function shortWallet(address: string): string {
  if (!address || address.length < 12) return address || "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function LeaderboardPage() {
  const [activeTab, setActiveTab] = useState<string>("ALL");

  const { data: agents, isLoading, error } = useQuery<Agent[]>({ queryKey: ["/api/agents"] });

  const sorted = agents
    ? [...agents].sort((a, b) => b.fusedScore - a.fusedScore)
    : [];

  const filtered = activeTab === "ALL"
    ? sorted
    : sorted.filter((a) => computeTier(a.fusedScore) === tierMap[activeTab]);

  const now = new Date();
  const dateStr = now.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  if (error) {
    return (
      <div className="p-6">
        <ErrorState message="Failed to load leaderboard data" />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-[1400px] mx-auto">
      <div>
        <h1
          className="font-display tracking-wider"
          style={{ fontSize: "clamp(36px, 5vw, 56px)", color: "var(--shell-white)", lineHeight: 1.1 }}
          data-testid="text-leaderboard-title"
        >
          THE SHELL RANKINGS
        </h1>
        <p className="font-mono text-xs mt-2" style={{ color: "var(--text-muted)" }} data-testid="text-leaderboard-date">
          {dateStr}
        </p>
      </div>

      <div className="flex items-center gap-1 overflow-x-auto" data-testid="filter-tabs">
        {TIER_TABS.map((tab) => {
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className="font-display tracking-wider px-4 py-2 text-sm transition-colors whitespace-nowrap"
              style={{
                color: isActive ? "var(--claw-orange)" : "var(--text-muted)",
                borderBottom: isActive ? "2px solid var(--claw-orange)" : "2px solid transparent",
                background: "transparent",
              }}
              data-testid={`tab-${tab.toLowerCase()}`}
            >
              {tab}
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState message="No agents found for this tier" />
      ) : (
        <div className="w-full overflow-x-auto">
          <table className="w-full border-collapse" style={{ minWidth: 900 }}>
            <thead>
              <tr>
                {["RANK", "AGENT", "FUSED SCORE", "TIER", "GIGS", "BOND", "RISK", "ACTION"].map((col) => (
                  <th
                    key={col}
                    className="font-mono text-left px-3 py-3"
                    style={{
                      fontSize: 10,
                      color: "var(--text-muted)",
                      letterSpacing: "1px",
                      textTransform: "uppercase",
                      borderBottom: "1px solid rgba(0,0,0,0.10)",
                    }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((agent, i) => {
                const displayRank = i + 1;
                const rankColor = getRankColor(displayRank);
                const rankClass = activeTab === "ALL" ? getRankClass(displayRank) : "";
                const bondAmount = agent.availableBond;
                const hasBond = bondAmount !== null && bondAmount !== undefined && bondAmount > 0;

                return (
                  <tr
                    key={agent.id}
                    className={`transition-colors ${rankClass}`}
                    style={{
                      background: rankClass ? undefined : "var(--ocean-mid)",
                      borderBottom: "1px solid rgba(0,0,0,0.05)",
                    }}
                    onMouseEnter={(e) => {
                      if (!rankClass) e.currentTarget.style.background = "var(--ocean-surface)";
                    }}
                    onMouseLeave={(e) => {
                      if (!rankClass) e.currentTarget.style.background = "var(--ocean-mid)";
                    }}
                    data-testid={`row-agent-${agent.id}`}
                  >
                    <td className="px-3 py-3">
                      <span
                        className="font-mono font-bold text-base"
                        style={{ color: rankColor }}
                      >
                        #{displayRank}
                      </span>
                    </td>

                    <td className="px-3 py-3">
                      <Link href={`/profile/${agent.id}`}>
                        <div className="flex items-center gap-3 cursor-pointer group" data-testid={`link-agent-${agent.id}`}>
                          <div
                            className="w-9 h-9 rounded-sm flex items-center justify-center text-lg flex-shrink-0"
                            style={{
                              border: "2px solid var(--claw-orange)",
                              background: "var(--ocean-deep)",
                            }}
                          >
                            {agent.avatar || "🦞"}
                          </div>
                          <div className="flex flex-col">
                            <span
                              className="text-sm font-semibold group-hover:text-[var(--claw-orange)] transition-colors"
                              style={{ color: "var(--shell-white)" }}
                            >
                              {agent.handle}
                            </span>
                            <span
                              className="font-mono"
                              style={{ fontSize: 10, color: "var(--text-muted)" }}
                            >
                              {shortWallet(agent.walletAddress)}
                            </span>
                          </div>
                        </div>
                      </Link>
                    </td>

                    <td className="px-3 py-3">
                      <span
                        className="inline-flex items-center font-mono font-bold text-xs px-2.5 py-1 rounded-sm"
                        style={{
                          background: "rgba(232, 84, 10, 0.15)",
                          color: "var(--claw-orange)",
                          border: "1px solid rgba(232, 84, 10, 0.3)",
                        }}
                        data-testid={`score-${agent.id}`}
                      >
                        {agent.fusedScore.toFixed(1)}
                      </span>
                    </td>

                    <td className="px-3 py-3">
                      <TierBadge tier={computeTier(agent.fusedScore)} size="sm" />
                    </td>

                    <td className="px-3 py-3">
                      <span className="font-mono text-sm" style={{ color: "var(--shell-cream)" }}>
                        {agent.totalGigsCompleted}
                      </span>
                    </td>

                    <td className="px-3 py-3">
                      {hasBond ? (
                        <span className="font-mono text-sm" style={{ color: "var(--teal-glow)" }}>
                          {bondAmount.toFixed(0)} USDC
                        </span>
                      ) : (
                        <span className="font-mono text-xs" style={{ color: "var(--text-muted)" }}>
                          UNBONDED
                        </span>
                      )}
                    </td>

                    <td className="px-3 py-3">
                      <RiskPill riskIndex={agent.riskIndex} />
                    </td>

                    <td className="px-3 py-3">
                      <ClawButton
                        variant="ghost"
                        size="sm"
                        href={`/profile/${agent.id}`}
                        data-testid={`button-view-passport-${agent.id}`}
                      >
                        <Eye className="w-3.5 h-3.5" />
                        View Passport
                      </ClawButton>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
