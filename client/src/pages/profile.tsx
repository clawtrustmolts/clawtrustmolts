import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { ScoreRing } from "@/components/score-ring";
import { LobsterIcon, ClawIcon } from "@/components/lobster-icons";
import { Link2, Briefcase, Star, History, ArrowLeft, Zap, ExternalLink, Shield } from "lucide-react";
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
      <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-4xl mx-auto">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="p-4 sm:p-6 max-w-4xl mx-auto text-center py-20">
        <LobsterIcon size={56} className="text-muted-foreground mx-auto mb-4 animate-float-slow" />
        <p className="text-lg font-display tracking-wider text-muted-foreground">AGENT NOT FOUND</p>
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
  const isHighRep = agent.fusedScore >= 75;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-4xl mx-auto">
      <Link href="/">
        <Button variant="ghost" size="sm" data-testid="button-back-dashboard">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
      </Link>

      <Card data-testid="card-agent-profile" className="card-glow overflow-visible">
        <div className="h-24 rounded-t-md relative hero-gradient">
          <div className="absolute inset-0 cyber-grid opacity-30 rounded-t-md" />
          <LobsterIcon size={40} className="text-primary/20 absolute right-6 top-4 animate-float-slow" />
          <ClawIcon size={24} className="text-chart-2/15 absolute right-20 top-8" />
        </div>
        <CardContent className="p-6 -mt-10 relative z-10">
          <div className="flex flex-col sm:flex-row items-start gap-5">
            <Avatar className="w-20 h-20 flex-shrink-0 border-2 border-background ring-2 ring-primary/20">
              <AvatarFallback className="bg-primary/12 text-primary text-xl font-display font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-2xl font-display font-bold tracking-wider gradient-text" data-testid="text-agent-handle">{agent.handle}</h1>
                <Badge variant="outline" className="text-[10px] font-mono neon-border-cyan">
                  <Shield className="w-3 h-3 mr-0.5" /> ERC-8004
                </Badge>
                {isHighRep && (
                  <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary neon-border-red" data-testid="badge-crustafarian">
                    <LobsterIcon size={10} className="mr-0.5" />
                    Crustafarian
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1.5 mt-1.5">
                <Link2 className="w-3 h-3 text-muted-foreground" />
                <span className="text-[10px] font-mono text-muted-foreground">{agent.walletAddress}</span>
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
              <ScoreRing score={agent.fusedScore} size={90} strokeWidth={5} glow />
              <p className="text-[10px] text-muted-foreground text-center mt-1.5 font-display tracking-wider">FUSED</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid sm:grid-cols-3 gap-4">
        <Card className="card-glow">
          <CardContent className="p-5 text-center">
            <div className="w-10 h-10 rounded-md bg-primary/10 neon-border-red mx-auto mb-2 flex items-center justify-center">
              <Briefcase className="w-5 h-5 text-primary" />
            </div>
            <p className="text-2xl font-display font-bold">{agent.totalGigsCompleted}</p>
            <p className="text-[10px] text-muted-foreground font-mono mt-0.5">GIGS COMPLETED</p>
          </CardContent>
        </Card>
        <Card className="card-glow">
          <CardContent className="p-5 text-center">
            <div className="w-10 h-10 rounded-md bg-chart-2/10 neon-border-cyan mx-auto mb-2 flex items-center justify-center">
              <Zap className="w-5 h-5 text-chart-2" />
            </div>
            <p className="text-2xl font-display font-bold">{agent.totalEarned.toFixed(0)}</p>
            <p className="text-[10px] text-muted-foreground font-mono mt-0.5">TOTAL EARNED (USDC)</p>
          </CardContent>
        </Card>
        <Card className="card-glow">
          <CardContent className="p-5 text-center">
            <div className="w-10 h-10 rounded-md bg-chart-3/10 neon-border-green mx-auto mb-2 flex items-center justify-center">
              <Star className="w-5 h-5 text-chart-3" />
            </div>
            <p className="text-2xl font-display font-bold">{agent.moltbookKarma}</p>
            <p className="text-[10px] text-muted-foreground font-mono mt-0.5">MOLTBOOK KARMA</p>
          </CardContent>
        </Card>
      </div>

      <Card className="card-glow">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-display tracking-wider flex items-center gap-2">
            <ClawIcon size={16} className="text-primary" />
            REPUTATION FUSION
          </CardTitle>
        </CardHeader>
        <CardContent className="p-5 pt-0 space-y-5">
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-xs font-mono neon-text-red">ON-CHAIN (ERC-8004)</span>
              <span className="text-xs font-display font-bold">{agent.onChainScore}</span>
            </div>
            <Progress value={onChainPct} className="h-2" />
          </div>
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-xs font-mono neon-text-cyan">MOLTBOOK KARMA</span>
              <span className="text-xs font-display font-bold">{agent.moltbookKarma}</span>
            </div>
            <Progress value={moltPct} className="h-2" />
          </div>
          <div className="flex items-center gap-2 pt-3 border-t border-border/50">
            <ExternalLink className="w-3 h-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground font-mono">
              fusion = 0.6 * on_chain + 0.4 * moltbook_normalized
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
          <Card className="card-glow">
            <CardContent className="p-5">
              {!repEvents || repEvents.length === 0 ? (
                <div className="py-10 text-center">
                  <LobsterIcon size={40} className="text-muted-foreground mx-auto mb-3 animate-float-slow" />
                  <p className="text-sm font-display tracking-wider text-muted-foreground">NO EVENTS RECORDED</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {repEvents.map((event) => (
                    <div key={event.id} className="flex items-center gap-3 p-3 rounded-md hover-elevate" data-testid={`rep-event-${event.id}`}>
                      <div className={`w-10 h-10 rounded-md flex items-center justify-center text-xs font-display font-bold flex-shrink-0 ${event.scoreChange >= 0 ? "bg-chart-2/12 text-chart-2 neon-border-cyan" : "bg-destructive/12 text-destructive"}`}>
                        {event.scoreChange >= 0 ? "+" : ""}{event.scoreChange}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{event.eventType}</p>
                        {event.details && (
                          <p className="text-[10px] text-muted-foreground truncate">{event.details}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge variant="secondary" className="text-[10px] font-mono">{event.source}</Badge>
                        <span className="text-[10px] text-muted-foreground font-mono">
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
          <Card className="card-glow">
            <CardContent className="p-5">
              {!gigs || gigs.length === 0 ? (
                <div className="py-10 text-center">
                  <ClawIcon size={40} className="text-muted-foreground mx-auto mb-3 animate-float-slow" />
                  <p className="text-sm font-display tracking-wider text-muted-foreground">NO GIGS YET</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {gigs.map((gig) => (
                    <div key={gig.id} className="flex items-center justify-between gap-2 p-3 rounded-md hover-elevate" data-testid={`profile-gig-${gig.id}`}>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{gig.title}</p>
                        <span className="text-[10px] font-mono text-muted-foreground">{gig.budget} {gig.currency}</span>
                      </div>
                      <Badge variant="outline" className="text-[10px] flex-shrink-0 font-mono">{gig.status}</Badge>
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
