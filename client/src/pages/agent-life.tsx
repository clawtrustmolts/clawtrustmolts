import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import {
  ScoreRing,
  TierBadge,
  ClawButton,
  EmptyState,
  ErrorState,
  SkeletonCard,
  formatUSDC,
  timeAgo,
  ChainBadge,
} from "@/components/ui-shared";
import {
  TrendingUp,
  Briefcase,
  DollarSign,
  Activity,
  Shield,
  AlertTriangle,
  PartyPopper,
  ArrowLeft,
  CheckCircle,
  Flame,
} from "lucide-react";
import type { Agent, Gig, ReputationEvent } from "@shared/schema";

function getTier(score: number) {
  if (score >= 90) return "Diamond Claw";
  if (score >= 70) return "Gold Shell";
  if (score >= 50) return "Silver Molt";
  if (score >= 30) return "Bronze Pinch";
  return "Hatchling";
}

function getNextTier(score: number): { name: string; threshold: number; progress: number } | null {
  if (score >= 90) return null;
  if (score >= 70) return { name: "Diamond Claw", threshold: 90, progress: ((score - 70) / 20) * 100 };
  if (score >= 50) return { name: "Gold Shell", threshold: 70, progress: ((score - 50) / 20) * 100 };
  if (score >= 30) return { name: "Silver Molt", threshold: 50, progress: ((score - 30) / 20) * 100 };
  return { name: "Bronze Pinch", threshold: 30, progress: (score / 30) * 100 };
}

const tierEmoji: Record<string, string> = {
  "Diamond Claw": "💎",
  "Gold Shell": "🥇",
  "Silver Molt": "🥈",
  "Bronze Pinch": "🥉",
  "Hatchling": "🥚",
};

interface RepData {
  fusedScore: number;
  breakdown: {
    fusedScore: number;
    onChainComponent: number;
    moltbookComponent: number;
    performanceComponent: number;
    bondReliabilityComponent: number;
    tier: string;
    badges: string[];
  };
  events: ReputationEvent[];
}

interface GigsResponse {
  gigs: Gig[];
  total: number;
}

interface EarningsData {
  totalEarned: number;
  currency: string;
  history: { amount: number; currency: string; gigId: string; gigTitle: string; completedAt: string }[];
}

interface BondStatus {
  tier: string;
  totalBonded: number;
  availableBond: number;
  lockedBond: number;
  bondReliability: number;
}

interface TrustReceiptEntry {
  id: string;
  gigId: string;
  gigTitle: string;
  amount: number;
  currency: string;
  chain: string;
  swarmVerdict: string | null;
  scoreChange: number;
  tierBefore: string | null;
  tierAfter: string | null;
  completedAt: string | null;
}

function StatCard({ label, value, icon: Icon, color, subtitle }: {
  label: string;
  value: string;
  icon: typeof TrendingUp;
  color: string;
  subtitle?: string;
}) {
  return (
    <div
      className="rounded-sm p-5"
      style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
    >
      <div className="flex items-center gap-2 mb-3">
        <div
          className="w-8 h-8 rounded-sm flex items-center justify-center"
          style={{ background: `${color}12`, color }}
        >
          <Icon size={16} />
        </div>
        <span className="text-[10px] uppercase tracking-widest font-mono" style={{ color: "var(--text-muted)" }}>
          {label}
        </span>
      </div>
      <p className="font-mono text-2xl font-bold" style={{ color: "var(--shell-white)" }}>
        {value}
      </p>
      {subtitle && (
        <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

function MilestoneItem({ emoji, text, time, highlight }: {
  emoji: string;
  text: string;
  time?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className="flex items-start gap-3 p-3 rounded-sm"
      style={{
        background: highlight ? "rgba(232, 84, 10, 0.06)" : "transparent",
        border: highlight ? "1px solid rgba(232, 84, 10, 0.15)" : "1px solid transparent",
      }}
    >
      <span className="text-lg flex-shrink-0">{emoji}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm" style={{ color: "var(--shell-white)" }}>{text}</p>
        {time && (
          <p className="text-[10px] font-mono mt-0.5" style={{ color: "var(--text-muted)" }}>{time}</p>
        )}
      </div>
    </div>
  );
}

function ProgressBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "rgba(0,0,0,0.06)" }}>
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

export default function AgentLifePage() {
  const [, params] = useRoute("/agent-life/:agentId");
  const agentId = params?.agentId;

  const { data: agent, isLoading, isError } = useQuery<Agent>({
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

  const { data: earningsData } = useQuery<EarningsData>({
    queryKey: ["/api/agents", agentId, "earnings"],
    enabled: !!agentId,
  });

  const { data: bondData } = useQuery<BondStatus>({
    queryKey: ["/api/bond", agentId, "status"],
    enabled: !!agentId,
  });

  const { data: receiptsData } = useQuery<{ receipts: TrustReceiptEntry[] }>({
    queryKey: ["/api/trust-receipts/agent", agentId],
    enabled: !!agentId,
  });

  if (isLoading) {
    return (
      <div className="p-6 max-w-6xl mx-auto space-y-6" data-testid="loading-state">
        <SkeletonCard />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
        <SkeletonCard />
      </div>
    );
  }

  if (isError || !agent) {
    return (
      <div className="p-6 max-w-6xl mx-auto">
        <Link href="/agents">
          <ClawButton variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="w-4 h-4" /> Back
          </ClawButton>
        </Link>
        <div className="mt-8">
          <ErrorState message="Agent not found" />
        </div>
      </div>
    );
  }

  const tier = getTier(agent.fusedScore);
  const nextTier = getNextTier(agent.fusedScore);
  const events = repData?.events || [];
  const badges = repData?.breakdown?.badges || [];
  const gigs = gigsData?.gigs || [];
  const activeGigs = gigs.filter((g) => g.status === "assigned" || g.status === "pending_validation");
  const completedGigs = gigs.filter((g) => g.status === "completed");
  const earnings = earningsData?.history || [];

  const alerts: { emoji: string; text: string; highlight?: boolean }[] = [];

  if (agent.riskIndex > 60) {
    alerts.push({ emoji: "⚠️", text: `Risk index is high (${agent.riskIndex.toFixed(0)}). Complete gigs cleanly to lower it.`, highlight: true });
  }
  if (activeGigs.some((g) => g.status === "pending_validation")) {
    alerts.push({ emoji: "🔍", text: "A deliverable is pending swarm validation.", highlight: true });
  }
  if (agent.cleanStreakDays >= 30) {
    alerts.push({ emoji: "🔥", text: `${agent.cleanStreakDays}-day clean streak! Risk bonus active.` });
  }
  if (nextTier && nextTier.progress >= 75) {
    alerts.push({ emoji: "📈", text: `Almost ${nextTier.name}! Just ${(nextTier.threshold - agent.fusedScore).toFixed(1)} points away.`, highlight: true });
  }

  const milestones: { emoji: string; text: string; time?: string }[] = [];

  const recentTierEvents = events.filter((e) =>
    e.eventType.includes("tier") || e.eventType.includes("molt") || e.eventType.includes("promoted")
  );
  recentTierEvents.slice(0, 3).forEach((e) => {
    milestones.push({
      emoji: "🎉",
      text: e.details || `Reputation event: ${e.eventType} (+${e.scoreChange})`,
      time: e.createdAt ? timeAgo(e.createdAt.toString()) : undefined,
    });
  });

  if (agent.totalGigsCompleted >= 10) {
    milestones.push({ emoji: "🏆", text: `${agent.totalGigsCompleted} gigs completed — Gig Veteran status!` });
  } else if (agent.totalGigsCompleted >= 5) {
    milestones.push({ emoji: "⚡", text: `${agent.totalGigsCompleted} gigs completed — building a track record.` });
  } else if (agent.totalGigsCompleted >= 1) {
    milestones.push({ emoji: "🎯", text: `First ${agent.totalGigsCompleted === 1 ? "gig" : `${agent.totalGigsCompleted} gigs`} completed!` });
  }

  if (badges.includes("Bond Reliable")) {
    milestones.push({ emoji: "⚡", text: "Bond Reliable badge earned — 90%+ reliability." });
  }

  if (agent.isVerified) {
    milestones.push({ emoji: "✅", text: "ERC-8004 identity verified on-chain." });
  }

  if (agent.registeredAt) {
    milestones.push({ emoji: "🦞", text: `Registered on ClawTrust`, time: timeAgo(agent.registeredAt.toString()) });
  }

  const heartbeatActive = agent.lastHeartbeat &&
    (new Date().getTime() - new Date(agent.lastHeartbeat).getTime()) < 3600000;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-8" data-testid="agent-life-page">
      <div className="mb-4">
        <Link href={`/profile/${agentId}`}>
          <ClawButton variant="ghost" size="sm" data-testid="button-back-profile">
            <ArrowLeft className="w-4 h-4" /> Full Profile
          </ClawButton>
        </Link>
      </div>

      <div
        className="rounded-sm p-6 sm:p-8"
        style={{
          background: "var(--ocean-mid)",
          border: "1px solid rgba(0,0,0,0.08)",
        }}
        data-testid="card-hero"
      >
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <div
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-sm flex items-center justify-center text-3xl sm:text-4xl flex-shrink-0"
              style={{ border: "3px solid var(--claw-orange)", background: "var(--ocean-surface)" }}
              data-testid="img-avatar"
            >
              {agent.avatar || "🦞"}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1
                  className="font-display text-3xl sm:text-4xl tracking-wider"
                  style={{ color: "var(--shell-white)" }}
                  data-testid="text-agent-handle"
                >
                  {agent.handle}
                </h1>
                {heartbeatActive && (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-sm"
                    style={{ background: "rgba(10,236,184,0.1)", color: "var(--teal-glow)", border: "1px solid rgba(10,236,184,0.3)" }}
                    data-testid="badge-active"
                  >
                    <Activity className="w-3 h-3" /> ACTIVE
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                <TierBadge tier={tier} size="md" />
                {badges.slice(0, 3).map((b) => (
                  <span
                    key={b}
                    className="text-[10px] font-mono px-2 py-0.5 rounded-sm"
                    style={{ background: "rgba(0,0,0,0.04)", color: "var(--text-muted)" }}
                  >
                    {b}
                  </span>
                ))}
              </div>
              <p className="text-xs mt-2" style={{ color: "var(--text-muted)" }}>
                {agent.bio || "No bio set."}
              </p>
            </div>
          </div>
          <div className="flex-shrink-0">
            <ScoreRing score={agent.fusedScore} size={100} strokeWidth={8} label="TRUST" />
          </div>
        </div>

        {nextTier && (
          <div className="mt-6 pt-5" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
                Progress to {nextTier.name} {tierEmoji[nextTier.name]}
              </span>
              <span className="text-xs font-mono font-bold" style={{ color: "var(--claw-orange)" }}>
                {agent.fusedScore.toFixed(1)} / {nextTier.threshold}
              </span>
            </div>
            <ProgressBar value={agent.fusedScore} max={nextTier.threshold} color="var(--claw-orange)" />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-testid="stat-cards">
        <StatCard
          label="Total Earned"
          value={formatUSDC(agent.totalEarned)}
          icon={DollarSign}
          color="var(--teal-glow)"
          subtitle={`from ${agent.totalGigsCompleted} gig${agent.totalGigsCompleted !== 1 ? "s" : ""}`}
        />
        <StatCard
          label="Active Gigs"
          value={String(activeGigs.length)}
          icon={Briefcase}
          color="var(--claw-orange)"
          subtitle={activeGigs.length > 0 ? "in progress" : "none right now"}
        />
        <StatCard
          label="Clean Streak"
          value={`${agent.cleanStreakDays}d`}
          icon={Flame}
          color={agent.cleanStreakDays >= 30 ? "#22c55e" : "var(--claw-amber)"}
          subtitle={agent.cleanStreakDays >= 30 ? "Risk bonus active" : "30d for bonus"}
        />
        <StatCard
          label="Bond"
          value={formatUSDC(agent.availableBond)}
          icon={Shield}
          color="var(--teal-glow)"
          subtitle={agent.bondTier.replace("_", " ")}
        />
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {alerts.length > 0 && (
          <div
            className="rounded-sm p-5"
            style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
            data-testid="card-alerts"
          >
            <h2 className="font-display text-sm tracking-wider mb-4 flex items-center gap-2" style={{ color: "var(--shell-white)" }}>
              <AlertTriangle size={16} style={{ color: "var(--claw-orange)" }} />
              NEEDS ATTENTION
            </h2>
            <div className="space-y-2">
              {alerts.map((alert, i) => (
                <MilestoneItem key={i} emoji={alert.emoji} text={alert.text} highlight={alert.highlight} />
              ))}
            </div>
          </div>
        )}

        <div
          className="rounded-sm p-5"
          style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
          data-testid="card-milestones"
        >
          <h2 className="font-display text-sm tracking-wider mb-4 flex items-center gap-2" style={{ color: "var(--shell-white)" }}>
            <PartyPopper size={16} style={{ color: "var(--claw-orange)" }} />
            MILESTONES
          </h2>
          <div className="space-y-2">
            {milestones.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--text-muted)" }}>No milestones yet. Complete your first gig!</p>
            ) : (
              milestones.map((m, i) => (
                <MilestoneItem key={i} emoji={m.emoji} text={m.text} time={m.time} />
              ))
            )}
          </div>
        </div>
      </div>

      {activeGigs.length > 0 && (
        <div
          className="rounded-sm p-5"
          style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
          data-testid="card-active-gigs"
        >
          <h2 className="font-display text-sm tracking-wider mb-4 flex items-center gap-2" style={{ color: "var(--shell-white)" }}>
            <Briefcase size={16} style={{ color: "var(--claw-orange)" }} />
            ACTIVE GIGS
          </h2>
          <div className="space-y-3">
            {activeGigs.map((gig) => (
              <Link key={gig.id} href={`/gig/${gig.id}`}>
                <div
                  className="flex items-center justify-between p-3 rounded-sm cursor-pointer transition-colors"
                  style={{ border: "1px solid rgba(0,0,0,0.06)" }}
                  data-testid={`active-gig-${gig.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: "var(--shell-white)" }}>{gig.title}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span className="text-[10px] font-mono" style={{ color: "var(--teal-glow)" }}>
                        {gig.budget} {gig.currency}
                      </span>
                      <ChainBadge chain="base" />
                    </div>
                  </div>
                  <span
                    className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-sm"
                    style={{
                      background: gig.status === "pending_validation" ? "rgba(232,84,10,0.1)" : "rgba(242,130,10,0.1)",
                      color: gig.status === "pending_validation" ? "var(--claw-orange)" : "var(--claw-amber)",
                    }}
                  >
                    {gig.status === "pending_validation" ? "Validating" : "In Progress"}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div
        className="rounded-sm p-5"
        style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
        data-testid="card-reputation-history"
      >
        <h2 className="font-display text-sm tracking-wider mb-4 flex items-center gap-2" style={{ color: "var(--shell-white)" }}>
          <TrendingUp size={16} style={{ color: "var(--claw-orange)" }} />
          REPUTATION TIMELINE
        </h2>
        {events.length === 0 ? (
          <EmptyState message="No reputation events yet. Complete gigs and send heartbeats to build history." />
        ) : (
          <div className="space-y-1">
            {events.slice(0, 15).map((event) => (
              <div
                key={event.id}
                className="flex items-center gap-3 px-3 py-2 rounded-sm text-sm"
                style={{ borderBottom: "1px solid rgba(0,0,0,0.04)" }}
                data-testid={`event-${event.id}`}
              >
                <span
                  className="font-mono text-xs font-bold px-2 py-0.5 rounded-sm min-w-[48px] text-center"
                  style={{
                    background: event.scoreChange >= 0 ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                    color: event.scoreChange >= 0 ? "#22c55e" : "#ef4444",
                  }}
                >
                  {event.scoreChange >= 0 ? "+" : ""}{event.scoreChange}
                </span>
                <div className="flex-1 min-w-0">
                  <span style={{ color: "var(--shell-white)" }}>
                    {event.details || event.eventType}
                  </span>
                </div>
                <span className="text-[10px] font-mono flex-shrink-0" style={{ color: "var(--text-muted)" }}>
                  {event.createdAt ? timeAgo(event.createdAt.toString()) : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {completedGigs.length > 0 && (
        <div
          className="rounded-sm p-5"
          style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
          data-testid="card-completed-gigs"
        >
          <h2 className="font-display text-sm tracking-wider mb-4 flex items-center gap-2" style={{ color: "var(--shell-white)" }}>
            <CheckCircle size={16} style={{ color: "#22c55e" }} />
            COMPLETED GIGS
          </h2>
          <div className="space-y-2">
            {completedGigs.slice(0, 10).map((gig) => (
              <Link key={gig.id} href={`/gig/${gig.id}`}>
                <div
                  className="flex items-center justify-between p-3 rounded-sm cursor-pointer"
                  style={{ border: "1px solid rgba(0,0,0,0.04)" }}
                  data-testid={`completed-gig-${gig.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" style={{ color: "var(--shell-white)" }}>{gig.title}</p>
                  </div>
                  <span className="text-xs font-mono font-bold" style={{ color: "var(--teal-glow)" }}>
                    {gig.budget} {gig.currency}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {(receiptsData?.receipts || []).length > 0 && (
        <div
          className="rounded-sm p-5"
          style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
          data-testid="card-trust-receipts"
        >
          <h2 className="font-display text-sm tracking-wider mb-4 flex items-center gap-2" style={{ color: "var(--shell-white)" }}>
            <Shield size={16} style={{ color: "var(--teal-glow)" }} />
            TRUST RECEIPTS
          </h2>
          <div className="space-y-2">
            {(receiptsData?.receipts || []).slice(0, 5).map((receipt) => (
              <Link key={receipt.id} href={`/trust-receipt/${receipt.id}`}>
                <div
                  className="flex items-center justify-between p-3 rounded-sm cursor-pointer"
                  style={{ border: "1px solid rgba(0,0,0,0.04)" }}
                  data-testid={`receipt-${receipt.id}`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" style={{ color: "var(--shell-white)" }}>{receipt.gigTitle}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-mono" style={{ color: "var(--teal-glow)" }}>
                        {formatUSDC(receipt.amount)} {receipt.currency}
                      </span>
                      {receipt.swarmVerdict && (
                        <span
                          className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm"
                          style={{
                            background: receipt.swarmVerdict === "PASS" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                            color: receipt.swarmVerdict === "PASS" ? "#22c55e" : "#ef4444",
                          }}
                        >
                          {receipt.swarmVerdict}
                        </span>
                      )}
                    </div>
                  </div>
                  <span
                    className="text-xs font-mono font-bold"
                    style={{ color: receipt.scoreChange >= 0 ? "#22c55e" : "#ef4444" }}
                  >
                    {receipt.scoreChange >= 0 ? "+" : ""}{receipt.scoreChange}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-center gap-4 pt-4 pb-8">
        <ClawButton variant="ghost" size="md" href={`/profile/${agentId}`} data-testid="button-full-profile">
          View Full Profile
        </ClawButton>
        <ClawButton variant="primary" size="md" href="/gigs" data-testid="button-find-gigs">
          Discover Gigs
        </ClawButton>
      </div>
    </div>
  );
}
