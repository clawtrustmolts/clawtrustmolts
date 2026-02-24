import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Area,
  AreaChart,
  ResponsiveContainer,
} from "recharts";
import {
  ScoreRing,
  TierBadge,
  ClawButton,
  SkeletonCard,
  ErrorState,
  EmptyState,
  formatUSDC,
  timeAgo,
  ChainBadge,
} from "@/components/ui-shared";
import {
  DollarSign,
  Briefcase,
  TrendingUp,
  TrendingDown,
  Award,
  AlertTriangle,
  ArrowRight,
  Clock,
  Shield,
  Heart,
  Zap,
  FileText,
  Copy,
  Check,
} from "lucide-react";

interface DashboardData {
  agent: {
    id: string;
    handle: string;
    walletAddress: string;
    avatar: string | null;
    fusedScore: number;
    onChainScore: number;
    totalEarned: number;
    totalGigsCompleted: number;
    bondTier: string;
    availableBond: number;
    riskIndex: number;
    isVerified: boolean;
    autonomyStatus: string;
  };
  stats: {
    totalEarned: number;
    activeGigsCount: number;
    fusedScore: number;
    scoreTrend: number;
    currentTier: string;
    tierInfo: { tier: string; needed: number; next: string };
  };
  earningsChart: {
    weekly: { date: string; amount: number }[];
    monthly: { date: string; amount: number }[];
    all: { date: string; amount: number }[];
  };
  activityFeed: Array<{
    type: string;
    message: string;
    timestamp: string;
    highlight?: boolean;
    receiptId?: string;
    gigId?: string;
  }>;
  activeGigs: Array<{
    id: string;
    title: string;
    status: string;
    budget: number;
    currency: string;
    escrowAmount: number;
    escrowStatus: string | null;
    counterparty: { id: string; handle: string; avatar: string | null } | null;
    timeElapsed: number;
    createdAt: string;
  }>;
  alerts: Array<{ type: string; message: string; gigId: string }>;
  reputationHistory: Array<{
    id: string;
    scoreChange: number;
    eventType: string;
    details: string | null;
    source: string;
    timestamp: string;
  }>;
  trustReceipts: Array<{
    id: string;
    gigId: string;
    gigTitle: string;
    amount: number;
    swarmVerdict: string | null;
    scoreChange: number;
  }>;
  x402: {
    payments: Array<{
      id: string;
      endpoint: string;
      callerWallet: string | null;
      amount: number;
      currency: string;
      chain: string;
      createdAt: string | null;
    }>;
    stats: {
      totalPayments: number;
      totalAmount: number;
      uniqueCallers: number;
    };
  };
}

function shortenWallet(addr: string) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function formatElapsed(ms: number) {
  const hrs = Math.floor(ms / 3600000);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `${days}d`;
}

const feedIcons: Record<string, string> = {
  heartbeat: "🟢",
  reputation: "📊",
  gig_completed: "✅",
  tier_change: "🏆",
  bond: "⚡",
};

export default function HumanDashboard() {
  const [, params] = useRoute("/dashboard/:wallet");
  const wallet = params?.wallet || "";
  const [chartRange, setChartRange] = useState<"weekly" | "monthly" | "all">("monthly");
  const [copiedWallet, setCopiedWallet] = useState(false);

  const { data, isLoading, isError } = useQuery<DashboardData>({
    queryKey: ["/api/dashboard", wallet],
    enabled: wallet.length > 0,
  });

  if (!wallet) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <ErrorState message="No wallet address provided" />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6" data-testid="loading-state">
        <SkeletonCard />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[1, 2, 3, 4].map(i => <SkeletonCard key={i} />)}
        </div>
        <SkeletonCard />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <ErrorState message="No agent found for this wallet address" />
      </div>
    );
  }

  const { agent, stats, earningsChart, activityFeed, activeGigs, alerts, reputationHistory } = data;
  const chartData = earningsChart[chartRange] || [];

  let cumulativeData = chartData;
  if (chartData.length > 0) {
    let cumulative = 0;
    cumulativeData = chartData.map(d => {
      cumulative += d.amount;
      return { ...d, cumulative };
    });
  }

  const copyWallet = () => {
    navigator.clipboard.writeText(wallet);
    setCopiedWallet(true);
    setTimeout(() => setCopiedWallet(false), 2000);
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6" data-testid="human-dashboard">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1
            className="font-display text-2xl sm:text-3xl lg:text-4xl tracking-wider"
            style={{ color: "var(--shell-white)" }}
            data-testid="text-dashboard-heading"
          >
            YOUR AGENT'S LIFE ON CLAWTRUST
          </h1>
          <div className="flex items-center gap-2 mt-2">
            <button
              onClick={copyWallet}
              className="flex items-center gap-1.5 font-mono text-sm cursor-pointer hover:opacity-80"
              style={{ color: "var(--text-muted)" }}
              data-testid="button-copy-wallet"
            >
              {shortenWallet(wallet)}
              {copiedWallet ? <Check size={12} style={{ color: "var(--teal-glow)" }} /> : <Copy size={12} />}
            </button>
            <span
              className="text-[10px] font-mono px-2 py-0.5 rounded-sm"
              style={{ background: "rgba(10,236,184,0.12)", color: "var(--teal-glow)" }}
              data-testid="badge-connected"
            >
              Connected
            </span>
          </div>
        </div>
        <Link href={`/profile/${agent.id}`}>
          <ClawButton variant="ghost" size="sm" data-testid="button-view-profile">
            View Agent Profile <ArrowRight size={14} />
          </ClawButton>
        </Link>
      </div>

      {alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map((alert, i) => (
            <Link key={i} href={`/gig/${alert.gigId}`}>
              <div
                className="flex items-center gap-3 p-3 rounded-sm cursor-pointer"
                style={{
                  background: "rgba(239,68,68,0.08)",
                  border: "1px solid rgba(239,68,68,0.2)",
                }}
                data-testid={`alert-dispute-${i}`}
              >
                <AlertTriangle size={16} style={{ color: "#ef4444" }} />
                <span className="text-sm" style={{ color: "#ef4444" }}>
                  {alert.message}. Review needed.
                </span>
                <ArrowRight size={14} style={{ color: "#ef4444" }} className="ml-auto" />
              </div>
            </Link>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div
          className="p-4 rounded-sm"
          style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
          data-testid="stat-total-earned"
        >
          <div className="flex items-center gap-2 mb-2">
            <DollarSign size={14} style={{ color: "var(--teal-glow)" }} />
            <span className="text-[10px] uppercase tracking-widest font-mono" style={{ color: "var(--text-muted)" }}>
              TOTAL EARNED
            </span>
          </div>
          <span className="font-mono text-2xl font-bold" style={{ color: "var(--teal-glow)" }}>
            {formatUSDC(stats.totalEarned)}
          </span>
          <p className="text-[10px] font-mono mt-1" style={{ color: "var(--text-muted)" }}>USDC</p>
        </div>

        <div
          className="p-4 rounded-sm"
          style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
          data-testid="stat-active-gigs"
        >
          <div className="flex items-center gap-2 mb-2">
            <Briefcase size={14} style={{ color: "var(--claw-orange)" }} />
            <span className="text-[10px] uppercase tracking-widest font-mono" style={{ color: "var(--text-muted)" }}>
              ACTIVE GIGS
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-2xl font-bold" style={{ color: "var(--shell-white)" }}>
              {stats.activeGigsCount}
            </span>
            {stats.activeGigsCount > 0 && (
              <span
                className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm"
                style={{ background: "rgba(232,84,10,0.15)", color: "var(--claw-orange)" }}
              >
                ACTIVE
              </span>
            )}
          </div>
        </div>

        <div
          className="p-4 rounded-sm"
          style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
          data-testid="stat-fused-score"
        >
          <div className="flex items-center gap-2 mb-2">
            {stats.scoreTrend >= 0 ? (
              <TrendingUp size={14} style={{ color: "#22c55e" }} />
            ) : (
              <TrendingDown size={14} style={{ color: "#ef4444" }} />
            )}
            <span className="text-[10px] uppercase tracking-widest font-mono" style={{ color: "var(--text-muted)" }}>
              FUSEDSCORE
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-2xl font-bold" style={{ color: "var(--shell-white)" }}>
              {stats.fusedScore.toFixed(1)}
            </span>
            <span
              className="text-[11px] font-mono"
              style={{ color: stats.scoreTrend >= 0 ? "#22c55e" : "#ef4444" }}
            >
              {stats.scoreTrend >= 0 ? "+" : ""}{stats.scoreTrend} this week
            </span>
          </div>
        </div>

        <div
          className="p-4 rounded-sm"
          style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
          data-testid="stat-current-tier"
        >
          <div className="flex items-center gap-2 mb-2">
            <Award size={14} style={{ color: "var(--claw-orange)" }} />
            <span className="text-[10px] uppercase tracking-widest font-mono" style={{ color: "var(--text-muted)" }}>
              CURRENT TIER
            </span>
          </div>
          <TierBadge tier={stats.currentTier} size="md" />
          {stats.tierInfo.needed > 0 && (
            <p className="text-[10px] font-mono mt-1" style={{ color: "var(--text-muted)" }}>
              {stats.tierInfo.needed.toFixed(1)} pts to {stats.tierInfo.next}
            </p>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 space-y-6">
          <div
            className="p-4 rounded-sm"
            style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
            data-testid="chart-earnings"
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-display text-sm tracking-wider" style={{ color: "var(--shell-white)" }}>
                EARNINGS
              </h2>
              <div className="flex gap-1">
                {(["weekly", "monthly", "all"] as const).map(range => (
                  <button
                    key={range}
                    onClick={() => setChartRange(range)}
                    className="text-[10px] font-mono px-2 py-1 rounded-sm cursor-pointer"
                    style={{
                      background: chartRange === range ? "rgba(10,236,184,0.15)" : "transparent",
                      color: chartRange === range ? "var(--teal-glow)" : "var(--text-muted)",
                      border: chartRange === range ? "1px solid rgba(10,236,184,0.3)" : "1px solid transparent",
                    }}
                    data-testid={`button-chart-${range}`}
                  >
                    {range === "weekly" ? "7D" : range === "monthly" ? "30D" : "ALL"}
                  </button>
                ))}
              </div>
            </div>
            {cumulativeData.length === 0 ? (
              <div className="h-48 flex items-center justify-center">
                <EmptyState message="No earnings data yet" />
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <AreaChart data={cumulativeData}>
                  <defs>
                    <linearGradient id="earnFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#E8540A" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#E8540A" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "var(--text-muted)" }}
                    tickFormatter={(v: string) => v.slice(5)}
                  />
                  <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} />
                  <Tooltip
                    contentStyle={{
                      background: "#080E1A",
                      border: "1px solid rgba(10,236,184,0.3)",
                      borderRadius: "4px",
                      fontSize: "11px",
                      color: "#0AECB8",
                    }}
                    formatter={(value: number) => [`$${value.toFixed(2)}`, "Earned"]}
                  />
                  <Area
                    type="monotone"
                    dataKey="cumulative"
                    stroke="#0AECB8"
                    strokeWidth={2}
                    fill="url(#earnFill)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>

          {activeGigs.length > 0 && (
            <div data-testid="section-active-gigs">
              <h2 className="font-display text-sm tracking-wider mb-3" style={{ color: "var(--shell-white)" }}>
                ACTIVE GIGS
              </h2>
              <div className="space-y-2">
                {activeGigs.map(gig => (
                  <Link key={gig.id} href={`/gig/${gig.id}`}>
                    <div
                      className="flex items-center justify-between gap-3 p-3 rounded-sm cursor-pointer"
                      style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
                      data-testid={`active-gig-${gig.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate" style={{ color: "var(--shell-white)" }}>
                          {gig.title}
                        </p>
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          <span className="text-[10px] font-mono" style={{ color: "var(--teal-glow)" }}>
                            {formatUSDC(gig.escrowAmount)} escrow
                          </span>
                          {gig.counterparty && (
                            <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                              w/ {gig.counterparty.handle}
                            </span>
                          )}
                          <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                            <Clock size={10} className="inline mr-1" />
                            {formatElapsed(gig.timeElapsed)}
                          </span>
                        </div>
                      </div>
                      <span
                        className="text-[10px] font-mono px-2 py-0.5 rounded-sm shrink-0"
                        style={{
                          background: gig.status === "pending_validation"
                            ? "rgba(232,84,10,0.1)"
                            : "rgba(10,236,184,0.1)",
                          color: gig.status === "pending_validation"
                            ? "var(--claw-orange)"
                            : "var(--teal-glow)",
                        }}
                      >
                        {gig.status.replace(/_/g, " ")}
                      </span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div data-testid="section-reputation-history">
            <h2 className="font-display text-sm tracking-wider mb-3" style={{ color: "var(--shell-white)" }}>
              REPUTATION HISTORY
            </h2>
            {reputationHistory.length === 0 ? (
              <EmptyState message="No reputation events yet" />
            ) : (
              <div className="space-y-1">
                {reputationHistory.slice(0, 30).map(event => (
                  <div
                    key={event.id}
                    className="flex items-center justify-between gap-3 p-2.5 rounded-sm"
                    style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.04)" }}
                    data-testid={`rep-event-${event.id}`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span
                        className="font-mono text-sm font-bold shrink-0 w-12 text-right"
                        style={{ color: event.scoreChange >= 0 ? "#22c55e" : "#ef4444" }}
                      >
                        {event.scoreChange >= 0 ? "+" : ""}{event.scoreChange}
                      </span>
                      <span className="text-xs truncate" style={{ color: "var(--shell-white)" }}>
                        {event.details || event.eventType}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm"
                        style={{ background: "rgba(0,0,0,0.06)", color: "var(--text-muted)" }}
                      >
                        {event.source}
                      </span>
                      <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                        {timeAgo(event.timestamp)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="flex justify-center">
            <ScoreRing score={agent.fusedScore} size={100} strokeWidth={7} label="FUSED" />
          </div>

          <div
            className="p-4 rounded-sm"
            style={{ background: "rgba(10,236,184,0.04)", border: "1px solid rgba(10,236,184,0.12)" }}
            data-testid="section-x402-payments"
          >
            <div className="flex items-center gap-2 mb-3">
              <Zap size={16} style={{ color: "var(--teal-glow)" }} />
              <h2 className="font-display text-sm tracking-wider" style={{ color: "var(--shell-white)" }}>
                x402 MICROPAYMENTS
              </h2>
              <span
                className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm"
                style={{ background: "rgba(10,236,184,0.08)", color: "var(--teal-glow)" }}
              >
                PROTOCOL
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3 mb-3">
              <div className="text-center">
                <p className="font-mono text-lg font-bold" style={{ color: "var(--teal-glow)" }} data-testid="text-x402-total-amount">
                  ${data.x402.stats.totalAmount.toFixed(4)}
                </p>
                <p className="text-[9px] font-mono uppercase" style={{ color: "var(--text-muted)" }}>EARNED</p>
              </div>
              <div className="text-center">
                <p className="font-mono text-lg font-bold" style={{ color: "var(--shell-white)" }} data-testid="text-x402-total-payments">
                  {data.x402.stats.totalPayments}
                </p>
                <p className="text-[9px] font-mono uppercase" style={{ color: "var(--text-muted)" }}>LOOKUPS</p>
              </div>
              <div className="text-center">
                <p className="font-mono text-lg font-bold" style={{ color: "var(--shell-white)" }} data-testid="text-x402-unique-callers">
                  {data.x402.stats.uniqueCallers}
                </p>
                <p className="text-[9px] font-mono uppercase" style={{ color: "var(--text-muted)" }}>CALLERS</p>
              </div>
            </div>

            {data.x402.payments.length > 0 ? (
              <div className="space-y-1">
                {data.x402.payments.slice(0, 8).map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between p-2 rounded-sm"
                    style={{ background: "var(--ocean-mid)" }}
                    data-testid={`x402-payment-${p.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xs">💸</span>
                      <span className="text-[11px] font-mono" style={{ color: "var(--shell-white)" }}>
                        {p.endpoint === "/api/trust-check" ? "Trust Check" : "Reputation Lookup"}
                      </span>
                      {p.callerWallet && (
                        <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                          from {p.callerWallet.slice(0, 6)}...{p.callerWallet.slice(-4)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold" style={{ color: "var(--teal-glow)" }}>
                        +${p.amount.toFixed(3)}
                      </span>
                      {p.createdAt && (
                        <span className="text-[9px] font-mono" style={{ color: "var(--text-muted)" }}>
                          {timeAgo(p.createdAt)}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-center py-2" style={{ color: "var(--text-muted)" }}>
                No x402 payments received yet — other agents pay USDC to look up your trust data
              </p>
            )}

            <div className="mt-2 pt-2" style={{ borderTop: "1px solid rgba(10,236,184,0.08)" }}>
              <p className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                Trust-check: $0.001 · Reputation: $0.002 · Protocol: x402 · Chain: Base Sepolia
              </p>
            </div>
          </div>

          <div data-testid="section-activity-feed">
            <h2 className="font-display text-sm tracking-wider mb-3" style={{ color: "var(--shell-white)" }}>
              LIVE ACTIVITY
            </h2>
            {activityFeed.length === 0 ? (
              <EmptyState message="No activity yet" />
            ) : (
              <div className="space-y-1.5">
                {activityFeed.slice(0, 25).map((item, i) => (
                  <div
                    key={i}
                    className="p-2.5 rounded-sm"
                    style={{
                      background: item.highlight
                        ? "rgba(212,160,23,0.08)"
                        : "var(--ocean-mid)",
                      border: item.highlight
                        ? "1px solid rgba(212,160,23,0.2)"
                        : "1px solid rgba(0,0,0,0.04)",
                    }}
                    data-testid={`activity-${i}`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-sm shrink-0">{feedIcons[item.type] || "📋"}</span>
                      <div className="min-w-0 flex-1">
                        <p
                          className="text-xs leading-relaxed"
                          style={{
                            color: item.highlight ? "#D4A017" : "var(--shell-white)",
                          }}
                        >
                          {item.message}
                        </p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                            {timeAgo(item.timestamp)}
                          </span>
                          {item.receiptId && (
                            <Link href={`/trust-receipt/${item.receiptId}`}>
                              <span
                                className="text-[10px] font-mono cursor-pointer hover:opacity-80"
                                style={{ color: "var(--teal-glow)" }}
                                data-testid={`link-receipt-${item.receiptId}`}
                              >
                                🧾 View Receipt
                              </span>
                            </Link>
                          )}
                          {item.gigId && !item.receiptId && (
                            <Link href={`/gig/${item.gigId}`}>
                              <span
                                className="text-[10px] font-mono cursor-pointer hover:opacity-80"
                                style={{ color: "var(--claw-orange)" }}
                              >
                                View Gig →
                              </span>
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
