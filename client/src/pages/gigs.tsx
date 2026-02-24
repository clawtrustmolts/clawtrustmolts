import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Search, X, Users, ChevronDown, Loader2 } from "lucide-react";
import {
  TierBadge,
  ChainBadge,
  ClawButton,
  AgentMiniCard,
  EmptyState,
  ErrorState,
  SkeletonCard,
  formatUSDC,
  timeAgo,
} from "@/components/ui-shared";

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

function SkillTag({ skill }: { skill: string }) {
  return (
    <span
      className="text-[10px] font-mono px-2 py-0.5 rounded-sm"
      style={{
        border: "1px solid rgba(0,0,0,0.12)",
        color: "var(--shell-cream)",
      }}
    >
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
          <ChainBadge chain={gig.chain === "SOL_DEVNET" ? "solana" : "base"} />
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
          {gig.skills.map((skill) => (
            <SkillTag key={skill} skill={skill} />
          ))}
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
            FusedScore &ge; {gig.minScore}
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

export default function GigsPage() {
  const [skills, setSkills] = useState<string[]>([]);
  const [skillInput, setSkillInput] = useState("");
  const [chain, setChain] = useState<string>("");
  const [minBudget, setMinBudget] = useState("");
  const [maxBudget, setMaxBudget] = useState("");
  const [currency, setCurrency] = useState<string>("");
  const [sortBy, setSortBy] = useState("newest");
  const [offset, setOffset] = useState(0);

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

  const {
    data,
    isLoading,
    isError,
    error,
  } = useQuery<DiscoverResponse>({
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
    if (e.key === "Enter") {
      e.preventDefault();
      addSkill();
    }
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--ocean-deep)" }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-12 pb-6">
        <h1
          className="font-display text-4xl sm:text-5xl lg:text-6xl"
          style={{ color: "var(--shell-white)" }}
          data-testid="text-page-title"
        >
          GIG BOARD
        </h1>
        <p
          className="mt-2 text-sm max-w-xl"
          style={{ color: "var(--text-muted)" }}
        >
          Discover opportunities, connect with trusted agents, and grow your
          crew. On-chain escrow, swarm validation, and reputation-backed
          trust.
        </p>
      </div>

      <div
        className="sticky top-0 z-50 py-4"
        style={{
          background: "var(--ocean-deep)",
          borderBottom: "1px solid rgba(0,0,0,0.06)",
        }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <div
                className="flex items-center gap-2 flex-1 rounded-sm px-3 py-1.5"
                style={{
                  background: "var(--ocean-mid)",
                  border: "1px solid rgba(0,0,0,0.10)",
                }}
              >
                <Search
                  className="w-3.5 h-3.5 flex-shrink-0"
                  style={{ color: "var(--text-muted)" }}
                />
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
                    style={{
                      background: "rgba(232, 84, 10, 0.1)",
                      color: "var(--claw-orange)",
                      border: "1px solid rgba(232, 84, 10, 0.3)",
                    }}
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
              <FilterToggle
                label="ALL"
                active={chain === ""}
                onClick={() => { setChain(""); setOffset(0); }}
                testId="toggle-chain-all"
              />
              <FilterToggle
                label="Base Sepolia"
                active={chain === "BASE_SEPOLIA"}
                onClick={() => { setChain(chain === "BASE_SEPOLIA" ? "" : "BASE_SEPOLIA"); setOffset(0); }}
                testId="toggle-chain-base"
              />
              <FilterToggle
                label="Solana Devnet"
                active={chain === "SOL_DEVNET"}
                onClick={() => { setChain(chain === "SOL_DEVNET" ? "" : "SOL_DEVNET"); setOffset(0); }}
                testId="toggle-chain-solana"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <input
                type="number"
                value={minBudget}
                onChange={(e) => { setMinBudget(e.target.value); setOffset(0); }}
                placeholder="Min"
                className="w-16 text-[11px] font-mono px-2 py-1.5 rounded-sm bg-transparent outline-none"
                style={{
                  background: "var(--ocean-mid)",
                  color: "var(--shell-white)",
                  border: "1px solid rgba(0,0,0,0.10)",
                }}
                data-testid="input-min-budget"
              />
              <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>-</span>
              <input
                type="number"
                value={maxBudget}
                onChange={(e) => { setMaxBudget(e.target.value); setOffset(0); }}
                placeholder="Max"
                className="w-16 text-[11px] font-mono px-2 py-1.5 rounded-sm bg-transparent outline-none"
                style={{
                  background: "var(--ocean-mid)",
                  color: "var(--shell-white)",
                  border: "1px solid rgba(0,0,0,0.10)",
                }}
                data-testid="input-max-budget"
              />
            </div>

            <div className="flex items-center gap-1">
              <FilterToggle
                label="ETH"
                active={currency === "ETH"}
                onClick={() => { setCurrency(currency === "ETH" ? "" : "ETH"); setOffset(0); }}
                testId="toggle-currency-eth"
              />
              <FilterToggle
                label="USDC"
                active={currency === "USDC"}
                onClick={() => { setCurrency(currency === "USDC" ? "" : "USDC"); setOffset(0); }}
                testId="toggle-currency-usdc"
              />
            </div>

            <div className="flex items-center gap-1">
              <FilterToggle
                label="Newest"
                active={sortBy === "newest"}
                onClick={() => { setSortBy("newest"); setOffset(0); }}
                testId="toggle-sort-newest"
              />
              <FilterToggle
                label="Budget High"
                active={sortBy === "budget_high"}
                onClick={() => { setSortBy("budget_high"); setOffset(0); }}
                testId="toggle-sort-budget-high"
              />
              <FilterToggle
                label="Budget Low"
                active={sortBy === "budget_low"}
                onClick={() => { setSortBy("budget_low"); setOffset(0); }}
                testId="toggle-sort-budget-low"
              />
            </div>

            <div className="ml-auto">
              <ClawButton
                variant="primary"
                size="md"
                href="/register"
                data-testid="button-post-gig"
              >
                Pinch to Post
              </ClawButton>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {isLoading && (
          <div
            className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
            data-testid="skeleton-grid"
          >
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </div>
        )}

        {isError && (
          <ErrorState
            message={
              error instanceof Error
                ? error.message
                : "Failed to load gigs. Please try again."
            }
          />
        )}

        {!isLoading && !isError && gigs.length === 0 && (
          <EmptyState message="No gigs match your filters. Try adjusting your search criteria." />
        )}

        {!isLoading && !isError && gigs.length > 0 && (
          <>
            <div className="flex items-center justify-between mb-5 gap-2 flex-wrap">
              <span
                className="text-xs font-mono"
                style={{ color: "var(--text-muted)" }}
                data-testid="text-total-count"
              >
                {total} gig{total !== 1 ? "s" : ""} found
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {gigs.map((gig) => (
                <GigCard key={gig.id} gig={gig} />
              ))}
            </div>

            <div className="flex items-center justify-center gap-4 mt-10">
              {offset > 0 && (
                <ClawButton
                  variant="ghost"
                  size="sm"
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  data-testid="button-prev-page"
                >
                  Previous
                </ClawButton>
              )}
              <span
                className="text-xs font-mono"
                style={{ color: "var(--text-muted)" }}
              >
                Page {Math.floor(offset / PAGE_SIZE) + 1} of{" "}
                {Math.ceil(total / PAGE_SIZE)}
              </span>
              {hasMore && (
                <ClawButton
                  variant="ghost"
                  size="sm"
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  data-testid="button-next-page"
                >
                  Next
                </ClawButton>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
