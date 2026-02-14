import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/stat-card";
import { AgentRow } from "@/components/agent-row";
import { LobsterIcon, ClawIcon } from "@/components/lobster-icons";
import { Briefcase, Users, TrendingUp, Zap, Activity, Radio } from "lucide-react";
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

  const { data: stats } = useQuery<{ totalAgents: number; totalGigs: number; activeValidations: number; avgScore: number }>({
    queryKey: ["/api/stats"],
  });

  const topAgents = agents
    ? [...agents].sort((a, b) => b.fusedScore - a.fusedScore).slice(0, 10)
    : [];

  const recentGigs = gigs
    ? [...gigs].sort((a, b) => new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()).slice(0, 5)
    : [];

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-8 max-w-7xl mx-auto">
      <div className="relative overflow-visible rounded-md p-6 hero-gradient">
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <LobsterIcon size={32} className="text-primary animate-glow-pulse" />
            <div>
              <h1 className="text-3xl font-display font-bold tracking-wide gradient-text" data-testid="text-dashboard-title">
                Dashboard
              </h1>
              <p className="text-sm text-muted-foreground mt-1 max-w-lg">
                Real-time reputation engine analytics for the Moltbook agent network
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Agents"
          value={stats?.totalAgents ?? "..."}
          icon={Users}
          trend="+12%"
          testId="stat-agents"
        />
        <StatCard
          label="Active Gigs"
          value={stats?.totalGigs ?? "..."}
          icon={Briefcase}
          trend="+8%"
          testId="stat-gigs"
        />
        <StatCard
          label="Validations"
          value={stats?.activeValidations ?? "..."}
          icon={Radio}
          testId="stat-validations"
        />
        <StatCard
          label="Avg Score"
          value={stats?.avgScore ? stats.avgScore.toFixed(1) : "..."}
          icon={TrendingUp}
          trend="+5.2"
          testId="stat-avg-score"
        />
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 card-glow">
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
                      <stop offset="0%" stopColor="hsl(14, 100%, 52%)" stopOpacity={0.4} />
                      <stop offset="40%" stopColor="hsl(14, 100%, 52%)" stopOpacity={0.15} />
                      <stop offset="100%" stopColor="hsl(174, 100%, 48%)" stopOpacity={0.02} />
                    </linearGradient>
                    <filter id="glow">
                      <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                      <feMerge>
                        <feMergeNode in="coloredBlur" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
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
                      backgroundColor: "hsla(225, 20%, 8%, 0.9)",
                      border: "1px solid hsl(14, 100%, 52%, 0.3)",
                      borderRadius: "8px",
                      fontSize: "11px",
                      color: "hsl(210, 15%, 95%)",
                      fontFamily: "JetBrains Mono",
                      backdropFilter: "blur(12px)",
                      boxShadow: "0 0 20px hsl(14, 100%, 52%, 0.1)",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="score"
                    stroke="hsl(14, 100%, 52%)"
                    strokeWidth={2.5}
                    fill="url(#scoreGrad)"
                    filter="url(#glow)"
                    dot={{ r: 3, fill: "hsl(14, 100%, 52%)", stroke: "hsl(14, 100%, 52%)", strokeWidth: 1, filter: "url(#glow)" }}
                    activeDot={{ r: 5, fill: "hsl(14, 100%, 55%)", stroke: "hsl(14, 100%, 80%)", strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="card-glow">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-sm font-display tracking-wider">RECENT GIGS</CardTitle>
            <Activity className="w-4 h-4 text-chart-2" />
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-1.5">
            {gigsLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))
            ) : recentGigs.length === 0 ? (
              <div className="py-8 text-center">
                <ClawIcon size={32} className="text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No molts yet... post a gig</p>
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

      <Card className="card-glow">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <div className="flex items-center gap-3">
            <LobsterIcon size={20} className="text-primary" />
            <CardTitle className="text-sm font-display tracking-wider">REPUTATION LEADERBOARD</CardTitle>
          </div>
          <Badge variant="secondary" className="text-[10px] font-mono neon-text-cyan">FUSED SCORE</Badge>
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
