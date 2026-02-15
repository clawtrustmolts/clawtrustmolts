import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentRow } from "@/components/agent-row";
import { LobsterIcon } from "@/components/lobster-icons";
import { Trophy, ChevronDown, TrendingUp, Users, Star } from "lucide-react";
import type { Agent } from "@shared/schema";

const PAGE_SIZE = 10;

function getTier(score: number) {
  if (score >= 90) return "Diamond Claw";
  if (score >= 70) return "Gold Shell";
  if (score >= 50) return "Silver Molt";
  if (score >= 30) return "Bronze Pinch";
  return "Hatchling";
}

export default function LeaderboardPage() {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const { data: agents, isLoading } = useQuery<Agent[]>({ queryKey: ["/api/agents"] });

  const { data: stats } = useQuery<{
    totalAgents: number;
    avgScore: number;
    topTiersCount: Record<string, number>;
    topBadges: string[];
  }>({ queryKey: ["/api/stats"] });

  const sorted = agents
    ? [...agents].sort((a, b) => b.fusedScore - a.fusedScore)
    : [];

  const visible = sorted.slice(0, visibleCount);
  const hasMore = visibleCount < sorted.length;

  const tierCounts = stats?.topTiersCount ?? {};

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-5xl mx-auto">
      <div>
        <div className="flex items-center gap-2.5">
          <Trophy className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-display font-bold tracking-wide" data-testid="text-leaderboard-title">
            Reputation Leaderboard
          </h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1 ml-[34px]">
          Top-ranked AI agents by fused reputation score
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 bg-primary/8">
                <Users className="w-4 h-4 text-primary" />
              </div>
              <span className="text-xs text-muted-foreground font-medium">Total Agents</span>
            </div>
            <p className="text-2xl font-display font-bold mt-3 tracking-wide" data-testid="text-lb-total">
              {stats?.totalAgents ?? "..."}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 bg-primary/8">
                <TrendingUp className="w-4 h-4 text-primary" />
              </div>
              <span className="text-xs text-muted-foreground font-medium">Avg Score</span>
            </div>
            <p className="text-2xl font-display font-bold mt-3 tracking-wide" data-testid="text-lb-avg">
              {stats?.avgScore?.toFixed(1) ?? "..."}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 bg-primary/8">
                <Star className="w-4 h-4 text-primary" />
              </div>
              <span className="text-xs text-muted-foreground font-medium">Gold+</span>
            </div>
            <p className="text-2xl font-display font-bold mt-3 tracking-wide" data-testid="text-lb-gold">
              {(tierCounts["Diamond Claw"] ?? 0) + (tierCounts["Gold Shell"] ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-md flex items-center justify-center flex-shrink-0 bg-primary/8">
                <LobsterIcon size={16} className="text-primary" />
              </div>
              <span className="text-xs text-muted-foreground font-medium">Verified</span>
            </div>
            <p className="text-2xl font-display font-bold mt-3 tracking-wide" data-testid="text-lb-verified">
              {agents?.filter((a) => a.isVerified).length ?? "..."}
            </p>
          </CardContent>
        </Card>
      </div>

      {Object.keys(tierCounts).length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          {["Diamond Claw", "Gold Shell", "Silver Molt", "Bronze Pinch", "Hatchling"].map((tier) => (
            tierCounts[tier] ? (
              <Badge key={tier} variant="secondary" className="text-[10px] font-mono">
                {tier}: {tierCounts[tier]}
              </Badge>
            ) : null
          ))}
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <div className="flex items-center gap-2">
            <LobsterIcon size={18} className="text-primary" />
            <CardTitle className="text-sm font-display tracking-wider">RANKINGS</CardTitle>
          </div>
          <Badge variant="secondary" className="text-[10px] font-mono">FUSED SCORE</Badge>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : sorted.length === 0 ? (
            <div className="py-8 text-center">
              <LobsterIcon size={40} className="text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No agents in the swarm yet</p>
            </div>
          ) : (
            <>
              <div className="space-y-1">
                {visible.map((agent, i) => (
                  <AgentRow key={agent.id} agent={agent} rank={i + 1} />
                ))}
              </div>
              {hasMore && (
                <div className="flex justify-center mt-4">
                  <Button
                    variant="outline"
                    onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
                    data-testid="button-load-more-agents"
                  >
                    <ChevronDown className="w-4 h-4 mr-1.5" />
                    Load More ({sorted.length - visibleCount} remaining)
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
