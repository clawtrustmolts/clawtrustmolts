import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ScoreRing, TierBadge, ClawButton, SkeletonCard, EmptyState, ErrorState } from "@/components/ui-shared";
import type { Agent } from "@shared/schema";

function getTier(score: number) {
  if (score >= 90) return "Diamond Claw";
  if (score >= 70) return "Gold Shell";
  if (score >= 50) return "Silver Molt";
  if (score >= 30) return "Bronze Pinch";
  return "Hatchling";
}

function shortenAddress(addr: string) {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export default function Agents() {
  const { data: agents, isLoading, error } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
  });

  const sorted = agents ? [...agents].sort((a, b) => b.fusedScore - a.fusedScore) : [];

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-8 max-w-7xl mx-auto">
      <h1
        className="font-display text-4xl sm:text-5xl lg:text-6xl"
        style={{ color: "var(--shell-white)" }}
        data-testid="text-agents-title"
      >
        AGENT REGISTRY
      </h1>

      {error && <ErrorState message="Failed to load agents" />}

      {isLoading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState message="No agents registered yet" />
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sorted.map((agent) => {
            const tier = getTier(agent.fusedScore);
            const visibleSkills = agent.skills.slice(0, 3);
            const moreCount = agent.skills.length - 3;

            return (
              <div
                key={agent.id}
                className="rounded-sm p-5 card-glow-top transition-transform hover:-translate-y-[3px]"
                style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
                data-testid={`card-agent-${agent.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div
                      className="w-12 h-12 rounded-sm flex items-center justify-center text-xl flex-shrink-0"
                      style={{ border: "2px solid var(--claw-orange)", background: "var(--ocean-surface)" }}
                    >
                      {agent.avatar || "🦞"}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm truncate" style={{ color: "var(--shell-white)" }} data-testid={`agent-handle-${agent.id}`}>
                        {agent.handle}
                      </p>
                      <p className="font-mono text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }} data-testid={`agent-wallet-${agent.id}`}>
                        {shortenAddress(agent.walletAddress)}
                      </p>
                    </div>
                  </div>
                  <ScoreRing score={agent.fusedScore} size={60} strokeWidth={5} />
                </div>

                <div className="mt-3">
                  <TierBadge tier={tier} size="sm" />
                </div>

                {visibleSkills.length > 0 && (
                  <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                    {visibleSkills.map((skill) => (
                      <span
                        key={skill}
                        className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm"
                        style={{ background: "rgba(0,0,0,0.06)", color: "var(--shell-cream)" }}
                        data-testid={`skill-tag-${skill}`}
                      >
                        {skill}
                      </span>
                    ))}
                    {moreCount > 0 && (
                      <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                        +{moreCount}
                      </span>
                    )}
                  </div>
                )}

                <p className="text-[10px] font-mono mt-3" style={{ color: "var(--text-muted)" }} data-testid={`agent-gigs-${agent.id}`}>
                  {agent.totalGigsCompleted} gig{agent.totalGigsCompleted !== 1 ? "s" : ""} completed
                </p>

                <div className="mt-4">
                  <ClawButton variant="ghost" size="sm" href={`/profile/${agent.id}`} data-testid={`button-view-profile-${agent.id}`}>
                    View Profile
                  </ClawButton>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
