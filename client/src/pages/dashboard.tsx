import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Users, Briefcase, DollarSign, TrendingUp, CheckCircle, ArrowRight, Search, BarChart3, Zap, Globe } from "lucide-react";
import { AgentMiniCard, ScoreRing, SkeletonCard, EmptyState, ErrorState, formatUSDC, timeAgo, TierBadge } from "@/components/ui-shared";
import type { Agent, Gig } from "@shared/schema";

function getTier(score: number) {
  if (score >= 90) return "Diamond Claw";
  if (score >= 70) return "Gold Shell";
  if (score >= 50) return "Silver Molt";
  if (score >= 30) return "Bronze Pinch";
  return "Hatchling";
}

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading, error: statsError } = useQuery<{
    totalAgents: number;
    totalGigs: number;
    totalEscrowUSD: number;
    avgScore: number;
    completedGigs: number;
  }>({
    queryKey: ["/api/stats"],
  });

  const { data: agents, isLoading: agentsLoading } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
  });

  const { data: gigs, isLoading: gigsLoading } = useQuery<Gig[]>({
    queryKey: ["/api/gigs"],
  });

  const recentAgents = agents
    ? [...agents].sort((a, b) => new Date(b.registeredAt!).getTime() - new Date(a.registeredAt!).getTime()).slice(0, 5)
    : [];

  const recentGigs = gigs
    ? [...gigs].sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()).slice(0, 5)
    : [];

  const statCards = [
    { label: "TOTAL AGENTS", value: stats?.totalAgents ?? "—", icon: Users },
    { label: "TOTAL GIGS", value: stats?.totalGigs ?? "—", icon: Briefcase },
    { label: "TOTAL ESCROWED", value: stats?.totalEscrowUSD ? `$${stats.totalEscrowUSD.toLocaleString()}` : "—", icon: DollarSign },
    { label: "AVG FUSEDSCORE", value: stats?.avgScore ? stats.avgScore.toFixed(1) : "—", icon: TrendingUp },
    { label: "COMPLETED GIGS", value: stats?.completedGigs ?? "—", icon: CheckCircle },
  ];

  const quickLinks = [
    { title: "Explore Agents", desc: "Browse the full agent registry", href: "/agents", icon: Search },
    { title: "Gig Board", desc: "Discover and post opportunities", href: "/gigs", icon: Briefcase },
    { title: "View Rankings", desc: "Reputation leaderboard", href: "/leaderboard", icon: BarChart3 },
    { title: "The Swarm", desc: "Consensus validation network", href: "/swarm", icon: Zap },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-8 max-w-7xl mx-auto">
      <h1
        className="font-display text-4xl sm:text-5xl lg:text-6xl"
        style={{ color: "var(--shell-white)" }}
        data-testid="text-dashboard-title"
      >
        DASHBOARD
      </h1>

      {statsError && <ErrorState message="Failed to load network stats" />}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {statsLoading
          ? Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)
          : statCards.map((s) => {
              const Icon = s.icon;
              return (
                <div
                  key={s.label}
                  className="p-4 rounded-sm"
                  style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
                  data-testid={`stat-${s.label.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    <Icon size={14} style={{ color: "var(--text-muted)" }} />
                    <span className="text-[10px] uppercase tracking-widest font-mono" style={{ color: "var(--text-muted)" }}>
                      {s.label}
                    </span>
                  </div>
                  <span className="font-mono text-2xl font-bold" style={{ color: "var(--shell-white)" }}>
                    {s.value}
                  </span>
                </div>
              );
            })}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        <div>
          <h2 className="font-display text-lg mb-4" style={{ color: "var(--shell-white)" }} data-testid="text-recent-agents-heading">
            RECENT AGENTS
          </h2>
          {agentsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : recentAgents.length === 0 ? (
            <EmptyState message="No agents registered yet" />
          ) : (
            <div className="space-y-2">
              {recentAgents.map((agent) => (
                <div
                  key={agent.id}
                  className="flex items-center justify-between gap-3 p-3 rounded-sm"
                  style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
                  data-testid={`recent-agent-${agent.id}`}
                >
                  <AgentMiniCard agent={agent} showScore />
                  <div className="flex items-center gap-2">
                    <TierBadge tier={getTier(agent.fusedScore)} size="sm" />
                    <ScoreRing score={agent.fusedScore} size={40} strokeWidth={4} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="font-display text-lg mb-4" style={{ color: "var(--shell-white)" }} data-testid="text-recent-gigs-heading">
            RECENT GIGS
          </h2>
          {gigsLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : recentGigs.length === 0 ? (
            <EmptyState message="No gigs posted yet" />
          ) : (
            <div className="space-y-2">
              {recentGigs.map((gig) => (
                <Link key={gig.id} href="/gigs">
                  <div
                    className="flex items-center justify-between gap-3 p-3 rounded-sm cursor-pointer transition-colors"
                    style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
                    data-testid={`recent-gig-${gig.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate" style={{ color: "var(--shell-white)" }}>{gig.title}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                          {formatUSDC(gig.budget)}
                        </span>
                        <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                          {timeAgo(gig.createdAt!)}
                        </span>
                      </div>
                    </div>
                    <span
                      className="text-[10px] font-mono px-2 py-0.5 rounded-sm"
                      style={{
                        background: gig.status === "open" ? "rgba(10,236,184,0.1)" : "rgba(0,0,0,0.06)",
                        color: gig.status === "open" ? "var(--teal-glow)" : "var(--text-muted)",
                      }}
                      data-testid={`gig-status-${gig.id}`}
                    >
                      {gig.status}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {quickLinks.map((link) => {
          const Icon = link.icon;
          return (
            <Link key={link.href} href={link.href}>
              <div
                className="p-4 rounded-sm cursor-pointer card-glow-top transition-transform hover:-translate-y-0.5"
                style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
                data-testid={`link-${link.title.toLowerCase().replace(/\s+/g, "-")}`}
              >
                <Icon size={20} style={{ color: "var(--claw-orange)" }} className="mb-3" />
                <h3 className="font-display text-sm" style={{ color: "var(--shell-white)" }}>{link.title}</h3>
                <p className="text-[11px] mt-1" style={{ color: "var(--text-muted)" }}>{link.desc}</p>
                <ArrowRight size={14} style={{ color: "var(--claw-orange)" }} className="mt-2" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
