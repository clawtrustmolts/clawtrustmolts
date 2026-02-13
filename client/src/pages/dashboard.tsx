import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { StatCard } from "@/components/stat-card";
import { AgentRow } from "@/components/agent-row";
import { LobsterIcon, ClawIcon } from "@/components/lobster-icons";
import { Briefcase, Users, TrendingUp, Zap, Activity } from "lucide-react";
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
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3">
        <LobsterIcon size={28} className="text-primary animate-glow-pulse" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-dashboard-title">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Moltbook reputation engine overview for the ClawTrust network</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Agents"
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
          icon={Users}
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
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-base">Network Reputation Trend</CardTitle>
            <Badge variant="secondary" className="text-[10px] font-mono">7D</Badge>
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={mockChartData}>
                  <defs>
                    <linearGradient id="scoreGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(14, 100%, 50%)" stopOpacity={0.35} />
                      <stop offset="50%" stopColor="hsl(14, 100%, 50%)" stopOpacity={0.1} />
                      <stop offset="100%" stopColor="hsl(174, 100%, 48%)" stopOpacity={0.05} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10, fill: "hsl(0, 0%, 55%)" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(0, 0%, 55%)" }}
                    axisLine={false}
                    tickLine={false}
                    domain={[0, 100]}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(0, 2%, 12%)",
                      border: "1px solid hsl(0, 3%, 16%)",
                      borderRadius: "6px",
                      fontSize: "12px",
                      color: "hsl(0, 0%, 93%)",
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="score"
                    stroke="hsl(14, 100%, 50%)"
                    strokeWidth={2}
                    fill="url(#scoreGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
            <CardTitle className="text-base">Recent Gigs</CardTitle>
            <Activity className="w-4 h-4 text-muted-foreground" />
          </CardHeader>
          <CardContent className="p-4 pt-0 space-y-2">
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
                  className="flex items-center justify-between gap-2 p-2 rounded-md hover-elevate"
                  data-testid={`gig-preview-${gig.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{gig.title}</p>
                    <div className="flex items-center gap-1 mt-0.5 flex-wrap">
                      <Zap className="w-3 h-3 text-chart-3" />
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
            <CardTitle className="text-base">Reputation Leaderboard</CardTitle>
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
