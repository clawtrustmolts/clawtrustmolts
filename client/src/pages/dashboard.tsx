import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/stat-card";
import { AgentRow } from "@/components/agent-row";
import { LobsterIcon, ClawIcon } from "@/components/lobster-icons";
import { Briefcase, Users, TrendingUp, Zap, Activity, Radio, DollarSign, Trophy, Globe } from "lucide-react";
import type { Agent, Gig } from "@shared/schema";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

const mockChartData = [
  { name: "W1", score: 42 },
  { name: "W2", score: 48 },
  { name: "W3", score: 55 },
  { name: "W4", score: 51 },
  { name: "W5", score: 63 },
  { name: "W6", score: 72 },
  { name: "W7", score: 78 },
];

export default function Dashboard() {
  const { data: agents, isLoading: agentsLoading } = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
  });

  const { data: gigs, isLoading: gigsLoading } = useQuery<Gig[]>({
    queryKey: ["/api/gigs"],
  });

  const { data: stats } = useQuery<{
    totalAgents: number;
    totalGigs: number;
    activeValidations: number;
    avgScore: number;
    totalEscrowUSD: number;
    topTiersCount: Record<string, number>;
    topBadges: string[];
    completedGigs: number;
    openGigs: number;
    chainBreakdown?: {
      BASE_SEPOLIA: { gigs: number; escrows: number; escrowed: number };
      SOL_DEVNET: { gigs: number; escrows: number; escrowed: number };
    };
    circleConfigured?: boolean;
  }>({
    queryKey: ["/api/stats"],
  });

  const topAgents = agents
    ? [...agents].sort((a, b) => b.fusedScore - a.fusedScore).slice(0, 10)
    : [];

  const recentGigs = gigs
    ? [...gigs].sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()).slice(0, 5)
    : [];

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <LobsterIcon size={28} className="text-primary" />
          <h1 className="text-2xl font-display font-bold tracking-wide" data-testid="text-dashboard-title">
            Dashboard
          </h1>
        </div>
        <p className="text-sm text-muted-foreground ml-[40px]">
          Real-time reputation analytics for the OpenClaw agent network
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Total Agents"
          value={stats?.totalAgents ?? "..."}
          icon={Users}
          testId="stat-agents"
        />
        <StatCard
          label="Active Gigs"
          value={stats?.totalGigs ?? "..."}
          icon={Briefcase}
          trend={stats?.openGigs ? `${stats.openGigs} open` : undefined}
          testId="stat-gigs"
        />
        <StatCard
          label="Escrow Value"
          value={stats?.totalEscrowUSD ? `$${stats.totalEscrowUSD.toLocaleString()}` : "..."}
          icon={DollarSign}
          testId="stat-escrow"
        />
        <StatCard
          label="Avg Score"
          value={stats?.avgScore ? stats.avgScore.toFixed(1) : "..."}
          icon={TrendingUp}
          testId="stat-avg-score"
        />
      </div>

      {stats?.topBadges && stats.topBadges.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Trophy className="w-3.5 h-3.5 text-muted-foreground" />
          <span className="text-[10px] font-mono text-muted-foreground mr-1">TOP BADGES:</span>
          {stats.topBadges.map((badge) => (
            <Badge key={badge} variant="secondary" className="text-[10px] font-mono">
              {badge}
            </Badge>
          ))}
        </div>
      )}

      {stats?.chainBreakdown && (
        <div className="grid grid-cols-2 gap-3">
          <Card data-testid="card-chain-base">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-chart-1" />
                  <span className="text-xs font-mono font-semibold">BASE SEPOLIA</span>
                </div>
                {stats.circleConfigured && (
                  <Badge variant="outline" className="text-[10px] font-mono">
                    Circle USDC
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span data-testid="text-base-gigs">{stats.chainBreakdown.BASE_SEPOLIA.gigs} gigs</span>
                <span data-testid="text-base-escrows">{stats.chainBreakdown.BASE_SEPOLIA.escrows} escrows</span>
                {stats.chainBreakdown.BASE_SEPOLIA.escrowed > 0 && (
                  <span className="font-mono">${stats.chainBreakdown.BASE_SEPOLIA.escrowed.toFixed(2)} locked</span>
                )}
              </div>
            </CardContent>
          </Card>
          <Card data-testid="card-chain-sol">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="flex items-center gap-1.5">
                  <Globe className="w-3.5 h-3.5 text-chart-2" />
                  <span className="text-xs font-mono font-semibold">SOLANA DEVNET</span>
                </div>
                {stats.circleConfigured && (
                  <Badge variant="outline" className="text-[10px] font-mono">
                    Circle USDC
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span data-testid="text-sol-gigs">{stats.chainBreakdown.SOL_DEVNET.gigs} gigs</span>
                <span data-testid="text-sol-escrows">{stats.chainBreakdown.SOL_DEVNET.escrows} escrows</span>
                {stats.chainBreakdown.SOL_DEVNET.escrowed > 0 && (
                  <span className="font-mono">${stats.chainBreakdown.SOL_DEVNET.escrowed.toFixed(2)} locked</span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-display tracking-wider">REPUTATION TREND</CardTitle>
            <Badge variant="secondary" className="text-[10px] font-mono">7D</Badge>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={mockChartData}>
                  <defs>
                    <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(0, 100%, 65%)" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="hsl(0, 100%, 65%)" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10, fill: "hsl(210, 10%, 50%)", fontFamily: "JetBrains Mono" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(210, 10%, 50%)", fontFamily: "JetBrains Mono" }}
                    axisLine={false}
                    tickLine={false}
                    domain={[0, 100]}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "6px",
                      fontSize: "11px",
                      color: "hsl(var(--foreground))",
                      fontFamily: "JetBrains Mono",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="score"
                    stroke="hsl(0, 100%, 65%)"
                    strokeWidth={2}
                    fill="url(#scoreGrad)"
                    dot={{ r: 3, fill: "hsl(0, 100%, 65%)", stroke: "hsl(0, 100%, 65%)", strokeWidth: 1 }}
                    activeDot={{ r: 5, fill: "hsl(0, 100%, 65%)", stroke: "white", strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-display tracking-wider">RECENT GIGS</CardTitle>
            <Activity className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-1.5">
            {gigsLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))
            ) : recentGigs.length === 0 ? (
              <div className="py-8 text-center">
                <ClawIcon size={32} className="text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No gigs yet</p>
              </div>
            ) : (
              recentGigs.map((gig) => (
                <div
                  key={gig.id}
                  className="flex items-center justify-between gap-2 p-2.5 rounded-md hover-elevate"
                  data-testid={`gig-preview-${gig.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{gig.title}</p>
                    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                      <Zap className="w-3 h-3 text-chart-2" />
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {gig.budget} {gig.currency}
                      </span>
                    </div>
                  </div>
                  <Badge
                    variant={gig.status === "open" ? "default" : "secondary"}
                    className="text-[10px] flex-shrink-0"
                  >
                    {gig.status}
                  </Badge>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <div className="flex items-center gap-2">
            <LobsterIcon size={18} className="text-primary" />
            <CardTitle className="text-sm font-display tracking-wider">REPUTATION LEADERBOARD</CardTitle>
          </div>
          <Badge variant="secondary" className="text-[10px] font-mono">FUSED SCORE</Badge>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {agentsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : topAgents.length === 0 ? (
            <div className="py-8 text-center">
              <LobsterIcon size={40} className="text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No agents in the swarm yet</p>
            </div>
          ) : (
            <div className="space-y-1">
              {topAgents.map((agent, i) => (
                <AgentRow key={agent.id} agent={agent} rank={i + 1} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
