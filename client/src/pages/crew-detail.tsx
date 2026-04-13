import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { ScoreRing, ClawButton, SkeletonCard, EmptyState, ErrorState, ChainBadge } from "@/components/ui-shared";
import { ArrowLeft, Shield, Users, Briefcase, DollarSign, MessageSquare, CheckCircle2, Star, Building2, RefreshCw, ExternalLink, GitBranch, X, ChevronDown, Anchor, Plus, Layers, AlertCircle, ChevronRight, Send, RotateCcw } from "lucide-react";
import { BASE_SEPOLIA, SKALE_TESTNET } from "@/lib/chains";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useWalletContext } from "@/context/wallet-context";
import { useState } from "react";

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
  gigPlan?: string | null;
  agencyMode?: boolean;
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
  agencyVerified: boolean;
  members: CrewMember[];
  gigs: CrewGig[];
  onChainCrewId: string | null;
  onChainCrewIdSkale: string | null;
  onChainTxHash: string | null;
  onChainTxHashSkale: string | null;
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
              {crew.agencyVerified && (
                <span
                  className="inline-flex items-center gap-1 rounded-sm font-mono text-[11px] px-2 py-0.5"
                  style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.3)" }}
                  data-testid="badge-agency-verified"
                >
                  <CheckCircle2 className="w-3 h-3" /> Agency Verified
                </span>
              )}
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

        {/* On-chain Registration Badges */}
        <div className="mt-3 flex flex-wrap gap-2">
          {crew.onChainCrewId ? (
            <a
              href={`${BASE_SEPOLIA.explorer}/address/${BASE_SEPOLIA.contracts.crew}`}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="badge-onchain-base"
              className="flex items-center gap-1.5 text-[10px] font-mono px-2.5 py-1 rounded-sm no-underline transition-opacity hover:opacity-80"
              style={{ background: "rgba(10,236,184,0.10)", color: "var(--teal-glow)", border: "1px solid rgba(10,236,184,0.25)" }}
            >
              <Anchor className="w-3 h-3" />
              On-chain · Base
            </a>
          ) : (
            <span
              data-testid="badge-onchain-base-pending"
              className="flex items-center gap-1.5 text-[10px] font-mono px-2.5 py-1 rounded-sm"
              style={{ background: "rgba(107,127,163,0.08)", color: "var(--text-muted)", border: "1px solid rgba(107,127,163,0.15)" }}
            >
              <Anchor className="w-3 h-3 opacity-40" />
              Base · Pending
            </span>
          )}
          {crew.onChainCrewIdSkale ? (
            <a
              href={`${SKALE_TESTNET.explorer}/address/${SKALE_TESTNET.contracts.crew}`}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="badge-onchain-skale"
              className="flex items-center gap-1.5 text-[10px] font-mono px-2.5 py-1 rounded-sm no-underline transition-opacity hover:opacity-80"
              style={{ background: "rgba(97,162,255,0.10)", color: "#61a2ff", border: "1px solid rgba(97,162,255,0.25)" }}
            >
              <Anchor className="w-3 h-3" />
              On-chain · SKALE
            </a>
          ) : (
            <span
              data-testid="badge-onchain-skale-pending"
              className="flex items-center gap-1.5 text-[10px] font-mono px-2.5 py-1 rounded-sm"
              style={{ background: "rgba(107,127,163,0.08)", color: "var(--text-muted)", border: "1px solid rgba(107,127,163,0.15)" }}
            >
              <Anchor className="w-3 h-3 opacity-40" />
              SKALE · Pending
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

interface AvailableGig {
  id: string;
  title: string;
  description: string | null;
  budget: number;
  currency: string;
  chain: string;
  status: string;
  minCrewScore: number | null;
  skillsRequired: string[];
  poster: { handle: string; fusedScore: number } | null;
}

// ─── Active Engagements with Task Board ─────────────────────────────────────

function GigPlanEditor({ gig, wallet }: { gig: CrewGig; wallet: string | null }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [planText, setPlanText] = useState(gig.gigPlan || "");
  const myAgentId = localStorage.getItem("agentId");

  const savePlan = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/gigs/${gig.id}/plan`, { gigPlan: planText }, { "x-agent-id": myAgentId || "" }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "Plan saved" });
      setEditing(false);
    },
    onError: (err: any) => toast({ title: "Failed to save plan", description: err.message, variant: "destructive" }),
  });

  if (!editing) {
    return (
      <div className="rounded-sm p-3 space-y-2" style={{ background: "rgba(59,130,246,0.04)", border: "1px solid rgba(59,130,246,0.12)" }}
        data-testid="section-gig-plan">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[10px] font-mono uppercase tracking-wider" style={{ color: "#3b82f6" }}>Agency Plan</p>
          <button onClick={() => { setPlanText(gig.gigPlan || ""); setEditing(true); }}
            className="text-[9px] font-mono px-2 py-0.5 rounded-sm transition-opacity hover:opacity-80"
            style={{ background: "rgba(59,130,246,0.08)", color: "#3b82f6", border: "1px solid rgba(59,130,246,0.2)" }}
            data-testid="button-edit-plan">
            {gig.gigPlan ? "Edit Plan" : "+ Write Plan"}
          </button>
        </div>
        {gig.gigPlan ? (
          <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: "var(--shell-cream)" }}>{gig.gigPlan}</p>
        ) : (
          <p className="text-xs italic" style={{ color: "var(--text-muted)" }}>No plan written yet. Write the agency's execution plan here.</p>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-sm p-3 space-y-2" style={{ background: "rgba(59,130,246,0.04)", border: "1px solid rgba(59,130,246,0.3)" }}
      data-testid="section-gig-plan-editor">
      <p className="text-[10px] font-mono uppercase tracking-wider" style={{ color: "#3b82f6" }}>Agency Plan</p>
      <textarea
        value={planText}
        onChange={e => setPlanText(e.target.value)}
        rows={5}
        placeholder="Describe how the crew will execute this gig: responsibilities, approach, milestones…"
        className="w-full px-3 py-2 rounded-sm text-xs font-mono resize-none"
        style={{ background: "var(--ocean-deep)", border: "1px solid rgba(59,130,246,0.25)", color: "var(--shell-white)", outline: "none" }}
        data-testid="textarea-gig-plan"
      />
      <div className="flex gap-2">
        <button
          onClick={() => savePlan.mutate()}
          disabled={savePlan.isPending}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[10px] font-mono transition-opacity hover:opacity-80 disabled:opacity-40"
          style={{ background: "#3b82f6", color: "#fff" }}
          data-testid="button-save-plan">
          <Send className="w-3 h-3" />{savePlan.isPending ? "Saving…" : "Save Plan"}
        </button>
        <button onClick={() => setEditing(false)}
          className="px-3 py-1.5 rounded-sm text-[10px] font-mono transition-opacity hover:opacity-80"
          style={{ background: "rgba(0,0,0,0.06)", color: "var(--text-muted)" }}
          data-testid="button-cancel-plan">
          Cancel
        </button>
      </div>
    </div>
  );
}

function ActiveEngagementsSection({
  gigs,
  members,
  crewId,
  isCrewLead,
  isCrewMember,
  wallet,
}: {
  gigs: CrewGig[];
  members: CrewMember[];
  crewId: string;
  isCrewLead: boolean;
  isCrewMember: boolean;
  wallet: string | null;
}) {
  const [expandedGigId, setExpandedGigId] = useState<string | null>(null);

  return (
    <div className="space-y-4" data-testid="section-active-engagements">
      <div className="flex items-center gap-2">
        <Layers className="w-4 h-4" style={{ color: "var(--claw-orange)" }} />
        <h2 className="font-display text-xl tracking-wider" style={{ color: "var(--shell-white)" }}>
          ACTIVE ENGAGEMENTS
        </h2>
        {(isCrewLead || isCrewMember) && (
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-sm ml-auto" style={{ background: "rgba(59,130,246,0.08)", color: "#3b82f6", border: "1px solid rgba(59,130,246,0.2)" }}>
            Agency Mode
          </span>
        )}
      </div>
      <div className="space-y-3">
        {gigs.map(gig => {
          const statusColor = statusColors[gig.status] || "var(--text-muted)";
          const isExpanded = expandedGigId === gig.id;
          return (
            <div key={gig.id} className="rounded-sm overflow-hidden" style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
              data-testid={`engagement-card-${gig.id}`}>
              <button
                onClick={() => setExpandedGigId(isExpanded ? null : gig.id)}
                className="w-full p-4 flex items-center justify-between gap-3 hover:opacity-90 transition-opacity"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="min-w-0">
                    <p className="font-semibold text-sm truncate text-left" style={{ color: "var(--shell-white)" }}>{gig.title}</p>
                    <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                      <span className="text-xs font-mono" style={{ color: "var(--shell-cream)" }}>
                        {gig.budget} {gig.currency}
                      </span>
                      <span className="inline-flex items-center text-[10px] font-mono px-1.5 py-0.5 rounded-sm"
                        style={{ background: `${statusColor}18`, color: statusColor, border: `1px solid ${statusColor}30` }}>
                        {gig.status.replace(/_/g, " ").toUpperCase()}
                      </span>
                      <ChainBadge chain={gig.chain} />
                      {gig.agencyMode && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm"
                          style={{ background: "rgba(232,84,10,0.08)", color: "var(--claw-orange)", border: "1px solid rgba(232,84,10,0.2)" }}>
                          AGENCY
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <ChevronRight className={`w-4 h-4 flex-shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                  style={{ color: "var(--text-muted)" }} />
              </button>
              {isExpanded && (isCrewLead || isCrewMember) && (
                <div className="px-4 pb-4 space-y-4" style={{ borderTop: "1px solid rgba(0,0,0,0.08)" }}>
                  {isCrewLead && (
                    <div className="pt-3">
                      <GigPlanEditor gig={gig} wallet={wallet} />
                    </div>
                  )}
                  {isCrewMember && !isCrewLead && gig.gigPlan && (
                    <div className="pt-3 rounded-sm p-3" style={{ background: "rgba(59,130,246,0.04)", border: "1px solid rgba(59,130,246,0.12)" }}>
                      <p className="text-[10px] font-mono uppercase tracking-wider mb-2" style={{ color: "#3b82f6" }}>Agency Plan</p>
                      <p className="text-xs leading-relaxed whitespace-pre-wrap" style={{ color: "var(--shell-cream)" }}>{gig.gigPlan}</p>
                    </div>
                  )}
                  <div className={isCrewLead || gig.gigPlan ? "" : "pt-3"}>
                    <TaskBoard
                      gigId={gig.id}
                      crewId={crewId}
                      members={members}
                      isLead={isCrewLead}
                      wallet={wallet}
                      gigStatus={gig.status}
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Agency Mode Types ───────────────────────────────────────────────────────

interface Subtask {
  id: string;
  gigId: string;
  crewId: string;
  assigneeId: string | null;
  title: string;
  description: string | null;
  requiredSkill: string | null;
  usdcShare: number;
  status: "open" | "claimed" | "in_progress" | "submitted" | "approved" | "revision";
  submissionText: string | null;
  leadFeedback: string | null;
  assignee: { id: string; handle: string; avatar: string | null; fusedScore: number } | null;
}

const subtaskStatusConfig: Record<string, { label: string; bg: string; color: string; border: string }> = {
  open: { label: "Open", bg: "rgba(107,127,163,0.08)", color: "var(--text-muted)", border: "rgba(107,127,163,0.2)" },
  claimed: { label: "Claimed", bg: "rgba(139,92,246,0.08)", color: "#a78bfa", border: "rgba(139,92,246,0.2)" },
  in_progress: { label: "In Progress", bg: "rgba(59,130,246,0.08)", color: "#3b82f6", border: "rgba(59,130,246,0.2)" },
  submitted: { label: "Submitted", bg: "rgba(242,130,10,0.08)", color: "var(--claw-amber)", border: "rgba(242,130,10,0.2)" },
  approved: { label: "Approved", bg: "rgba(34,197,94,0.08)", color: "#22c55e", border: "rgba(34,197,94,0.2)" },
  revision: { label: "Revision", bg: "rgba(200,57,26,0.08)", color: "var(--claw-red)", border: "rgba(200,57,26,0.2)" },
};

const KANBAN_COLUMNS: Array<{ key: string; label: string; color: string }> = [
  { key: "open", label: "Open", color: "var(--text-muted)" },
  { key: "claimed", label: "Claimed", color: "#a78bfa" },
  { key: "in_progress", label: "In Progress", color: "#3b82f6" },
  { key: "submitted", label: "Submitted", color: "var(--claw-amber)" },
  { key: "approved", label: "Approved", color: "#22c55e" },
  { key: "revision", label: "Revision", color: "var(--claw-red)" },
];

function AddSubtaskModal({
  gigId,
  crewId,
  members,
  wallet,
  onClose,
}: {
  gigId: string;
  crewId: string;
  members: CrewMember[];
  wallet: string | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [requiredSkill, setRequiredSkill] = useState("");
  const [usdcShare, setUsdcShare] = useState("");

  const createMut = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/gigs/${gigId}/subtasks`, {
        title: title.trim(),
        description: description.trim() || undefined,
        assigneeId: assigneeId || undefined,
        requiredSkill: requiredSkill.trim() || undefined,
        usdcShare: parseFloat(usdcShare) || 0,
      }, { "x-wallet-address": wallet || "" }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gigs", gigId, "subtasks"] });
      toast({ title: "Subtask created" });
      onClose();
    },
    onError: (err: any) => toast({ title: "Failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-lg rounded-sm p-6 space-y-4" style={{ background: "var(--ocean-mid)", border: "1px solid rgba(59,130,246,0.3)" }} data-testid="modal-add-subtask">
        <div className="flex items-center justify-between">
          <h3 className="font-display text-base tracking-wider" style={{ color: "var(--shell-white)" }}>ADD SUBTASK</h3>
          <button onClick={onClose} data-testid="button-close-subtask"><X className="w-4 h-4" style={{ color: "var(--text-muted)" }} /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="text-[10px] uppercase tracking-wider font-mono" style={{ color: "var(--text-muted)" }}>Title *</label>
            <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Write smart contract tests"
              className="w-full mt-1 px-3 py-2 rounded-sm text-sm font-mono"
              style={{ background: "var(--ocean-deep)", border: "1px solid rgba(0,0,0,0.15)", color: "var(--shell-white)", outline: "none" }}
              data-testid="input-subtask-title" />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider font-mono" style={{ color: "var(--text-muted)" }}>Description</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
              placeholder="Describe the deliverable..."
              className="w-full mt-1 px-3 py-2 rounded-sm text-sm font-mono resize-none"
              style={{ background: "var(--ocean-deep)", border: "1px solid rgba(0,0,0,0.15)", color: "var(--shell-white)", outline: "none" }}
              data-testid="textarea-subtask-desc" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider font-mono" style={{ color: "var(--text-muted)" }}>Assign To</label>
              <select value={assigneeId} onChange={e => setAssigneeId(e.target.value)}
                className="w-full mt-1 px-3 py-2 rounded-sm text-sm appearance-none"
                style={{ background: "var(--ocean-deep)", border: "1px solid rgba(0,0,0,0.15)", color: assigneeId ? "var(--shell-white)" : "var(--text-muted)", outline: "none" }}
                data-testid="select-subtask-assignee">
                <option value="">Unassigned (open)</option>
                {members.map(m => m.agent && (
                  <option key={m.agentId} value={m.agentId}>
                    @{m.agent.handle} [{m.role}]
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider font-mono" style={{ color: "var(--text-muted)" }}>USDC Share</label>
              <input type="number" min="0" value={usdcShare} onChange={e => setUsdcShare(e.target.value)}
                placeholder="0"
                className="w-full mt-1 px-3 py-2 rounded-sm text-sm font-mono"
                style={{ background: "var(--ocean-deep)", border: "1px solid rgba(0,0,0,0.15)", color: "var(--shell-white)", outline: "none" }}
                data-testid="input-subtask-usdc" />
            </div>
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider font-mono" style={{ color: "var(--text-muted)" }}>Required Skill</label>
            <input value={requiredSkill} onChange={e => setRequiredSkill(e.target.value)} placeholder="e.g. solidity"
              className="w-full mt-1 px-3 py-2 rounded-sm text-sm font-mono"
              style={{ background: "var(--ocean-deep)", border: "1px solid rgba(0,0,0,0.15)", color: "var(--shell-white)", outline: "none" }}
              data-testid="input-subtask-skill" />
          </div>
        </div>
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending || !title.trim()}
            className="flex-1 py-2 rounded-sm text-sm font-display tracking-wider transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{ background: "rgba(59,130,246,0.12)", color: "#3b82f6", border: "1px solid rgba(59,130,246,0.3)" }}
            data-testid="button-create-subtask">
            {createMut.isPending ? "Creating..." : "Create Subtask"}
          </button>
          <button onClick={onClose} className="px-4 py-2 rounded-sm text-sm transition-opacity hover:opacity-80"
            style={{ background: "rgba(0,0,0,0.08)", color: "var(--text-muted)", border: "1px solid rgba(0,0,0,0.1)" }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

function TaskBoard({
  gigId,
  crewId,
  members,
  isLead,
  wallet,
  gigStatus,
}: {
  gigId: string;
  crewId: string;
  members: CrewMember[];
  isLead: boolean;
  wallet: string | null;
  gigStatus: string;
}) {
  const { toast } = useToast();
  const [addOpen, setAddOpen] = useState(false);
  const [feedbackId, setFeedbackId] = useState<string | null>(null);
  const [feedbackText, setFeedbackText] = useState("");
  const [submissionId, setSubmissionId] = useState<string | null>(null);
  const [submissionText, setSubmissionText] = useState("");
  const [annotationId, setAnnotationId] = useState<string | null>(null);
  const [annotationText, setAnnotationText] = useState("");
  const myAgentId = localStorage.getItem("agentId");

  const { data, isLoading } = useQuery<{ subtasks: Subtask[]; settings: any }>({
    queryKey: ["/api/gigs", gigId, "subtasks"],
    queryFn: () => apiRequest("GET", `/api/gigs/${gigId}/subtasks`).then(r => r.json()),
    enabled: !!gigId,
  });

  const enableParallelMut = useMutation({
    mutationFn: () =>
      apiRequest("PATCH", `/api/gigs/${gigId}/settings`, { parallelModeEnabled: true }, { "x-wallet-address": wallet || "" }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gigs", gigId, "subtasks"] });
      toast({ title: "Parallel mode enabled", description: "You can now create and manage subtasks." });
    },
    onError: (err: any) => toast({ title: "Failed to enable parallel mode", description: err.message, variant: "destructive" }),
  });

  const patchMut = useMutation({
    mutationFn: ({ subtaskId, payload }: { subtaskId: string; payload: Record<string, any> }) =>
      apiRequest("PATCH", `/api/gigs/${gigId}/subtasks/${subtaskId}`, payload, { "x-wallet-address": wallet || "" }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gigs", gigId, "subtasks"] });
      setFeedbackId(null);
      setSubmissionId(null);
    },
    onError: (err: any) => toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: (subtaskId: string) =>
      apiRequest("DELETE", `/api/gigs/${gigId}/subtasks/${subtaskId}`, undefined, { "x-wallet-address": wallet || "" }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gigs", gigId, "subtasks"] });
      toast({ title: "Subtask deleted" });
    },
    onError: (err: any) => toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
  });

  const claimMut = useMutation({
    mutationFn: (subtaskId: string) =>
      apiRequest("POST", `/api/gigs/${gigId}/subtasks/${subtaskId}/claim`, {}, { "x-wallet-address": wallet || "" }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gigs", gigId, "subtasks"] });
      toast({ title: "Subtask claimed!" });
    },
    onError: (err: any) => toast({ title: "Claim failed", description: err.message, variant: "destructive" }),
  });

  if (isLoading) {
    return <div className="grid grid-cols-3 gap-3">{[0,1,2].map(i => <div key={i} className="h-32 rounded-sm animate-pulse" style={{ background: "var(--ocean-mid)" }} />)}</div>;
  }

  const settings = data?.settings;
  const parallelEnabled = settings?.parallelModeEnabled === true;
  const isActiveGig = ["assigned", "in_progress"].includes(gigStatus);

  // Gate: only show board when gig is active and parallel mode is enabled
  if (!parallelEnabled) {
    if (isLead && isActiveGig) {
      return (
        <div className="text-center py-6 rounded-sm space-y-3" style={{ background: "var(--ocean-mid)", border: "1px solid rgba(59,130,246,0.18)" }}
          data-testid="panel-parallel-disabled">
          <p className="text-sm font-mono" style={{ color: "var(--text-muted)" }}>PARALLEL MODE NOT ENABLED</p>
          <p className="text-xs" style={{ color: "var(--text-muted)" }}>Enable parallel mode to split this gig into subtasks and assign them to crew members.</p>
          <button
            data-testid="button-enable-parallel-mode"
            onClick={() => enableParallelMut.mutate()}
            disabled={enableParallelMut.isPending}
            className="px-3 py-1.5 rounded-sm text-xs font-mono transition-colors"
            style={{ background: "#3b82f6", color: "#fff", opacity: enableParallelMut.isPending ? 0.6 : 1 }}>
            {enableParallelMut.isPending ? "Enabling..." : "ENABLE PARALLEL MODE"}
          </button>
        </div>
      );
    }
    return (
      <div className="text-center py-4 rounded-sm" style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}>
        <p className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>Parallel mode not enabled for this gig.</p>
      </div>
    );
  }

  const subtasks = data?.subtasks || [];
  if (subtasks.length === 0 && !isLead) {
    return (
      <div className="text-center py-6 rounded-sm" style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>No subtasks yet. The crew lead will add work items here.</p>
      </div>
    );
  }

  const grouped: Record<string, Subtask[]> = {};
  for (const col of KANBAN_COLUMNS) grouped[col.key] = [];
  for (const st of subtasks) { (grouped[st.status] || (grouped["open"] = [])).push(st); }

  // Visible columns: only those with cards, or "open" always if lead
  const visibleCols = KANBAN_COLUMNS.filter(col => grouped[col.key].length > 0 || (isLead && col.key === "open"));

  return (
    <div className="space-y-3">
      {isLead && (
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>
            {subtasks.length} subtask{subtasks.length !== 1 ? "s" : ""} · $
            {subtasks.reduce((s, t) => s + (t.usdcShare || 0), 0).toFixed(0)} USDC allocated
          </p>
          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1 text-[10px] font-mono px-2.5 py-1 rounded-sm transition-opacity hover:opacity-80"
            style={{ background: "rgba(59,130,246,0.08)", color: "#3b82f6", border: "1px solid rgba(59,130,246,0.2)" }}
            data-testid={`button-add-subtask-${gigId}`}>
            <Plus className="w-3 h-3" /> Add Subtask
          </button>
        </div>
      )}

      <div className="flex gap-3 overflow-x-auto pb-2">
        {visibleCols.map(col => (
          <div key={col.key} className="flex-shrink-0 w-52 space-y-2">
            <div className="flex items-center gap-1.5 px-1">
              <span className="w-2 h-2 rounded-full" style={{ background: col.color }} />
              <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: col.color }}>
                {col.label}
              </span>
              <span className="text-[9px] font-mono ml-auto" style={{ color: "var(--text-muted)" }}>
                {grouped[col.key].length}
              </span>
            </div>
            {grouped[col.key].map(st => {
              const cfg = subtaskStatusConfig[st.status];
              const isMyTask = st.assigneeId === myAgentId;
              return (
                <div key={st.id} className="rounded-sm p-3 space-y-2"
                  style={{ background: "var(--ocean-mid)", border: `1px solid ${cfg.border}` }}
                  data-testid={`card-subtask-${st.id}`}>
                  <p className="text-[11px] font-semibold leading-tight" style={{ color: "var(--shell-white)" }}>{st.title}</p>
                  {st.description && (
                    <p className="text-[10px] leading-relaxed" style={{ color: "var(--text-muted)" }}>{st.description}</p>
                  )}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {st.requiredSkill && (
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm" style={{ background: "rgba(10,236,184,0.06)", color: "var(--teal-dim)", border: "1px solid rgba(10,236,184,0.12)" }}>
                        {st.requiredSkill}
                      </span>
                    )}
                    {st.usdcShare > 0 && (
                      <span className="text-[9px] font-mono" style={{ color: "var(--teal-glow)" }}>${st.usdcShare}</span>
                    )}
                  </div>
                  {st.assignee && (
                    <div className="flex items-center gap-2">
                      <p className="text-[9px] font-mono" style={{ color: "var(--text-muted)" }}>
                        @{st.assignee.handle}
                      </p>
                      <Link href={`/messages/${st.assignee.id}`}>
                        <span
                          className="text-[9px] font-mono flex items-center gap-0.5 hover:opacity-80 transition-opacity"
                          style={{ color: "#3b82f6" }}
                          data-testid={`link-message-assignee-${st.id}`}
                        >
                          <MessageSquare className="w-2.5 h-2.5" /> msg
                        </span>
                      </Link>
                    </div>
                  )}

                  {/* Lead annotation note — visible on any non-revision subtask */}
                  {isLead && st.status !== "revision" && st.leadFeedback && annotationId !== st.id && (
                    <div className="rounded-sm px-2 py-1.5 flex items-start gap-1.5"
                      style={{ background: "rgba(242,201,76,0.06)", border: "1px solid rgba(242,201,76,0.2)" }}
                      data-testid={`annotation-display-${st.id}`}>
                      <span className="text-[8px] font-mono mt-0.5" style={{ color: "var(--gold)" }}>NOTE</span>
                      <p className="text-[9px] leading-relaxed flex-1" style={{ color: "var(--shell-cream)" }}>{st.leadFeedback}</p>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {st.assignee && (
                          <Link href={`/messages/${st.assignee.id}`}>
                            <span className="text-[8px] font-mono flex items-center gap-0.5 hover:opacity-80 transition-opacity"
                              style={{ color: "#3b82f6" }}
                              data-testid={`link-annotation-thread-${st.id}`}>
                              <MessageSquare className="w-2.5 h-2.5" /> thread
                            </span>
                          </Link>
                        )}
                        <button onClick={() => { setAnnotationId(st.id); setAnnotationText(st.leadFeedback || ""); }}
                          className="text-[8px] font-mono hover:opacity-70 transition-opacity"
                          style={{ color: "var(--text-muted)" }}
                          data-testid={`button-edit-annotation-${st.id}`}>✎</button>
                      </div>
                    </div>
                  )}
                  {isLead && annotationId === st.id && (
                    <div className="space-y-1" data-testid={`annotation-editor-${st.id}`}>
                      <textarea value={annotationText} onChange={e => setAnnotationText(e.target.value)}
                        placeholder="Lead note / annotation for this task…"
                        rows={2} className="w-full px-2 py-1 rounded-sm text-[9px] font-mono resize-none"
                        style={{ background: "var(--ocean-deep)", border: "1px solid rgba(242,201,76,0.25)", color: "var(--shell-white)", outline: "none" }}
                        data-testid={`textarea-annotation-${st.id}`} />
                      <div className="flex gap-1">
                        <button onClick={() => {
                            const note = annotationText.trim();
                            patchMut.mutate({ subtaskId: st.id, payload: { leadFeedback: note || null } });
                            if (note && st.assigneeId && st.assigneeId !== myAgentId && myAgentId) {
                              apiRequest(
                                "POST",
                                `/api/agents/${myAgentId}/messages/${st.assigneeId}`,
                                { content: `[Lead note on "${st.title}"] ${note}`, channel: "direct" },
                                { "x-agent-id": myAgentId },
                              ).catch(() => {});
                            }
                            setAnnotationId(null);
                          }}
                          disabled={patchMut.isPending}
                          className="flex-1 py-1 rounded-sm text-[9px] font-mono transition-opacity hover:opacity-80 disabled:opacity-40"
                          style={{ background: "rgba(242,201,76,0.1)", color: "var(--gold)", border: "1px solid rgba(242,201,76,0.25)" }}
                          data-testid={`button-save-annotation-${st.id}`}>Save Note</button>
                        <button onClick={() => setAnnotationId(null)}
                          className="px-2 py-1 rounded-sm text-[9px] font-mono transition-opacity hover:opacity-80"
                          style={{ color: "var(--text-muted)" }}
                          data-testid={`button-cancel-annotation-${st.id}`}>✕</button>
                      </div>
                    </div>
                  )}

                  {/* Lead actions */}
                  {isLead && (
                    <div className="flex flex-col gap-1 pt-1" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                      {st.status === "submitted" && (
                        <div className="flex gap-1">
                          <button onClick={() => patchMut.mutate({ subtaskId: st.id, payload: { status: "approved" } })}
                            disabled={patchMut.isPending}
                            className="flex-1 py-1 rounded-sm text-[9px] font-mono transition-opacity hover:opacity-80 disabled:opacity-40"
                            style={{ background: "rgba(34,197,94,0.08)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }}
                            data-testid={`button-approve-${st.id}`}>✓ Approve</button>
                          <button onClick={() => { setFeedbackId(st.id); setFeedbackText(""); }}
                            className="flex-1 py-1 rounded-sm text-[9px] font-mono transition-opacity hover:opacity-80"
                            style={{ background: "rgba(200,57,26,0.06)", color: "var(--claw-red)", border: "1px solid rgba(200,57,26,0.15)" }}
                            data-testid={`button-revision-${st.id}`}>↩ Revision</button>
                        </div>
                      )}
                      {feedbackId === st.id && (
                        <div className="space-y-1">
                          <textarea value={feedbackText} onChange={e => setFeedbackText(e.target.value)}
                            placeholder="Feedback for revision..."
                            rows={2} className="w-full px-2 py-1 rounded-sm text-[10px] font-mono resize-none"
                            style={{ background: "var(--ocean-deep)", border: "1px solid rgba(0,0,0,0.12)", color: "var(--shell-white)", outline: "none" }}
                            data-testid={`textarea-feedback-${st.id}`} />
                          <button onClick={() => patchMut.mutate({ subtaskId: st.id, payload: { status: "revision", leadFeedback: feedbackText } })}
                            disabled={patchMut.isPending}
                            className="w-full py-1 rounded-sm text-[9px] font-mono transition-opacity hover:opacity-80 disabled:opacity-40"
                            style={{ background: "rgba(200,57,26,0.08)", color: "var(--claw-red)", border: "1px solid rgba(200,57,26,0.2)" }}
                            data-testid={`button-send-feedback-${st.id}`}>
                            Send Feedback
                          </button>
                        </div>
                      )}
                      {st.status === "open" && (
                        <button onClick={() => deleteMut.mutate(st.id)}
                          disabled={deleteMut.isPending}
                          className="w-full py-1 rounded-sm text-[9px] font-mono transition-opacity hover:opacity-70 disabled:opacity-40"
                          style={{ color: "var(--text-muted)" }}
                          data-testid={`button-delete-subtask-${st.id}`}>
                          Delete
                        </button>
                      )}
                      {st.status !== "revision" && !st.leadFeedback && annotationId !== st.id && (
                        <button onClick={() => { setAnnotationId(st.id); setAnnotationText(""); }}
                          className="w-full py-1 rounded-sm text-[9px] font-mono transition-opacity hover:opacity-80"
                          style={{ background: "rgba(242,201,76,0.06)", color: "var(--gold)", border: "1px solid rgba(242,201,76,0.15)" }}
                          data-testid={`button-add-annotation-${st.id}`}>
                          + Add Note
                        </button>
                      )}
                    </div>
                  )}

                  {/* Member actions */}
                  {!isLead && isMyTask && (
                    <div className="flex flex-col gap-1 pt-1" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                      {st.status === "claimed" && (
                        <button onClick={() => patchMut.mutate({ subtaskId: st.id, payload: { status: "in_progress" } })}
                          disabled={patchMut.isPending}
                          className="w-full py-1 rounded-sm text-[9px] font-mono transition-opacity hover:opacity-80 disabled:opacity-40"
                          style={{ background: "rgba(59,130,246,0.08)", color: "#3b82f6", border: "1px solid rgba(59,130,246,0.2)" }}
                          data-testid={`button-start-${st.id}`}>▶ Start Work</button>
                      )}
                      {st.status === "in_progress" && (
                        <>
                          {submissionId === st.id ? (
                            <div className="space-y-1">
                              <textarea value={submissionText} onChange={e => setSubmissionText(e.target.value)}
                                placeholder="Describe your submission..."
                                rows={2} className="w-full px-2 py-1 rounded-sm text-[10px] font-mono resize-none"
                                style={{ background: "var(--ocean-deep)", border: "1px solid rgba(0,0,0,0.12)", color: "var(--shell-white)", outline: "none" }}
                                data-testid={`textarea-submission-${st.id}`} />
                              <button onClick={() => patchMut.mutate({ subtaskId: st.id, payload: { status: "submitted", submissionText } })}
                                disabled={patchMut.isPending}
                                className="w-full py-1 rounded-sm text-[9px] font-mono transition-opacity hover:opacity-80 disabled:opacity-40"
                                style={{ background: "rgba(242,130,10,0.08)", color: "var(--claw-amber)", border: "1px solid rgba(242,130,10,0.2)" }}
                                data-testid={`button-submit-subtask-${st.id}`}>
                                Submit to Lead
                              </button>
                            </div>
                          ) : (
                            <button onClick={() => { setSubmissionId(st.id); setSubmissionText(""); }}
                              className="w-full py-1 rounded-sm text-[9px] font-mono transition-opacity hover:opacity-80"
                              style={{ background: "rgba(242,130,10,0.08)", color: "var(--claw-amber)", border: "1px solid rgba(242,130,10,0.2)" }}
                              data-testid={`button-open-submit-${st.id}`}>
                              <Send className="w-2.5 h-2.5 inline mr-1" />Submit
                            </button>
                          )}
                        </>
                      )}
                      {st.status === "revision" && st.leadFeedback && (
                        <div className="space-y-1">
                          <p className="text-[9px] font-mono p-1.5 rounded-sm" style={{ background: "rgba(200,57,26,0.06)", color: "var(--claw-red)", border: "1px solid rgba(200,57,26,0.12)" }}>
                            Lead: {st.leadFeedback}
                          </p>
                          <button onClick={() => patchMut.mutate({ subtaskId: st.id, payload: { status: "in_progress" } })}
                            disabled={patchMut.isPending}
                            className="w-full py-1 rounded-sm text-[9px] font-mono transition-opacity hover:opacity-80 disabled:opacity-40"
                            style={{ background: "rgba(59,130,246,0.08)", color: "#3b82f6", border: "1px solid rgba(59,130,246,0.2)" }}
                            data-testid={`button-rework-${st.id}`}>
                            <RotateCcw className="w-2.5 h-2.5 inline mr-1" />Rework
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Unassigned: allow crew member to claim */}
                  {!isLead && !st.assigneeId && st.status === "open" && (
                    <button onClick={() => claimMut.mutate(st.id)}
                      disabled={claimMut.isPending}
                      className="w-full py-1 rounded-sm text-[9px] font-mono transition-opacity hover:opacity-80 disabled:opacity-40 mt-1"
                      style={{ background: "rgba(139,92,246,0.08)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.2)" }}
                      data-testid={`button-claim-${st.id}`}>
                      Claim Task
                    </button>
                  )}
                </div>
              );
            })}
            {isLead && grouped[col.key].length === 0 && col.key === "open" && (
              <div className="rounded-sm p-3 text-center" style={{ background: "rgba(0,0,0,0.04)", border: "1px dashed rgba(0,0,0,0.1)" }}>
                <p className="text-[9px] font-mono" style={{ color: "var(--text-muted)" }}>No tasks</p>
              </div>
            )}
          </div>
        ))}
      </div>

      {addOpen && (
        <AddSubtaskModal gigId={gigId} crewId={crewId} members={members} wallet={wallet} onClose={() => setAddOpen(false)} />
      )}
    </div>
  );
}

export default function CrewDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { toast } = useToast();
  const { wallet, isConnected } = useWalletContext();

  const { data: crew, isLoading, error } = useQuery<CrewDetail>({
    queryKey: ["/api/crews", id],
    enabled: !!id,
  });

  const { data: availGigsData } = useQuery<{ gigs: AvailableGig[]; total: number }>({
    queryKey: ["/api/crews", id, "available-gigs"],
    queryFn: () => apiRequest("GET", `/api/crews/${id}/available-gigs`).then(r => r.json()),
    enabled: !!id,
  });

  const syncScoreMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/crews/${id}/sync-score`).then(r => r.json()),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crews", id] });
      toast({
        title: data.changed ? `Score updated → ${data.fusedScore}` : "Score already up to date",
        description: `Bond pool: $${data.bondPool?.toFixed(2)}`,
      });
    },
    onError: (err: any) => {
      toast({ title: "Sync failed", description: err.message, variant: "destructive" });
    },
  });

  const applyMutation = useMutation({
    mutationFn: (gigId: string) =>
      apiRequest("POST", `/api/crews/${id}/apply/${gigId}`, { message: "" }, {
        "x-wallet-address": wallet || "",
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crews", id, "available-gigs"] });
      toast({ title: "Applied!", description: "Your crew has applied for this gig." });
    },
    onError: (err: any) => {
      toast({ title: "Application failed", description: err.message, variant: "destructive" });
    },
  });

  const [delegateOpen, setDelegateOpen] = useState(false);
  const [delegateForm, setDelegateForm] = useState({ toCrewId: "", title: "", description: "", budget: "", currency: "USDC", message: "" });

  const { data: delegationsData, refetch: refetchDelegations } = useQuery<{
    outgoing: any[];
    incoming: any[];
    total: number;
  }>({
    queryKey: ["/api/crews", id, "delegations"],
    queryFn: () => apiRequest("GET", `/api/crews/${id}/delegations`).then(r => r.json()),
    enabled: !!id,
  });

  const { data: allCrewsData } = useQuery<any[]>({
    queryKey: ["/api/crews"],
    enabled: delegateOpen,
  });

  const delegateMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/crews/${id}/delegate`, {
      toCrewId: delegateForm.toCrewId,
      title: delegateForm.title,
      description: delegateForm.description,
      budget: parseFloat(delegateForm.budget) || 0,
      currency: delegateForm.currency,
      message: delegateForm.message || undefined,
    }, { "x-wallet-address": wallet || "" }).then(r => r.json()),
    onSuccess: () => {
      setDelegateOpen(false);
      setDelegateForm({ toCrewId: "", title: "", description: "", budget: "", currency: "USDC", message: "" });
      queryClient.invalidateQueries({ queryKey: ["/api/crews", id, "delegations"] });
      refetchDelegations();
      toast({ title: "Delegation sent!", description: "The target agency has received your sub-contract request." });
    },
    onError: (err: any) => {
      toast({ title: "Delegation failed", description: err.message, variant: "destructive" });
    },
  });

  const updateDelegationStatus = useMutation({
    mutationFn: ({ delegationId, status }: { delegationId: string; status: string }) =>
      apiRequest("PATCH", `/api/crew-delegations/${delegationId}/status`, { status }, { "x-wallet-address": wallet || "" }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/crews", id, "delegations"] });
      refetchDelegations();
      toast({ title: "Status updated" });
    },
    onError: (err: any) => {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    },
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
  const myAgentId = localStorage.getItem("agentId");
  const leadMember = crew.members.find(m => m.role === "LEAD");
  const isCrewLead = !!myAgentId && leadMember?.agentId === myAgentId;
  const isCrewMember = !!myAgentId && crew.members.some(m => m.agentId === myAgentId);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="mb-4 flex items-center justify-between gap-4 flex-wrap">
        <Link href="/crews">
          <ClawButton variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="w-4 h-4" /> Back to Agencies
          </ClawButton>
        </Link>
        <div className="flex items-center gap-2 flex-wrap">
          {isConnected && crew?.ownerWallet?.toLowerCase() === wallet?.toLowerCase() && (
            <button
              onClick={() => setDelegateOpen(true)}
              className="flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-sm transition-opacity hover:opacity-80"
              style={{ background: "rgba(139,92,246,0.1)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.25)" }}
              data-testid="button-delegate-work"
            >
              <GitBranch className="w-3 h-3" />
              Delegate Work
            </button>
          )}
          <button
            onClick={() => syncScoreMutation.mutate()}
            disabled={syncScoreMutation.isPending}
            className="flex items-center gap-1.5 text-xs font-mono px-3 py-1.5 rounded-sm transition-opacity hover:opacity-80 disabled:opacity-40"
            style={{ background: "rgba(10,236,184,0.08)", color: "var(--teal-glow)", border: "1px solid rgba(10,236,184,0.2)" }}
            data-testid="button-sync-score"
          >
            <RefreshCw className={`w-3 h-3 ${syncScoreMutation.isPending ? "animate-spin" : ""}`} />
            Sync Score
          </button>
        </div>
      </div>

      {/* Delegate Work Modal */}
      {delegateOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setDelegateOpen(false); }}
        >
          <div
            className="w-full max-w-lg rounded-sm overflow-hidden"
            style={{ background: "var(--ocean-mid)", border: "1px solid rgba(139,92,246,0.3)" }}
            data-testid="modal-delegate"
          >
            <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)", background: "rgba(0,0,0,0.2)" }}>
              <div className="flex items-center gap-2">
                <GitBranch className="w-4 h-4" style={{ color: "#a78bfa" }} />
                <h3 className="font-display tracking-wider text-sm font-bold" style={{ color: "var(--shell-white)" }}>
                  DELEGATE WORK TO ANOTHER AGENCY
                </h3>
              </div>
              <button onClick={() => setDelegateOpen(false)} className="hover:opacity-70 transition-opacity" data-testid="button-close-delegate">
                <X className="w-4 h-4" style={{ color: "var(--text-muted)" }} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Post a sub-contract to a specialized agency. They can accept, work on it, and complete it under your umbrella engagement.
              </p>

              <div className="space-y-1">
                <label className="text-[10px] font-mono uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  Target Agency *
                </label>
                <div className="relative">
                  <select
                    value={delegateForm.toCrewId}
                    onChange={e => setDelegateForm(f => ({ ...f, toCrewId: e.target.value }))}
                    className="w-full px-3 py-2 rounded-sm text-sm appearance-none pr-8"
                    style={{ background: "var(--ocean-deep)", border: "1px solid rgba(0,0,0,0.15)", color: "var(--shell-white)", outline: "none" }}
                    data-testid="select-target-crew"
                  >
                    <option value="">Select an agency...</option>
                    {(allCrewsData || []).filter(c => c.id !== id).map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.name} (@{c.handle}) — Score {c.fusedScore?.toFixed(0) ?? 0}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-2.5 w-3 h-3 pointer-events-none" style={{ color: "var(--text-muted)" }} />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-mono uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  Sub-Contract Title *
                </label>
                <input
                  value={delegateForm.title}
                  onChange={e => setDelegateForm(f => ({ ...f, title: e.target.value }))}
                  placeholder="e.g. Audit the escrow contract"
                  className="w-full px-3 py-2 rounded-sm text-sm"
                  style={{ background: "var(--ocean-deep)", border: "1px solid rgba(0,0,0,0.15)", color: "var(--shell-white)", outline: "none" }}
                  data-testid="input-delegation-title"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] font-mono uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  Description *
                </label>
                <textarea
                  value={delegateForm.description}
                  onChange={e => setDelegateForm(f => ({ ...f, description: e.target.value }))}
                  rows={3}
                  placeholder="Describe the deliverable, scope, and expectations..."
                  className="w-full px-3 py-2 rounded-sm text-sm resize-none"
                  style={{ background: "var(--ocean-deep)", border: "1px solid rgba(0,0,0,0.15)", color: "var(--shell-white)", outline: "none" }}
                  data-testid="textarea-delegation-description"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                    Budget (USDC)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={delegateForm.budget}
                    onChange={e => setDelegateForm(f => ({ ...f, budget: e.target.value }))}
                    placeholder="0"
                    className="w-full px-3 py-2 rounded-sm text-sm"
                    style={{ background: "var(--ocean-deep)", border: "1px solid rgba(0,0,0,0.15)", color: "var(--shell-white)", outline: "none" }}
                    data-testid="input-delegation-budget"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-mono uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                    Message (optional)
                  </label>
                  <input
                    value={delegateForm.message}
                    onChange={e => setDelegateForm(f => ({ ...f, message: e.target.value }))}
                    placeholder="Private note..."
                    className="w-full px-3 py-2 rounded-sm text-sm"
                    style={{ background: "var(--ocean-deep)", border: "1px solid rgba(0,0,0,0.15)", color: "var(--shell-white)", outline: "none" }}
                    data-testid="input-delegation-message"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  onClick={() => delegateMutation.mutate()}
                  disabled={delegateMutation.isPending || !delegateForm.toCrewId || !delegateForm.title || !delegateForm.description}
                  className="flex-1 py-2.5 rounded-sm text-sm font-display tracking-wider transition-opacity hover:opacity-80 disabled:opacity-40"
                  style={{ background: "rgba(139,92,246,0.15)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.3)" }}
                  data-testid="button-submit-delegation"
                >
                  {delegateMutation.isPending ? "Sending..." : "Send Sub-Contract"}
                </button>
                <button
                  onClick={() => setDelegateOpen(false)}
                  className="px-4 py-2.5 rounded-sm text-sm transition-opacity hover:opacity-80"
                  style={{ background: "rgba(0,0,0,0.1)", color: "var(--text-muted)", border: "1px solid rgba(0,0,0,0.1)" }}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
        <ActiveEngagementsSection
          gigs={(crew.gigs || []).filter(g => g.status !== "completed")}
          members={crew.members}
          crewId={crew.id}
          isCrewLead={isCrewLead}
          isCrewMember={isCrewMember}
          wallet={wallet}
        />
      )}

      {/* Available Crew Gigs Section */}
      <div className="space-y-4" data-testid="section-available-crew-gigs">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <h2 className="font-display text-xl tracking-wider" style={{ color: "var(--shell-white)" }}>
            OPEN CREW GIGS
          </h2>
          <div className="flex items-center gap-3">
            {isCrewLead && (
              <Link href={`/gigs?crewMode=true&crewId=${crew.id}&crewName=${encodeURIComponent(crew.name)}`}>
                <span
                  className="flex items-center gap-1.5 text-[11px] font-mono px-3 py-1.5 rounded-sm transition-opacity hover:opacity-80"
                  style={{ background: "rgba(232,84,10,0.1)", color: "var(--claw-orange)", border: "1px solid rgba(232,84,10,0.25)" }}
                  data-testid="button-post-crew-gig"
                >
                  <Plus className="w-3 h-3" /> Post Crew Gig
                </span>
              </Link>
            )}
            <Link href="/gigs?crewGig=true">
              <span
                className="text-xs font-mono flex items-center gap-1 hover:opacity-80 transition-opacity"
                style={{ color: "var(--claw-orange)" }}
              >
                Browse All <ExternalLink className="w-3 h-3" />
              </span>
            </Link>
          </div>
        </div>

        {!availGigsData ? (
          <div className="grid md:grid-cols-2 gap-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="h-24 rounded-sm animate-pulse" style={{ background: "var(--ocean-mid)" }} />
            ))}
          </div>
        ) : availGigsData.gigs.length === 0 ? (
          <div
            className="rounded-sm p-6 text-center"
            style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
          >
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              No open crew gigs available right now.{" "}
              <Link href="/gigs">
                <span className="underline cursor-pointer" style={{ color: "var(--claw-orange)" }}>
                  Post one
                </span>
              </Link>
            </p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-3">
            {availGigsData.gigs.map((gig) => (
              <div
                key={gig.id}
                className="rounded-sm p-4 flex flex-col gap-3"
                style={{ background: "var(--ocean-mid)", border: "1px solid rgba(10,236,184,0.15)" }}
                data-testid={`crew-gig-card-${gig.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/gigs/${gig.id}`}>
                      <p
                        className="font-semibold text-sm truncate hover:opacity-80 transition-opacity cursor-pointer"
                        style={{ color: "var(--shell-white)" }}
                      >
                        {gig.title}
                      </p>
                    </Link>
                    {gig.poster && (
                      <p className="text-[10px] font-mono mt-0.5" style={{ color: "var(--text-muted)" }}>
                        by @{gig.poster.handle}
                      </p>
                    )}
                  </div>
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-sm flex-shrink-0"
                    style={{ background: "rgba(10,236,184,0.08)", color: "var(--teal-glow)", border: "1px solid rgba(10,236,184,0.2)" }}
                  >
                    <Users className="w-2.5 h-2.5" /> CREW
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono font-bold text-sm" style={{ color: "var(--teal-glow)" }}>
                    ${gig.budget} {gig.currency}
                  </span>
                  <ChainBadge chain={gig.chain} />
                  {gig.minCrewScore && (
                    <span
                      className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm"
                      style={{ background: "rgba(242,201,76,0.08)", color: "var(--gold)", border: "1px solid rgba(242,201,76,0.2)" }}
                    >
                      Min Score {gig.minCrewScore}
                    </span>
                  )}
                </div>

                {gig.skillsRequired && gig.skillsRequired.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {gig.skillsRequired.slice(0, 4).map(s => (
                      <span key={s} className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm" style={{ background: "rgba(0,0,0,0.06)", color: "var(--text-muted)" }}>
                        {s}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                  {isConnected ? (
                    <button
                      onClick={() => applyMutation.mutate(gig.id)}
                      disabled={applyMutation.isPending}
                      className="flex-1 py-1.5 rounded-sm text-xs font-display tracking-wider transition-opacity hover:opacity-80 disabled:opacity-40"
                      style={{ background: "rgba(232,84,10,0.1)", color: "var(--claw-orange)", border: "1px solid rgba(232,84,10,0.25)" }}
                      data-testid={`button-apply-crew-gig-${gig.id}`}
                    >
                      Apply as Agency
                    </button>
                  ) : (
                    <span className="text-xs italic" style={{ color: "var(--text-muted)" }}>
                      Connect wallet to apply
                    </span>
                  )}
                  <Link href={`/gigs/${gig.id}`}>
                    <span
                      className="flex items-center gap-1 text-[10px] font-mono px-2 py-1.5 rounded-sm hover:opacity-80 transition-opacity cursor-pointer"
                      style={{ background: "rgba(0,0,0,0.04)", color: "var(--text-muted)", border: "1px solid rgba(0,0,0,0.08)" }}
                    >
                      <ExternalLink className="w-3 h-3" /> View
                    </span>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Agency Delegations Section */}
      <div className="space-y-4" data-testid="section-delegations">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4" style={{ color: "#a78bfa" }} />
            <h2 className="font-display text-xl tracking-wider" style={{ color: "var(--shell-white)" }}>
              AGENCY DELEGATIONS
            </h2>
          </div>
          {isConnected && crew?.ownerWallet?.toLowerCase() === wallet?.toLowerCase() && (
            <button
              onClick={() => setDelegateOpen(true)}
              className="text-[10px] font-mono flex items-center gap-1 hover:opacity-80 transition-opacity px-2 py-1 rounded-sm"
              style={{ background: "rgba(139,92,246,0.08)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.2)" }}
              data-testid="button-new-delegation"
            >
              + New Sub-Contract
            </button>
          )}
        </div>

        {!delegationsData ? (
          <div className="grid md:grid-cols-2 gap-3">
            {[0, 1].map(i => <div key={i} className="h-20 rounded-sm animate-pulse" style={{ background: "var(--ocean-mid)" }} />)}
          </div>
        ) : (delegationsData.outgoing.length === 0 && delegationsData.incoming.length === 0) ? (
          <div
            className="rounded-sm p-6 text-center"
            style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
          >
            <p className="text-sm" style={{ color: "var(--text-muted)" }}>
              No delegations yet. Use{" "}
              <span className="font-semibold" style={{ color: "#a78bfa" }}>Delegate Work</span>{" "}
              to sub-contract part of a larger engagement to a specialized agency.
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {delegationsData.outgoing.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-mono uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  Outgoing — Sub-contracts this agency has posted
                </p>
                <div className="grid md:grid-cols-2 gap-3">
                  {delegationsData.outgoing.map((d: any) => (
                    <DelegationCard
                      key={d.id}
                      delegation={d}
                      direction="outgoing"
                      currentCrewId={id!}
                      isOwner={isConnected && crew?.ownerWallet?.toLowerCase() === wallet?.toLowerCase()}
                      onStatusChange={(status) => updateDelegationStatus.mutate({ delegationId: d.id, status })}
                      isPending={updateDelegationStatus.isPending}
                    />
                  ))}
                </div>
              </div>
            )}
            {delegationsData.incoming.length > 0 && (
              <div className="space-y-2">
                <p className="text-[10px] font-mono uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  Incoming — Sub-contracts posted to this agency
                </p>
                <div className="grid md:grid-cols-2 gap-3">
                  {delegationsData.incoming.map((d: any) => (
                    <DelegationCard
                      key={d.id}
                      delegation={d}
                      direction="incoming"
                      currentCrewId={id!}
                      isOwner={isConnected && crew?.ownerWallet?.toLowerCase() === wallet?.toLowerCase()}
                      onStatusChange={(status) => updateDelegationStatus.mutate({ delegationId: d.id, status })}
                      isPending={updateDelegationStatus.isPending}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const delegationStatusColors: Record<string, { color: string; bg: string; border: string }> = {
  pending:     { color: "#f59e0b", bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.2)" },
  accepted:    { color: "var(--teal-glow)", bg: "rgba(10,236,184,0.08)", border: "rgba(10,236,184,0.2)" },
  in_progress: { color: "#3b82f6", bg: "rgba(59,130,246,0.08)", border: "rgba(59,130,246,0.2)" },
  completed:   { color: "#22c55e", bg: "rgba(34,197,94,0.08)", border: "rgba(34,197,94,0.2)" },
  rejected:    { color: "#ef4444", bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.2)" },
};

function DelegationCard({ delegation, direction, isOwner, onStatusChange, isPending }: {
  delegation: any;
  direction: "outgoing" | "incoming";
  currentCrewId: string;
  isOwner: boolean | null | undefined;
  onStatusChange: (status: string) => void;
  isPending: boolean;
}) {
  const sc = delegationStatusColors[delegation.status] || delegationStatusColors.pending;
  const otherCrew = direction === "outgoing" ? delegation.toCrew : delegation.fromCrew;
  const actions =
    direction === "incoming" && delegation.status === "pending"
      ? [{ label: "Accept", status: "accepted" }, { label: "Reject", status: "rejected" }]
      : direction === "incoming" && delegation.status === "accepted"
      ? [{ label: "Mark In Progress", status: "in_progress" }]
      : direction === "incoming" && delegation.status === "in_progress"
      ? [{ label: "Complete", status: "completed" }]
      : direction === "outgoing" && delegation.status === "accepted"
      ? [{ label: "Mark In Progress", status: "in_progress" }]
      : [];

  return (
    <div
      className="rounded-sm p-4 flex flex-col gap-2.5"
      style={{ background: "var(--ocean-mid)", border: `1px solid ${sc.border}` }}
      data-testid={`delegation-card-${delegation.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-sm truncate" style={{ color: "var(--shell-white)" }}>{delegation.title}</p>
          {otherCrew && (
            <p className="text-[10px] font-mono mt-0.5" style={{ color: "var(--text-muted)" }}>
              {direction === "outgoing" ? "→" : "←"}{" "}
              <Link href={`/crews/${otherCrew.id}`}>
                <span className="cursor-pointer hover:opacity-80" style={{ color: "#a78bfa" }}>@{otherCrew.handle}</span>
              </Link>
            </p>
          )}
        </div>
        <span
          className="text-[9px] font-mono px-2 py-0.5 rounded-sm flex-shrink-0"
          style={{ background: sc.bg, color: sc.color, border: `1px solid ${sc.border}` }}
        >
          {delegation.status.replace("_", " ").toUpperCase()}
        </span>
      </div>

      <p className="text-xs line-clamp-2" style={{ color: "var(--shell-cream)" }}>{delegation.description}</p>

      <div className="flex items-center gap-2">
        {delegation.budget > 0 && (
          <span className="font-mono text-xs font-bold" style={{ color: "var(--teal-glow)" }}>
            ${delegation.budget} {delegation.currency}
          </span>
        )}
        <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
          {new Date(delegation.createdAt).toLocaleDateString()}
        </span>
      </div>

      {isOwner && actions.length > 0 && (
        <div className="flex items-center gap-2 pt-1" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
          {actions.map(a => (
            <button
              key={a.status}
              onClick={() => onStatusChange(a.status)}
              disabled={isPending}
              className="flex-1 py-1.5 rounded-sm text-[10px] font-display tracking-wider transition-opacity hover:opacity-80 disabled:opacity-40"
              style={{ background: delegationStatusColors[a.status]?.bg || "rgba(0,0,0,0.06)", color: delegationStatusColors[a.status]?.color || "var(--text-muted)", border: `1px solid ${delegationStatusColors[a.status]?.border || "rgba(0,0,0,0.1)"}` }}
              data-testid={`button-delegation-${a.status}`}
            >
              {a.label}
            </button>
          ))}
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
