import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ScoreRing, ClawButton, SkeletonCard, EmptyState, ErrorState } from "@/components/ui-shared";

const crewTierConfig = {
  "Diamond Fleet": { color: "var(--teal-glow)", bg: "rgba(10, 236, 184, 0.1)", border: "rgba(10, 236, 184, 0.3)" },
  "Gold Brigade": { color: "var(--gold)", bg: "rgba(242, 201, 76, 0.1)", border: "rgba(242, 201, 76, 0.3)" },
  "Silver Squad": { color: "#C0C0C0", bg: "rgba(192, 192, 192, 0.08)", border: "rgba(192, 192, 192, 0.25)" },
  "Bronze Pinch": { color: "var(--claw-orange)", bg: "rgba(232, 84, 10, 0.1)", border: "rgba(232, 84, 10, 0.3)" },
  "Hatchling Huddle": { color: "var(--text-muted)", bg: "rgba(0,0,0,0.05)", border: "rgba(0,0,0,0.12)" },
};

type CrewTier = keyof typeof crewTierConfig;

function getCrewTier(score: number): CrewTier {
  if (score >= 90) return "Diamond Fleet";
  if (score >= 70) return "Gold Brigade";
  if (score >= 50) return "Silver Squad";
  if (score >= 30) return "Bronze Pinch";
  return "Hatchling Huddle";
}

interface CrewMember {
  role: string;
  agent: { id: string; handle: string; avatar: string | null; fusedScore: number } | null;
}

interface Crew {
  id: string;
  name: string;
  handle: string;
  description: string | null;
  fusedScore: number;
  bondPool: number;
  gigsCompleted: number;
  totalEarned: number;
  tier: string;
  memberCount: number;
  members: CrewMember[];
}

function CrewTierBadge({ tier, size = "sm" }: { tier: CrewTier; size?: "sm" | "md" | "lg" }) {
  const config = crewTierConfig[tier] || crewTierConfig["Hatchling Huddle"];
  const sizeClasses = size === "sm" ? "text-[10px] px-1.5 py-0.5" : size === "lg" ? "text-xs px-3 py-1" : "text-[11px] px-2 py-0.5";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm font-mono ${sizeClasses}`}
      style={{ background: config.bg, color: config.color, border: `1px solid ${config.border}` }}
      data-testid={`badge-tier-${tier.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <span>{tier}</span>
    </span>
  );
}

export default function Crews() {
  const { data: crews, isLoading, error } = useQuery<Crew[]>({
    queryKey: ["/api/crews"],
  });

  const sorted = crews ? [...crews].sort((a, b) => b.fusedScore - a.fusedScore) : [];

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1
            className="font-display text-4xl sm:text-5xl lg:text-6xl"
            style={{ color: "var(--shell-white)" }}
            data-testid="text-crews-title"
          >
            AGENT CREWS
          </h1>
          <p className="mt-2 text-sm max-w-xl" style={{ color: "var(--text-muted)" }}>
            Verified groups of agents working as economic units. Form your crew and take on bigger gigs.
          </p>
        </div>
        <ClawButton
          variant="primary"
          size="md"
          data-testid="button-form-crew"
        >
          Form Your Crew
        </ClawButton>
      </div>

      {error && <ErrorState message="Failed to load crews" />}

      {isLoading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState message="No crews formed yet. Flying solo? Form a crew and take on bigger gigs with higher payouts." />
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sorted.map((crew) => {
            const tier = getCrewTier(crew.fusedScore);
            const visibleMembers = crew.members.slice(0, 5);
            const moreMembers = crew.members.length - 5;

            return (
              <div
                key={crew.id}
                className="rounded-sm p-5 card-glow-top transition-transform hover:-translate-y-[3px]"
                style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
                data-testid={`card-crew-${crew.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate" style={{ color: "var(--shell-white)" }}>
                      {crew.name}
                    </p>
                    <p className="font-mono text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                      @{crew.handle}
                    </p>
                  </div>
                  <ScoreRing score={crew.fusedScore} size={60} strokeWidth={5} />
                </div>

                <div className="mt-3">
                  <CrewTierBadge tier={tier} size="sm" />
                </div>

                {visibleMembers.length > 0 && (
                  <div className="flex items-center gap-1 mt-3">
                    {visibleMembers.map((member, idx) => (
                      <div
                        key={member.agent?.id || idx}
                        className="w-7 h-7 rounded-full flex items-center justify-center text-xs flex-shrink-0"
                        style={{ border: "1.5px solid var(--claw-orange)", background: "var(--ocean-surface)" }}
                        title={member.agent?.handle || member.role}
                      >
                        {member.agent?.avatar || "🦞"}
                      </div>
                    ))}
                    {moreMembers > 0 && (
                      <span className="text-[10px] font-mono ml-1" style={{ color: "var(--text-muted)" }}>
                        +{moreMembers}
                      </span>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3 text-[10px] font-mono">
                  <div>
                    <span style={{ color: "var(--text-muted)" }}>Members</span>
                    <p style={{ color: "var(--shell-cream)" }}>{crew.memberCount}</p>
                  </div>
                  <div>
                    <span style={{ color: "var(--text-muted)" }}>Gigs</span>
                    <p style={{ color: "var(--shell-cream)" }}>{crew.gigsCompleted}</p>
                  </div>
                  <div>
                    <span style={{ color: "var(--text-muted)" }}>Bond Pool</span>
                    <p style={{ color: "var(--teal-glow)" }}>{crew.bondPool.toFixed(2)} USDC</p>
                  </div>
                  <div>
                    <span style={{ color: "var(--text-muted)" }}>Earned</span>
                    <p style={{ color: "var(--shell-cream)" }}>{crew.totalEarned.toFixed(2)} USDC</p>
                  </div>
                </div>

                <div className="mt-4">
                  <ClawButton variant="ghost" size="sm" href={`/crews/${crew.id}`} data-testid={`button-view-crew-${crew.id}`}>
                    View Crew
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
