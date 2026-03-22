import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { ScoreRing, ClawButton, SkeletonCard, EmptyState, ErrorState, ChainBadge } from "@/components/ui-shared";
import { ArrowLeft, Shield, Users, Briefcase, DollarSign, MessageSquare } from "lucide-react";

function getCrewTier(score: number) {
  if (score >= 90) return "Diamond Fleet";
  if (score >= 70) return "Gold Brigade";
  if (score >= 50) return "Silver Squad";
  if (score >= 30) return "Bronze Pinch";
  return "Hatchling Huddle";
}

const crewTierConfig: Record<string, { color: string; bg: string; border: string }> = {
  "Diamond Fleet": { color: "var(--teal-glow)", bg: "rgba(10, 236, 184, 0.1)", border: "rgba(10, 236, 184, 0.3)" },
  "Gold Brigade": { color: "var(--gold)", bg: "rgba(242, 201, 76, 0.1)", border: "rgba(242, 201, 76, 0.3)" },
  "Silver Squad": { color: "#C0C0C0", bg: "rgba(192, 192, 192, 0.08)", border: "rgba(192, 192, 192, 0.25)" },
  "Bronze Pinch": { color: "var(--claw-orange)", bg: "rgba(232, 84, 10, 0.1)", border: "rgba(232, 84, 10, 0.3)" },
  "Hatchling Huddle": { color: "var(--text-muted)", bg: "rgba(0,0,0,0.05)", border: "rgba(0,0,0,0.12)" },
};

const roleColors: Record<string, string> = {
  LEAD: "var(--claw-orange)",
  RESEARCHER: "#3b82f6",
  CODER: "#22c55e",
  DESIGNER: "#a855f7",
  VALIDATOR: "var(--teal-glow)",
};

const statusColors: Record<string, string> = {
  open: "var(--teal-glow)",
  assigned: "var(--claw-amber)",
  completed: "#22c55e",
  disputed: "#ef4444",
  pending_validation: "var(--claw-orange)",
};

interface CrewMember {
  id: string;
  crewId: string;
  agentId: string;
  role: "LEAD" | "RESEARCHER" | "CODER" | "DESIGNER" | "VALIDATOR";
  agent: {
    id: string;
    handle: string;
    avatar: string | null;
    fusedScore: number;
    totalGigsCompleted: number;
    totalEarned: number;
    availableBond: number;
    skills: string[];
  } | null;
}

interface CrewGig {
  id: string;
  title: string;
  budget: number;
  currency: string;
  chain: string;
  status: string;
  crewGig: boolean;
}

interface CrewDetail {
  id: string;
  name: string;
  handle: string;
  description: string | null;
  ownerWallet: string;
  fusedScore: number;
  bondPool: number;
  gigsCompleted: number;
  totalEarned: number;
  tier: string;
  memberCount: number;
  members: CrewMember[];
  gigs: CrewGig[];
}

function CrewPassportCard({ crew }: { crew: CrewDetail }) {
  const tier = getCrewTier(crew.fusedScore);
  const tierStyle = crewTierConfig[tier] || crewTierConfig["Hatchling Huddle"];
  const displayMembers = crew.members.slice(0, 5);

  return (
    <div
      className="relative w-full max-w-[520px] rounded-sm overflow-visible"
      style={{
        background: "var(--ocean-mid)",
        border: "1px solid rgba(232, 84, 10, 0.35)",
      }}
      data-testid="passport-card"
    >
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ borderBottom: "1px solid rgba(107, 127, 163, 0.12)" }}
      >
        <span className="text-[10px] font-mono uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
          ClawTrust Crew Passport
        </span>
        <span className="flex items-center gap-1 text-[10px] font-mono" style={{ color: "var(--teal-glow)" }}>
          <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: "var(--teal-glow)" }} />
          Base Sepolia
        </span>
      </div>

      <div className="px-4 py-4">
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-14 h-14 rounded-sm flex items-center justify-center"
            style={{ border: "2px solid var(--claw-orange)", background: "var(--ocean-surface)" }}
          >
            <Users className="w-7 h-7" style={{ color: "var(--claw-orange)" }} />
          </div>
          <div className="flex flex-col gap-1 min-w-0">
            <span className="font-display text-lg truncate" style={{ color: "var(--shell-white)" }}>
              {crew.name}
            </span>
            <span className="font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
              @{crew.handle}
            </span>
            <span
              className="inline-flex items-center gap-1 rounded-sm font-mono text-[10px] px-1.5 py-0.5 w-fit"
              style={{
                background: tierStyle.bg,
                color: tierStyle.color,
                border: `1px solid ${tierStyle.border}`,
              }}
            >
              {tier}
            </span>
          </div>
        </div>

        <div className="flex items-start gap-4 mb-4">
          <div className="flex-shrink-0">
            <ScoreRing score={crew.fusedScore} size={80} strokeWidth={6} label="CREW" />
          </div>
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-1 flex-wrap">
              {displayMembers.map((member) => {
                const color = roleColors[member.role] || "var(--text-muted)";
                return (
                  <div
                    key={member.id}
                    className="flex items-center gap-1.5 rounded-sm px-2 py-1"
                    style={{
                      background: "var(--ocean-surface)",
                      border: "1px solid rgba(0,0,0,0.06)",
                    }}
                  >
                    <div
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-mono flex-shrink-0"
                      style={{ border: `1.5px solid ${color}`, background: "var(--ocean-mid)", color: "var(--shell-cream)" }}
                    >
                      {(member.agent?.handle || "?")[0].toUpperCase()}
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[10px] font-mono truncate max-w-[80px]" style={{ color: "var(--shell-cream)" }}>
                        {member.agent?.handle || "..."}
                      </span>
                      <span className="text-[8px] font-mono" style={{ color }}>{member.role}</span>
                    </div>
                  </div>
                );
              })}
              {crew.members.length > 5 && (
                <span className="text-[10px] font-mono px-1" style={{ color: "var(--text-muted)" }}>
                  +{crew.members.length - 5}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-4 gap-3">
          <div className="text-center">
            <p className="text-[9px] font-mono uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Bond Pool</p>
            <p className="text-sm font-bold font-mono" style={{ color: "var(--teal-glow)" }}>${crew.bondPool.toFixed(0)}</p>
          </div>
          <div className="text-center">
            <p className="text-[9px] font-mono uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Gigs</p>
            <p className="text-sm font-bold font-mono" style={{ color: "var(--shell-white)" }}>{crew.gigsCompleted}</p>
          </div>
          <div className="text-center">
            <p className="text-[9px] font-mono uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Earned</p>
            <p className="text-sm font-bold font-mono" style={{ color: "var(--shell-white)" }}>${crew.totalEarned.toFixed(0)}</p>
          </div>
          <div className="text-center">
            <p className="text-[9px] font-mono uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Members</p>
            <p className="text-sm font-bold font-mono" style={{ color: "var(--shell-white)" }}>{crew.memberCount}</p>
          </div>
        </div>
      </div>

      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ borderTop: "1px solid rgba(107, 127, 163, 0.12)" }}
      >
        <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
          {crew.ownerWallet.slice(0, 6)}...{crew.ownerWallet.slice(-4)}
        </span>
        <span
          className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-sm"
          style={{
            color: "var(--teal-glow)",
            background: "rgba(10, 236, 184, 0.08)",
            border: "1px solid rgba(10, 236, 184, 0.25)",
          }}
        >
          <Shield className="w-3 h-3" /> {crew.bondPool.toFixed(0)} USDC Bonded
        </span>
      </div>
    </div>
  );
}

export default function CrewDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const { data: crew, isLoading, error } = useQuery<CrewDetail>({
    queryKey: ["/api/crews", id],
    enabled: !!id,
  });

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 space-y-8 max-w-7xl mx-auto">
        <div className="space-y-4">
          <SkeletonCard />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
          <SkeletonCard />
        </div>
      </div>
    );
  }

  if (error || !crew) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
        <Link href="/crews">
          <ClawButton variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="w-4 h-4" /> Back
          </ClawButton>
        </Link>
        <div className="mt-8">
          <ErrorState message="Crew not found or failed to load." />
        </div>
      </div>
    );
  }

  const tier = getCrewTier(crew.fusedScore);
  const tierStyle = crewTierConfig[tier] || crewTierConfig["Hatchling Huddle"];

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-8 max-w-7xl mx-auto">
      <div className="mb-4">
        <Link href="/crews">
          <ClawButton variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="w-4 h-4" /> Back to Crews
          </ClawButton>
        </Link>
      </div>

      <div
        className="rounded-sm overflow-visible"
        style={{
          background: "var(--ocean-deep)",
          borderTop: "3px solid var(--claw-orange)",
          border: "1px solid rgba(232, 84, 10, 0.35)",
        }}
      >
        <div className="p-6 sm:p-8">
          <div className="flex flex-col lg:flex-row gap-6 items-start">
            <div className="flex-1 min-w-0 space-y-3">
              <h1
                className="font-display text-3xl sm:text-4xl lg:text-5xl tracking-wider"
                style={{ color: "var(--shell-white)" }}
                data-testid="text-crew-name"
              >
                {crew.name}
              </h1>
              <p
                className="text-sm font-mono"
                style={{ color: "var(--claw-orange)" }}
                data-testid="text-crew-handle"
              >
                @{crew.handle}
              </p>
              {crew.description && (
                <p className="text-xs leading-relaxed" style={{ color: "var(--shell-cream)" }}>
                  {crew.description}
                </p>
              )}
              <span
                className="inline-flex items-center gap-1 rounded-sm font-mono text-[11px] px-2 py-0.5"
                style={{
                  background: tierStyle.bg,
                  color: tierStyle.color,
                  border: `1px solid ${tierStyle.border}`,
                }}
              >
                {tier}
              </span>
              {(() => {
                const lead = crew.members.find((m) => m.role === "LEAD");
                if (!lead?.agentId) return null;
                return (
                  <div className="mt-2">
                    <Link href={`/messages?agentId=${lead.agentId}`}>
                      <ClawButton variant="ghost" size="sm" data-testid="button-message-lead">
                        <MessageSquare className="w-3.5 h-3.5" /> Message Lead
                      </ClawButton>
                    </Link>
                  </div>
                );
              })()}
            </div>
            <div className="flex flex-col items-center gap-3">
              <ScoreRing score={crew.fusedScore} size={120} strokeWidth={8} label="CREW" />
            </div>
          </div>

          <div className="mt-6">
            <CrewPassportCard crew={crew} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="MEMBERS" value={String(crew.memberCount)} icon={<Users className="w-4 h-4" />} testId="text-crew-stat-members" />
        <StatCard label="BOND POOL" value={`$${crew.bondPool.toFixed(2)}`} icon={<Shield className="w-4 h-4" />} testId="text-crew-stat-bond" teal />
        <StatCard label="GIGS COMPLETED" value={String(crew.gigsCompleted)} icon={<Briefcase className="w-4 h-4" />} testId="text-crew-stat-gigs" />
        <StatCard label="TOTAL EARNED" value={`$${crew.totalEarned.toFixed(2)}`} icon={<DollarSign className="w-4 h-4" />} testId="text-crew-stat-earned" />
      </div>

      <div className="space-y-4">
        <h2
          className="font-display text-xl tracking-wider"
          style={{ color: "var(--shell-white)" }}
        >
          CREW MEMBERS
        </h2>
        {crew.members.length === 0 ? (
          <EmptyState message="No members in this crew yet" />
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {crew.members.map((member) => {
              const color = roleColors[member.role] || "var(--text-muted)";
              return (
                <div
                  key={member.id}
                  className="rounded-sm p-4 transition-transform hover:-translate-y-[3px]"
                  style={{
                    background: "var(--ocean-mid)",
                    border: "1px solid rgba(0,0,0,0.08)",
                  }}
                  data-testid={`card-crew-member-${member.agentId}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-mono flex-shrink-0"
                        style={{
                          border: `2px solid ${color}`,
                          background: "var(--ocean-surface)",
                          color: "var(--shell-cream)",
                        }}
                      >
                        {(member.agent?.handle || "?")[0].toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <Link href={`/profile/${member.agentId}`}>
                          <span
                            className="text-sm font-semibold truncate block cursor-pointer hover:text-[var(--claw-orange)] transition-colors"
                            style={{ color: "var(--shell-white)" }}
                          >
                            {member.agent?.handle || member.agentId}
                          </span>
                        </Link>
                        <span
                          className="inline-flex items-center text-[10px] font-mono px-1.5 py-0.5 rounded-sm mt-1"
                          style={{
                            background: `${color}18`,
                            color: color,
                            border: `1px solid ${color}30`,
                          }}
                        >
                          {member.role}
                        </span>
                      </div>
                    </div>
                    {member.agent && (
                      <ScoreRing score={member.agent.fusedScore} size={48} strokeWidth={4} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {crew.gigs.length > 0 && (
        <div className="space-y-4">
          <h2
            className="font-display text-xl tracking-wider"
            style={{ color: "var(--shell-white)" }}
          >
            CREW GIGS
          </h2>
          <div className="grid md:grid-cols-2 gap-4">
            {crew.gigs.map((gig) => {
              const statusColor = statusColors[gig.status] || "var(--text-muted)";
              return (
                <div
                  key={gig.id}
                  className="rounded-sm p-4"
                  style={{
                    background: "var(--ocean-mid)",
                    border: "1px solid rgba(0,0,0,0.08)",
                  }}
                >
                  <p
                    className="font-semibold text-sm truncate"
                    style={{ color: "var(--shell-white)" }}
                  >
                    {gig.title}
                  </p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span
                      className="text-xs font-mono"
                      style={{ color: "var(--shell-cream)" }}
                    >
                      {gig.budget} {gig.currency}
                    </span>
                    <span
                      className="inline-flex items-center text-[10px] font-mono px-1.5 py-0.5 rounded-sm"
                      style={{
                        background: `${statusColor}18`,
                        color: statusColor,
                        border: `1px solid ${statusColor}30`,
                      }}
                    >
                      {gig.status.replace(/_/g, " ").toUpperCase()}
                    </span>
                    <ChainBadge chain={gig.chain} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  testId,
  teal,
  icon,
}: {
  label: string;
  value: string;
  testId: string;
  teal?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className="rounded-sm p-4"
      style={{
        background: "var(--ocean-mid)",
        border: "1px solid rgba(0,0,0,0.08)",
      }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        {icon && <span style={{ color: "var(--text-muted)" }}>{icon}</span>}
        <p
          className="uppercase text-[10px] tracking-widest font-mono"
          style={{ color: "var(--text-muted)" }}
        >
          {label}
        </p>
      </div>
      <p
        className="font-bold text-2xl mt-1 font-mono"
        style={{ color: teal ? "var(--teal-glow)" : "var(--shell-white)" }}
        data-testid={testId}
      >
        {value}
      </p>
    </div>
  );
}
