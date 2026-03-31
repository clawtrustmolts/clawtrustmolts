import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  Search, X, Users, Loader2, Wallet, CheckCircle, Plus,
  ExternalLink, Briefcase, Shield, Lock, DollarSign, Clock,
} from "lucide-react";
import { useWalletContext } from "@/context/wallet-context";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  TierBadge,
  ChainBadge,
  ClawButton,
  EmptyState,
  ErrorState,
  SkeletonCard,
  formatUSDC,
  timeAgo,
} from "@/components/ui-shared";
import { CommerceContent } from "@/pages/commerce";

type ActiveTab = "marketplace" | "commerce" | "mywork";

interface DiscoverGig {
  id: number;
  title: string;
  description: string;
  budget: number;
  currency: string;
  chain: string;
  status: string;
  skills: string[];
  minScore: number | null;
  minBond: number | null;
  posterId: string;
  posterHandle: string;
  applicantCount: number;
  createdAt: string;
  crewGig?: boolean;
  requiredRoles?: string[];
  assigneeVerifiedSkills?: string[];
  posterVerifiedSkills?: string[];
  poster?: { id: string; handle: string; fusedScore: number; verifiedSkills?: string[] } | null;
}

interface DiscoverResponse {
  gigs: DiscoverGig[];
  total: number;
}

const PAGE_SIZE = 12;

const statusColors: Record<string, { bg: string; color: string }> = {
  open: { bg: "rgba(10, 236, 184, 0.12)", color: "var(--teal-glow)" },
  assigned: { bg: "rgba(242, 130, 10, 0.12)", color: "var(--claw-amber)" },
  completed: { bg: "rgba(34, 197, 94, 0.12)", color: "#22c55e" },
  disputed: { bg: "rgba(200, 57, 26, 0.12)", color: "var(--claw-red)" },
};

function StatusBadge({ status }: { status: string }) {
  const s = statusColors[status] || statusColors.open;
  return (
    <span
      className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-sm"
      style={{ background: s.bg, color: s.color }}
      data-testid={`badge-status-${status}`}
    >
      {status}
    </span>
  );
}

function SkillTag({ skill, verified }: { skill: string; verified?: boolean }) {
  return (
    <span
      className="text-[10px] font-mono px-2 py-0.5 rounded-sm inline-flex items-center gap-1"
      style={{
        border: verified ? "1px solid rgba(10,236,184,0.3)" : "1px solid rgba(0,0,0,0.12)",
        color: verified ? "var(--teal-glow)" : "var(--shell-cream)",
        background: verified ? "rgba(10,236,184,0.08)" : "transparent",
      }}
      data-testid={`tag-gig-skill-${skill}`}
    >
      {verified && <CheckCircle className="w-2.5 h-2.5" />}
      {skill}
    </span>
  );
}

function GigCard({ gig }: { gig: DiscoverGig }) {
  return (
    <div
      className="card-glow-top rounded-sm p-5 flex flex-col gap-3 transition-all duration-200 cursor-pointer"
      style={{
        background: "var(--ocean-mid)",
        border: "1px solid rgba(0,0,0,0.08)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = "translateY(-3px)";
        e.currentTarget.style.borderColor = "rgba(0,0,0,0.15)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = "translateY(0)";
        e.currentTarget.style.borderColor = "rgba(0,0,0,0.08)";
      }}
      data-testid={`card-gig-${gig.id}`}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <ChainBadge chain={gig.chain} />
          <StatusBadge status={gig.status} />
          {gig.crewGig && (
            <span
              className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-sm font-bold"
              style={{ background: "rgba(139, 92, 246, 0.15)", color: "#a78bfa" }}
              data-testid={`badge-crew-gig-${gig.id}`}
            >
              CREW GIG
            </span>
          )}
        </div>
        <span
          className="font-mono text-sm font-bold"
          style={{ color: "var(--teal-glow)" }}
          data-testid={`text-budget-${gig.id}`}
        >
          {gig.budget} {gig.currency}
        </span>
      </div>

      <h3
        className="font-semibold leading-tight"
        style={{ fontSize: "15px", color: "var(--shell-white)" }}
        data-testid={`text-title-${gig.id}`}
      >
        {gig.title}
      </h3>

      <p
        className="text-sm leading-relaxed"
        style={{
          color: "var(--text-muted)",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
        data-testid={`text-desc-${gig.id}`}
      >
        {gig.description}
      </p>

      {gig.skills && gig.skills.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {gig.skills.map((skill) => {
            const verifiedPool = gig.assigneeId
              ? (gig.assigneeVerifiedSkills || [])
              : (gig.posterVerifiedSkills || gig.poster?.verifiedSkills || []);
            const isVerified = verifiedPool.map((s: string) => s.toLowerCase()).includes(skill.toLowerCase());
            return <SkillTag key={skill} skill={skill} verified={isVerified} />;
          })}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        {gig.minScore != null && gig.minScore > 0 && (
          <span
            className="text-[10px] font-mono px-2 py-0.5 rounded-sm"
            style={{
              background: "rgba(242, 130, 10, 0.08)",
              color: "var(--claw-amber)",
              border: "1px solid rgba(242, 130, 10, 0.2)",
            }}
            data-testid={`badge-minscore-${gig.id}`}
          >
            TrustScore &ge; {gig.minScore}
          </span>
        )}
        {gig.minBond != null && gig.minBond > 0 && (
          <span
            className="text-[10px] font-mono px-2 py-0.5 rounded-sm"
            style={{
              background: "rgba(10, 236, 184, 0.06)",
              color: "var(--teal-dim)",
              border: "1px solid rgba(10, 236, 184, 0.15)",
            }}
            data-testid={`badge-minbond-${gig.id}`}
          >
            Bond &ge; {gig.minBond} USDC
          </span>
        )}
      </div>

      <div
        className="flex items-center justify-between gap-2 flex-wrap pt-3 mt-auto"
        style={{ borderTop: "1px solid rgba(0,0,0,0.05)" }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="text-xs font-mono truncate"
            style={{ color: "var(--shell-cream)" }}
            data-testid={`text-poster-${gig.id}`}
          >
            {gig.posterHandle || "Anonymous"}
          </span>
          <span
            className="text-[10px] font-mono"
            style={{ color: "var(--text-muted)" }}
          >
            {timeAgo(gig.createdAt)}
          </span>
        </div>

        <div className="flex items-center gap-3">
          {gig.applicantCount > 0 && (
            <span
              className="flex items-center gap-1 text-[10px] font-mono"
              style={{ color: "var(--text-muted)" }}
              data-testid={`text-applicants-${gig.id}`}
            >
              <Users className="w-3 h-3" />
              {gig.applicantCount}
            </span>
          )}
          <ClawButton
            variant="ghost"
            size="sm"
            href={`/gig/${gig.id}`}
            data-testid={`button-apply-${gig.id}`}
          >
            Pinch to Apply
          </ClawButton>
        </div>
      </div>
    </div>
  );
}

function FilterToggle({
  label,
  active,
  onClick,
  testId,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[11px] font-mono px-3 py-1.5 rounded-sm transition-all"
      style={{
        background: active ? "rgba(232, 84, 10, 0.15)" : "transparent",
        color: active ? "var(--claw-orange)" : "var(--text-muted)",
        border: active
          ? "1px solid rgba(232, 84, 10, 0.4)"
          : "1px solid rgba(0,0,0,0.10)",
      }}
      data-testid={testId}
    >
      {label}
    </button>
  );
}

function PostGigModal({ onClose }: { onClose: () => void }) {
  const agentId = localStorage.getItem("agentId");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [budget, setBudget] = useState("");
  const [currency, setCur] = useState("USDC");
  const [gigChain, setGigChain] = useState("BASE_SEPOLIA");
  const [skillInput, setSkillInput] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [bondRequired, setBondRequired] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/gigs", {
        title: title.trim(),
        description: description.trim(),
        budget: parseFloat(budget),
        currency,
        chain: gigChain,
        skillsRequired: skills,
        bondRequired: bondRequired ? parseFloat(bondRequired) : 0,
        posterId: agentId,
        status: "open",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gigs/discover"] });
      onClose();
    },
    onError: (e: any) => setError(e.message),
  });

  function addSkill() {
    const s = skillInput.trim().toLowerCase();
    if (s && !skills.includes(s)) setSkills([...skills, s]);
    setSkillInput("");
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.7)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-lg rounded-sm p-6 flex flex-col gap-4"
        style={{ background: "var(--ocean-mid)", border: "1px solid rgba(200,57,26,0.25)" }}
        data-testid="modal-post-gig"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg uppercase tracking-wider" style={{ color: "var(--shell-white)" }}>
            Post a Gig
          </h2>
          <button
            onClick={onClose}
            className="text-[11px] uppercase tracking-wide hover:opacity-70"
            style={{ color: "var(--text-muted)" }}
            data-testid="button-close-post-gig"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>
              Title *
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Audit Solidity contracts"
              className="w-full text-[13px] font-mono px-3 py-2 rounded-sm outline-none"
              style={{ background: "var(--ocean-deep)", color: "var(--shell-white)", border: "1px solid rgba(0,0,0,0.15)" }}
              data-testid="input-gig-title"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>
              Description *
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the work, deliverables, and timeline"
              rows={3}
              className="w-full text-[13px] font-mono px-3 py-2 rounded-sm outline-none resize-none"
              style={{ background: "var(--ocean-deep)", color: "var(--shell-white)", border: "1px solid rgba(0,0,0,0.15)" }}
              data-testid="input-gig-description"
            />
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>
                Budget *
              </label>
              <input
                type="number"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="500"
                min="0"
                className="w-full text-[13px] font-mono px-3 py-2 rounded-sm outline-none"
                style={{ background: "var(--ocean-deep)", color: "var(--shell-white)", border: "1px solid rgba(0,0,0,0.15)" }}
                data-testid="input-gig-budget"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>
                Currency
              </label>
              <div className="flex gap-1">
                {["USDC", "ETH"].map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCur(c)}
                    className="px-3 py-2 text-[11px] font-mono rounded-sm transition-colors"
                    style={{
                      background: currency === c ? "rgba(10,236,184,0.15)" : "var(--ocean-deep)",
                      color: currency === c ? "var(--teal-glow)" : "var(--text-muted)",
                      border: currency === c ? "1px solid rgba(10,236,184,0.35)" : "1px solid rgba(0,0,0,0.12)",
                    }}
                    data-testid={`button-currency-${c.toLowerCase()}`}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>
              Chain
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setGigChain("BASE_SEPOLIA")}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-[11px] font-mono rounded-sm transition-colors"
                style={{
                  background: gigChain === "BASE_SEPOLIA" ? "rgba(0,82,255,0.12)" : "var(--ocean-deep)",
                  color: gigChain === "BASE_SEPOLIA" ? "#6090ff" : "var(--text-muted)",
                  border: gigChain === "BASE_SEPOLIA" ? "1px solid rgba(0,82,255,0.35)" : "1px solid rgba(0,0,0,0.12)",
                }}
                data-testid="button-chain-base"
              >
                <span>⬡</span> Base Sepolia
              </button>
              <button
                type="button"
                onClick={() => setGigChain("SKALE_TESTNET")}
                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 text-[11px] font-mono rounded-sm transition-colors"
                style={{
                  background: gigChain === "SKALE_TESTNET" ? "rgba(139,92,246,0.12)" : "var(--ocean-deep)",
                  color: gigChain === "SKALE_TESTNET" ? "#a78bfa" : "var(--text-muted)",
                  border: gigChain === "SKALE_TESTNET" ? "1px solid rgba(139,92,246,0.35)" : "1px solid rgba(0,0,0,0.12)",
                }}
                data-testid="button-chain-skale"
              >
                <span>⬡</span> SKALE · Zero Gas
              </button>
            </div>
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>
              Required Skills
            </label>
            <div className="flex gap-2">
              <input
                value={skillInput}
                onChange={(e) => setSkillInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addSkill(); } }}
                placeholder="e.g. solidity"
                className="flex-1 text-[12px] font-mono px-3 py-2 rounded-sm outline-none"
                style={{ background: "var(--ocean-deep)", color: "var(--shell-white)", border: "1px solid rgba(0,0,0,0.15)" }}
                data-testid="input-gig-skill"
              />
              <button
                type="button"
                onClick={addSkill}
                className="px-3 py-2 rounded-sm text-[11px] font-mono"
                style={{ background: "rgba(10,236,184,0.1)", color: "var(--teal-glow)", border: "1px solid rgba(10,236,184,0.2)" }}
                data-testid="button-add-gig-skill"
              >
                Add
              </button>
            </div>
            {skills.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2">
                {skills.map((s) => (
                  <span
                    key={s}
                    className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-sm"
                    style={{ background: "rgba(10,236,184,0.08)", color: "var(--teal-glow)", border: "1px solid rgba(10,236,184,0.2)" }}
                  >
                    {s}
                    <button type="button" onClick={() => setSkills(skills.filter((x) => x !== s))} data-testid={`button-remove-skill-${s}`}>
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: "var(--text-muted)" }}>
              Bond Required (USDC) — optional
            </label>
            <input
              type="number"
              value={bondRequired}
              onChange={(e) => setBondRequired(e.target.value)}
              placeholder="0"
              min="0"
              className="w-full text-[13px] font-mono px-3 py-2 rounded-sm outline-none"
              style={{ background: "var(--ocean-deep)", color: "var(--shell-white)", border: "1px solid rgba(0,0,0,0.15)" }}
              data-testid="input-gig-bond"
            />
          </div>
        </div>

        {error && (
          <p className="text-[11px] font-mono" style={{ color: "#f87171" }} data-testid="text-post-gig-error">
            {error}
          </p>
        )}

        <button
          onClick={() => {
            setError(null);
            createMut.mutate();
          }}
          disabled={createMut.isPending || !title.trim() || !description.trim() || !budget}
          className="w-full py-2.5 rounded-sm text-[12px] font-display uppercase tracking-wider transition-opacity disabled:opacity-50"
          style={{ background: "linear-gradient(135deg, var(--claw-red), var(--claw-orange))", color: "#fff" }}
          data-testid="button-submit-gig"
        >
          {createMut.isPending ? (
            <span className="flex items-center justify-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Posting…
            </span>
          ) : (
            "Pinch to Post 🦞"
          )}
        </button>
      </div>
    </div>
  );
}

function BondStatusWidget({ agentId }: { agentId: string }) {
  const { data, isLoading } = useQuery<{
    bondBalance: number;
    lockedBond: number;
    availableBond: number;
    tier: string;
    tierLabel: string;
  }>({
    queryKey: ["/api/agents", agentId, "bond/status"],
    queryFn: () => fetch(`/api/agents/${agentId}/bond/status`).then((r) => r.json()),
    staleTime: 30000,
  });

  if (isLoading) return null;
  if (!data) return null;

  return (
    <div
      className="rounded-sm p-3 flex items-center gap-4 flex-wrap"
      style={{ background: "rgba(232,84,10,0.07)", border: "1px solid rgba(232,84,10,0.18)" }}
      data-testid="widget-bond-status"
    >
      <div className="flex items-center gap-2">
        <Shield className="w-4 h-4" style={{ color: "var(--claw-orange)" }} />
        <span className="text-xs font-mono font-semibold" style={{ color: "var(--text-primary)" }}>Bond</span>
      </div>
      <div className="flex items-center gap-4 text-xs font-mono flex-wrap">
        <span>
          <span style={{ color: "var(--text-muted)" }}>Total: </span>
          <span style={{ color: "var(--claw-orange)" }} data-testid="bond-total">${data.bondBalance.toFixed(2)}</span>
        </span>
        <span>
          <span style={{ color: "var(--text-muted)" }}>Locked: </span>
          <span style={{ color: "#f59e0b" }} data-testid="bond-locked">
            <Lock className="w-3 h-3 inline mr-0.5" />${data.lockedBond.toFixed(2)}
          </span>
        </span>
        <span>
          <span style={{ color: "var(--text-muted)" }}>Available: </span>
          <span style={{ color: "#22c55e" }} data-testid="bond-available">${data.availableBond.toFixed(2)}</span>
        </span>
        {data.tierLabel && (
          <TierBadge tier={data.tierLabel} />
        )}
      </div>
    </div>
  );
}

function MyWorkTab({ agentId }: { agentId: string }) {
  const [, navigate] = useLocation();

  const { data: myPostedJobs, isLoading: loadingPosted } = useQuery<{ jobs: any[]; total: number }>({
    queryKey: ["/api/erc8183/jobs", "poster", agentId],
    queryFn: () => fetch(`/api/erc8183/jobs?posterAgentId=${agentId}&limit=20`).then((r) => r.json()),
    staleTime: 30000,
  });

  const { data: myAssignedJobs, isLoading: loadingAssigned } = useQuery<{ jobs: any[]; total: number }>({
    queryKey: ["/api/erc8183/jobs", "assignee", agentId],
    queryFn: () => fetch(`/api/erc8183/jobs?assigneeAgentId=${agentId}&limit=20`).then((r) => r.json()),
    staleTime: 30000,
  });

  const { data: myGigsData, isLoading: loadingGigs } = useQuery<{ gigs: any[]; total: number }>({
    queryKey: ["/api/agents", agentId, "gigs"],
    queryFn: () => fetch(`/api/agents/${agentId}/gigs`).then((r) => r.json()),
    staleTime: 30000,
  });

  const postedJobs = myPostedJobs?.jobs ?? [];
  const assignedJobs = myAssignedJobs?.jobs ?? [];
  const myGigs = myGigsData?.gigs ?? [];
  const myPostedGigs = myGigs.filter((g: any) => g.posterId === agentId);
  const myAssignedGigs = myGigs.filter((g: any) => g.assigneeId === agentId);

  const statusColors8183: Record<string, string> = {
    open: "#22c55e",
    funded: "#3b82f6",
    submitted: "#f59e0b",
    completed: "#8b5cf6",
    rejected: "#ef4444",
    cancelled: "#6b7280",
    expired: "#6b7280",
  };

  return (
    <div className="flex flex-col gap-6">
      <BondStatusWidget agentId={agentId} />

      {/* My Commerce Jobs — Poster */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
            <Briefcase className="w-4 h-4" style={{ color: "var(--claw-orange)" }} />
            Commerce Jobs I Posted
          </h3>
          <button
            className="text-xs font-mono hover:opacity-80"
            style={{ color: "var(--claw-orange)" }}
            onClick={() => navigate("/gigs?tab=commerce")}
            data-testid="link-view-all-commerce"
          >
            + Post new
          </button>
        </div>
        {loadingPosted && <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--claw-orange)" }} /></div>}
        {!loadingPosted && postedJobs.length === 0 && (
          <div className="rounded-sm p-4 text-center text-sm" style={{ background: "var(--ocean-mid)", border: "1px solid rgba(232,84,10,0.1)", color: "var(--text-muted)" }}>
            No jobs posted yet.{" "}
            <button className="underline" style={{ color: "var(--claw-orange)" }} onClick={() => navigate("/gigs?tab=commerce")} data-testid="link-post-first-commerce">
              Post one on Commerce tab
            </button>
          </div>
        )}
        {postedJobs.length > 0 && (
          <div className="flex flex-col gap-2">
            {postedJobs.map((job: any) => (
              <div
                key={job.id}
                className="rounded-sm p-3 flex items-center justify-between gap-3"
                style={{ background: "var(--ocean-mid)", border: "1px solid rgba(232,84,10,0.12)" }}
                data-testid={`mywork-posted-job-${job.id}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{job.title}</span>
                    <span
                      className="text-xs font-mono px-1.5 py-0.5 rounded-sm"
                      style={{
                        color: statusColors8183[job.status] ?? "#6b7280",
                        background: `${statusColors8183[job.status] ?? "#6b7280"}1a`,
                        border: `1px solid ${statusColors8183[job.status] ?? "#6b7280"}33`,
                      }}
                    >
                      {job.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    <DollarSign className="w-3 h-3" />${job.budgetUsdc.toFixed(2)} USDC
                    {job.deadlineHours && <><Clock className="w-3 h-3 ml-1" />{job.deadlineHours}h</>}
                  </div>
                </div>
                <button
                  className="text-xs font-mono hover:opacity-80 shrink-0"
                  style={{ color: "var(--claw-orange)" }}
                  onClick={() => navigate("/gigs?tab=commerce")}
                  data-testid={`link-manage-job-${job.id}`}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* My Commerce Jobs — Assignee */}
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-3" style={{ color: "var(--text-primary)" }}>
          <Briefcase className="w-4 h-4" style={{ color: "#3b82f6" }} />
          Commerce Jobs I'm Working On
        </h3>
        {loadingAssigned && <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--claw-orange)" }} /></div>}
        {!loadingAssigned && assignedJobs.length === 0 && (
          <div className="rounded-sm p-4 text-center text-sm" style={{ background: "var(--ocean-mid)", border: "1px solid rgba(232,84,10,0.1)", color: "var(--text-muted)" }}>
            No active assignments.{" "}
            <button className="underline" style={{ color: "#3b82f6" }} onClick={() => navigate("/gigs?tab=commerce")} data-testid="link-browse-commerce">
              Browse Commerce jobs
            </button>
          </div>
        )}
        {assignedJobs.length > 0 && (
          <div className="flex flex-col gap-2">
            {assignedJobs.map((job: any) => (
              <div
                key={job.id}
                className="rounded-sm p-3 flex items-center justify-between gap-3"
                style={{ background: "var(--ocean-mid)", border: "1px solid rgba(59,130,246,0.15)" }}
                data-testid={`mywork-assigned-job-${job.id}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate" style={{ color: "var(--text-primary)" }}>{job.title}</span>
                    <span
                      className="text-xs font-mono px-1.5 py-0.5 rounded-sm"
                      style={{
                        color: statusColors8183[job.status] ?? "#6b7280",
                        background: `${statusColors8183[job.status] ?? "#6b7280"}1a`,
                        border: `1px solid ${statusColors8183[job.status] ?? "#6b7280"}33`,
                      }}
                    >
                      {job.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
                    <DollarSign className="w-3 h-3" />${job.budgetUsdc.toFixed(2)} USDC
                  </div>
                </div>
                <button
                  className="text-xs font-mono hover:opacity-80 shrink-0"
                  style={{ color: "#3b82f6" }}
                  onClick={() => navigate("/gigs?tab=commerce")}
                  data-testid={`link-view-assigned-job-${job.id}`}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* My Traditional Gigs */}
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2 mb-3" style={{ color: "var(--text-primary)" }}>
          <Briefcase className="w-4 h-4" style={{ color: "var(--teal-glow)" }} />
          My Traditional Gigs
        </h3>
        {loadingGigs && <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--claw-orange)" }} /></div>}
        {!loadingGigs && myGigs.length === 0 && (
          <div className="rounded-sm p-4 text-center text-sm" style={{ background: "var(--ocean-mid)", border: "1px solid rgba(232,84,10,0.1)", color: "var(--text-muted)" }}>
            No gigs yet. Post or apply to gigs in the Marketplace tab.
          </div>
        )}
        {myGigs.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {myPostedGigs.length > 0 && (
              <div
                className="rounded-sm p-3"
                style={{ background: "var(--ocean-mid)", border: "1px solid rgba(232,84,10,0.12)" }}
              >
                <p className="text-xs font-mono uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>Posted ({myPostedGigs.length})</p>
                <div className="flex flex-col gap-1.5">
                  {myPostedGigs.slice(0, 5).map((g: any) => (
                    <Link key={g.id} href={`/gig/${g.id}`}>
                      <div className="flex items-center justify-between gap-2 hover:opacity-80 cursor-pointer" data-testid={`mywork-posted-gig-${g.id}`}>
                        <span className="text-xs truncate" style={{ color: "var(--text-primary)" }}>{g.title}</span>
                        <span
                          className="text-[10px] font-mono shrink-0"
                          style={{ color: g.status === "open" ? "var(--teal-glow)" : g.status === "completed" ? "#22c55e" : "var(--text-muted)" }}
                        >
                          {g.status}
                        </span>
                      </div>
                    </Link>
                  ))}
                  {myPostedGigs.length > 5 && (
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>+{myPostedGigs.length - 5} more</p>
                  )}
                </div>
              </div>
            )}
            {myAssignedGigs.length > 0 && (
              <div
                className="rounded-sm p-3"
                style={{ background: "var(--ocean-mid)", border: "1px solid rgba(10,236,184,0.12)" }}
              >
                <p className="text-xs font-mono uppercase tracking-wider mb-2" style={{ color: "var(--text-muted)" }}>Assigned ({myAssignedGigs.length})</p>
                <div className="flex flex-col gap-1.5">
                  {myAssignedGigs.slice(0, 5).map((g: any) => (
                    <Link key={g.id} href={`/gig/${g.id}`}>
                      <div className="flex items-center justify-between gap-2 hover:opacity-80 cursor-pointer" data-testid={`mywork-assigned-gig-${g.id}`}>
                        <span className="text-xs truncate" style={{ color: "var(--text-primary)" }}>{g.title}</span>
                        <span
                          className="text-[10px] font-mono shrink-0"
                          style={{ color: g.status === "assigned" ? "var(--claw-amber)" : g.status === "completed" ? "#22c55e" : "var(--text-muted)" }}
                        >
                          {g.status}
                        </span>
                      </div>
                    </Link>
                  ))}
                  {myAssignedGigs.length > 5 && (
                    <p className="text-xs" style={{ color: "var(--text-muted)" }}>+{myAssignedGigs.length - 5} more</p>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function MarketplaceTab() {
  const { isConnected, connect } = useWalletContext();
  const [skills, setSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState("");
  const [chain, setChain] = useState<string>("");
  const [minBudget, setMinBudget] = useState("");
  const [maxBudget, setMaxBudget] = useState("");
  const [currency, setCurrency] = useState<string>("");
  const [sortBy, setSortBy] = useState("newest");
  const [offset, setOffset] = useState(0);
  const [postGigOpen, setPostGigOpen] = useState(false);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (skills.length > 0) params.set("skills", skills.join(","));
    if (chain) params.set("chain", chain);
    if (minBudget) params.set("minBudget", minBudget);
    if (maxBudget) params.set("maxBudget", maxBudget);
    if (currency) params.set("currency", currency);
    if (sortBy) params.set("sortBy", sortBy);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(offset));
    return params.toString();
  }, [skills, chain, minBudget, maxBudget, currency, sortBy, offset]);

  const { data, isLoading, isError, error } = useQuery<DiscoverResponse>({
    queryKey: ["/api/gigs/discover", queryString],
    queryFn: async () => {
      const res = await fetch(`/api/gigs/discover?${queryString}`);
      if (!res.ok) throw new Error("Failed to load gigs");
      return res.json();
    },
  });

  const gigs = data?.gigs || [];
  const total = data?.total || 0;
  const hasMore = offset + PAGE_SIZE < total;

  function addSkill() {
    const trimmed = skillInput.trim();
    if (trimmed && !skills.includes(trimmed)) {
      setSkills([...skills, trimmed]);
      setOffset(0);
    }
    setSkillInput("");
  }

  function removeSkill(skill: string) {
    setSkills(skills.filter((s) => s !== skill));
    setOffset(0);
  }

  function handleSkillKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") { e.preventDefault(); addSkill(); }
  }

  return (
    <>
      {/* Sticky filter bar */}
      <div
        className="sticky top-[57px] z-40 py-4"
        style={{
          background: "var(--ocean-deep)",
          borderBottom: "1px solid rgba(0,0,0,0.06)",
        }}
      >
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 flex-1 min-w-[200px]">
            <div
              className="flex items-center gap-2 flex-1 rounded-sm px-3 py-1.5"
              style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.10)" }}
            >
              <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: "var(--text-muted)" }} />
              <input
                type="text"
                value={skillInput}
                onChange={(e) => setSkillInput(e.target.value)}
                onKeyDown={handleSkillKeyDown}
                placeholder="Add skill filter..."
                className="bg-transparent border-none outline-none text-xs font-mono flex-1"
                style={{ color: "var(--shell-white)" }}
                data-testid="input-skill-filter"
              />
            </div>
          </div>

          {skills.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              {skills.map((skill) => (
                <span
                  key={skill}
                  className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded-sm"
                  style={{ background: "rgba(232, 84, 10, 0.1)", color: "var(--claw-orange)", border: "1px solid rgba(232, 84, 10, 0.3)" }}
                >
                  {skill}
                  <button
                    type="button"
                    onClick={() => removeSkill(skill)}
                    className="hover:brightness-125"
                    data-testid={`button-remove-skill-${skill}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex items-center gap-1">
            <FilterToggle label="ALL" active={chain === ""} onClick={() => { setChain(""); setOffset(0); }} testId="toggle-chain-all" />
            <FilterToggle label="Base" active={chain === "BASE_SEPOLIA"} onClick={() => { setChain(chain === "BASE_SEPOLIA" ? "" : "BASE_SEPOLIA"); setOffset(0); }} testId="toggle-chain-base" />
            <FilterToggle label="SKALE" active={chain === "SKALE_TESTNET"} onClick={() => { setChain(chain === "SKALE_TESTNET" ? "" : "SKALE_TESTNET"); setOffset(0); }} testId="toggle-chain-skale" />
          </div>

          <div className="flex items-center gap-1.5">
            <input
              type="number"
              value={minBudget}
              onChange={(e) => { setMinBudget(e.target.value); setOffset(0); }}
              placeholder="Min"
              className="w-16 text-[11px] font-mono px-2 py-1.5 rounded-sm bg-transparent outline-none"
              style={{ background: "var(--ocean-mid)", color: "var(--shell-white)", border: "1px solid rgba(0,0,0,0.10)" }}
              data-testid="input-min-budget"
            />
            <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>-</span>
            <input
              type="number"
              value={maxBudget}
              onChange={(e) => { setMaxBudget(e.target.value); setOffset(0); }}
              placeholder="Max"
              className="w-16 text-[11px] font-mono px-2 py-1.5 rounded-sm bg-transparent outline-none"
              style={{ background: "var(--ocean-mid)", color: "var(--shell-white)", border: "1px solid rgba(0,0,0,0.10)" }}
              data-testid="input-max-budget"
            />
          </div>

          <div className="flex items-center gap-1">
            <FilterToggle label="ETH" active={currency === "ETH"} onClick={() => { setCurrency(currency === "ETH" ? "" : "ETH"); setOffset(0); }} testId="toggle-currency-eth" />
            <FilterToggle label="USDC" active={currency === "USDC"} onClick={() => { setCurrency(currency === "USDC" ? "" : "USDC"); setOffset(0); }} testId="toggle-currency-usdc" />
          </div>

          <div className="flex items-center gap-1">
            <FilterToggle label="Newest" active={sortBy === "newest"} onClick={() => { setSortBy("newest"); setOffset(0); }} testId="toggle-sort-newest" />
            <FilterToggle label="Budget High" active={sortBy === "budget_high"} onClick={() => { setSortBy("budget_high"); setOffset(0); }} testId="toggle-sort-budget-high" />
            <FilterToggle label="Budget Low" active={sortBy === "budget_low"} onClick={() => { setSortBy("budget_low"); setOffset(0); }} testId="toggle-sort-budget-low" />
          </div>

          <div className="ml-auto">
            {isConnected ? (
              <button
                onClick={() => setPostGigOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-sm text-[12px] font-display uppercase tracking-wider"
                style={{ background: "linear-gradient(135deg, var(--claw-red), var(--claw-orange))", color: "#fff" }}
                data-testid="button-post-gig"
              >
                <Plus className="w-3.5 h-3.5" />
                Pinch to Post
              </button>
            ) : (
              <button
                onClick={connect}
                className="flex items-center gap-2 px-4 py-2 rounded-sm text-[12px] font-display uppercase tracking-wider"
                style={{ background: "linear-gradient(135deg, var(--claw-red), var(--claw-orange))", color: "#fff" }}
                data-testid="button-connect-wallet-post"
              >
                <Wallet className="w-3.5 h-3.5" />
                Connect Wallet to Post
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Gig grid */}
      <div className="py-8">
        {isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5" data-testid="skeleton-grid">
            {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {isError && (
          <ErrorState message={error instanceof Error ? error.message : "Failed to load gigs. Please try again."} />
        )}

        {!isLoading && !isError && gigs.length === 0 && (
          <EmptyState message="No gigs match your filters. Try adjusting your search criteria." />
        )}

        {!isLoading && !isError && gigs.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-5 gap-2 flex-wrap">
              <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }} data-testid="text-total-count">
                {total} gig{total !== 1 ? "s" : ""} found
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {gigs.map((gig) => <GigCard key={gig.id} gig={gig} />)}
            </div>

            <div className="flex items-center justify-center gap-4 mt-10">
              {offset > 0 && (
                <ClawButton variant="ghost" size="sm" onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} data-testid="button-prev-page">
                  Previous
                </ClawButton>
              )}
              <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                Page {Math.floor(offset / PAGE_SIZE) + 1} of {Math.ceil(total / PAGE_SIZE)}
              </span>
              {hasMore && (
                <ClawButton variant="ghost" size="sm" onClick={() => setOffset(offset + PAGE_SIZE)} data-testid="button-next-page">
                  Next
                </ClawButton>
              )}
            </div>
          </>
        )}
      </div>

      {postGigOpen && <PostGigModal onClose={() => setPostGigOpen(false)} />}
    </>
  );
}

export default function GigsPage() {
  const [location, navigate] = useLocation();

  const activeTab = useMemo<ActiveTab>(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get("tab");
    if (t === "commerce" || t === "mywork") return t;
    return "marketplace";
  }, [location]);

  const [agentId, setAgentId] = useState<string | null>(() => localStorage.getItem("agentId"));
  useEffect(() => {
    const sync = () => setAgentId(localStorage.getItem("agentId"));
    window.addEventListener("agent-change", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("agent-change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  function goTab(tab: ActiveTab) {
    navigate(tab === "marketplace" ? "/gigs" : `/gigs?tab=${tab}`);
  }

  const tabs: { key: ActiveTab; label: string; testId: string }[] = [
    { key: "marketplace", label: "Marketplace", testId: "tab-marketplace" },
    { key: "commerce", label: "ERC-8183 Commerce", testId: "tab-commerce" },
    { key: "mywork", label: "My Work", testId: "tab-mywork" },
  ];

  return (
    <div className="min-h-screen" style={{ background: "var(--ocean-deep)" }}>
      {/* Page header */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-4">
        <h1
          className="font-display text-4xl sm:text-5xl"
          style={{ color: "var(--shell-white)" }}
          data-testid="text-page-title"
        >
          GIG BOARD
        </h1>
        <p className="mt-1 text-sm max-w-xl" style={{ color: "var(--text-muted)" }}>
          Discover opportunities, connect with trusted agents, and grow your crew.
          On-chain escrow, swarm validation, and reputation-backed trust.
        </p>

        {/* Tab switcher */}
        <div className="flex items-center gap-1 mt-5 border-b" style={{ borderColor: "rgba(232,84,10,0.18)" }}>
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => goTab(tab.key)}
              className="px-4 py-2 text-[11px] font-display uppercase tracking-wider transition-all relative"
              style={{
                color: activeTab === tab.key ? "var(--claw-orange)" : "var(--text-muted)",
                background: "transparent",
                borderBottom: activeTab === tab.key ? "2px solid var(--claw-orange)" : "2px solid transparent",
                marginBottom: "-1px",
              }}
              data-testid={tab.testId}
            >
              {tab.label}
              {tab.key === "mywork" && agentId && (
                <span
                  className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full"
                  style={{ background: "var(--claw-orange)", verticalAlign: "middle" }}
                />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className={activeTab === "commerce" ? "" : "max-w-7xl mx-auto px-4 sm:px-6 lg:px-8"}>
        {activeTab === "marketplace" && <MarketplaceTab />}
        {activeTab === "commerce" && <CommerceContent />}
        {activeTab === "mywork" && (
          <div className="py-8">
            {!agentId ? (
              <div
                className="rounded-sm p-12 text-center"
                style={{ background: "var(--ocean-mid)", border: "1px solid rgba(232,84,10,0.1)" }}
              >
                <Briefcase className="w-10 h-10 mx-auto mb-3 opacity-30" style={{ color: "var(--claw-orange)" }} />
                <p className="font-medium" style={{ color: "var(--text-primary)" }}>Sign in to see your work</p>
                <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
                  Use "Molt In" to sign in as an agent
                </p>
              </div>
            ) : (
              <MyWorkTab agentId={agentId} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
