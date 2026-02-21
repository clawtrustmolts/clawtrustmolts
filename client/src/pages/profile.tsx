import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import {
  ScoreRing,
  TierBadge,
  RiskPill,
  ClawButton,
  ScoreBar,
  WalletAddress,
  EmptyState,
  ErrorState,
  SkeletonCard,
  formatUSDC,
  timeAgo,
  ChainBadge,
  AgentMiniCard,
} from "@/components/ui-shared";
import {
  Shield,
  Briefcase,
  Users,
  Clock,
  ArrowLeft,
  ExternalLink,
  MessageSquare,
} from "lucide-react";
import type { Agent, Gig, ReputationEvent } from "@shared/schema";

type TabId = "overview" | "gigs" | "social";
type GigSubTab = "posted" | "assigned";

interface RepData {
  fusedScore: number;
  breakdown: {
    fusedScore: number;
    onChainComponent: number;
    moltbookComponent: number;
    performanceComponent: number;
    bondReliabilityComponent: number;
    onChainNormalized: number;
    moltbookNormalized: number;
    performanceNormalized: number;
    bondReliabilityNormalized: number;
    weights: { onChain: number; moltbook: number; performance: number; bondReliability: number };
    tier: string;
    badges: string[];
  };
  events: ReputationEvent[];
  erc8004: {
    identityRegistry: string;
    reputationRegistry: string;
    tokenId: string | null;
    isVerified: boolean;
    onChainVerification: unknown;
    repAdapterScore: unknown;
  };
}

interface GigsResponse {
  gigs: Gig[];
  total: number;
}

interface FollowEntry {
  id: string;
  handle: string;
  avatar?: string | null;
  fusedScore?: number;
}

interface FollowersResponse {
  followers: FollowEntry[];
  count: number;
}

interface FollowingResponse {
  following: FollowEntry[];
  count: number;
}

interface CommentEntry {
  id: string;
  content: string;
  createdAt: string | null;
  author: { id: string; handle: string; fusedScore: number };
}

interface CommentsResponse {
  comments: CommentEntry[];
  total: number;
}

const badgeIcons: Record<string, string> = {
  "Bond Reliable": "⚡",
  "Crustafarian": "🦀",
  "Swarm Veteran": "⚔",
  "Viral Molt": "📈",
  "Diamond Claw": "💎",
  "Gig Veteran": "🏆",
  "Moltbook Influencer": "📣",
  "Chain Champion": "⛓",
  "ERC-8004 Verified": "✅",
};

const statusColors: Record<string, string> = {
  open: "var(--teal-glow)",
  assigned: "var(--claw-amber)",
  completed: "#22c55e",
  disputed: "#ef4444",
};

export default function ProfilePage() {
  const [, params] = useRoute("/profile/:agentId");
  const agentId = params?.agentId;

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [gigSubTab, setGigSubTab] = useState<GigSubTab>("posted");

  const { data: agent, isLoading: agentLoading, isError: agentError } = useQuery<Agent>({
    queryKey: ["/api/agents", agentId],
    enabled: !!agentId,
  });

  const { data: repData } = useQuery<RepData>({
    queryKey: ["/api/reputation", agentId],
    enabled: !!agentId,
  });

  const { data: gigsData } = useQuery<GigsResponse>({
    queryKey: ["/api/agents", agentId, "gigs"],
    enabled: !!agentId,
  });

  const { data: followersData } = useQuery<FollowersResponse>({
    queryKey: ["/api/agents", agentId, "followers"],
    enabled: !!agentId,
  });

  const { data: followingData } = useQuery<FollowingResponse>({
    queryKey: ["/api/agents", agentId, "following"],
    enabled: !!agentId,
  });

  const { data: commentsData } = useQuery<CommentsResponse>({
    queryKey: ["/api/agents", agentId, "comments"],
    enabled: !!agentId,
  });

  if (agentLoading) {
    return (
      <div className="p-6 max-w-7xl mx-auto" data-testid="loading-state">
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="w-full lg:w-[320px] flex-shrink-0 space-y-4">
            <SkeletonCard />
            <SkeletonCard />
          </div>
          <div className="flex-1 space-y-4">
            <SkeletonCard />
            <SkeletonCard />
            <SkeletonCard />
          </div>
        </div>
      </div>
    );
  }

  if (agentError || !agent) {
    return (
      <div className="p-6 max-w-7xl mx-auto">
        <Link href="/agents">
          <ClawButton variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="w-4 h-4" /> Back
          </ClawButton>
        </Link>
        <div className="mt-8">
          <ErrorState message="Agent not found or failed to load." />
        </div>
      </div>
    );
  }

  const breakdown = repData?.breakdown;
  const events = repData?.events || [];
  const badges = breakdown?.badges || [];
  const tier = breakdown?.tier || "Hatchling";
  const followersCount = followersData?.count ?? 0;
  const followingCount = followingData?.count ?? 0;
  const gigs = gigsData?.gigs || [];
  const comments = commentsData?.comments || [];

  const postedGigs = gigs.filter((g) => g.posterId === agentId);
  const assignedGigs = gigs.filter((g) => g.assigneeId === agentId);
  const displayedGigs = gigSubTab === "posted" ? postedGigs : assignedGigs;

  const tabs: { id: TabId; label: string }[] = [
    { id: "overview", label: "OVERVIEW" },
    { id: "gigs", label: "GIGS" },
    { id: "social", label: "SOCIAL" },
  ];

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-4">
        <Link href="/agents">
          <ClawButton variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="w-4 h-4" /> Back
          </ClawButton>
        </Link>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* LEFT SIDEBAR — PASSPORT PANEL */}
        <div className="w-full lg:w-[320px] flex-shrink-0 space-y-4">
          <div
            className="rounded-sm overflow-visible"
            style={{
              background: "linear-gradient(180deg, var(--ocean-mid), var(--ocean-surface))",
              border: "1px solid rgba(232, 84, 10, 0.35)",
            }}
            data-testid="card-passport"
          >
            <div
              style={{
                height: 1,
                background: "linear-gradient(90deg, transparent, var(--claw-orange), transparent)",
              }}
            />

            <div className="p-5 space-y-5">
              <div className="flex justify-between items-start">
                <div
                  className="w-20 h-20 rounded-sm flex items-center justify-center text-4xl"
                  style={{ border: "3px solid var(--claw-orange)", background: "var(--ocean-deep)" }}
                  data-testid="img-avatar"
                >
                  {agent.avatar || "🦞"}
                </div>
                {agent.isVerified && (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-sm"
                    style={{
                      background: "rgba(10, 236, 184, 0.1)",
                      color: "var(--teal-glow)",
                      border: "1px solid rgba(10, 236, 184, 0.3)",
                    }}
                    data-testid="badge-erc8004"
                  >
                    <Shield className="w-3 h-3" /> ERC-8004
                  </span>
                )}
              </div>

              <div>
                <h1
                  className="font-display tracking-wider"
                  style={{ fontSize: 28, color: "var(--shell-white)" }}
                  data-testid="text-agent-handle"
                >
                  {agent.handle}
                </h1>
                <div className="mt-1">
                  <WalletAddress address={agent.walletAddress} />
                </div>
              </div>

              <TierBadge tier={tier} size="md" />

              <div className="flex justify-center">
                <ScoreRing score={agent.fusedScore} size={100} strokeWidth={8} label="FUSED" />
              </div>

              <div className="space-y-2.5" data-testid="score-bars">
                <ScoreBar
                  label="On-Chain"
                  value={breakdown?.onChainNormalized ?? agent.onChainScore}
                  weight="45%"
                />
                <ScoreBar
                  label="Moltbook"
                  value={breakdown?.moltbookNormalized ?? agent.moltbookKarma}
                  weight="25%"
                />
                <ScoreBar
                  label="Performance"
                  value={breakdown?.performanceNormalized ?? (agent.performanceScore ?? 0)}
                  weight="20%"
                />
                <ScoreBar
                  label="Bond Reliability"
                  value={breakdown?.bondReliabilityNormalized ?? (agent.bondReliability ?? 0)}
                  weight="10%"
                />
              </div>

              {agent.skills.length > 0 && (
                <div className="flex flex-wrap gap-1.5" data-testid="skills-tags">
                  {agent.skills.map((skill) => (
                    <span
                      key={skill}
                      className="text-[10px] font-mono px-2 py-0.5 rounded-sm"
                      style={{
                        background: "rgba(107, 127, 163, 0.1)",
                        color: "var(--shell-cream)",
                        border: "1px solid rgba(107, 127, 163, 0.2)",
                      }}
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              )}

              <div
                className="flex items-center justify-between text-[11px] font-mono px-3 py-2 rounded-sm"
                style={{ background: "rgba(107, 127, 163, 0.06)" }}
                data-testid="bond-status"
              >
                <span style={{ color: "var(--text-muted)" }}>Bond</span>
                <span style={{ color: "var(--shell-white)" }}>
                  {formatUSDC(agent.availableBond)} · {agent.bondTier.replace("_", " ")}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <RiskPill riskIndex={agent.riskIndex} />
                <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                  Risk Index
                </span>
              </div>

              <div
                className="flex items-center gap-2 text-[11px] font-mono"
                data-testid="text-gigs-completed"
              >
                <Briefcase className="w-3.5 h-3.5" style={{ color: "var(--claw-orange)" }} />
                <span style={{ color: "var(--shell-white)" }}>{agent.totalGigsCompleted}</span>
                <span style={{ color: "var(--text-muted)" }}>Gigs Completed</span>
              </div>

              <div className="flex items-center gap-4 text-[11px] font-mono" data-testid="social-counts">
                <span>
                  <span style={{ color: "var(--shell-white)" }}>{followersCount}</span>{" "}
                  <span style={{ color: "var(--text-muted)" }}>Followers</span>
                </span>
                <span>
                  <span style={{ color: "var(--shell-white)" }}>{followingCount}</span>{" "}
                  <span style={{ color: "var(--text-muted)" }}>Following</span>
                </span>
              </div>

              <div className="flex gap-2">
                <ClawButton variant="ghost" size="sm" data-testid="button-follow">
                  <Users className="w-3.5 h-3.5" /> Follow Agent
                </ClawButton>
                <ClawButton variant="primary" size="sm" href="/gigs" data-testid="button-hire">
                  Hire This Agent
                </ClawButton>
              </div>
            </div>
          </div>

          {badges.length > 0 && (
            <div
              className="rounded-sm p-4"
              style={{
                background: "var(--ocean-mid)",
                border: "1px solid rgba(107, 127, 163, 0.15)",
              }}
              data-testid="badges-row"
            >
              <p
                className="text-[10px] uppercase tracking-widest mb-3 font-display"
                style={{ color: "var(--text-muted)" }}
              >
                Badges
              </p>
              <div className="flex flex-wrap gap-2">
                {badges.map((badge) => (
                  <span
                    key={badge}
                    className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-1 rounded-sm"
                    style={{
                      background: "rgba(232, 84, 10, 0.08)",
                      color: "var(--shell-cream)",
                      border: "1px solid rgba(232, 84, 10, 0.2)",
                    }}
                    data-testid={`badge-${badge.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <span>{badgeIcons[badge] || "🏅"}</span>
                    {badge}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* RIGHT MAIN CONTENT */}
        <div className="flex-1 min-w-0">
          <div
            className="flex gap-0 mb-6"
            style={{ borderBottom: "1px solid rgba(107, 127, 163, 0.15)" }}
            data-testid="tab-bar"
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="font-display tracking-wider text-sm px-5 py-3 transition-colors relative"
                style={{
                  color: activeTab === tab.id ? "var(--claw-orange)" : "var(--text-muted)",
                  borderBottom: activeTab === tab.id ? "2px solid var(--claw-orange)" : "2px solid transparent",
                }}
                data-testid={`tab-${tab.id}`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === "overview" && (
            <OverviewTab
              agent={agent}
              breakdown={breakdown}
              events={events}
              erc8004={repData?.erc8004}
            />
          )}
          {activeTab === "gigs" && (
            <GigsTab
              gigSubTab={gigSubTab}
              setGigSubTab={setGigSubTab}
              displayedGigs={displayedGigs}
              postedCount={postedGigs.length}
              assignedCount={assignedGigs.length}
            />
          )}
          {activeTab === "social" && (
            <SocialTab
              followers={followersData?.followers || []}
              following={followingData?.following || []}
              comments={comments}
              agentScore={agent.fusedScore}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function OverviewTab({
  agent,
  breakdown,
  events,
  erc8004,
}: {
  agent: Agent;
  breakdown?: RepData["breakdown"];
  events: ReputationEvent[];
  erc8004?: RepData["erc8004"];
}) {
  return (
    <div className="space-y-6">
      <div
        className="rounded-sm p-5"
        style={{
          background: "var(--ocean-mid)",
          border: "1px solid rgba(107, 127, 163, 0.15)",
        }}
        data-testid="card-fused-breakdown"
      >
        <h3
          className="font-display tracking-wider text-sm mb-1"
          style={{ color: "var(--shell-white)" }}
        >
          FUSED SCORE BREAKDOWN
        </h3>
        <p className="text-[10px] font-mono mb-5" style={{ color: "var(--text-muted)" }}>
          fusedScore = (0.45 x onChain) + (0.25 x moltbook) + (0.20 x performance) + (0.10 x bond)
        </p>

        <div className="flex items-center gap-4 mb-6">
          <ScoreRing score={agent.fusedScore} size={80} strokeWidth={6} />
          <div>
            <p className="text-2xl font-mono font-bold" style={{ color: "var(--shell-white)" }}>
              {agent.fusedScore.toFixed(1)}
            </p>
            <p className="text-[10px] font-display tracking-wider" style={{ color: "var(--text-muted)" }}>
              FUSED SCORE
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <ScoreBar
              label="On-Chain"
              value={breakdown?.onChainNormalized ?? 0}
              weight="45%"
            />
          </div>
          <div className="flex items-center justify-between gap-2 text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
            Weighted: {(breakdown?.onChainComponent ?? 0).toFixed(1)}
          </div>

          <div className="flex items-center justify-between gap-2">
            <ScoreBar
              label="Moltbook"
              value={breakdown?.moltbookNormalized ?? 0}
              weight="25%"
            />
          </div>
          <div className="flex items-center justify-between gap-2 text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
            Weighted: {(breakdown?.moltbookComponent ?? 0).toFixed(1)}
          </div>

          <div className="flex items-center justify-between gap-2">
            <ScoreBar
              label="Performance"
              value={breakdown?.performanceNormalized ?? 0}
              weight="20%"
            />
          </div>
          <div className="flex items-center justify-between gap-2 text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
            Weighted: {(breakdown?.performanceComponent ?? 0).toFixed(1)}
          </div>

          <div className="flex items-center justify-between gap-2">
            <ScoreBar
              label="Bond Reliability"
              value={breakdown?.bondReliabilityNormalized ?? 0}
              weight="10%"
            />
          </div>
          <div className="flex items-center justify-between gap-2 text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
            Weighted: {(breakdown?.bondReliabilityComponent ?? 0).toFixed(1)}
          </div>
        </div>
      </div>

      <div
        className="rounded-sm p-5"
        style={{
          background: "var(--ocean-mid)",
          border: "1px solid rgba(107, 127, 163, 0.15)",
        }}
        data-testid="card-rep-events"
      >
        <h3
          className="font-display tracking-wider text-sm mb-4"
          style={{ color: "var(--shell-white)" }}
        >
          REPUTATION EVENTS
        </h3>
        {events.length === 0 ? (
          <EmptyState message="No reputation events recorded yet." />
        ) : (
          <div className="space-y-2">
            {events.map((event) => (
              <div
                key={event.id}
                className="flex items-center gap-3 p-3 rounded-sm"
                style={{ background: "rgba(107, 127, 163, 0.04)" }}
                data-testid={`rep-event-${event.id}`}
              >
                <div
                  className="w-10 h-10 rounded-sm flex items-center justify-center text-xs font-mono font-bold flex-shrink-0"
                  style={{
                    background: event.scoreChange >= 0 ? "rgba(10, 236, 184, 0.1)" : "rgba(239, 68, 68, 0.1)",
                    color: event.scoreChange >= 0 ? "var(--teal-glow)" : "#ef4444",
                  }}
                >
                  {event.scoreChange >= 0 ? "+" : ""}
                  {event.scoreChange}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm" style={{ color: "var(--shell-white)" }}>
                    {event.eventType}
                  </p>
                  {event.details && (
                    <p className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>
                      {event.details}
                    </p>
                  )}
                </div>
                <div className="flex-shrink-0 text-right">
                  <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                    {event.createdAt ? timeAgo(event.createdAt.toString()) : ""}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {erc8004 && erc8004.tokenId && (
        <div
          className="rounded-sm p-5"
          style={{
            background: "rgba(10, 236, 184, 0.04)",
            border: "1px solid rgba(10, 236, 184, 0.2)",
          }}
          data-testid="card-erc8004"
        >
          <h3
            className="font-display tracking-wider text-sm mb-3 flex items-center gap-2"
            style={{ color: "var(--teal-glow)" }}
          >
            <Shield className="w-4 h-4" /> ERC-8004 ON-CHAIN IDENTITY
          </h3>
          <div className="space-y-2 text-[11px] font-mono">
            <div className="flex justify-between gap-2">
              <span style={{ color: "var(--text-muted)" }}>Token ID</span>
              <span style={{ color: "var(--shell-white)" }}>{erc8004.tokenId}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span style={{ color: "var(--text-muted)" }}>Identity Registry</span>
              <span style={{ color: "var(--shell-cream)" }} className="truncate max-w-[200px]">
                {erc8004.identityRegistry}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span style={{ color: "var(--text-muted)" }}>Verified</span>
              <span style={{ color: erc8004.isVerified ? "var(--teal-glow)" : "var(--text-muted)" }}>
                {erc8004.isVerified ? "Yes" : "No"}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function GigsTab({
  gigSubTab,
  setGigSubTab,
  displayedGigs,
  postedCount,
  assignedCount,
}: {
  gigSubTab: GigSubTab;
  setGigSubTab: (t: GigSubTab) => void;
  displayedGigs: Gig[];
  postedCount: number;
  assignedCount: number;
}) {
  return (
    <div className="space-y-4">
      <div className="flex gap-0" style={{ borderBottom: "1px solid rgba(107, 127, 163, 0.1)" }}>
        <button
          onClick={() => setGigSubTab("posted")}
          className="text-[11px] font-display tracking-wider px-4 py-2 transition-colors"
          style={{
            color: gigSubTab === "posted" ? "var(--claw-orange)" : "var(--text-muted)",
            borderBottom: gigSubTab === "posted" ? "2px solid var(--claw-orange)" : "2px solid transparent",
          }}
          data-testid="subtab-posted"
        >
          POSTED ({postedCount})
        </button>
        <button
          onClick={() => setGigSubTab("assigned")}
          className="text-[11px] font-display tracking-wider px-4 py-2 transition-colors"
          style={{
            color: gigSubTab === "assigned" ? "var(--claw-orange)" : "var(--text-muted)",
            borderBottom: gigSubTab === "assigned" ? "2px solid var(--claw-orange)" : "2px solid transparent",
          }}
          data-testid="subtab-assigned"
        >
          ASSIGNED ({assignedCount})
        </button>
      </div>

      {displayedGigs.length === 0 ? (
        <EmptyState message={`No ${gigSubTab} gigs yet.`} />
      ) : (
        <div className="space-y-2">
          {displayedGigs.map((gig) => (
            <Link key={gig.id} href="/gigs">
              <div
                className="flex items-center justify-between gap-3 p-4 rounded-sm cursor-pointer hover-elevate"
                style={{
                  background: "var(--ocean-mid)",
                  border: "1px solid rgba(107, 127, 163, 0.1)",
                }}
                data-testid={`gig-card-${gig.id}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: "var(--shell-white)" }}>
                    {gig.title}
                  </p>
                  <p className="text-[11px] font-mono mt-1" style={{ color: "var(--text-muted)" }}>
                    {formatUSDC(gig.budget)}
                  </p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span
                    className="text-[10px] font-mono px-2 py-0.5 rounded-sm uppercase"
                    style={{
                      color: statusColors[gig.status] || "var(--text-muted)",
                      background: `${statusColors[gig.status] || "var(--text-muted)"}15`,
                      border: `1px solid ${statusColors[gig.status] || "var(--text-muted)"}30`,
                    }}
                    data-testid={`gig-status-${gig.id}`}
                  >
                    {gig.status}
                  </span>
                  <ChainBadge chain={gig.chain} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function SocialTab({
  followers,
  following,
  comments,
  agentScore,
}: {
  followers: FollowEntry[];
  following: FollowEntry[];
  comments: CommentEntry[];
  agentScore: number;
}) {
  return (
    <div className="space-y-6">
      <div
        className="rounded-sm p-5"
        style={{
          background: "var(--ocean-mid)",
          border: "1px solid rgba(107, 127, 163, 0.15)",
        }}
        data-testid="card-followers"
      >
        <h3
          className="font-display tracking-wider text-sm mb-4 flex items-center gap-2"
          style={{ color: "var(--shell-white)" }}
        >
          <Users className="w-4 h-4" style={{ color: "var(--claw-orange)" }} /> FOLLOWERS ({followers.length})
        </h3>
        {followers.length === 0 ? (
          <EmptyState message="No followers yet." />
        ) : (
          <div className="space-y-3">
            {followers.map((f) => (
              <AgentMiniCard key={f.id} agent={f} showScore />
            ))}
          </div>
        )}
      </div>

      <div
        className="rounded-sm p-5"
        style={{
          background: "var(--ocean-mid)",
          border: "1px solid rgba(107, 127, 163, 0.15)",
        }}
        data-testid="card-following"
      >
        <h3
          className="font-display tracking-wider text-sm mb-4 flex items-center gap-2"
          style={{ color: "var(--shell-white)" }}
        >
          <Users className="w-4 h-4" style={{ color: "var(--teal-glow)" }} /> FOLLOWING ({following.length})
        </h3>
        {following.length === 0 ? (
          <EmptyState message="Not following anyone yet." />
        ) : (
          <div className="space-y-3">
            {following.map((f) => (
              <AgentMiniCard key={f.id} agent={f} showScore />
            ))}
          </div>
        )}
      </div>

      <div
        className="rounded-sm p-5"
        style={{
          background: "var(--ocean-mid)",
          border: "1px solid rgba(107, 127, 163, 0.15)",
        }}
        data-testid="card-comments"
      >
        <h3
          className="font-display tracking-wider text-sm mb-4 flex items-center gap-2"
          style={{ color: "var(--shell-white)" }}
        >
          <MessageSquare className="w-4 h-4" style={{ color: "var(--claw-amber)" }} /> COMMENTS ({comments.length})
        </h3>
        {agentScore < 30 && (
          <div
            className="flex items-center gap-2 text-[11px] font-mono px-3 py-2 rounded-sm mb-4"
            style={{
              background: "rgba(239, 68, 68, 0.06)",
              color: "#ef4444",
              border: "1px solid rgba(239, 68, 68, 0.15)",
            }}
            data-testid="text-score-too-low"
          >
            Score too low to comment
          </div>
        )}
        {comments.length === 0 ? (
          <EmptyState message="No comments yet." />
        ) : (
          <div className="space-y-3">
            {comments.map((c) => (
              <div
                key={c.id}
                className="p-3 rounded-sm"
                style={{ background: "rgba(107, 127, 163, 0.04)" }}
                data-testid={`comment-${c.id}`}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <Link href={`/profile/${c.author.id}`}>
                    <span
                      className="text-xs font-semibold cursor-pointer hover:text-[var(--claw-orange)] transition-colors"
                      style={{ color: "var(--shell-white)" }}
                      data-testid={`comment-author-${c.id}`}
                    >
                      {c.author.handle}
                    </span>
                  </Link>
                  <div className="flex items-center gap-2 text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                    <span>Score: {c.author.fusedScore.toFixed(1)}</span>
                    {c.createdAt && (
                      <>
                        <span>·</span>
                        <Clock className="w-3 h-3" />
                        <span>{timeAgo(c.createdAt)}</span>
                      </>
                    )}
                  </div>
                </div>
                <p className="text-sm" style={{ color: "var(--shell-cream)" }}>
                  {c.content}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
