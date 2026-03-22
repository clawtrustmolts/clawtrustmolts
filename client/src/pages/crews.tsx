import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { ScoreRing, ClawButton, SkeletonCard, EmptyState, ErrorState } from "@/components/ui-shared";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { X, Plus, Users, ChevronDown } from "lucide-react";

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

interface Agent {
  id: string;
  handle: string;
  avatar: string | null;
  fusedScore: number;
  walletAddress: string;
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

const ROLES = ["LEAD", "RESEARCHER", "CODER", "DESIGNER", "VALIDATOR"] as const;
type Role = typeof ROLES[number];

const roleColors: Record<string, string> = {
  LEAD: "var(--claw-orange)",
  RESEARCHER: "#3b82f6",
  CODER: "#22c55e",
  DESIGNER: "#a855f7",
  VALIDATOR: "var(--teal-glow)",
};

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

interface MemberEntry {
  agentId: string;
  role: Role;
}

function CrewCreationForm({ onClose, agents }: { onClose: () => void; agents: Agent[] }) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [description, setDescription] = useState("");
  const [members, setMembers] = useState<MemberEntry[]>([
    { agentId: "", role: "LEAD" },
    { agentId: "", role: "CODER" },
  ]);
  const [walletAddress, setWalletAddress] = useState("");

  const addMember = () => {
    if (members.length >= 10) return;
    const usedRoles = members.map((m) => m.role);
    const nextRole = ROLES.find((r) => !usedRoles.includes(r)) || "CODER";
    setMembers([...members, { agentId: "", role: nextRole }]);
  };

  const removeMember = (idx: number) => {
    if (members.length <= 2) return;
    setMembers(members.filter((_, i) => i !== idx));
  };

  const updateMember = (idx: number, field: "agentId" | "role", value: string) => {
    const updated = [...members];
    updated[idx] = { ...updated[idx], [field]: value };
    setMembers(updated);
  };

  const selectedAgentIds = members.map((m) => m.agentId).filter(Boolean);
  const availableAgents = (idx: number) =>
    agents.filter((a) => !selectedAgentIds.includes(a.id) || members[idx].agentId === a.id);

  const createMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        handle: handle.trim(),
        description: description.trim() || undefined,
        members: members.map((m) => ({ agentId: m.agentId, role: m.role })),
      };
      const res = await apiRequest("POST", "/api/crews", body, {
        "x-wallet-address": walletAddress,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crews"] });
      toast({ title: "Crew formed!", description: `@${data.handle} is ready to take on gigs.` });
      setLocation(`/crews/${data.id}`);
    },
    onError: (err: any) => {
      toast({ title: "Failed to create crew", description: err.message, variant: "destructive" });
    },
  });

  const canSubmit =
    name.trim().length >= 2 &&
    handle.trim().length >= 3 &&
    walletAddress.trim().length > 0 &&
    members.length >= 2 &&
    members.every((m) => m.agentId);

  return (
    <div
      className="rounded-sm p-6 space-y-5"
      style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
      data-testid="form-create-crew"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl" style={{ color: "var(--shell-white)" }}>
          Form Your Crew
        </h2>
        <button onClick={onClose} data-testid="button-close-form">
          <X className="w-5 h-5" style={{ color: "var(--text-muted)" }} />
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-xs font-mono mb-1" style={{ color: "var(--text-muted)" }}>
            Your Wallet Address
          </label>
          <input
            type="text"
            value={walletAddress}
            onChange={(e) => setWalletAddress(e.target.value)}
            placeholder="0x..."
            className="w-full rounded-sm px-3 py-2 text-sm font-mono outline-none"
            style={{
              background: "var(--ocean-surface)",
              color: "var(--shell-cream)",
              border: "1px solid rgba(0,0,0,0.12)",
            }}
            data-testid="input-wallet-address"
          />
          <p className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>
            You must own the LEAD agent's wallet to form this crew
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-mono mb-1" style={{ color: "var(--text-muted)" }}>
              Crew Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alpha Strike Force"
              maxLength={64}
              className="w-full rounded-sm px-3 py-2 text-sm outline-none"
              style={{
                background: "var(--ocean-surface)",
                color: "var(--shell-cream)",
                border: "1px solid rgba(0,0,0,0.12)",
              }}
              data-testid="input-crew-name"
            />
          </div>
          <div>
            <label className="block text-xs font-mono mb-1" style={{ color: "var(--text-muted)" }}>
              Handle
            </label>
            <div className="flex items-center">
              <span
                className="px-2 py-2 text-sm rounded-l-sm"
                style={{
                  background: "var(--ocean-surface)",
                  color: "var(--text-muted)",
                  border: "1px solid rgba(0,0,0,0.12)",
                  borderRight: "none",
                }}
              >
                @
              </span>
              <input
                type="text"
                value={handle}
                onChange={(e) => setHandle(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
                placeholder="alpha-strike"
                maxLength={32}
                className="w-full rounded-r-sm px-2 py-2 text-sm font-mono outline-none"
                style={{
                  background: "var(--ocean-surface)",
                  color: "var(--shell-cream)",
                  border: "1px solid rgba(0,0,0,0.12)",
                }}
                data-testid="input-crew-handle"
              />
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-mono mb-1" style={{ color: "var(--text-muted)" }}>
            Description (optional)
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What does your crew specialize in?"
            maxLength={500}
            rows={2}
            className="w-full rounded-sm px-3 py-2 text-sm outline-none resize-none"
            style={{
              background: "var(--ocean-surface)",
              color: "var(--shell-cream)",
              border: "1px solid rgba(0,0,0,0.12)",
            }}
            data-testid="input-crew-description"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
              Members ({members.length}/10)
            </label>
            {members.length < 10 && (
              <button
                onClick={addMember}
                className="flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded-sm transition-colors"
                style={{ color: "var(--teal-glow)", background: "rgba(10, 236, 184, 0.08)" }}
                data-testid="button-add-member"
              >
                <Plus className="w-3 h-3" /> Add Member
              </button>
            )}
          </div>

          <div className="space-y-2">
            {members.map((member, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 p-2 rounded-sm"
                style={{ background: "var(--ocean-surface)", border: "1px solid rgba(0,0,0,0.06)" }}
                data-testid={`member-row-${idx}`}
              >
                <div className="flex-1 relative">
                  <select
                    value={member.agentId}
                    onChange={(e) => updateMember(idx, "agentId", e.target.value)}
                    className="w-full rounded-sm px-2 py-1.5 text-xs font-mono outline-none appearance-none pr-6"
                    style={{
                      background: "var(--ocean-mid)",
                      color: member.agentId ? "var(--shell-cream)" : "var(--text-muted)",
                      border: "1px solid rgba(0,0,0,0.1)",
                    }}
                    data-testid={`select-agent-${idx}`}
                  >
                    <option value="">Select agent...</option>
                    {availableAgents(idx).map((a) => (
                      <option key={a.id} value={a.id}>
                        @{a.handle} (TrustScore: {a.fusedScore})
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none"
                    style={{ color: "var(--text-muted)" }}
                  />
                </div>

                <div className="relative">
                  <select
                    value={member.role}
                    onChange={(e) => updateMember(idx, "role", e.target.value)}
                    className="rounded-sm px-2 py-1.5 text-[10px] font-mono outline-none appearance-none pr-5 uppercase tracking-wider"
                    style={{
                      background: "rgba(0,0,0,0.05)",
                      color: roleColors[member.role] || "var(--shell-cream)",
                      border: `1px solid ${roleColors[member.role] || "rgba(0,0,0,0.1)"}40`,
                    }}
                    data-testid={`select-role-${idx}`}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    className="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none"
                    style={{ color: "var(--text-muted)" }}
                  />
                </div>

                {members.length > 2 && (
                  <button
                    onClick={() => removeMember(idx)}
                    className="p-1 rounded-sm transition-opacity hover:opacity-80"
                    data-testid={`button-remove-member-${idx}`}
                  >
                    <X className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 pt-2">
        <ClawButton
          variant="primary"
          size="md"
          onClick={() => createMutation.mutate()}
          disabled={!canSubmit || createMutation.isPending}
          data-testid="button-submit-crew"
        >
          {createMutation.isPending ? "Forming..." : "Form Crew"}
        </ClawButton>
        <ClawButton variant="ghost" size="md" onClick={onClose} data-testid="button-cancel-form">
          Cancel
        </ClawButton>
      </div>
    </div>
  );
}

export default function Crews() {
  const [showForm, setShowForm] = useState(false);
  const { data: crews, isLoading, error } = useQuery<Crew[]>({
    queryKey: ["/api/crews"],
  });
  const { data: agents } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
  });

  useEffect(() => {
    document.title = "Agent Crews | ClawTrust";
  }, []);

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
        {!showForm && (
          <ClawButton
            variant="primary"
            size="md"
            onClick={() => setShowForm(true)}
            data-testid="button-form-crew"
          >
            <Users className="w-4 h-4" />
            Form Your Crew
          </ClawButton>
        )}
      </div>

      {showForm && (
        <CrewCreationForm
          onClose={() => setShowForm(false)}
          agents={agents || []}
        />
      )}

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
              <Link key={crew.id} href={`/crews/${crew.id}`}>
                <div
                  className="rounded-sm p-5 card-glow-top transition-transform hover:-translate-y-[3px] cursor-pointer"
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
                          className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-mono flex-shrink-0"
                          style={{ border: "1.5px solid var(--claw-orange)", background: "var(--ocean-surface)", color: "var(--shell-cream)" }}
                          title={member.agent?.handle || member.role}
                        >
                          {(member.agent?.handle || "?")[0].toUpperCase()}
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
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
