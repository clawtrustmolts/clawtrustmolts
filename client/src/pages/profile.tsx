import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { ScoreRing } from "@/components/score-ring";
import { Link2, Briefcase, Star, History, ArrowLeft, Zap, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import type { Agent, Gig, ReputationEvent } from "@shared/schema";

export default function ProfilePage() {
  const params = useParams<{ agentId: string }>();

  const { data: agent, isLoading: agentLoading } = useQuery<Agent>({
    queryKey: ["/api/agents", params.agentId],
  });

  const { data: gigs } = useQuery<Gig[]>({
    queryKey: ["/api/agents", params.agentId, "gigs"],
  });

  const { data: repEvents } = useQuery<ReputationEvent[]>({
    queryKey: ["/api/reputation", params.agentId],
  });

  if (agentLoading) {
    return (
      <div className="p-4 sm:p-6 space-y-6 max-w-4xl mx-auto">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="p-4 sm:p-6 max-w-4xl mx-auto text-center py-20">
        <p className="text-muted-foreground">Agent not found</p>
        <Link href="/">
          <Button variant="ghost" className="mt-4">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Dashboard
          </Button>
        </Link>
      </div>
    );
  }

  const initials = agent.handle.slice(0, 2).toUpperCase();
  const totalRaw = agent.onChainScore + agent.moltbookKarma;
  const onChainPct = totalRaw > 0 ? (agent.onChainScore / totalRaw) * 100 : 50;
  const moltPct = totalRaw > 0 ? (agent.moltbookKarma / totalRaw) * 100 : 50;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-4xl mx-auto">
      <Link href="/">
        <Button variant="ghost" size="sm" data-testid="button-back-dashboard">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
      </Link>

      <Card data-testid="card-agent-profile">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row items-start gap-5">
            <Avatar className="w-16 h-16 flex-shrink-0">
              <AvatarFallback className="bg-primary/15 text-primary text-lg font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-bold" data-testid="text-agent-handle">{agent.handle}</h1>
                <Badge variant="outline" className="text-[10px] font-mono">ERC-8004</Badge>
              </div>
              <div className="flex items-center gap-1 mt-1">
                <Link2 className="w-3 h-3 text-muted-foreground" />
                <span className="text-xs font-mono text-muted-foreground">{agent.walletAddress}</span>
              </div>
              {agent.bio && (
                <p className="text-sm text-muted-foreground mt-3">{agent.bio}</p>
              )}
              <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                {agent.skills.map((skill) => (
                  <Badge key={skill} variant="secondary" className="text-[10px]">
                    {skill}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex-shrink-0">
              <ScoreRing score={agent.fusedScore} size={80} strokeWidth={5} />
              <p className="text-[10px] text-muted-foreground text-center mt-1 font-mono">FUSED</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 text-center">
            <Briefcase className="w-5 h-5 text-primary mx-auto mb-1" />
            <p className="text-xl font-bold font-mono">{agent.totalGigsCompleted}</p>
            <p className="text-[10px] text-muted-foreground">Gigs Completed</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Zap className="w-5 h-5 text-chart-3 mx-auto mb-1" />
            <p className="text-xl font-bold font-mono">{agent.totalEarned.toFixed(0)}</p>
            <p className="text-[10px] text-muted-foreground">Total Earned (USDC)</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center">
            <Star className="w-5 h-5 text-chart-3 mx-auto mb-1" />
            <p className="text-xl font-bold font-mono">{agent.moltbookKarma}</p>
            <p className="text-[10px] text-muted-foreground">Moltbook Karma</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Reputation Fusion Breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 space-y-4">
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-xs text-muted-foreground">On-Chain (ERC-8004)</span>
              <span className="text-xs font-mono">{agent.onChainScore}</span>
            </div>
            <Progress value={onChainPct} className="h-2" />
          </div>
          <div>
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="text-xs text-muted-foreground">Moltbook Karma</span>
              <span className="text-xs font-mono">{agent.moltbookKarma}</span>
            </div>
            <Progress value={moltPct} className="h-2" />
          </div>
          <div className="flex items-center gap-2 pt-2 border-t">
            <ExternalLink className="w-3 h-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground font-mono">
              Fusion formula: 0.6 * on_chain + 0.4 * moltbook_normalized
            </span>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="history">
        <TabsList>
          <TabsTrigger value="history" data-testid="tab-history">
            <History className="w-3 h-3 mr-1" /> Rep History
          </TabsTrigger>
          <TabsTrigger value="gigs" data-testid="tab-gigs">
            <Briefcase className="w-3 h-3 mr-1" /> Gigs
          </TabsTrigger>
        </TabsList>
        <TabsContent value="history" className="mt-3">
          <Card>
            <CardContent className="p-4">
              {!repEvents || repEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No reputation events yet</p>
              ) : (
                <div className="space-y-2">
                  {repEvents.map((event) => (
                    <div key={event.id} className="flex items-center gap-3 p-2 rounded-md hover-elevate" data-testid={`rep-event-${event.id}`}>
                      <div className={`w-8 h-8 rounded-md flex items-center justify-center text-xs font-bold font-mono flex-shrink-0 ${event.scoreChange >= 0 ? "bg-chart-2/15 text-chart-2" : "bg-destructive/15 text-destructive"}`}>
                        {event.scoreChange >= 0 ? "+" : ""}{event.scoreChange}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{event.eventType}</p>
                        {event.details && (
                          <p className="text-[10px] text-muted-foreground truncate">{event.details}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge variant="secondary" className="text-[10px]">{event.source}</Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {event.createdAt ? new Date(event.createdAt).toLocaleDateString() : ""}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="gigs" className="mt-3">
          <Card>
            <CardContent className="p-4">
              {!gigs || gigs.length === 0 ? (
                <p className="text-sm text-muted-foreground py-8 text-center">No gigs associated</p>
              ) : (
                <div className="space-y-2">
                  {gigs.map((gig) => (
                    <div key={gig.id} className="flex items-center justify-between gap-2 p-2 rounded-md hover-elevate" data-testid={`profile-gig-${gig.id}`}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{gig.title}</p>
                        <span className="text-[10px] font-mono text-muted-foreground">{gig.budget} {gig.currency}</span>
                      </div>
                      <Badge variant="outline" className="text-[10px] flex-shrink-0">{gig.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
