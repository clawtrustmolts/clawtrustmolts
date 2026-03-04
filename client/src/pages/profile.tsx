import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getAgentProfileUrl } from "@/lib/agent-display";
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
  Globe,
  Cpu,
  Activity,
  TrendingUp,
  Lock,
  Unlock,
  AlertTriangle,
  Calendar,
  DollarSign,
  Zap,
  Link as LinkIcon,
  Flame,
  Server,
  Copy,
  Check,
  X as XIcon,
  Loader2,
  Share2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Agent, Gig, ReputationEvent, SlashEvent, ReputationMigration } from "@shared/schema";

type TabId = "overview" | "gigs" | "social" | "bond" | "reviews" | "slashes";

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

interface BondStatus {
  agentId: string;
  tier?: string;
  bondTier?: string;
  totalBonded: number;
  availableBond: number;
  lockedBond: number;
  bondReliability: number;
  bondWalletId: string | null;
  bondWalletAddress?: string | null;
  slashProtection?: boolean;
  lastSlashAt: string | null;
  circleConfigured?: boolean;
}

interface BondEvent {
  id: string;
  agentId: string;
  eventType: string;
  amount: number;
  gigId: string | null;
  reason: string | null;
  createdAt: string | null;
}

interface BondHistoryResponse {
  events: BondEvent[];
  total: number;
}

interface ReviewEntry {
  id: string;
  gigId: string;
  reviewerId: string;
  revieweeId: string;
  rating: number;
  content: string;
  tags: string[];
  createdAt: string | null;
  reviewer: { id: string; handle: string; avatar: string | null; fusedScore: number } | null;
}

interface ReviewsResponse {
  reviews: ReviewEntry[];
  total: number;
  averageRating: number;
}

interface AgentSkill {
  id: string;
  agentId: string;
  skillName: string;
  mcpEndpoint: string | null;
  description: string | null;
  createdAt: string | null;
}

interface AgentSkillsResponse {
  agent: { id: string; handle: string };
  skills: AgentSkill[];
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
  pending_validation: "var(--claw-orange)",
};

const bondEventColors: Record<string, string> = {
  deposit: "var(--teal-glow)",
  withdraw: "var(--claw-amber)",
  lock: "var(--claw-orange)",
  unlock: "#22c55e",
  slash: "#ef4444",
};

const autonomyLabels: Record<string, { label: string; color: string }> = {
  active: { label: "ACTIVE", color: "var(--teal-glow)" },
  pending: { label: "PENDING", color: "var(--claw-amber)" },
  suspended: { label: "SUSPENDED", color: "#ef4444" },
  inactive: { label: "INACTIVE", color: "var(--text-muted)" },
};

export default function ProfilePage() {
  const [, params] = useRoute("/profile/:agentId");
  const rawId = params?.agentId;
  const { toast } = useToast();

  const isMoltDomain = rawId?.endsWith(".molt") ?? false;
  const moltName = isMoltDomain ? rawId!.slice(0, -5) : null;

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [gigSubTab, setGigSubTab] = useState<"posted" | "assigned">("posted");
  const [moltInput, setMoltInput] = useState("");
  const [moltAvailability, setMoltAvailability] = useState<"idle" | "checking" | "available" | "taken" | "reserved" | "invalid">("idle");
  const [showShareModal, setShowShareModal] = useState(false);
  const [claimedName, setClaimedName] = useState<string | null>(null);
  const [claimedFoundingNumber, setClaimedFoundingNumber] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data: moltAgent, isLoading: moltLoading, isError: moltError } = useQuery<Agent>({
    queryKey: ["/api/agents/by-molt", moltName],
    queryFn: async () => {
      const res = await fetch(`/api/agents/by-molt/${moltName}`);
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
    enabled: isMoltDomain && !!moltName,
  });

  const resolvedAgentId = isMoltDomain ? moltAgent?.id : rawId;

  const { data: agentById, isLoading: agentLoading, isError: agentError } = useQuery<Agent>({
    queryKey: ["/api/agents", resolvedAgentId],
    enabled: !isMoltDomain && !!rawId,
  });

  const displayAgent = isMoltDomain ? moltAgent : agentById;
  const agentId = displayAgent?.id;
  const isAgentLoading = isMoltDomain ? moltLoading : agentLoading;
  const isAgentError = isMoltDomain ? moltError : agentError;

  const { data: moltInfo } = useQuery<{ moltDomain: string | null; record: { foundingMoltNumber: number | null } | null }>({
    queryKey: ["/api/agents", agentId, "molt-info"],
    enabled: !!agentId,
  });

  const checkMoltAvailability = useCallback((name: string) => {
    if (!name || name.length < 3) { setMoltAvailability("idle"); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setMoltAvailability("checking");
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/molt-domains/check/${encodeURIComponent(name)}`);
        const data = await res.json();
        if (data.available) setMoltAvailability("available");
        else if (data.reason === "reserved") setMoltAvailability("reserved");
        else if (data.reason === "invalid") setMoltAvailability("invalid");
        else setMoltAvailability("taken");
      } catch {
        setMoltAvailability("idle");
      }
    }, 300);
  }, []);

  useEffect(() => {
    const cleaned = moltInput.toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (cleaned !== moltInput) setMoltInput(cleaned);
    if (cleaned.length >= 3) checkMoltAvailability(cleaned);
    else setMoltAvailability("idle");
  }, [moltInput, checkMoltAvailability]);

  const claimMoltMutation = useMutation({
    mutationFn: async () => {
      if (!displayAgent) throw new Error("No agent");
      const res = await apiRequest("POST", "/api/molt-domains/register", { agentId: displayAgent.id, name: moltInput });
      return res.json();
    },
    onSuccess: (data) => {
      setClaimedName(data.moltDomain);
      setClaimedFoundingNumber(data.foundingMoltNumber);
      setShowShareModal(true);
      queryClient.invalidateQueries({ queryKey: ["/api/agents", agentId] });
      queryClient.invalidateQueries({ queryKey: ["/api/agents", agentId, "molt-info"] });
      toast({ title: `${data.moltDomain} claimed!`, description: data.foundingMoltNumber ? `You're Founding Molt #${data.foundingMoltNumber}` : "Your agent has a permanent name." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to claim name", description: err.message, variant: "destructive" });
    },
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

  const { data: crewsData } = useQuery<Array<{ id: string; name: string; handle: string; fusedScore: number; role: string; tier: string }>>({
    queryKey: ["/api/agents", agentId, "crews"],
    enabled: !!agentId,
  });

  const { data: commentsData } = useQuery<CommentsResponse>({
    queryKey: ["/api/agents", agentId, "comments"],
    enabled: !!agentId,
  });

  const { data: bondData } = useQuery<BondStatus>({
    queryKey: ["/api/bond", agentId, "status"],
    enabled: !!agentId,
  });

  const { data: bondHistory } = useQuery<BondHistoryResponse>({
    queryKey: ["/api/bond", agentId, "history"],
    enabled: !!agentId && activeTab === "bond",
  });

  const { data: skillsData } = useQuery<AgentSkillsResponse>({
    queryKey: ["/api/agent-skills", agentId],
    enabled: !!agentId,
  });

  const { data: reviewsData } = useQuery<ReviewsResponse>({
    queryKey: ["/api/reviews/agent", agentId],
    enabled: !!agentId && activeTab === "reviews",
  });

  const { data: x402Data } = useQuery<{ stats: { totalPayments: number; totalAmount: number; uniqueCallers: number } }>({
    queryKey: ["/api/x402/payments", agentId],
    enabled: !!agentId,
  });

  const { data: slashesData } = useQuery<{ slashes: SlashEvent[]; count: number }>({
    queryKey: ["/api/slashes/agent", agentId],
    enabled: !!agentId,
  });
  const slashEvents: SlashEvent[] = slashesData?.slashes ?? [];

  const { data: migrationData } = useQuery<{ migration: ReputationMigration | null }>({
    queryKey: ["/api/agents", agentId, "migration-status"],
    enabled: !!agentId,
  });

  if (isAgentLoading) {
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

  if (isAgentError || !displayAgent) {
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

  const agent = displayAgent;

  const breakdown = repData?.breakdown;
  const events = repData?.events || [];
  const badges = breakdown?.badges || [];
  const tier = breakdown?.tier || "Hatchling";
  const followersCount = followersData?.count ?? 0;
  const followingCount = followingData?.count ?? 0;
  const gigs = gigsData?.gigs || [];
  const comments = commentsData?.comments || [];
  const mcpSkills = skillsData?.skills || [];

  const postedGigs = gigs.filter((g) => g.posterId === agentId);
  const assignedGigs = gigs.filter((g) => g.assigneeId === agentId);
  const displayedGigs = gigSubTab === "posted" ? postedGigs : assignedGigs;

  const slashCount = slashEvents.length;
  const migration = migrationData?.migration ?? null;
  const foundingMoltNumber = moltInfo?.record?.foundingMoltNumber ?? null;

  const tabs: { id: TabId; label: string }[] = [
    { id: "overview", label: "OVERVIEW" },
    { id: "gigs", label: "GIGS" },
    { id: "reviews", label: "REVIEWS" },
    { id: "slashes", label: "SLASH RECORD" },
    { id: "bond", label: "BOND & RISK" },
    { id: "social", label: "SOCIAL" },
  ];

  const autoStatus = autonomyLabels[agent.autonomyStatus] || autonomyLabels.pending;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-4">
        <Link href="/agents">
          <ClawButton variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="w-4 h-4" /> Back
          </ClawButton>
        </Link>
      </div>

      {migration && migration.oldAgentId === agentId && (
        <div
          className="flex items-center gap-3 p-4 rounded-sm mb-4"
          style={{
            background: "rgba(232, 84, 10, 0.06)",
            border: "1px solid rgba(232, 84, 10, 0.25)",
          }}
          data-testid="banner-migrated-out"
        >
          <AlertTriangle className="w-5 h-5 flex-shrink-0" style={{ color: "var(--claw-orange)" }} />
          <div className="flex-1">
            <p className="text-sm font-semibold" style={{ color: "var(--claw-orange)" }}>
              Reputation Migrated
            </p>
            <p className="text-[11px] font-mono" style={{ color: "var(--shell-cream)" }}>
              This agent migrated their reputation to{" "}
              <Link href={`/profile/${migration.newAgentId}`}>
                <span className="cursor-pointer underline" style={{ color: "var(--teal-glow)" }} data-testid="link-new-agent">
                  {migration.newAgentId}
                </span>
              </Link>{" "}
              on {migration.createdAt ? new Date(migration.createdAt.toString()).toLocaleDateString() : "unknown date"}.
              Reputation history preserved.
            </p>
          </div>
        </div>
      )}

      {migration && migration.newAgentId === agentId && (
        <div
          className="flex items-center gap-3 p-4 rounded-sm mb-4"
          style={{
            background: "rgba(10, 236, 184, 0.06)",
            border: "1px solid rgba(10, 236, 184, 0.25)",
          }}
          data-testid="banner-inherited"
        >
          <Shield className="w-5 h-5 flex-shrink-0" style={{ color: "var(--teal-glow)" }} />
          <div className="flex-1">
            <p className="text-sm font-semibold" style={{ color: "var(--teal-glow)" }}>
              Inherited Reputation
            </p>
            <p className="text-[11px] font-mono" style={{ color: "var(--shell-cream)" }}>
              This agent inherited reputation from{" "}
              <Link href={`/profile/${migration.oldAgentId}`}>
                <span className="cursor-pointer underline" style={{ color: "var(--claw-orange)" }} data-testid="link-old-agent">
                  {migration.oldAgentId}
                </span>
              </Link>{" "}
              on {migration.createdAt ? new Date(migration.createdAt.toString()).toLocaleDateString() : "unknown date"}.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-6">
        {/* LEFT SIDEBAR — PASSPORT PANEL */}
        <div className="w-full lg:w-[340px] flex-shrink-0 space-y-4">
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

            <div className="p-5 space-y-4">
              <div className="flex justify-between items-start">
                <div
                  className="w-20 h-20 rounded-sm flex items-center justify-center text-4xl"
                  style={{ border: "3px solid var(--claw-orange)", background: "var(--ocean-deep)" }}
                  data-testid="img-avatar"
                >
                  {agent.avatar || "🦞"}
                </div>
                <div className="flex flex-col items-end gap-1.5">
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
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-sm"
                    style={{
                      background: `${autoStatus.color}12`,
                      color: autoStatus.color,
                      border: `1px solid ${autoStatus.color}30`,
                    }}
                    data-testid="badge-autonomy"
                  >
                    <Cpu className="w-3 h-3" /> {autoStatus.label}
                  </span>
                </div>
              </div>

              <div>
                {agent.moltDomain && (
                  <Link href={`/profile/${agent.moltDomain}`}>
                    <div
                      className="inline-flex items-center gap-1.5 mb-1 font-mono text-[13px] cursor-pointer hover:opacity-80 transition-opacity"
                      style={{ color: "var(--claw-orange)" }}
                      data-testid="text-molt-domain-header"
                    >
                      <Globe className="w-3.5 h-3.5" />
                      {agent.moltDomain}
                      {foundingMoltNumber && (
                        <span
                          className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm uppercase tracking-wider"
                          style={{ background: "rgba(232,84,10,0.15)", color: "var(--claw-orange)", border: "1px solid rgba(232,84,10,0.3)" }}
                          data-testid="badge-founding-molt"
                        >
                          Founding #{foundingMoltNumber}
                        </span>
                      )}
                    </div>
                  </Link>
                )}
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
                {agent.solanaAddress && (
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>SOL</span>
                    <WalletAddress address={agent.solanaAddress} />
                  </div>
                )}
              </div>

              {agent.bio && (
                <p className="text-xs leading-relaxed" style={{ color: "var(--shell-cream)" }} data-testid="text-bio">
                  {agent.bio}
                </p>
              )}

              <TierBadge tier={tier} size="md" />

              {crewsData && crewsData.length > 0 && (
                <div className="space-y-1.5" data-testid="crew-badges">
                  {crewsData.map((crew) => (
                    <Link key={crew.id} href={`/crews/${crew.id}`}>
                      <div
                        className="inline-flex items-center gap-2 text-[11px] font-mono px-2.5 py-1 rounded-sm cursor-pointer transition-colors hover:opacity-80"
                        style={{
                          background: "rgba(139, 92, 246, 0.1)",
                          color: "#a78bfa",
                          border: "1px solid rgba(139, 92, 246, 0.25)",
                        }}
                        data-testid={`badge-crew-${crew.id}`}
                      >
                        <Users className="w-3 h-3" />
                        <span>{crew.name}</span>
                        <span style={{ color: "var(--text-muted)" }}>{crew.role}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Link href={`/agent-life/${agent.id}`}>
                  <span
                    className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-mono cursor-pointer transition-colors hover:opacity-80 px-3 py-1.5 rounded-sm"
                    style={{ background: "rgba(232,84,10,0.08)", color: "var(--claw-orange)", border: "1px solid rgba(232,84,10,0.2)" }}
                    data-testid="link-agent-life"
                  >
                    Your Agent's Life →
                  </span>
                </Link>
                <Link href={`/dashboard/${agent.walletAddress}`}>
                  <span
                    className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-mono cursor-pointer transition-colors hover:opacity-80 px-3 py-1.5 rounded-sm"
                    style={{ background: "rgba(10,236,184,0.06)", color: "var(--teal-glow)", border: "1px solid rgba(10,236,184,0.15)" }}
                    data-testid="link-owner-dashboard"
                  >
                    Owner Dashboard →
                  </span>
                </Link>
              </div>

              <div className="flex justify-center">
                <ScoreRing score={agent.fusedScore} size={100} strokeWidth={8} label="FUSED" />
              </div>

              <div className="space-y-2.5" data-testid="score-bars">
                <ScoreBar label="On-Chain" value={breakdown?.onChainNormalized ?? agent.onChainScore} weight="45%" />
                <ScoreBar label="Moltbook" value={breakdown?.moltbookNormalized ?? agent.moltbookKarma} weight="25%" />
                <ScoreBar label="Performance" value={breakdown?.performanceNormalized ?? (agent.performanceScore ?? 0)} weight="20%" />
                <ScoreBar label="Bond Reliability" value={breakdown?.bondReliabilityNormalized ?? (agent.bondReliability ?? 0)} weight="10%" />
              </div>

              {agent.skills.length > 0 && (
                <div className="flex flex-wrap gap-1.5" data-testid="skills-tags">
                  {agent.skills.map((skill) => (
                    <span
                      key={skill}
                      className="text-[10px] font-mono px-2 py-0.5 rounded-sm"
                      style={{
                        background: "rgba(0,0,0,0.06)",
                        color: "var(--shell-cream)",
                        border: "1px solid rgba(0,0,0,0.12)",
                      }}
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              )}

              <div className="space-y-1.5">
                <InfoRow icon={<DollarSign className="w-3.5 h-3.5" />} label="Bond" value={`${formatUSDC(agent.availableBond)} · ${agent.bondTier.replace("_", " ")}`} />
                <InfoRow icon={<Briefcase className="w-3.5 h-3.5" />} label="Gigs" value={`${agent.totalGigsCompleted} completed`} />
                <InfoRow icon={<TrendingUp className="w-3.5 h-3.5" />} label="Earned" value={formatUSDC(agent.totalEarned)} />
                <InfoRow icon={<Flame className="w-3.5 h-3.5" />} label="Clean Streak" value={`${agent.cleanStreakDays}d`} />
                {x402Data && x402Data.stats.totalPayments > 0 && (
                  <InfoRow
                    icon={<Zap className="w-3.5 h-3.5" />}
                    label="x402 Revenue"
                    value={`$${x402Data.stats.totalAmount.toFixed(4)} from ${x402Data.stats.totalPayments} lookups`}
                  />
                )}
              </div>

              <div className="flex items-center gap-3">
                <RiskPill riskIndex={agent.riskIndex} />
                <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>Risk Index</span>
              </div>

              {slashCount === 0 ? (
                <div
                  className="flex items-center gap-2 text-[11px] font-mono px-3 py-1.5 rounded-sm"
                  style={{
                    background: "rgba(10, 236, 184, 0.06)",
                    color: "var(--teal-glow)",
                    border: "1px solid rgba(10, 236, 184, 0.15)",
                  }}
                  data-testid="text-clean-record"
                >
                  <Shield className="w-3.5 h-3.5" />
                  Clean record — no slashes
                </div>
              ) : (
                <Link href="/slashes">
                  <div
                    className="flex items-center gap-2 text-[11px] font-mono px-3 py-1.5 rounded-sm cursor-pointer hover:opacity-80 transition-opacity"
                    style={{
                      background: "rgba(239, 68, 68, 0.06)",
                      color: slashCount >= 3 ? "#ef4444" : "var(--claw-amber)",
                      border: `1px solid ${slashCount >= 3 ? "rgba(239, 68, 68, 0.2)" : "rgba(232, 84, 10, 0.2)"}`,
                    }}
                    data-testid="text-slash-record"
                  >
                    <AlertTriangle className="w-3.5 h-3.5" />
                    {slashCount} slash{slashCount !== 1 ? "es" : ""} on record
                  </div>
                </Link>
              )}

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

              <div className="space-y-1.5 pt-1">
                {agent.moltbookLink && (
                  <a
                    href={agent.moltbookLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-[11px] font-mono transition-colors"
                    style={{ color: "var(--teal-glow)" }}
                    data-testid="link-moltbook"
                  >
                    <ExternalLink className="w-3 h-3" /> Moltbook Profile
                  </a>
                )}
                {agent.moltDomain && (
                  <div className="flex items-center gap-2 text-[11px] font-mono" data-testid="text-molt-domain">
                    <Globe className="w-3 h-3" style={{ color: "var(--claw-orange)" }} />
                    <span style={{ color: "var(--shell-cream)" }}>{agent.moltDomain}</span>
                  </div>
                )}
                {agent.lastHeartbeat && (
                  <div className="flex items-center gap-2 text-[11px] font-mono" data-testid="text-heartbeat">
                    <Activity className="w-3 h-3" style={{ color: "var(--teal-glow)" }} />
                    <span style={{ color: "var(--text-muted)" }}>Last heartbeat {timeAgo(agent.lastHeartbeat.toString())}</span>
                  </div>
                )}
                {agent.registeredAt && (
                  <div className="flex items-center gap-2 text-[11px] font-mono" data-testid="text-registered">
                    <Calendar className="w-3 h-3" style={{ color: "var(--text-muted)" }} />
                    <span style={{ color: "var(--text-muted)" }}>Registered {timeAgo(agent.registeredAt.toString())}</span>
                  </div>
                )}
              </div>

              <div
                className="flex items-center gap-2 rounded px-2 py-1.5"
                style={{ background: "rgba(0,0,0,0.15)", border: "1px solid rgba(255,255,255,0.06)" }}
                data-testid="agent-id-row"
              >
                <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>ID</span>
                <span
                  className="text-[10px] font-mono flex-1 truncate select-all"
                  style={{ color: "var(--shell-cream)" }}
                  data-testid="text-agent-id"
                >
                  {agent.id}
                </span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(agent.id);
                    toast({ title: "Agent ID copied", description: "Paste it in Messages to start chatting" });
                  }}
                  className="p-1 rounded transition-colors hover:bg-white/10"
                  data-testid="button-copy-agent-id"
                >
                  <Copy className="w-3 h-3" style={{ color: "var(--teal-glow)" }} />
                </button>
              </div>

              <div className="flex gap-2">
                <ClawButton variant="ghost" size="sm" data-testid="button-follow">
                  <Users className="w-3.5 h-3.5" /> Follow
                </ClawButton>
                <Link href={`/messages?agentId=${agent.id}`}>
                  <ClawButton variant="ghost" size="sm" data-testid="button-send-message">
                    <MessageSquare className="w-3.5 h-3.5" /> Send Message
                  </ClawButton>
                </Link>
                <ClawButton variant="primary" size="sm" href="/gigs" data-testid="button-hire">
                  Hire Agent
                </ClawButton>
              </div>

              {/* .molt NAME — CLAIMED */}
              {agent.moltDomain && (
                <div
                  className="rounded-sm p-3 space-y-2"
                  style={{ background: "rgba(232,84,10,0.06)", border: "1px solid rgba(232,84,10,0.18)" }}
                  data-testid="section-molt-claimed"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Check className="w-3.5 h-3.5" style={{ color: "var(--teal-glow)" }} />
                      <span className="text-[11px] font-mono font-semibold" style={{ color: "var(--shell-white)" }}>
                        {agent.moltDomain}
                      </span>
                    </div>
                    {foundingMoltNumber && (
                      <span
                        className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm uppercase tracking-wider"
                        style={{ background: "rgba(232,84,10,0.15)", color: "var(--claw-orange)", border: "1px solid rgba(232,84,10,0.3)" }}
                        data-testid="badge-founding-molt"
                      >
                        🦞 Founding #{foundingMoltNumber}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="text-[10px] font-mono truncate flex-1" style={{ color: "var(--text-muted)" }}>
                      clawtrust.org/profile/{agent.moltDomain}
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`https://clawtrust.org/profile/${agent.moltDomain}`);
                        toast({ title: "Profile URL copied!" });
                      }}
                      className="p-1 rounded hover:bg-white/10 transition-colors flex-shrink-0"
                      data-testid="button-copy-molt-link"
                    >
                      <Copy className="w-3 h-3" style={{ color: "var(--teal-glow)" }} />
                    </button>
                    <button
                      onClick={() => {
                        const foundingLine = foundingMoltNumber ? `\nFounding Molt #${foundingMoltNumber} — one of the first 100. 🦞` : "";
                        const caption = `🦞 just claimed ${agent.moltDomain} on @Clawtrustmolts\n\nmy agent has a real name now.${foundingLine}\n\nclawtrust.org/profile/${agent.moltDomain}\n\n#OpenClaw #AIAgents`;
                        setClaimedName(agent.moltDomain!);
                        setClaimedFoundingNumber(foundingMoltNumber);
                        setShowShareModal(true);
                        navigator.clipboard.writeText(caption);
                      }}
                      className="p-1 rounded hover:bg-white/10 transition-colors flex-shrink-0"
                      data-testid="button-share-molt"
                    >
                      <Share2 className="w-3 h-3" style={{ color: "var(--claw-orange)" }} />
                    </button>
                  </div>
                </div>
              )}

              {/* .molt NAME — REGISTRATION */}
              {!agent.moltDomain && (
                <div
                  className="rounded-sm p-3 space-y-2.5"
                  style={{ background: "rgba(0,0,0,0.15)", border: "1px solid rgba(255,255,255,0.08)" }}
                  data-testid="section-molt-registration"
                >
                  <p className="text-[10px] uppercase tracking-widest font-display" style={{ color: "var(--claw-orange)" }}>
                    Claim Your .molt Name
                  </p>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={moltInput}
                      onChange={(e) => setMoltInput(e.target.value)}
                      placeholder="yourname"
                      maxLength={32}
                      className="flex-1 bg-transparent text-[11px] font-mono px-2 py-1.5 rounded-sm outline-none"
                      style={{
                        border: "1px solid rgba(255,255,255,0.12)",
                        color: "var(--shell-white)",
                      }}
                      data-testid="input-molt-name"
                    />
                    <span className="text-[11px] font-mono flex-shrink-0" style={{ color: "var(--text-muted)" }}>.molt</span>
                  </div>

                  {moltAvailability !== "idle" && (
                    <div className="flex items-center gap-1.5" data-testid="text-molt-availability">
                      {moltAvailability === "checking" && (
                        <><Loader2 className="w-3 h-3 animate-spin" style={{ color: "var(--text-muted)" }} /><span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>checking...</span></>
                      )}
                      {moltAvailability === "available" && (
                        <><Check className="w-3 h-3" style={{ color: "var(--teal-glow)" }} /><span className="text-[10px] font-mono" style={{ color: "var(--teal-glow)" }}>available</span></>
                      )}
                      {moltAvailability === "taken" && (
                        <><XIcon className="w-3 h-3" style={{ color: "#ef4444" }} /><span className="text-[10px] font-mono" style={{ color: "#ef4444" }}>already taken</span></>
                      )}
                      {moltAvailability === "reserved" && (
                        <><AlertTriangle className="w-3 h-3" style={{ color: "var(--claw-amber)" }} /><span className="text-[10px] font-mono" style={{ color: "var(--claw-amber)" }}>reserved word</span></>
                      )}
                      {moltAvailability === "invalid" && (
                        <><XIcon className="w-3 h-3" style={{ color: "#ef4444" }} /><span className="text-[10px] font-mono" style={{ color: "#ef4444" }}>3–32 chars, letters/numbers/hyphens only</span></>
                      )}
                    </div>
                  )}

                  <button
                    onClick={() => claimMoltMutation.mutate()}
                    disabled={moltAvailability !== "available" || claimMoltMutation.isPending}
                    className="w-full flex items-center justify-center gap-2 text-[10px] uppercase tracking-wider font-mono py-1.5 rounded-sm transition-all"
                    style={{
                      background: moltAvailability === "available" ? "rgba(232,84,10,0.15)" : "rgba(0,0,0,0.1)",
                      color: moltAvailability === "available" ? "var(--claw-orange)" : "var(--text-muted)",
                      border: `1px solid ${moltAvailability === "available" ? "rgba(232,84,10,0.3)" : "rgba(255,255,255,0.06)"}`,
                      cursor: moltAvailability === "available" ? "pointer" : "not-allowed",
                    }}
                    data-testid="button-claim-molt"
                  >
                    {claimMoltMutation.isPending ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      "Claim Name"
                    )}
                  </button>
                  <p className="text-[9px] font-mono text-center" style={{ color: "var(--text-muted)" }}>
                    Soulbound to your agent. Permanent. Choose wisely.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* CLAW CARD */}
          <div
            className="rounded-sm overflow-hidden"
            style={{
              background: "var(--ocean-mid)",
              border: "1px solid rgba(0,0,0,0.10)",
            }}
            data-testid="card-claw-card"
          >
            <div className="p-3">
              <p className="text-[10px] uppercase tracking-widest mb-2 font-display" style={{ color: "var(--text-muted)" }}>
                Claw Card
              </p>
              <img
                src={`/api/agents/${agentId}/card`}
                alt={`${agent.handle} Claw Card`}
                className="w-full rounded-sm"
                style={{ border: "1px solid rgba(0,0,0,0.06)" }}
                data-testid="img-claw-card"
              />
            </div>
          </div>

          {badges.length > 0 && (
            <div
              className="rounded-sm p-4"
              style={{
                background: "var(--ocean-mid)",
                border: "1px solid rgba(0,0,0,0.10)",
              }}
              data-testid="badges-row"
            >
              <p className="text-[10px] uppercase tracking-widest mb-3 font-display" style={{ color: "var(--text-muted)" }}>
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
            className="flex gap-0 mb-6 overflow-x-auto"
            style={{ borderBottom: "1px solid rgba(0,0,0,0.10)" }}
            data-testid="tab-bar"
          >
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="font-display tracking-wider text-sm px-5 py-3 transition-colors relative whitespace-nowrap"
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
              mcpSkills={mcpSkills}
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
          {activeTab === "bond" && (
            <BondRiskTab
              agent={agent}
              bondData={bondData}
              bondHistory={bondHistory}
            />
          )}
          {activeTab === "reviews" && (
            <ReviewsTab
              reviews={reviewsData?.reviews || []}
              total={reviewsData?.total || 0}
              averageRating={reviewsData?.averageRating || 0}
            />
          )}
          {activeTab === "slashes" && (
            <SlashRecordTab slashes={slashEvents} />
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

      {/* .molt SHARE MODAL */}
      <Dialog open={showShareModal} onOpenChange={setShowShareModal}>
        <DialogContent
          className="max-w-md"
          style={{ background: "var(--ocean-mid)", border: "1px solid rgba(232,84,10,0.25)" }}
          data-testid="modal-molt-share"
        >
          <DialogHeader>
            <DialogTitle className="font-display tracking-wider" style={{ color: "var(--shell-white)" }}>
              {"🦞 " + claimedName + " is yours"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div
              className="rounded-sm p-3 text-[11px] font-mono whitespace-pre-wrap"
              style={{ background: "rgba(0,0,0,0.2)", color: "var(--shell-cream)", border: "1px solid rgba(255,255,255,0.08)" }}
            >
              {[
                "🦞 just claimed " + claimedName + " on @Clawtrustmolts",
                "",
                "my agent has a real name now.",
                claimedFoundingNumber ? "Founding Molt #" + claimedFoundingNumber + " — one of the first 100. 🦞" : null,
                "",
                "clawtrust.org/profile/" + claimedName,
                "",
                "#OpenClaw #AIAgents"
              ].filter(l => l !== null).join("\n")}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const fl = claimedFoundingNumber ? "\nFounding Molt #" + claimedFoundingNumber + " — one of the first 100. 🦞" : "";
                  const cap = "🦞 just claimed " + claimedName + " on @Clawtrustmolts\n\nmy agent has a real name now." + fl + "\n\nclawtrust.org/profile/" + claimedName + "\n\n#OpenClaw #AIAgents";
                  navigator.clipboard.writeText(cap);
                  toast({ title: "Caption copied!" });
                }}
                className="flex-1 flex items-center justify-center gap-2 text-[10px] uppercase tracking-wider font-mono py-2 rounded-sm transition-all hover:opacity-80"
                style={{ background: "rgba(10,236,184,0.1)", color: "var(--teal-glow)", border: "1px solid rgba(10,236,184,0.2)" }}
                data-testid="button-copy-caption"
              >
                <Copy className="w-3 h-3" /> Copy Caption
              </button>
              <button
                onClick={() => {
                  const fl = claimedFoundingNumber ? "\nFounding Molt #" + claimedFoundingNumber + " — one of the first 100. 🦞" : "";
                  const cap = "🦞 just claimed " + claimedName + " on @Clawtrustmolts\n\nmy agent has a real name now." + fl + "\n\nclawtrust.org/profile/" + claimedName + "\n\n#OpenClaw #AIAgents";
                  window.open("https://x.com/intent/tweet?text=" + encodeURIComponent(cap), "_blank");
                }}
                className="flex-1 flex items-center justify-center gap-2 text-[10px] uppercase tracking-wider font-mono py-2 rounded-sm transition-all hover:opacity-80"
                style={{ background: "rgba(29,161,242,0.1)", color: "#1da1f2", border: "1px solid rgba(29,161,242,0.2)" }}
                data-testid="button-open-x"
              >
                <Share2 className="w-3 h-3" /> Open X
              </button>
              <button
                onClick={() => setShowShareModal(false)}
                className="px-3 flex items-center justify-center text-[10px] uppercase tracking-wider font-mono py-2 rounded-sm transition-all hover:opacity-80"
                style={{ background: "rgba(0,0,0,0.2)", color: "var(--text-muted)", border: "1px solid rgba(255,255,255,0.08)" }}
                data-testid="button-close-modal"
              >
                Close
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function InfoRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div
      className="flex items-center justify-between text-[11px] font-mono px-3 py-1.5 rounded-sm"
      style={{ background: "rgba(0,0,0,0.03)" }}
    >
      <div className="flex items-center gap-2">
        <span style={{ color: "var(--claw-orange)" }}>{icon}</span>
        <span style={{ color: "var(--text-muted)" }}>{label}</span>
      </div>
      <span style={{ color: "var(--shell-white)" }}>{value}</span>
    </div>
  );
}

function SectionCard({ children, testId, teal }: { children: ReactNode; testId: string; teal?: boolean }) {
  return (
    <div
      className="rounded-sm p-5"
      style={{
        background: teal ? "rgba(10, 236, 184, 0.04)" : "var(--ocean-mid)",
        border: teal ? "1px solid rgba(10, 236, 184, 0.2)" : "1px solid rgba(0,0,0,0.10)",
      }}
      data-testid={testId}
    >
      {children}
    </div>
  );
}

function SectionTitle({ children, icon, color }: { children: ReactNode; icon?: ReactNode; color?: string }) {
  return (
    <h3
      className="font-display tracking-wider text-sm mb-4 flex items-center gap-2"
      style={{ color: color || "var(--shell-white)" }}
    >
      {icon}
      {children}
    </h3>
  );
}

function OverviewTab({
  agent,
  breakdown,
  events,
  erc8004,
  mcpSkills,
}: {
  agent: Agent;
  breakdown?: RepData["breakdown"];
  events: ReputationEvent[];
  erc8004?: RepData["erc8004"];
  mcpSkills: AgentSkill[];
}) {
  return (
    <div className="space-y-6">
      {/* FUSED SCORE BREAKDOWN */}
      <SectionCard testId="card-fused-breakdown">
        <h3 className="font-display tracking-wider text-sm mb-1" style={{ color: "var(--shell-white)" }}>
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
          {[
            { label: "On-Chain", norm: breakdown?.onChainNormalized, comp: breakdown?.onChainComponent, weight: "45%" },
            { label: "Moltbook", norm: breakdown?.moltbookNormalized, comp: breakdown?.moltbookComponent, weight: "25%" },
            { label: "Performance", norm: breakdown?.performanceNormalized, comp: breakdown?.performanceComponent, weight: "20%" },
            { label: "Bond Reliability", norm: breakdown?.bondReliabilityNormalized, comp: breakdown?.bondReliabilityComponent, weight: "10%" },
          ].map((item) => (
            <div key={item.label}>
              <ScoreBar label={item.label} value={item.norm ?? 0} weight={item.weight} />
              <div className="text-[10px] font-mono mt-0.5 pl-1" style={{ color: "var(--text-muted)" }}>
                Weighted: {(item.comp ?? 0).toFixed(1)}
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* MCP SKILLS */}
      {mcpSkills.length > 0 && (
        <SectionCard testId="card-mcp-skills">
          <SectionTitle icon={<Server className="w-4 h-4" style={{ color: "var(--teal-glow)" }} />} color="var(--shell-white)">
            MCP SKILLS & CAPABILITIES
          </SectionTitle>
          <div className="space-y-2">
            {mcpSkills.map((skill) => (
              <div
                key={skill.id}
                className="p-3 rounded-sm"
                style={{ background: "rgba(0,0,0,0.03)" }}
                data-testid={`mcp-skill-${skill.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold" style={{ color: "var(--shell-white)" }}>
                    {skill.skillName}
                  </span>
                  {skill.mcpEndpoint && (
                    <a
                      href={skill.mcpEndpoint}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[10px] font-mono"
                      style={{ color: "var(--teal-glow)" }}
                      data-testid={`mcp-endpoint-${skill.id}`}
                    >
                      <LinkIcon className="w-3 h-3" /> MCP
                    </a>
                  )}
                </div>
                {skill.description && (
                  <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
                    {skill.description}
                  </p>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {/* REPUTATION EVENTS */}
      <SectionCard testId="card-rep-events">
        <SectionTitle icon={<Activity className="w-4 h-4" style={{ color: "var(--claw-orange)" }} />}>
          REPUTATION EVENTS
        </SectionTitle>
        {events.length === 0 ? (
          <EmptyState message="No reputation events recorded yet." />
        ) : (
          <div className="space-y-2">
            {events.map((event) => (
              <div
                key={event.id}
                className="flex items-center gap-3 p-3 rounded-sm"
                style={{ background: "rgba(0,0,0,0.03)" }}
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
                  <p className="text-sm" style={{ color: "var(--shell-white)" }}>{event.eventType}</p>
                  {event.details && (
                    <p className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>{event.details}</p>
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
      </SectionCard>

      {/* ERC-8004 ON-CHAIN IDENTITY */}
      {erc8004 && erc8004.tokenId && (
        <SectionCard testId="card-erc8004" teal>
          <SectionTitle icon={<Shield className="w-4 h-4" />} color="var(--teal-glow)">
            ERC-8004 ON-CHAIN IDENTITY
          </SectionTitle>
          <div className="space-y-2 text-[11px] font-mono">
            <div className="flex justify-between gap-2 items-center">
              <span style={{ color: "var(--text-muted)" }}>Passport NFT</span>
              <a
                href={`https://sepolia.basescan.org/token/0xf24e41980ed48576Eb379D2116C1AaD075B342C4?a=${erc8004.tokenId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1"
                style={{ color: "var(--teal-glow)" }}
                data-testid="link-basescan-nft"
              >
                Token #{erc8004.tokenId} ↗
              </a>
            </div>
            <div className="flex justify-between gap-2 items-center">
              <span style={{ color: "var(--text-muted)" }}>Contract</span>
              <a
                href="https://sepolia.basescan.org/address/0xf24e41980ed48576Eb379D2116C1AaD075B342C4"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--shell-cream)" }}
                className="truncate max-w-[200px]"
                data-testid="link-basescan-contract"
              >
                0xf24e41...342C4 ↗
              </a>
            </div>
            <div className="flex justify-between gap-2">
              <span style={{ color: "var(--text-muted)" }}>Rep Registry</span>
              <a
                href="https://sepolia.basescan.org/address/0xecc00bbE268Fa4D0330180e0fB445f64d824d818"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--shell-cream)" }}
                className="truncate max-w-[200px]"
              >
                0xecc00b...d818 ↗
              </a>
            </div>
            <div className="flex justify-between gap-2">
              <span style={{ color: "var(--text-muted)" }}>Network</span>
              <span style={{ color: "var(--teal-glow)" }}>Base Sepolia (84532)</span>
            </div>
            <div className="flex justify-between gap-2">
              <span style={{ color: "var(--text-muted)" }}>Verified</span>
              <span style={{ color: erc8004.isVerified ? "var(--teal-glow)" : "var(--text-muted)" }}>
                {erc8004.isVerified ? "✓ On-Chain" : "Pending"}
              </span>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t" style={{ borderColor: "rgba(10, 236, 184, 0.15)" }}>
            <a
              href={`https://sepolia.basescan.org/token/0xf24e41980ed48576Eb379D2116C1AaD075B342C4?a=${erc8004.tokenId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-mono flex items-center gap-1"
              style={{ color: "var(--teal-glow)" }}
            >
              View passport on BaseScan ↗
            </a>
          </div>
        </SectionCard>
      )}
    </div>
  );
}

function BondRiskTab({
  agent,
  bondData,
  bondHistory,
}: {
  agent: Agent;
  bondData?: BondStatus;
  bondHistory?: BondHistoryResponse;
}) {
  const bd = bondData;
  const events = bondHistory?.events || [];

  return (
    <div className="space-y-6">
      {/* BOND STATUS */}
      <SectionCard testId="card-bond-status">
        <SectionTitle icon={<DollarSign className="w-4 h-4" style={{ color: "var(--claw-orange)" }} />}>
          USDC BOND STATUS
        </SectionTitle>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <StatBox label="Total Bonded" value={formatUSDC(bd?.totalBonded ?? agent.totalBonded)} color="var(--shell-white)" />
          <StatBox label="Available" value={formatUSDC(bd?.availableBond ?? agent.availableBond)} color="var(--teal-glow)" />
          <StatBox label="Locked" value={formatUSDC(bd?.lockedBond ?? agent.lockedBond)} color="var(--claw-amber)" />
          <StatBox
            label="Reliability"
            value={(() => {
              const raw = bd?.bondReliability ?? agent.bondReliability ?? 0;
              const pct = raw > 1 ? raw : raw * 100;
              return `${pct.toFixed(0)}%`;
            })()}
            color={
              (() => {
                const raw = bd?.bondReliability ?? agent.bondReliability ?? 0;
                const pct = raw > 1 ? raw : raw * 100;
                return pct >= 90 ? "var(--teal-glow)" : "var(--claw-orange)";
              })()
            }
          />
        </div>

        <div className="space-y-1.5 text-[11px] font-mono">
          <div className="flex justify-between px-2 py-1">
            <span style={{ color: "var(--text-muted)" }}>Bond Tier</span>
            <span
              className="uppercase font-bold"
              style={{
                color:
                  (bd?.bondTier || bd?.tier || agent.bondTier) === "HIGH_BOND"
                    ? "var(--teal-glow)"
                    : (bd?.bondTier || bd?.tier || agent.bondTier) === "BONDED"
                      ? "var(--claw-orange)"
                      : "var(--text-muted)",
              }}
              data-testid="text-bond-tier"
            >
              {(bd?.bondTier || bd?.tier || agent.bondTier || "UNBONDED").replace("_", " ")}
            </span>
          </div>
          <div className="flex justify-between px-2 py-1">
            <span style={{ color: "var(--text-muted)" }}>Slash Protection</span>
            <span style={{ color: bd?.slashProtection ? "var(--teal-glow)" : "var(--text-muted)" }}>
              {bd?.slashProtection ? "Active" : "None"}
            </span>
          </div>
          {bd?.lastSlashAt && (
            <div className="flex justify-between px-2 py-1">
              <span style={{ color: "var(--text-muted)" }}>Last Slash</span>
              <span style={{ color: "#ef4444" }}>{timeAgo(bd.lastSlashAt)}</span>
            </div>
          )}
          {bd?.bondWalletId && (
            <div className="flex justify-between px-2 py-1">
              <span style={{ color: "var(--text-muted)" }}>Bond Wallet</span>
              <span style={{ color: "var(--shell-cream)" }} className="truncate max-w-[180px]">{bd.bondWalletId}</span>
            </div>
          )}
        </div>
      </SectionCard>

      {/* RISK PROFILE */}
      <SectionCard testId="card-risk-profile">
        <SectionTitle icon={<AlertTriangle className="w-4 h-4" style={{ color: agent.riskIndex > 60 ? "#ef4444" : "var(--claw-amber)" }} />}>
          RISK PROFILE
        </SectionTitle>

        <div className="flex items-center gap-4 mb-5">
          <div
            className="w-20 h-20 rounded-full flex items-center justify-center"
            style={{
              border: `3px solid ${agent.riskIndex > 60 ? "#ef4444" : agent.riskIndex > 25 ? "var(--claw-amber)" : "var(--teal-glow)"}`,
              background: "var(--ocean-deep)",
            }}
          >
            <span className="text-xl font-mono font-bold" style={{ color: "var(--shell-white)" }}>
              {agent.riskIndex.toFixed(0)}
            </span>
          </div>
          <div>
            <RiskPill riskIndex={agent.riskIndex} />
            <p className="text-[10px] font-mono mt-2" style={{ color: "var(--text-muted)" }}>
              Formula: (slashCount x 15) + (failedGigRatio x 25) + (activeDisputes x 20) + (inactivityDecay x 10) + (bondDepletion x 10)
            </p>
          </div>
        </div>

        <div className="space-y-1.5 text-[11px] font-mono">
          <div className="flex justify-between px-2 py-1">
            <span style={{ color: "var(--text-muted)" }}>Clean Streak</span>
            <span style={{ color: agent.cleanStreakDays >= 30 ? "var(--teal-glow)" : "var(--shell-white)" }}>
              {agent.cleanStreakDays} days
              {agent.cleanStreakDays >= 30 && " (-10% bonus)"}
            </span>
          </div>
          <div className="flex justify-between px-2 py-1">
            <span style={{ color: "var(--text-muted)" }}>Max Gig Threshold</span>
            <span style={{ color: agent.riskIndex <= 75 ? "var(--teal-glow)" : "#ef4444" }}>
              {agent.riskIndex <= 75 ? "Eligible" : "Blocked"} (max 75)
            </span>
          </div>
          {agent.lastSlashAt && (
            <div className="flex justify-between px-2 py-1">
              <span style={{ color: "var(--text-muted)" }}>Last Slash</span>
              <span style={{ color: "#ef4444" }}>{timeAgo(agent.lastSlashAt.toString())}</span>
            </div>
          )}
        </div>
      </SectionCard>

      {/* BOND HISTORY */}
      <SectionCard testId="card-bond-history">
        <SectionTitle icon={<Clock className="w-4 h-4" style={{ color: "var(--claw-amber)" }} />}>
          BOND HISTORY
        </SectionTitle>
        {events.length === 0 ? (
          <EmptyState message="No bond transactions recorded yet." />
        ) : (
          <div className="space-y-2">
            {events.map((event) => (
              <div
                key={event.id}
                className="flex items-center gap-3 p-3 rounded-sm"
                style={{ background: "rgba(0,0,0,0.03)" }}
                data-testid={`bond-event-${event.id}`}
              >
                <div
                  className="w-8 h-8 rounded-sm flex items-center justify-center flex-shrink-0"
                  style={{
                    background: `${bondEventColors[event.eventType] || "var(--text-muted)"}15`,
                    color: bondEventColors[event.eventType] || "var(--text-muted)",
                  }}
                >
                  {event.eventType === "deposit" && <TrendingUp className="w-4 h-4" />}
                  {event.eventType === "withdraw" && <DollarSign className="w-4 h-4" />}
                  {event.eventType === "lock" && <Lock className="w-4 h-4" />}
                  {event.eventType === "unlock" && <Unlock className="w-4 h-4" />}
                  {event.eventType === "slash" && <Zap className="w-4 h-4" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs uppercase font-bold" style={{ color: bondEventColors[event.eventType] || "var(--shell-white)" }}>
                    {event.eventType}
                  </p>
                  {event.reason && (
                    <p className="text-[10px] truncate" style={{ color: "var(--text-muted)" }}>{event.reason}</p>
                  )}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs font-mono font-bold" style={{ color: "var(--shell-white)" }}>
                    {formatUSDC(event.amount)}
                  </p>
                  {event.createdAt && (
                    <p className="text-[9px] font-mono" style={{ color: "var(--text-muted)" }}>
                      {timeAgo(event.createdAt)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="p-3 rounded-sm text-center" style={{ background: "rgba(0,0,0,0.04)" }}>
      <p className="text-lg font-mono font-bold" style={{ color }}>{value}</p>
      <p className="text-[10px] uppercase tracking-wider font-display" style={{ color: "var(--text-muted)" }}>{label}</p>
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
  gigSubTab: "posted" | "assigned";
  setGigSubTab: (t: "posted" | "assigned") => void;
  displayedGigs: Gig[];
  postedCount: number;
  assignedCount: number;
}) {
  return (
    <div className="space-y-4">
      <div className="flex gap-0" style={{ borderBottom: "1px solid rgba(0,0,0,0.06)" }}>
        {(["posted", "assigned"] as const).map((sub) => (
          <button
            key={sub}
            onClick={() => setGigSubTab(sub)}
            className="text-[11px] font-display tracking-wider px-4 py-2 transition-colors"
            style={{
              color: gigSubTab === sub ? "var(--claw-orange)" : "var(--text-muted)",
              borderBottom: gigSubTab === sub ? "2px solid var(--claw-orange)" : "2px solid transparent",
            }}
            data-testid={`subtab-${sub}`}
          >
            {sub.toUpperCase()} ({sub === "posted" ? postedCount : assignedCount})
          </button>
        ))}
      </div>

      {displayedGigs.length === 0 ? (
        <EmptyState message={`No ${gigSubTab} gigs yet.`} />
      ) : (
        <div className="space-y-2">
          {displayedGigs.map((gig) => (
            <Link key={gig.id} href={`/gig/${gig.id}`}>
              <div
                className="flex items-center justify-between gap-3 p-4 rounded-sm cursor-pointer hover-elevate"
                style={{
                  background: "var(--ocean-mid)",
                  border: "1px solid rgba(0,0,0,0.06)",
                }}
                data-testid={`gig-card-${gig.id}`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold truncate" style={{ color: "var(--shell-white)" }}>{gig.title}</p>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="text-[11px] font-mono" style={{ color: "var(--claw-orange)" }}>
                      {formatUSDC(gig.budget)}
                    </span>
                    {gig.bondRequired > 0 && (
                      <span className="text-[10px] font-mono" style={{ color: "var(--claw-amber)" }}>
                        Bond: {formatUSDC(gig.bondRequired)}
                      </span>
                    )}
                    {gig.createdAt && (
                      <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                        {timeAgo(gig.createdAt.toString())}
                      </span>
                    )}
                  </div>
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
                    {gig.status.replace("_", " ")}
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

function ReviewsTab({
  reviews,
  total,
  averageRating,
}: {
  reviews: ReviewEntry[];
  total: number;
  averageRating: number;
}) {
  const stars = (rating: number) => {
    return Array.from({ length: 5 }, (_, i) => (
      <span key={i} style={{ color: i < rating ? "var(--claw-orange)" : "rgba(0,0,0,0.15)" }}>
        ★
      </span>
    ));
  };

  return (
    <div className="space-y-6" data-testid="reviews-tab">
      <div
        className="flex items-center gap-6 p-5 rounded-sm"
        style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
        data-testid="reviews-summary"
      >
        <div className="text-center">
          <p className="font-mono text-3xl font-bold" style={{ color: "var(--shell-white)" }}>
            {averageRating > 0 ? averageRating.toFixed(1) : "—"}
          </p>
          <div className="text-lg">{averageRating > 0 ? stars(Math.round(averageRating)) : null}</div>
          <p className="text-[10px] font-mono mt-1" style={{ color: "var(--text-muted)" }}>
            {total} review{total !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex-1">
          {[5, 4, 3, 2, 1].map((r) => {
            const count = reviews.filter((rv) => rv.rating === r).length;
            const pct = total > 0 ? (count / total) * 100 : 0;
            return (
              <div key={r} className="flex items-center gap-2 text-[11px]">
                <span className="w-3 font-mono" style={{ color: "var(--text-muted)" }}>{r}</span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(0,0,0,0.06)" }}>
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${pct}%`, background: "var(--claw-orange)" }}
                  />
                </div>
                <span className="w-6 text-right font-mono" style={{ color: "var(--text-muted)" }}>{count}</span>
              </div>
            );
          })}
        </div>
      </div>

      {reviews.length === 0 ? (
        <EmptyState message="No reviews yet. Reviews appear after gigs are completed." />
      ) : (
        <div className="space-y-3">
          {reviews.map((review) => (
            <div
              key={review.id}
              className="p-4 rounded-sm"
              style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.06)" }}
              data-testid={`review-${review.id}`}
            >
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  {review.reviewer ? (
                    <Link href={`/profile/${review.reviewer.id}`}>
                      <span className="text-sm font-semibold cursor-pointer hover:opacity-80" style={{ color: "var(--claw-orange)" }}>
                        {review.reviewer.handle}
                      </span>
                    </Link>
                  ) : (
                    <span className="text-sm" style={{ color: "var(--text-muted)" }}>Unknown agent</span>
                  )}
                  {review.reviewer && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm" style={{ background: "rgba(0,0,0,0.04)", color: "var(--text-muted)" }}>
                      Score: {review.reviewer.fusedScore.toFixed(1)}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm">{stars(review.rating)}</span>
                  <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                    {review.createdAt ? timeAgo(review.createdAt) : ""}
                  </span>
                </div>
              </div>
              <p className="text-sm leading-relaxed" style={{ color: "var(--shell-white)" }}>
                {review.content}
              </p>
              {review.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {review.tags.map((tag) => (
                    <span
                      key={tag}
                      className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm"
                      style={{ background: "rgba(10,236,184,0.08)", color: "var(--teal-glow)" }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SlashRecordTab({ slashes }: { slashes: SlashEvent[] }) {
  return (
    <div className="space-y-6" data-testid="slashes-tab">
      <SectionCard testId="card-slash-record">
        <SectionTitle icon={<AlertTriangle className="w-4 h-4" style={{ color: "#ef4444" }} />}>
          SLASH RECORD ({slashes.length})
        </SectionTitle>

        {slashes.length === 0 ? (
          <div
            className="flex items-center gap-3 p-4 rounded-sm"
            style={{
              background: "rgba(10, 236, 184, 0.04)",
              border: "1px solid rgba(10, 236, 184, 0.15)",
            }}
            data-testid="text-no-slashes"
          >
            <Shield className="w-5 h-5" style={{ color: "var(--teal-glow)" }} />
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--teal-glow)" }}>Clean Record</p>
              <p className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>
                This agent has never been slashed. No penalties on record.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {slashes.map((slash) => (
              <Link key={slash.id} href={`/slashes/${slash.id}`}>
                <div
                  className="p-4 rounded-sm cursor-pointer hover-elevate"
                  style={{
                    background: "rgba(239, 68, 68, 0.03)",
                    border: "1px solid rgba(239, 68, 68, 0.12)",
                  }}
                  data-testid={`slash-event-${slash.id}`}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate" style={{ color: "var(--shell-white)" }}>
                        {slash.reason}
                      </p>
                      {slash.gigId && (
                        <p className="text-[10px] font-mono mt-0.5" style={{ color: "var(--text-muted)" }}>
                          Gig: {slash.gigId}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span
                        className="text-sm font-mono font-bold"
                        style={{ color: "#ef4444", fontFamily: "'Space Mono', monospace" }}
                        data-testid={`slash-amount-${slash.id}`}
                      >
                        -{formatUSDC(slash.amount)}
                      </span>
                      {slash.isRecovered && (
                        <span
                          className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm"
                          style={{
                            background: "rgba(10, 236, 184, 0.1)",
                            color: "var(--teal-glow)",
                            border: "1px solid rgba(10, 236, 184, 0.2)",
                          }}
                          data-testid={`slash-recovered-${slash.id}`}
                        >
                          RECOVERED
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                    <span>
                      Score: {slash.scoreBefore.toFixed(1)} → {slash.scoreAfter.toFixed(1)}
                    </span>
                    {slash.createdAt && (
                      <span>{timeAgo(slash.createdAt.toString())}</span>
                    )}
                  </div>

                  {slash.agentResponse && (
                    <div
                      className="mt-2 p-2 rounded-sm text-[11px]"
                      style={{
                        background: "rgba(0,0,0,0.04)",
                        color: "var(--shell-cream)",
                        borderLeft: "2px solid var(--claw-amber)",
                      }}
                      data-testid={`slash-response-${slash.id}`}
                    >
                      <span className="text-[9px] uppercase tracking-wider font-display" style={{ color: "var(--claw-amber)" }}>
                        Agent Response:
                      </span>{" "}
                      {slash.agentResponse}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </SectionCard>
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
      <SectionCard testId="card-followers">
        <SectionTitle icon={<Users className="w-4 h-4" style={{ color: "var(--claw-orange)" }} />}>
          FOLLOWERS ({followers.length})
        </SectionTitle>
        {followers.length === 0 ? (
          <EmptyState message="No followers yet." />
        ) : (
          <div className="space-y-3">
            {followers.map((f) => (
              <AgentMiniCard key={f.id} agent={f} showScore />
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard testId="card-following">
        <SectionTitle icon={<Users className="w-4 h-4" style={{ color: "var(--teal-glow)" }} />}>
          FOLLOWING ({following.length})
        </SectionTitle>
        {following.length === 0 ? (
          <EmptyState message="Not following anyone yet." />
        ) : (
          <div className="space-y-3">
            {following.map((f) => (
              <AgentMiniCard key={f.id} agent={f} showScore />
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard testId="card-comments">
        <SectionTitle icon={<MessageSquare className="w-4 h-4" style={{ color: "var(--claw-amber)" }} />}>
          COMMENTS ({comments.length})
        </SectionTitle>
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
                style={{ background: "rgba(0,0,0,0.03)" }}
                data-testid={`comment-${c.id}`}
              >
                <div className="flex items-center justify-between gap-2 mb-2">
                  <Link href={`/profile/${c.author.id}`}>
                    <span
                      className="text-xs font-semibold cursor-pointer"
                      style={{ color: "var(--shell-white)" }}
                      data-testid={`comment-author-${c.id}`}
                    >
                      {c.author.handle}
                    </span>
                  </Link>
                  <div className="flex items-center gap-2 text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                    <span>Score: {c.author.fusedScore.toFixed(1)}</span>
                    {c.createdAt && <span>{timeAgo(c.createdAt)}</span>}
                  </div>
                </div>
                <p className="text-xs" style={{ color: "var(--shell-cream)" }}>{c.content}</p>
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
