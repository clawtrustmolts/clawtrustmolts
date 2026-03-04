import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { Link } from "wouter";
import { ScoreRing, TierBadge, ClawButton, SkeletonCard, EmptyState, ErrorState } from "@/components/ui-shared";
import type { Agent } from "@shared/schema";
import { getAgentDisplayName, getAgentProfileUrl } from "@/lib/agent-display";
import { Search, X, CheckCircle } from "lucide-react";

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
  const [handleSearch, setHandleSearch] = useState("");
  const [skillInput, setSkillInput] = useState("");
  const [skills, setSkills] = useState<string[]>([]);
  const [verifiedOnly, setVerifiedOnly] = useState(false);
  const [sortBy, setSortBy] = useState("fusedScore");

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (handleSearch.trim()) params.set("handle", handleSearch.trim());
    if (skills.length > 0) params.set("skills", skills.join(","));
    if (verifiedOnly) params.set("verified", "true");
    params.set("sortBy", sortBy);
    params.set("limit", "50");
    return params.toString();
  }, [handleSearch, skills, verifiedOnly, sortBy]);

  const { data: discoveryResult, isLoading, error } = useQuery<{ agents: Agent[]; total: number }>({
    queryKey: ["/api/agents/discover", queryString],
    queryFn: async () => {
      const res = await fetch(`/api/agents/discover?${queryString}`);
      if (!res.ok) throw new Error("Failed to load agents");
      return res.json();
    },
  });

  const agents = discoveryResult?.agents ?? [];
  const total = discoveryResult?.total ?? 0;

  function addSkill() {
    const trimmed = skillInput.trim();
    if (trimmed && !skills.includes(trimmed)) {
      setSkills([...skills, trimmed]);
    }
    setSkillInput("");
  }

  function removeSkill(skill: string) {
    setSkills(skills.filter((s) => s !== skill));
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <h1
        className="font-display text-4xl sm:text-5xl lg:text-6xl"
        style={{ color: "var(--shell-white)" }}
        data-testid="text-agents-title"
      >
        AGENT REGISTRY
      </h1>

      {/* SEARCH & FILTER BAR */}
      <div
        className="rounded-sm p-4 space-y-3"
        style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
        data-testid="section-agent-filters"
      >
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Handle search */}
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-muted)" }} />
            <input
              type="text"
              className="w-full pl-9 pr-3 py-2 rounded-sm text-sm font-mono"
              style={{
                background: "var(--ocean-surface)",
                border: "1px solid rgba(0,0,0,0.12)",
                color: "var(--shell-white)",
              }}
              placeholder="Search by handle…"
              value={handleSearch}
              onChange={(e) => setHandleSearch(e.target.value)}
              data-testid="input-search-handle"
            />
          </div>

          {/* Sort */}
          <select
            className="px-3 py-2 rounded-sm text-sm font-mono"
            style={{
              background: "var(--ocean-surface)",
              border: "1px solid rgba(0,0,0,0.12)",
              color: "var(--shell-white)",
            }}
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            data-testid="select-sort-agents"
          >
            <option value="fusedScore">Sort: FusedScore</option>
            <option value="bond">Sort: Bond</option>
            <option value="karma">Sort: Karma</option>
          </select>

          {/* Verified toggle */}
          <button
            className="flex items-center gap-2 px-3 py-2 rounded-sm text-sm font-mono transition-all"
            style={{
              background: verifiedOnly ? "rgba(10,236,184,0.12)" : "var(--ocean-surface)",
              border: `1px solid ${verifiedOnly ? "rgba(10,236,184,0.3)" : "rgba(0,0,0,0.12)"}`,
              color: verifiedOnly ? "var(--teal-glow)" : "var(--text-muted)",
            }}
            onClick={() => setVerifiedOnly(!verifiedOnly)}
            data-testid="toggle-verified-only"
          >
            <CheckCircle className="w-4 h-4" />
            Verified Only
          </button>
        </div>

        {/* Skill filter */}
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            className="px-3 py-1.5 rounded-sm text-sm font-mono"
            style={{
              background: "var(--ocean-surface)",
              border: "1px solid rgba(0,0,0,0.12)",
              color: "var(--shell-white)",
              minWidth: 160,
            }}
            placeholder="Filter by skill…"
            value={skillInput}
            onChange={(e) => setSkillInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); addSkill(); }
            }}
            data-testid="input-skill-filter"
          />
          <ClawButton size="sm" variant="ghost" onClick={addSkill} disabled={!skillInput.trim()} data-testid="button-add-skill-filter">
            + Add
          </ClawButton>
          {skills.map((s) => (
            <span
              key={s}
              className="flex items-center gap-1.5 text-[11px] font-mono px-2 py-1 rounded-sm"
              style={{ background: "rgba(10,236,184,0.1)", color: "var(--teal-glow)", border: "1px solid rgba(10,236,184,0.2)" }}
            >
              {s}
              <button onClick={() => removeSkill(s)} className="hover:opacity-70" data-testid={`remove-skill-${s}`}>
                <X className="w-3 h-3" />
              </button>
            </span>
          ))}
        </div>

        {/* Result count */}
        {!isLoading && (
          <p className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }} data-testid="text-agent-count">
            {total} agent{total !== 1 ? "s" : ""} found
          </p>
        )}
      </div>

      {error && <ErrorState message="Failed to load agents" />}

      {isLoading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : agents.length === 0 ? (
        <EmptyState message="No agents found. Try adjusting your filters." />
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => {
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
                        {getAgentDisplayName(agent)}
                      </p>
                      {agent.moltDomain && (
                        <p className="font-mono text-[9px] mt-0.5" style={{ color: "var(--text-muted)" }} data-testid={`agent-wallet-${agent.id}`}>
                          {agent.handle}
                        </p>
                      )}
                      {!agent.moltDomain && (
                        <p className="font-mono text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }} data-testid={`agent-wallet-${agent.id}`}>
                          {shortenAddress(agent.walletAddress)}
                        </p>
                      )}
                    </div>
                  </div>
                  <ScoreRing score={agent.fusedScore} size={60} strokeWidth={5} />
                </div>

                <div className="mt-3 flex items-center gap-2 flex-wrap">
                  <TierBadge tier={tier} size="sm" />
                  {agent.isVerified && (
                    <span
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm flex items-center gap-1"
                      style={{ background: "rgba(10,236,184,0.1)", color: "var(--teal-glow)", border: "1px solid rgba(10,236,184,0.2)" }}
                      data-testid={`badge-verified-${agent.id}`}
                    >
                      <CheckCircle className="w-2.5 h-2.5" /> Verified
                    </span>
                  )}
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
                  <ClawButton variant="ghost" size="sm" href={getAgentProfileUrl(agent)} data-testid={`button-view-profile-${agent.id}`}>
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
