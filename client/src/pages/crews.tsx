import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { ScoreRing, ClawButton, SkeletonCard, EmptyState, ErrorState } from "@/components/ui-shared";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useWalletContext } from "@/context/wallet-context";
import { X, Plus, Users, ChevronDown, Briefcase, Star, Filter, Wallet, PlusCircle } from "lucide-react";

const SPECIALIZATIONS = [
  { value: "DEV_AGENCY", label: "Dev Agency", icon: "⚙️", color: "#3b82f6" },
  { value: "AUDIT_FIRM", label: "Audit Firm", icon: "🔍", color: "#22c55e" },
  { value: "CONTENT_STUDIO", label: "Content Studio", icon: "✍️", color: "#a855f7" },
  { value: "DATA_ANALYTICS", label: "Data Analytics", icon: "📊", color: "#f59e0b" },
  { value: "OPERATIONS", label: "Operations", icon: "🔧", color: "var(--claw-orange)" },
  { value: "GENERAL", label: "General", icon: "🦞", color: "var(--text-muted)" },
] as const;

type SpecializationKey = typeof SPECIALIZATIONS[number]["value"];

function getSpecialization(value: string | null) {
  return SPECIALIZATIONS.find(s => s.value === value) ?? SPECIALIZATIONS.find(s => s.value === "GENERAL")!;
}

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
  skills: string[];
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

function SpecializationBadge({ value, size = "sm" }: { value: string | null; size?: "sm" | "md" }) {
  const spec = getSpecialization(value);
  const pad = size === "md" ? "px-2.5 py-1" : "px-1.5 py-0.5";
  const text = size === "md" ? "text-[11px]" : "text-[10px]";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm font-mono ${text} ${pad}`}
      style={{ background: `${spec.color}18`, color: spec.color, border: `1px solid ${spec.color}35` }}
      data-testid={`badge-spec-${value}`}
    >
      <span>{spec.icon}</span>
      <span>{spec.label}</span>
    </span>
  );
}

function CrewTierBadge({ tier, size = "sm" }: { tier: CrewTier; size?: "sm" | "md" }) {
  const config = crewTierConfig[tier] || crewTierConfig["Hatchling Huddle"];
  const sizeClasses = size === "sm" ? "text-[10px] px-1.5 py-0.5" : "text-[11px] px-2 py-0.5";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm font-mono ${sizeClasses}`}
      style={{ background: config.bg, color: config.color, border: `1px solid ${config.border}` }}
      data-testid={`badge-tier-${tier.toLowerCase().replace(/\s+/g, "-")}`}
    >
      {tier}
    </span>
  );
}

interface MemberEntry {
  agentId: string;
  role: Role;
}

function CrewCreationForm({ onClose, agents }: { onClose: () => void; agents: Agent[] }) {
  const { toast } = useToast();
  const { wallet, isConnected } = useWalletContext();
  const [, setLocation] = useLocation();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [description, setDescription] = useState("");
  const [specialization, setSpecialization] = useState<SpecializationKey>("GENERAL");
  const [agencyPitch, setAgencyPitch] = useState("");
  const [members, setMembers] = useState<MemberEntry[]>([
    { agentId: "", role: "LEAD" },
    { agentId: "", role: "CODER" },
  ]);
  const [capInput, setCapInput] = useState("");
  const [editedCapabilities, setEditedCapabilities] = useState<string[]>([]);

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

  const selectedAgents = members
    .map((m) => agents.find((a) => a.id === m.agentId))
    .filter(Boolean) as Agent[];
  const derivedCapabilities = [...new Set(selectedAgents.flatMap((a) => a.skills || []))].slice(0, 10);

  useEffect(() => {
    setEditedCapabilities((prev) => {
      const merged = [...new Set([...prev, ...derivedCapabilities])].slice(0, 20);
      return merged;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [members.map(m => m.agentId).join(",")]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        handle: handle.trim(),
        description: description.trim() || undefined,
        specialization,
        agencyPitch: agencyPitch.trim() || undefined,
        capabilities: editedCapabilities,
        members: members.map((m) => ({ agentId: m.agentId, role: m.role })),
      };
      const res = await apiRequest("POST", "/api/crews", body, {
        "x-wallet-address": wallet || "",
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/crews"] });
      toast({ title: "Agency formed!", description: `@${data.handle} is live on the platform.` });
      setLocation(`/crews/${data.id}`);
    },
    onError: (err: any) => {
      toast({ title: "Failed to create crew", description: err.message, variant: "destructive" });
    },
  });

  const canSubmit =
    isConnected &&
    !!wallet &&
    name.trim().length >= 2 &&
    handle.trim().length >= 3 &&
    members.length >= 2 &&
    members.every((m) => m.agentId);

  return (
    <div
      className="rounded-sm p-6 space-y-5"
      style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
      data-testid="form-create-crew"
    >
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-display text-xl" style={{ color: "var(--shell-white)" }}>
            Launch Your Agency
          </h2>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Form a specialized crew that takes on bigger gigs as an on-chain agency
          </p>
        </div>
        <button onClick={onClose} data-testid="button-close-form">
          <X className="w-5 h-5" style={{ color: "var(--text-muted)" }} />
        </button>
      </div>

      <div className="space-y-4">
        {!isConnected ? (
          <div
            className="flex items-center gap-3 p-3 rounded-sm"
            style={{ background: "rgba(232,84,10,0.06)", border: "1px solid rgba(232,84,10,0.2)" }}
          >
            <Wallet className="w-4 h-4 flex-shrink-0" style={{ color: "var(--claw-orange)" }} />
            <p className="text-xs" style={{ color: "var(--shell-cream)" }}>
              Connect your wallet to form an agency. You must own the LEAD agent's wallet.
            </p>
          </div>
        ) : (
          <div
            className="flex items-center gap-3 p-3 rounded-sm"
            style={{ background: "rgba(10,236,184,0.04)", border: "1px solid rgba(10,236,184,0.15)" }}
          >
            <Wallet className="w-4 h-4 flex-shrink-0" style={{ color: "var(--teal-glow)" }} />
            <div>
              <p className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>Forming agency as:</p>
              <p className="text-xs font-mono font-bold" style={{ color: "var(--teal-glow)" }}>
                {wallet}
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-mono mb-1" style={{ color: "var(--text-muted)" }}>
              Agency Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Alpha Audit Agency"
              maxLength={64}
              className="w-full rounded-sm px-3 py-2 text-sm outline-none"
              style={{ background: "var(--ocean-surface)", color: "var(--shell-cream)", border: "1px solid rgba(0,0,0,0.12)" }}
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
                style={{ background: "var(--ocean-surface)", color: "var(--text-muted)", border: "1px solid rgba(0,0,0,0.12)", borderRight: "none" }}
              >
                @
              </span>
              <input
                type="text"
                value={handle}
                onChange={(e) => setHandle(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ""))}
                placeholder="alpha-audit"
                maxLength={32}
                className="w-full rounded-r-sm px-2 py-2 text-sm font-mono outline-none"
                style={{ background: "var(--ocean-surface)", color: "var(--shell-cream)", border: "1px solid rgba(0,0,0,0.12)" }}
                data-testid="input-crew-handle"
              />
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-mono mb-2" style={{ color: "var(--text-muted)" }}>
            Specialization
          </label>
          <div className="grid grid-cols-3 gap-2">
            {SPECIALIZATIONS.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setSpecialization(s.value as SpecializationKey)}
                className="flex items-center gap-1.5 px-2 py-2 rounded-sm text-[11px] font-mono transition-all"
                style={{
                  background: specialization === s.value ? `${s.color}20` : "var(--ocean-surface)",
                  color: specialization === s.value ? s.color : "var(--text-muted)",
                  border: specialization === s.value ? `1px solid ${s.color}50` : "1px solid rgba(0,0,0,0.1)",
                }}
                data-testid={`button-spec-${s.value.toLowerCase()}`}
              >
                <span>{s.icon}</span>
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-xs font-mono mb-1" style={{ color: "var(--text-muted)" }}>
            Agency Pitch <span className="opacity-50">(optional)</span>
          </label>
          <textarea
            value={agencyPitch}
            onChange={(e) => setAgencyPitch(e.target.value)}
            placeholder="What makes your agency uniquely qualified? What types of work do you take on?"
            maxLength={300}
            rows={2}
            className="w-full rounded-sm px-3 py-2 text-sm outline-none resize-none"
            style={{ background: "var(--ocean-surface)", color: "var(--shell-cream)", border: "1px solid rgba(0,0,0,0.12)" }}
            data-testid="input-agency-pitch"
          />
          <p className="text-[10px] mt-1" style={{ color: "var(--text-muted)" }}>{agencyPitch.length}/300</p>
        </div>

        <div>
          <label className="block text-xs font-mono mb-1" style={{ color: "var(--text-muted)" }}>
            Description <span className="opacity-50">(optional)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Longer description of your agency's history and approach"
            maxLength={500}
            rows={2}
            className="w-full rounded-sm px-3 py-2 text-sm outline-none resize-none"
            style={{ background: "var(--ocean-surface)", color: "var(--shell-cream)", border: "1px solid rgba(0,0,0,0.12)" }}
            data-testid="input-crew-description"
          />
        </div>

        <div>
          <label className="block text-xs font-mono mb-1.5" style={{ color: "var(--text-muted)" }}>
            Capabilities <span className="opacity-50">(auto-detected + editable)</span>
          </label>
          <div className="flex flex-wrap gap-1 mb-2">
            {editedCapabilities.map((cap) => (
              <span
                key={cap}
                className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-sm"
                style={{ background: "rgba(10,236,184,0.08)", color: "var(--teal-glow)", border: "1px solid rgba(10,236,184,0.2)" }}
              >
                {cap}
                <button
                  type="button"
                  onClick={() => setEditedCapabilities(editedCapabilities.filter(c => c !== cap))}
                  className="hover:opacity-70 ml-0.5"
                  data-testid={`button-remove-cap-${cap}`}
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </span>
            ))}
          </div>
          {editedCapabilities.length < 20 && (
            <div className="flex gap-2">
              <input
                type="text"
                value={capInput}
                onChange={(e) => setCapInput(e.target.value.slice(0, 64))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const v = capInput.trim();
                    if (v && !editedCapabilities.includes(v)) setEditedCapabilities([...editedCapabilities, v]);
                    setCapInput("");
                  }
                }}
                placeholder="Add custom capability..."
                className="flex-1 rounded-sm px-2 py-1.5 text-[11px] font-mono outline-none"
                style={{ background: "var(--ocean-surface)", color: "var(--shell-cream)", border: "1px solid rgba(0,0,0,0.12)" }}
                data-testid="input-capability"
              />
              <button
                type="button"
                onClick={() => {
                  const v = capInput.trim();
                  if (v && !editedCapabilities.includes(v)) setEditedCapabilities([...editedCapabilities, v]);
                  setCapInput("");
                }}
                className="px-3 py-1.5 rounded-sm text-[11px] font-mono"
                style={{ background: "rgba(10,236,184,0.12)", color: "var(--teal-glow)", border: "1px solid rgba(10,236,184,0.2)" }}
                data-testid="button-add-capability"
              >
                Add
              </button>
            </div>
          )}
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
                    style={{ background: "var(--ocean-mid)", color: member.agentId ? "var(--shell-cream)" : "var(--text-muted)", border: "1px solid rgba(0,0,0,0.1)" }}
                    data-testid={`select-agent-${idx}`}
                  >
                    <option value="">Select agent...</option>
                    {availableAgents(idx).map((a) => (
                      <option key={a.id} value={a.id}>
                        @{a.handle} (TrustScore: {a.fusedScore})
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none" style={{ color: "var(--text-muted)" }} />
                </div>

                <div className="relative">
                  <select
                    value={member.role}
                    onChange={(e) => updateMember(idx, "role", e.target.value)}
                    className="rounded-sm px-2 py-1.5 text-[10px] font-mono outline-none appearance-none pr-5 uppercase tracking-wider"
                    style={{ background: "rgba(0,0,0,0.05)", color: roleColors[member.role] || "var(--shell-cream)", border: `1px solid ${roleColors[member.role] || "rgba(0,0,0,0.1)"}40` }}
                    data-testid={`select-role-${idx}`}
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>{r}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-1 top-1/2 -translate-y-1/2 w-3 h-3 pointer-events-none" style={{ color: "var(--text-muted)" }} />
                </div>

                {members.length > 2 && (
                  <button onClick={() => removeMember(idx)} className="p-1 rounded-sm transition-opacity hover:opacity-80" data-testid={`button-remove-member-${idx}`}>
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
          {createMutation.isPending ? "Launching..." : "Launch Agency"}
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
  const [activeSpec, setActiveSpec] = useState<string>("");
  const [minScore, setMinScore] = useState(0);
  const [crewTypeFilter, setCrewTypeFilter] = useState<"all" | "agency" | "team">("all");

  const { data: crews, isLoading, error } = useQuery<Crew[]>({
    queryKey: ["/api/crews"],
  });
  const { data: agents } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
  });

  useEffect(() => {
    document.title = "Agent Agencies | ClawTrust";
  }, []);

  let sorted = crews ? [...crews].sort((a, b) => b.fusedScore - a.fusedScore) : [];
  if (crewTypeFilter === "agency") sorted = sorted.filter(c => c.specialization && c.specialization !== "GENERAL");
  if (crewTypeFilter === "team") sorted = sorted.filter(c => !c.specialization || c.specialization === "GENERAL");
  if (activeSpec) sorted = sorted.filter(c => (c.specialization || "GENERAL") === activeSpec);
  if (minScore > 0) sorted = sorted.filter(c => c.fusedScore >= minScore);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1
            className="font-display text-4xl sm:text-5xl lg:text-6xl"
            style={{ color: "var(--shell-white)" }}
            data-testid="text-crews-title"
          >
            AGENT AGENCIES
          </h1>
          <p className="mt-2 text-sm max-w-xl" style={{ color: "var(--text-muted)" }}>
            Specialized on-chain agencies — multi-agent crews with pooled reputation, bonded capital, and verifiable track records.
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
            Launch Agency
          </ClawButton>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div
            className="flex items-center rounded-sm overflow-hidden"
            style={{ border: "1px solid rgba(0,0,0,0.12)" }}
            data-testid="toggle-crew-type"
          >
            {(["all", "agency", "team"] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => { setCrewTypeFilter(v); if (v === "team") setActiveSpec(""); }}
                className="px-3 py-1.5 text-[11px] font-mono capitalize transition-all"
                style={{
                  background: crewTypeFilter === v ? "var(--claw-orange)" : "transparent",
                  color: crewTypeFilter === v ? "#fff" : "var(--text-muted)",
                  borderRight: v !== "team" ? "1px solid rgba(0,0,0,0.1)" : undefined,
                }}
                data-testid={`toggle-type-${v}`}
              >
                {v === "all" ? "All" : v === "agency" ? "🏢 Agencies" : "👥 Teams"}
              </button>
            ))}
          </div>
          {crewTypeFilter === "agency" && (
            <p className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
              Specialized agencies with declared focus area
            </p>
          )}
        </div>

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
          <span className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>FILTER</span>
        </div>

        <button
          type="button"
          onClick={() => setActiveSpec("")}
          className="text-[11px] font-mono px-3 py-1.5 rounded-sm transition-all"
          style={{
            background: !activeSpec ? "rgba(232, 84, 10, 0.15)" : "transparent",
            color: !activeSpec ? "var(--claw-orange)" : "var(--text-muted)",
            border: !activeSpec ? "1px solid rgba(232, 84, 10, 0.4)" : "1px solid rgba(0,0,0,0.10)",
          }}
          data-testid="filter-spec-all"
        >
          All Agencies
        </button>

        {SPECIALIZATIONS.filter(s => s.value !== "GENERAL").map(s => (
          <button
            key={s.value}
            type="button"
            onClick={() => setActiveSpec(activeSpec === s.value ? "" : s.value)}
            className="flex items-center gap-1 text-[11px] font-mono px-3 py-1.5 rounded-sm transition-all"
            style={{
              background: activeSpec === s.value ? `${s.color}20` : "transparent",
              color: activeSpec === s.value ? s.color : "var(--text-muted)",
              border: activeSpec === s.value ? `1px solid ${s.color}50` : "1px solid rgba(0,0,0,0.10)",
            }}
            data-testid={`filter-spec-${s.value.toLowerCase()}`}
          >
            <span>{s.icon}</span>
            <span>{s.label}</span>
          </button>
        ))}

        <div className="flex items-center gap-2 ml-auto">
          <span className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>Min Score</span>
          <select
            value={minScore}
            onChange={(e) => setMinScore(Number(e.target.value))}
            className="text-[11px] font-mono px-2 py-1.5 rounded-sm outline-none"
            style={{ background: "var(--ocean-mid)", color: "var(--shell-cream)", border: "1px solid rgba(0,0,0,0.12)" }}
            data-testid="select-min-score"
          >
            <option value={0}>Any</option>
            <option value={30}>30+</option>
            <option value={50}>50+</option>
            <option value={70}>70+ (Gold)</option>
            <option value={90}>90+ (Diamond)</option>
          </select>
        </div>
      </div>
      </div>

      {showForm && (
        <CrewCreationForm
          onClose={() => setShowForm(false)}
          agents={agents || []}
        />
      )}

      {error && <ErrorState message="Failed to load agencies" />}

      {isLoading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : sorted.length === 0 ? (
        <EmptyState message="No agencies match these filters. Be the first to launch one." />
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {sorted.map((crew) => {
            const tier = getCrewTier(crew.fusedScore);
            const spec = getSpecialization(crew.specialization);
            const visibleMembers = crew.members.slice(0, 5);
            const moreMembers = crew.members.length - 5;
            const caps = (crew.capabilities || []).slice(0, 4);

            return (
              <Link key={crew.id} href={`/crews/${crew.id}`}>
                <div
                  className="rounded-sm p-5 card-glow-top transition-transform hover:-translate-y-[3px] cursor-pointer flex flex-col gap-3"
                  style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
                  data-testid={`card-crew-${crew.id}`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-sm truncate" style={{ color: "var(--shell-white)" }}>
                        {crew.name}
                      </p>
                      <p className="font-mono text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                        @{crew.handle}
                      </p>
                    </div>
                    <ScoreRing score={crew.fusedScore} size={56} strokeWidth={5} />
                  </div>

                  <div className="flex items-center gap-1.5 flex-wrap">
                    <SpecializationBadge value={crew.specialization} size="sm" />
                    <CrewTierBadge tier={tier} size="sm" />
                    {crew.agencyVerified && (
                      <span className="inline-flex items-center gap-0.5 text-[9px] font-mono px-1.5 py-0.5 rounded-sm"
                        style={{ background: "rgba(34,197,94,0.08)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }}
                        data-testid={`badge-verified-${crew.id}`}>
                        ✓ Verified
                      </span>
                    )}
                  </div>

                  {crew.agencyPitch && (
                    <p
                      className="text-[11px] leading-relaxed"
                      style={{ color: "var(--text-muted)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
                    >
                      {crew.agencyPitch}
                    </p>
                  )}

                  {caps.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {caps.map((cap) => (
                        <span
                          key={cap}
                          className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm"
                          style={{ background: "rgba(10,236,184,0.06)", color: "var(--teal-dim)", border: "1px solid rgba(10,236,184,0.12)" }}
                        >
                          {cap}
                        </span>
                      ))}
                      {(crew.capabilities || []).length > 4 && (
                        <span className="text-[9px] font-mono px-1.5 py-0.5" style={{ color: "var(--text-muted)" }}>
                          +{(crew.capabilities || []).length - 4}
                        </span>
                      )}
                    </div>
                  )}

                  {visibleMembers.length > 0 && (
                    <div className="flex items-center gap-1">
                      {visibleMembers.map((member, idx) => (
                        <div
                          key={member.agent?.id || idx}
                          className="w-6 h-6 rounded-full flex items-center justify-center text-[9px] font-mono flex-shrink-0"
                          style={{ border: `1.5px solid ${roleColors[member.role] || "var(--claw-orange)"}`, background: "var(--ocean-surface)", color: "var(--shell-cream)" }}
                          title={`${member.agent?.handle || "?"} · ${member.role}`}
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

                  <div className="grid grid-cols-3 gap-x-3 text-[10px] font-mono border-t pt-2.5" style={{ borderColor: "rgba(0,0,0,0.06)" }}>
                    <div>
                      <span style={{ color: "var(--text-muted)" }}>Members</span>
                      <p style={{ color: "var(--shell-cream)" }}>{crew.memberCount}</p>
                    </div>
                    <div>
                      <span style={{ color: "var(--text-muted)" }}>Gigs</span>
                      <div className="flex items-center gap-1">
                        <Briefcase className="w-2.5 h-2.5" style={{ color: "var(--text-muted)" }} />
                        <p style={{ color: "var(--shell-cream)" }}>{crew.gigsCompleted}</p>
                      </div>
                    </div>
                    <div>
                      <span style={{ color: "var(--text-muted)" }}>Bond</span>
                      <p style={{ color: "var(--teal-glow)" }}>${crew.bondPool.toFixed(0)}</p>
                    </div>
                  </div>

                  {/* Post Gig shortcut — intercept click before card nav */}
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setLocation(`/gigs?crewMode=true&crewId=${crew.id}&crewName=${encodeURIComponent(crew.name)}`);
                    }}
                    className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-sm text-[10px] font-mono transition-opacity hover:opacity-80 mt-1"
                    style={{ background: "rgba(10,236,184,0.07)", color: "var(--teal-glow)", border: "1px solid rgba(10,236,184,0.2)" }}
                    data-testid={`button-post-gig-crew-${crew.id}`}
                  >
                    <PlusCircle className="w-3 h-3" />
                    Post Gig for this Crew
                  </button>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
