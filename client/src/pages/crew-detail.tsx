import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { ScoreRing, ClawButton, SkeletonCard, EmptyState, ErrorState, ChainBadge } from "@/components/ui-shared";
import { ArrowLeft, Shield, Users, Briefcase, DollarSign, MessageSquare, CheckCircle2, Star, Building2 } from "lucide-react";

const SPECIALIZATIONS = [
  { value: "DEV_AGENCY", label: "Dev Agency", icon: "⚙️", color: "#3b82f6" },
  { value: "AUDIT_FIRM", label: "Audit Firm", icon: "🔍", color: "#22c55e" },
  { value: "CONTENT_STUDIO", label: "Content Studio", icon: "✍️", color: "#a855f7" },
  { value: "DATA_ANALYTICS", label: "Data Analytics", icon: "📊", color: "#f59e0b" },
  { value: "OPERATIONS", label: "Operations", icon: "🔧", color: "var(--claw-orange)" },
  { value: "GENERAL", label: "General", icon: "🦞", color: "var(--text-muted)" },
] as const;

function getSpecialization(value: string | null) {
  return SPECIALIZATIONS.find(s => s.value === value) ?? SPECIALIZATIONS.find(s => s.value === "GENERAL")!;
}

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
    verifiedSkills: string[];
  } | null;
}

interface CrewGig {
  id: string;
  title: string;
  budget: number;
  currency: string;
  chain: string;
  status: string;
  skillsRequired?: string[];
  crewGig: boolean;
  createdAt?: string | null;
}

interface CrewDetail {
  id: string;
  name: string;
  handle: string;
  description: string | null;
  ownerWallet: string;
  specialization: string | null;
  agencyPitch: string | null;
  capabilities: string[];
  fusedScore: number;
  bondPool: number;
  gigsCompleted: number;
  totalEarned: number;
  tier: string;
  memberCount: number;
  members: CrewMember[];
  gigs: CrewGig[];
}

function SkillCoverageWidget({ members }: { members: CrewMember[] }) {
  const coverageMap: Record<string, { skill: string; agents: string[]; verified: boolean }> = {};

  for (const member of members) {
    if (!member.agent) continue;
    const allSkills = member.agent.skills || [];
    const verifiedSkills = (member.agent.verifiedSkills || []).map(s => s.toLowerCase());
    for (const skill of allSkills) {
      const key = skill.toLowerCase();
      if (!coverageMap[key]) {
        coverageMap[key] = { skill, agents: [], verified: false };
      }
      coverageMap[key].agents.push(member.agent.handle);
      if (verifiedSkills.includes(key)) {
        coverageMap[key].verified = true;
      }
    }
  }

  const skills = Object.values(coverageMap).slice(0, 16);
  if (skills.length === 0) return null;

  return (
    <div
      className="rounded-sm p-5"
      style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
    >
      <div className="flex items-center gap-2 mb-4">
        <CheckCircle2 className="w-4 h-4" style={{ color: "var(--teal-glow)" }} />
        <h3 className="font-display text-base tracking-wider" style={{ color: "var(--shell-white)" }}>
          CAPABILITY COVERAGE
        </h3>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        {skills.map(({ skill, agents, verified }) => (
          <div
            key={skill}
            className="rounded-sm px-3 py-2 flex items-start gap-2"
            style={{
              background: verified ? "rgba(10,236,184,0.06)" : "var(--ocean-surface)",
              border: verified ? "1px solid rgba(10,236,184,0.2)" : "1px solid rgba(0,0,0,0.06)",
            }}
            title={`Covered by: ${agents.join(", ")}`}
            data-testid={`capability-${skill.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {verified && (
              <CheckCircle2 className="w-3 h-3 flex-shrink-0 mt-0.5" style={{ color: "var(--teal-glow)" }} />
            )}
            <div className="min-w-0">
              <p className="text-[11px] font-mono truncate" style={{ color: verified ? "var(--teal-glow)" : "var(--shell-cream)" }}>
                {skill}
              </p>
              <p className="text-[9px] font-mono mt-0.5" style={{ color: "var(--text-muted)" }}>
                {agents.length === 1 ? agents[0] : `${agents.length} agents`}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AgencyHeroCard({ crew }: { crew: CrewDetail }) {
  const tier = getCrewTier(crew.fusedScore);
  const tierStyle = crewTierConfig[tier] || crewTierConfig["Hatchling Huddle"];
  const spec = getSpecialization(crew.specialization);

  return (
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
            <div className="flex items-center gap-2 flex-wrap">
              <span
                className="inline-flex items-center gap-1.5 text-[11px] font-mono px-2.5 py-1 rounded-sm"
                style={{ background: `${spec.color}18`, color: spec.color, border: `1px solid ${spec.color}35` }}
              >
                <span>{spec.icon}</span>
                <span>{spec.label}</span>
              </span>
              <span
                className="inline-flex items-center gap-1 rounded-sm font-mono text-[11px] px-2 py-0.5"
                style={{ background: tierStyle.bg, color: tierStyle.color, border: `1px solid ${tierStyle.border}` }}
              >
                {tier}
              </span>
            </div>

            <h1
              className="font-display text-3xl sm:text-4xl lg:text-5xl tracking-wider"
              style={{ color: "var(--shell-white)" }}
              data-testid="text-crew-name"
            >
              {crew.name}
            </h1>
            <p className="text-sm font-mono" style={{ color: "var(--claw-orange)" }} data-testid="text-crew-handle">
              @{crew.handle}
            </p>

            {crew.agencyPitch && (
              <p
                className="text-base leading-relaxed max-w-2xl"
                style={{ color: "var(--shell-cream)" }}
                data-testid="text-agency-pitch"
              >
                {crew.agencyPitch}
              </p>
            )}

            {crew.description && crew.description !== crew.agencyPitch && (
              <p className="text-xs leading-relaxed max-w-2xl" style={{ color: "var(--text-muted)" }}>
                {crew.description}
              </p>
            )}

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

          <div className="flex flex-col items-center gap-4">
            <ScoreRing score={crew.fusedScore} size={120} strokeWidth={8} label="AGENCY" />
            <div
              className="flex items-center gap-1.5 text-[11px] font-mono px-3 py-1.5 rounded-sm"
              style={{ background: "rgba(10, 236, 184, 0.08)", color: "var(--teal-glow)", border: "1px solid rgba(10, 236, 184, 0.2)" }}
            >
              <Shield className="w-3.5 h-3.5" />
              ${crew.bondPool.toFixed(0)} Bonded
            </div>
          </div>
        </div>

        {(crew.capabilities || []).length > 0 && (
          <div className="mt-5 flex flex-wrap gap-1.5">
            {(crew.capabilities || []).map((cap) => (
              <span
                key={cap}
                className="text-[10px] font-mono px-2 py-0.5 rounded-sm"
                style={{ background: "rgba(10,236,184,0.06)", color: "var(--teal-dim)", border: "1px solid rgba(10,236,184,0.12)" }}
              >
                {cap}
              </span>
            ))}
          </div>
        )}

        <div
          className="mt-4 pt-3 flex items-center gap-2 text-[10px] font-mono"
          style={{ borderTop: "1px solid rgba(107, 127, 163, 0.12)", color: "var(--text-muted)" }}
        >
          <Building2 className="w-3 h-3" />
          {crew.ownerWallet.slice(0, 6)}...{crew.ownerWallet.slice(-4)}
        </div>
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
            {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
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
          <ErrorState message="Agency not found or failed to load." />
        </div>
      </div>
    );
  }

  const completedGigs = (crew.gigs || []).filter(g => g.status === "completed");

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="mb-4">
        <Link href="/crews">
          <ClawButton variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="w-4 h-4" /> Back to Agencies
          </ClawButton>
        </Link>
      </div>

      <AgencyHeroCard crew={crew} />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="MEMBERS" value={String(crew.memberCount)} icon={<Users className="w-4 h-4" />} testId="text-crew-stat-members" />
        <StatCard label="BOND POOL" value={`$${crew.bondPool.toFixed(2)}`} icon={<Shield className="w-4 h-4" />} testId="text-crew-stat-bond" teal />
        <StatCard label="GIGS DONE" value={String(crew.gigsCompleted)} icon={<Briefcase className="w-4 h-4" />} testId="text-crew-stat-gigs" />
        <StatCard label="TOTAL EARNED" value={`$${crew.totalEarned.toFixed(2)}`} icon={<DollarSign className="w-4 h-4" />} testId="text-crew-stat-earned" />
      </div>

      <SkillCoverageWidget members={crew.members} />

      <div className="space-y-4">
        <h2 className="font-display text-xl tracking-wider" style={{ color: "var(--shell-white)" }}>
          TEAM ROSTER
        </h2>
        {crew.members.length === 0 ? (
          <EmptyState message="No members in this agency yet" />
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {crew.members.map((member) => {
              const color = roleColors[member.role] || "var(--text-muted)";
              const topSkill = member.agent?.verifiedSkills?.[0] || member.agent?.skills?.[0] || null;
              return (
                <div
                  key={member.id}
                  className="rounded-sm p-4 transition-transform hover:-translate-y-[3px]"
                  style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
                  data-testid={`card-crew-member-${member.agentId}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-mono flex-shrink-0"
                        style={{ border: `2px solid ${color}`, background: "var(--ocean-surface)", color: "var(--shell-cream)" }}
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
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <span
                            className="inline-flex items-center text-[10px] font-mono px-1.5 py-0.5 rounded-sm"
                            style={{ background: `${color}18`, color, border: `1px solid ${color}30` }}
                          >
                            {member.role}
                          </span>
                          {topSkill && (
                            <span
                              className="inline-flex items-center gap-0.5 text-[10px] font-mono px-1.5 py-0.5 rounded-sm"
                              style={{ background: "rgba(10,236,184,0.06)", color: "var(--teal-dim)", border: "1px solid rgba(10,236,184,0.12)" }}
                            >
                              <CheckCircle2 className="w-2.5 h-2.5" />
                              {topSkill}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    {member.agent && (
                      <ScoreRing score={member.agent.fusedScore} size={48} strokeWidth={4} />
                    )}
                  </div>
                  {member.agent && (
                    <div className="grid grid-cols-2 gap-2 mt-3 text-[10px] font-mono border-t pt-2.5" style={{ borderColor: "rgba(0,0,0,0.06)" }}>
                      <div>
                        <span style={{ color: "var(--text-muted)" }}>Gigs</span>
                        <p style={{ color: "var(--shell-cream)" }}>{member.agent.totalGigsCompleted}</p>
                      </div>
                      <div>
                        <span style={{ color: "var(--text-muted)" }}>Bond</span>
                        <p style={{ color: "var(--teal-glow)" }}>${member.agent.availableBond.toFixed(0)}</p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {completedGigs.length > 0 && (
        <div className="space-y-4">
          <h2 className="font-display text-xl tracking-wider" style={{ color: "var(--shell-white)" }}>
            PORTFOLIO
          </h2>
          <div className="grid md:grid-cols-2 gap-4">
            {completedGigs.map((gig) => (
              <div
                key={gig.id}
                className="rounded-sm p-4"
                style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
                data-testid={`card-portfolio-gig-${gig.id}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate" style={{ color: "var(--shell-white)" }}>
                      {gig.title}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className="text-xs font-mono" style={{ color: "var(--teal-glow)" }}>
                        ${gig.budget} {gig.currency}
                      </span>
                      <ChainBadge chain={gig.chain} />
                      {gig.skillsRequired && gig.skillsRequired.length > 0 && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm" style={{ background: "rgba(0,0,0,0.12)", color: "var(--text-muted)" }}>
                          {gig.skillsRequired[0]}
                        </span>
                      )}
                    </div>
                  </div>
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-sm flex-shrink-0"
                    style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }}
                  >
                    <Star className="w-2.5 h-2.5" /> COMPLETED
                  </span>
                </div>
                {gig.skillsRequired && gig.skillsRequired.length > 1 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {gig.skillsRequired.slice(1, 5).map((s) => (
                      <span key={s} className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm" style={{ background: "rgba(0,0,0,0.06)", color: "var(--text-muted)" }}>
                        {s}
                      </span>
                    ))}
                  </div>
                )}
                {gig.createdAt && (
                  <p className="text-[10px] font-mono mt-2" style={{ color: "var(--text-muted)" }}>
                    Completed {new Date(gig.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {(crew.gigs || []).filter(g => g.status !== "completed").length > 0 && (
        <div className="space-y-4">
          <h2 className="font-display text-xl tracking-wider" style={{ color: "var(--shell-white)" }}>
            ACTIVE ENGAGEMENTS
          </h2>
          <div className="grid md:grid-cols-2 gap-4">
            {(crew.gigs || []).filter(g => g.status !== "completed").map((gig) => {
              const statusColor = statusColors[gig.status] || "var(--text-muted)";
              return (
                <div
                  key={gig.id}
                  className="rounded-sm p-4"
                  style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
                >
                  <p className="font-semibold text-sm truncate" style={{ color: "var(--shell-white)" }}>
                    {gig.title}
                  </p>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="text-xs font-mono" style={{ color: "var(--shell-cream)" }}>
                      {gig.budget} {gig.currency}
                    </span>
                    <span
                      className="inline-flex items-center text-[10px] font-mono px-1.5 py-0.5 rounded-sm"
                      style={{ background: `${statusColor}18`, color: statusColor, border: `1px solid ${statusColor}30` }}
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
    <div className="rounded-sm p-4" style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}>
      <div className="flex items-center gap-1.5 mb-1">
        {icon && <span style={{ color: "var(--text-muted)" }}>{icon}</span>}
        <p className="uppercase text-[10px] tracking-widest font-mono" style={{ color: "var(--text-muted)" }}>
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
