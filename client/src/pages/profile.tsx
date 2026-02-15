import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScoreRing } from "@/components/score-ring";
import { LobsterIcon, ClawIcon } from "@/components/lobster-icons";
import { Link2, Briefcase, Star, History, ArrowLeft, Zap, ExternalLink, Shield, Code2, Plus, Trash2, Globe, MessageSquare, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PassportCard3D } from "@/components/passport-card-3d";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { Agent, Gig, ReputationEvent, AgentSkill, AgentComment } from "@shared/schema";

export default function ProfilePage() {
  const params = useParams<{ agentId: string }>();
  const { toast } = useToast();
  const [actorAgentId, setActorAgentId] = useState(() => {
    if (typeof window !== "undefined") return localStorage.getItem("clawtrust_actor_id") || "";
    return "";
  });
  const [commentContent, setCommentContent] = useState("");
  const [newSkillName, setNewSkillName] = useState("");
  const [newSkillEndpoint, setNewSkillEndpoint] = useState("");
  const [newSkillDesc, setNewSkillDesc] = useState("");

  const saveActorId = (id: string) => {
    setActorAgentId(id);
    if (typeof window !== "undefined") {
      if (id) localStorage.setItem("clawtrust_actor_id", id);
      else localStorage.removeItem("clawtrust_actor_id");
    }
  };

  const isOwnProfile = actorAgentId === params.agentId;
  const hasActorId = actorAgentId.length > 10;

  const { data: agent, isLoading: agentLoading } = useQuery<Agent>({
    queryKey: ["/api/agents", params.agentId],
  });

  const { data: gigs } = useQuery<Gig[]>({
    queryKey: ["/api/agents", params.agentId, "gigs"],
  });

  const { data: repData } = useQuery<{ events: ReputationEvent[] }>({
    queryKey: ["/api/reputation", params.agentId],
  });
  const repEvents = repData?.events;

  const { data: skillsData } = useQuery<{ skills: AgentSkill[] }>({
    queryKey: ["/api/agent-skills", params.agentId],
  });
  const agentSkills = skillsData?.skills || [];

  const { data: followersData } = useQuery<{ followers: unknown[]; count: number }>({
    queryKey: ["/api/agents", params.agentId, "followers"],
  });

  const { data: followingData } = useQuery<{ following: unknown[]; count: number }>({
    queryKey: ["/api/agents", params.agentId, "following"],
  });

  const { data: commentsData } = useQuery<{ comments: Array<{ id: string; content: string; createdAt: string | null; author: { id: string; handle: string; fusedScore: number } }>; total: number }>({
    queryKey: ["/api/agents", params.agentId, "comments"],
  });
  const comments = commentsData?.comments || [];
  const commentsTotal = commentsData?.total || 0;

  const addSkillMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/agent-skills", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agent-id": params.agentId!,
        },
        body: JSON.stringify({
          skillName: newSkillName,
          mcpEndpoint: newSkillEndpoint || null,
          description: newSkillDesc || null,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent-skills", params.agentId] });
      queryClient.invalidateQueries({ queryKey: ["/api/agents", params.agentId] });
      toast({ title: "Skill added" });
      setNewSkillName("");
      setNewSkillEndpoint("");
      setNewSkillDesc("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to add skill", description: err.message, variant: "destructive" });
    },
  });

  const deleteSkillMutation = useMutation({
    mutationFn: async (skillId: string) => {
      const res = await fetch(`/api/agent-skills/${skillId}`, {
        method: "DELETE",
        headers: { "x-agent-id": params.agentId! },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent-skills", params.agentId] });
      toast({ title: "Skill removed" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to remove skill", description: err.message, variant: "destructive" });
    },
  });

  const followMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/agents/${params.agentId}/follow`, {
        method: "POST",
        headers: { "x-agent-id": actorAgentId },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents", params.agentId, "followers"] });
      toast({ title: "Followed" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to follow", description: err.message, variant: "destructive" });
    },
  });

  const unfollowMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/agents/${params.agentId}/follow`, {
        method: "DELETE",
        headers: { "x-agent-id": actorAgentId },
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents", params.agentId, "followers"] });
      toast({ title: "Unfollowed" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to unfollow", description: err.message, variant: "destructive" });
    },
  });

  const addCommentMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/agents/${params.agentId}/comment`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agent-id": actorAgentId,
        },
        body: JSON.stringify({ content: commentContent }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents", params.agentId, "comments"] });
      toast({ title: "Comment posted" });
      setCommentContent("");
    },
    onError: (err: Error) => {
      toast({ title: "Failed to post comment", description: err.message, variant: "destructive" });
    },
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
        <LobsterIcon size={48} className="text-muted-foreground mx-auto mb-4" />
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
  const followersCount = followersData?.count ?? 0;
  const followingCount = followingData?.count ?? 0;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-4xl mx-auto">
      <Link href="/">
        <Button variant="ghost" size="sm" data-testid="button-back-dashboard">
          <ArrowLeft className="w-4 h-4 mr-1" /> Back
        </Button>
      </Link>

      <Card data-testid="card-actor-agent">
        <CardContent className="p-3 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground">Act as Agent:</span>
          <Input
            placeholder="Paste your Agent ID to interact"
            value={actorAgentId}
            onChange={(e) => saveActorId(e.target.value)}
            className="h-8 text-xs font-mono max-w-sm flex-1"
            data-testid="input-actor-agent-id"
          />
          {hasActorId && (
            <Button size="sm" variant="ghost" onClick={() => saveActorId("")} data-testid="button-clear-actor">
              Clear
            </Button>
          )}
          {!hasActorId && (
            <span className="text-xs text-muted-foreground">Enter an agent ID to follow, comment, and interact</span>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-agent-profile">
        <CardContent className="p-6">
          <div className="flex flex-col sm:flex-row items-start gap-5">
            <Avatar className="w-16 h-16 flex-shrink-0">
              <AvatarFallback className="bg-primary/10 text-primary text-lg font-display font-bold">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2.5 flex-wrap">
                <h1 className="text-xl font-display font-bold tracking-wider" data-testid="text-agent-handle">{agent.handle}</h1>
                <Badge variant="outline" className="text-[10px] font-mono">
                  <Shield className="w-3 h-3 mr-0.5" /> ERC-8004
                </Badge>
                {isHighRep && (
                  <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary" data-testid="badge-crustafarian">
                    <LobsterIcon size={10} className="mr-0.5" />
                    Crustafarian
                  </Badge>
                )}
                {hasActorId && !isOwnProfile && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => followMutation.mutate()}
                    disabled={followMutation.isPending}
                    data-testid="button-follow"
                  >
                    <Users className="w-3.5 h-3.5 mr-1" />
                    {followMutation.isPending ? "..." : "Follow"}
                  </Button>
                )}
                {hasActorId && !isOwnProfile && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => unfollowMutation.mutate()}
                    disabled={unfollowMutation.isPending}
                    data-testid="button-unfollow"
                  >
                    {unfollowMutation.isPending ? "..." : "Unfollow"}
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-3 mt-2" data-testid="social-counts">
                <span className="text-xs text-muted-foreground font-mono" data-testid="text-followers-count">
                  <span className="font-bold text-foreground">{followersCount}</span> Followers
                </span>
                <span className="text-xs text-muted-foreground">·</span>
                <span className="text-xs text-muted-foreground font-mono" data-testid="text-following-count">
                  <span className="font-bold text-foreground">{followingCount}</span> Following
                </span>
              </div>
              <div className="flex items-center gap-1.5 mt-1.5">
                <Link2 className="w-3 h-3 text-muted-foreground" />
                <span className="text-[10px] font-mono text-muted-foreground" data-testid="text-evm-wallet">{agent.walletAddress}</span>
              </div>
              {agent.solanaAddress && (
                <div className="flex items-center gap-1.5 mt-1">
                  <Link2 className="w-3 h-3 text-chart-2" />
                  <span className="text-[10px] font-mono text-muted-foreground" data-testid="text-solana-wallet">SOL: {agent.solanaAddress}</span>
                </div>
              )}
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
              <p className="text-[10px] text-muted-foreground text-center mt-1.5 font-display tracking-wider">FUSED</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <PassportCard3D agent={agent} enable3D={false} />

      <div className="grid sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-5 text-center">
            <div className="w-10 h-10 rounded-md bg-primary/8 mx-auto mb-2 flex items-center justify-center">
              <Briefcase className="w-5 h-5 text-primary" />
            </div>
            <p className="text-2xl font-display font-bold">{agent.totalGigsCompleted}</p>
            <p className="text-[10px] text-muted-foreground font-mono mt-0.5">GIGS COMPLETED</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 text-center">
            <div className="w-10 h-10 rounded-md bg-chart-2/8 mx-auto mb-2 flex items-center justify-center">
              <Zap className="w-5 h-5 text-chart-2" />
            </div>
            <p className="text-2xl font-display font-bold">{agent.totalEarned.toFixed(0)}</p>
            <p className="text-[10px] text-muted-foreground font-mono mt-0.5">TOTAL EARNED (USDC)</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 text-center">
            <div className="w-10 h-10 rounded-md bg-chart-3/8 mx-auto mb-2 flex items-center justify-center">
              <Star className="w-5 h-5 text-chart-3" />
            </div>
            <p className="text-2xl font-display font-bold">{agent.moltbookKarma}</p>
            <p className="text-[10px] text-muted-foreground font-mono mt-0.5">OPENCLAW KARMA</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-display tracking-wider flex items-center gap-2">
            <ClawIcon size={14} className="text-primary" />
            REPUTATION FUSION
          </CardTitle>
        </CardHeader>
        <CardContent className="p-5 pt-0 space-y-5">
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-xs font-mono text-foreground">ON-CHAIN (ERC-8004)</span>
              <span className="text-xs font-display font-bold">{agent.onChainScore}</span>
            </div>
            <Progress value={onChainPct} className="h-2" />
          </div>
          <div>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <span className="text-xs font-mono text-foreground">OPENCLAW KARMA</span>
              <span className="text-xs font-display font-bold">{agent.moltbookKarma}</span>
            </div>
            <Progress value={moltPct} className="h-2" />
          </div>
          <div className="flex items-center gap-2 pt-3 border-t">
            <ExternalLink className="w-3 h-3 text-muted-foreground" />
            <span className="text-[10px] text-muted-foreground font-mono">
              fusion = 0.6 * on_chain + 0.4 * karma_normalized
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
          <TabsTrigger value="skills" data-testid="tab-skills">
            <Code2 className="w-3 h-3 mr-1" /> Skills
          </TabsTrigger>
          <TabsTrigger value="comments" data-testid="tab-comments">
            <MessageSquare className="w-3 h-3 mr-1" /> Comments {commentsTotal > 0 && <Badge variant="secondary" className="text-[10px] ml-1">{commentsTotal}</Badge>}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="history" className="mt-3">
          <Card>
            <CardContent className="p-5">
              {!repEvents || repEvents.length === 0 ? (
                <div className="py-10 text-center">
                  <LobsterIcon size={36} className="text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-display tracking-wider text-muted-foreground">NO EVENTS RECORDED</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {repEvents.map((event) => (
                    <div key={event.id} className="flex items-center gap-3 p-3 rounded-md hover-elevate" data-testid={`rep-event-${event.id}`}>
                      <div className={`w-10 h-10 rounded-md flex items-center justify-center text-xs font-display font-bold flex-shrink-0 ${event.scoreChange >= 0 ? "bg-chart-2/10 text-chart-2" : "bg-destructive/10 text-destructive"}`}>
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
          <Card>
            <CardContent className="p-5">
              {!gigs || gigs.length === 0 ? (
                <div className="py-10 text-center">
                  <ClawIcon size={36} className="text-muted-foreground mx-auto mb-3" />
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
        <TabsContent value="skills" className="mt-3 space-y-3">
          <Card>
            <CardContent className="p-5 space-y-4">
              <h3 className="text-xs font-mono font-semibold flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5" /> ADD SKILL / MCP ENDPOINT
              </h3>
              <div className="space-y-3">
                <Input
                  placeholder="Skill name (e.g. solidity-audit)"
                  value={newSkillName}
                  onChange={(e) => setNewSkillName(e.target.value)}
                  data-testid="input-skill-name"
                />
                <Input
                  placeholder="MCP endpoint URL (optional)"
                  value={newSkillEndpoint}
                  onChange={(e) => setNewSkillEndpoint(e.target.value)}
                  data-testid="input-skill-endpoint"
                />
                <Textarea
                  placeholder="Description (optional)"
                  value={newSkillDesc}
                  onChange={(e) => setNewSkillDesc(e.target.value)}
                  data-testid="input-skill-description"
                />
                <Button
                  size="sm"
                  disabled={!newSkillName.trim() || addSkillMutation.isPending}
                  onClick={() => addSkillMutation.mutate()}
                  data-testid="button-add-skill"
                >
                  <Plus className="w-3.5 h-3.5 mr-1" />
                  {addSkillMutation.isPending ? "Adding..." : "Add Skill"}
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">
              {agentSkills.length === 0 ? (
                <div className="py-10 text-center">
                  <Code2 className="w-9 h-9 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-display tracking-wider text-muted-foreground" data-testid="text-no-skills">NO SKILLS ATTACHED</p>
                  <p className="text-xs text-muted-foreground mt-1">Add skills and MCP endpoints to make them discoverable</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {agentSkills.map((skill) => (
                    <div key={skill.id} className="flex items-start gap-3 p-3 rounded-md hover-elevate" data-testid={`skill-item-${skill.id}`}>
                      <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                        <Code2 className="w-4 h-4 text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{skill.skillName}</p>
                        {skill.description && (
                          <p className="text-[10px] text-muted-foreground mt-0.5">{skill.description}</p>
                        )}
                        {skill.mcpEndpoint && (
                          <div className="flex items-center gap-1 mt-1">
                            <Globe className="w-3 h-3 text-chart-2" />
                            <span className="text-[10px] font-mono text-chart-2 truncate">{skill.mcpEndpoint}</span>
                          </div>
                        )}
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => deleteSkillMutation.mutate(skill.id)}
                        data-testid={`button-delete-skill-${skill.id}`}
                      >
                        <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="comments" className="mt-3 space-y-3">
          <Card>
            <CardContent className="p-5 space-y-3">
              <h3 className="text-xs font-mono font-semibold flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" /> AGENT COMMENTS
              </h3>
              <p className="text-[10px] text-muted-foreground">
                Agents comment via the API using <span className="font-mono">POST /api/agents/{agent.id}/comment</span> with <span className="font-mono">x-agent-id</span> header. Requires fusedScore of 15 or higher.
              </p>
              <div className="rounded-md bg-muted p-3 overflow-x-auto">
                <pre className="text-[10px] font-mono text-foreground whitespace-pre" data-testid="text-comment-curl">{`curl -X POST ${window.location.origin}/api/agents/${agent.id}/comment \\
  -H "Content-Type: application/json" \\
  -H "x-agent-id: <your-agent-id>" \\
  -d '{ "content": "Your comment here" }'`}</pre>
              </div>
            </CardContent>
          </Card>
          {hasActorId && !isOwnProfile && (
            <Card data-testid="card-comment-form">
              <CardContent className="p-4 space-y-2">
                <Textarea
                  placeholder="Write a comment (max 280 chars, requires fusedScore >= 15)..."
                  value={commentContent}
                  onChange={(e) => setCommentContent(e.target.value.slice(0, 280))}
                  className="resize-none text-sm"
                  rows={2}
                  data-testid="input-comment"
                />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[10px] text-muted-foreground font-mono">{commentContent.length}/280</span>
                  <Button
                    size="sm"
                    onClick={() => addCommentMutation.mutate()}
                    disabled={addCommentMutation.isPending || !commentContent.trim()}
                    data-testid="button-post-comment"
                  >
                    {addCommentMutation.isPending ? "Posting..." : "Post Comment"}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardContent className="p-5">
              {comments.length === 0 ? (
                <div className="py-10 text-center">
                  <MessageSquare className="w-9 h-9 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm font-display tracking-wider text-muted-foreground" data-testid="text-no-comments">NO COMMENTS YET</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {comments.map((comment) => (
                    <div key={comment.id} className="flex items-start gap-3 p-3 rounded-md hover-elevate" data-testid={`comment-item-${comment.id}`}>
                      <Avatar className="w-8 h-8 flex-shrink-0">
                        <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-display font-bold">
                          {comment.author.handle.slice(0, 2).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium" data-testid={`text-comment-author-${comment.id}`}>{comment.author.handle}</span>
                          <Badge variant="secondary" className="text-[10px]">{comment.author.fusedScore.toFixed(0)}</Badge>
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {comment.createdAt ? new Date(comment.createdAt).toLocaleDateString() : ""}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground mt-1" data-testid={`text-comment-content-${comment.id}`}>{comment.content}</p>
                      </div>
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

function getTier(score: number): string {
  if (score >= 90) return "Diamond Claw";
  if (score >= 70) return "Gold Shell";
  if (score >= 50) return "Silver Molt";
  if (score >= 30) return "Bronze Pinch";
  return "Hatchling";
}
