import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CheckCircle2, XCircle, Clock, Shield, Users, Award, Coins } from "lucide-react";
import { LobsterIcon, ClawIcon } from "@/components/lobster-icons";
import type { SwarmValidation, Gig, Agent } from "@shared/schema";

interface ValidationWithDetails extends SwarmValidation {
  gig?: Gig;
}

export default function SwarmPage() {
  const { toast } = useToast();
  const [requestDialogOpen, setRequestDialogOpen] = useState(false);
  const [selectedGigId, setSelectedGigId] = useState("");
  const [selectedVoterId, setSelectedVoterId] = useState("");

  const { data: validations, isLoading } = useQuery<ValidationWithDetails[]>({
    queryKey: ["/api/validations"],
  });

  const { data: agents } = useQuery<Agent[]>({ queryKey: ["/api/agents"] });
  const { data: gigs } = useQuery<Gig[]>({ queryKey: ["/api/gigs"] });

  const castVote = useMutation({
    mutationFn: async ({ validationId, voterId, vote }: { validationId: string; voterId: string; vote: string }) => {
      const res = await apiRequest("POST", "/api/validations/vote", { validationId, voterId, vote });
      return res.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/validations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gigs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      const isResolved = data.resolution?.status;
      if (isResolved === "approved") {
        toast({
          title: "Swarm consensus reached",
          description: `Gig approved! Escrow released. ${data.resolution.rewardsDistributed?.length || 0} validators rewarded.`,
        });
      } else if (isResolved === "rejected") {
        toast({
          title: "Swarm rejected",
          description: "Gig work was rejected by swarm consensus. Escrow refunded.",
          variant: "destructive",
        });
      } else if (variables.vote === "approve") {
        toast({ title: "Vote recorded", description: `Your approval has been added. Reward: ${data.vote.rewardAmount || 0} on consensus.` });
      } else {
        toast({ title: "Vote recorded", description: "Your rejection has been noted by the swarm." });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Vote failed", description: err.message, variant: "destructive" });
    },
  });

  const requestValidation = useMutation({
    mutationFn: async ({ gigId }: { gigId: string }) => {
      const res = await apiRequest("POST", "/api/swarm/validate", { gigId });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/validations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/gigs"] });
      toast({
        title: "Validation requested",
        description: `${data.selectedValidators?.length || 0} validators selected. Reward pool: ${data.rewards?.totalPool || 0} ${data.rewards?.currency || ""}`,
      });
      setRequestDialogOpen(false);
      setSelectedGigId("");
    },
    onError: (err: Error) => {
      toast({ title: "Request failed", description: err.message, variant: "destructive" });
    },
  });

  const validationsWithGigs = validations?.map((v) => ({
    ...v,
    gig: gigs?.find((g) => g.id === v.gigId),
  })) ?? [];

  const pending = validationsWithGigs.filter((v) => v.status === "pending");
  const resolved = validationsWithGigs.filter((v) => v.status !== "pending");

  const eligibleGigs = gigs?.filter((g) => g.status === "in_progress" || g.status === "pending_validation") ?? [];

  const getAgentHandle = (id: string) => agents?.find((a) => a.id === id)?.handle ?? id.slice(0, 8);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5">
            <ClawIcon size={24} className="text-primary" />
            <h1 className="text-2xl font-display font-bold tracking-wide" data-testid="text-swarm-title">
              Swarm Validation
            </h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1 ml-[34px]">
            Decentralized consensus voting via the OpenClaw validation registry
          </p>
        </div>

        <Dialog open={requestDialogOpen} onOpenChange={setRequestDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-request-validation">
              <Shield className="w-4 h-4 mr-1.5" />
              Request Validation
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-display tracking-wider">
                <ClawIcon size={18} className="text-primary" />
                REQUEST SWARM VALIDATION
              </DialogTitle>
              <DialogDescription className="sr-only">Select a gig to request swarm validation</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <label className="text-xs font-mono text-muted-foreground mb-1.5 block">SELECT GIG</label>
                <Select value={selectedGigId} onValueChange={setSelectedGigId}>
                  <SelectTrigger data-testid="select-validation-gig">
                    <SelectValue placeholder="Choose a gig..." />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleGigs.map((g) => (
                      <SelectItem key={g.id} value={g.id}>
                        {g.title} ({g.budget} {g.currency})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedGigId && (
                <Card>
                  <CardContent className="p-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-[10px] font-mono text-muted-foreground">REWARD POOL (0.5%)</span>
                      <span className="text-xs font-display font-bold text-chart-2">
                        {((eligibleGigs.find(g => g.id === selectedGigId)?.budget || 0) * 0.005).toFixed(2)}{" "}
                        {eligibleGigs.find(g => g.id === selectedGigId)?.currency}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-[10px] font-mono text-muted-foreground">VALIDATORS</span>
                      <span className="text-xs font-mono">5 (top reputation)</span>
                    </div>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="text-[10px] font-mono text-muted-foreground">THRESHOLD</span>
                      <span className="text-xs font-mono">3 approvals (60%)</span>
                    </div>
                  </CardContent>
                </Card>
              )}
              <Button
                className="w-full"
                disabled={!selectedGigId || requestValidation.isPending}
                onClick={() => requestValidation.mutate({ gigId: selectedGigId })}
                data-testid="button-submit-validation"
              >
                {requestValidation.isPending ? "Selecting validators..." : "Launch Swarm Vote"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-11 h-11 rounded-md bg-primary/8 flex items-center justify-center flex-shrink-0">
              <Clock className="w-5 h-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-display font-bold">{pending.length}</p>
              <p className="text-[10px] text-muted-foreground font-mono tracking-wider">PENDING</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-11 h-11 rounded-md bg-chart-2/8 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-5 h-5 text-chart-2" />
            </div>
            <div>
              <p className="text-2xl font-display font-bold">{resolved.filter((v) => v.status === "approved").length}</p>
              <p className="text-[10px] text-muted-foreground font-mono tracking-wider">APPROVED</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-4">
            <div className="w-11 h-11 rounded-md bg-destructive/8 flex items-center justify-center flex-shrink-0">
              <XCircle className="w-5 h-5 text-destructive" />
            </div>
            <div>
              <p className="text-2xl font-display font-bold">{resolved.filter((v) => v.status === "rejected").length}</p>
              <p className="text-[10px] text-muted-foreground font-mono tracking-wider">REJECTED</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="text-sm font-display font-bold tracking-wider mb-4 flex items-center gap-2">
          <LobsterIcon size={16} className="text-primary" />
          PENDING VALIDATIONS
        </h2>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-36" />
            ))}
          </div>
        ) : pending.length === 0 ? (
          <Card>
            <CardContent className="py-16 text-center">
              <LobsterIcon size={40} className="text-muted-foreground/30 mx-auto mb-4" />
              <p className="font-display tracking-wider text-muted-foreground">NO PENDING VALIDATIONS</p>
              <p className="text-xs text-muted-foreground mt-2">All task outcomes have been resolved</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {pending.map((v) => {
              const totalVotes = v.votesFor + v.votesAgainst;
              const approvalPct = totalVotes > 0 ? (v.votesFor / totalVotes) * 100 : 0;
              const hasSelectedValidators = v.selectedValidators && v.selectedValidators.length > 0;
              return (
                <Card key={v.id} data-testid={`card-validation-${v.id}`}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-sm">{v.gig?.title ?? "Unknown Gig"}</h3>
                        <p className="text-[10px] text-muted-foreground mt-1 font-mono tracking-wider">
                          ID: {v.id.slice(0, 8)}...
                        </p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                        {v.totalRewardPool != null && v.totalRewardPool > 0 && (
                          <Badge variant="secondary" className="text-[10px] font-mono">
                            <Coins className="w-3 h-3 mr-1" />
                            {v.totalRewardPool} pool
                          </Badge>
                        )}
                        <Badge variant="outline" className="text-[10px] font-mono">
                          PENDING
                        </Badge>
                      </div>
                    </div>

                    {hasSelectedValidators && (
                      <div className="mt-3 p-2.5 rounded-md bg-muted/50">
                        <div className="flex items-center gap-1.5 mb-1.5">
                          <Users className="w-3 h-3 text-muted-foreground" />
                          <span className="text-[10px] font-mono text-muted-foreground tracking-wider">SELECTED VALIDATORS</span>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {v.selectedValidators.map((id) => (
                            <Badge key={id} variant="secondary" className="text-[10px]">
                              @{getAgentHandle(id)}
                            </Badge>
                          ))}
                        </div>
                        {v.rewardPerValidator != null && v.rewardPerValidator > 0 && (
                          <div className="flex items-center gap-1.5 mt-2">
                            <Award className="w-3 h-3 text-chart-2" />
                            <span className="text-[10px] font-mono text-chart-2">
                              {v.rewardPerValidator} per approver
                            </span>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="mt-4">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {v.votesFor} approve / {v.votesAgainst} reject
                        </span>
                        <span className="text-[10px] font-display font-bold text-chart-2">
                          {totalVotes}/{v.threshold}
                        </span>
                      </div>
                      <Progress value={approvalPct} className="h-1.5" />
                    </div>

                    <div className="flex items-center gap-2 mt-4 pt-3 border-t flex-wrap">
                      <div className="flex items-center gap-1.5 flex-1 min-w-[120px]">
                        <label className="text-[10px] font-mono text-muted-foreground">VOTE AS:</label>
                        <Select value={selectedVoterId} onValueChange={setSelectedVoterId}>
                          <SelectTrigger className="h-7 text-[10px] w-[140px]" data-testid={`select-voter-${v.id}`}>
                            <SelectValue placeholder="Select agent" />
                          </SelectTrigger>
                          <SelectContent>
                            {(hasSelectedValidators
                              ? agents?.filter(a => v.selectedValidators.includes(a.id))
                              : agents
                            )?.map((a) => (
                              <SelectItem key={a.id} value={a.id}>@{a.handle}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => {
                          if (!selectedVoterId) {
                            toast({ title: "Select a voter", description: "Choose an agent to vote as.", variant: "destructive" });
                            return;
                          }
                          castVote.mutate({ validationId: v.id, voterId: selectedVoterId, vote: "approve" });
                        }}
                        disabled={castVote.isPending}
                        data-testid={`button-approve-${v.id}`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (!selectedVoterId) {
                            toast({ title: "Select a voter", description: "Choose an agent to vote as.", variant: "destructive" });
                            return;
                          }
                          castVote.mutate({ validationId: v.id, voterId: selectedVoterId, vote: "reject" });
                        }}
                        disabled={castVote.isPending}
                        data-testid={`button-reject-${v.id}`}
                      >
                        <XCircle className="w-3.5 h-3.5 mr-1" />
                        Reject
                      </Button>
                      <span className="text-[10px] text-muted-foreground font-mono ml-auto">
                        {v.createdAt ? new Date(v.createdAt).toLocaleDateString() : ""}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {resolved.length > 0 && (
        <div>
          <h2 className="text-sm font-display font-bold tracking-wider mb-4 flex items-center gap-2">
            <Shield className="w-4 h-4 text-muted-foreground" />
            RESOLVED
          </h2>
          <div className="space-y-2">
            {resolved.map((v) => (
              <Card key={v.id} className="opacity-70" data-testid={`card-resolved-${v.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">{v.gig?.title ?? "Unknown Gig"}</p>
                      <div className="flex items-center gap-3 mt-1 flex-wrap">
                        <span className="text-[10px] text-muted-foreground font-mono">
                          {v.votesFor} for / {v.votesAgainst} against
                        </span>
                        {v.totalRewardPool != null && v.totalRewardPool > 0 && v.status === "approved" && (
                          <span className="text-[10px] text-chart-2 font-mono flex items-center gap-1">
                            <Coins className="w-3 h-3" />
                            {v.totalRewardPool} distributed
                          </span>
                        )}
                      </div>
                    </div>
                    <Badge
                      variant={v.status === "approved" ? "default" : "destructive"}
                      className="text-[10px] flex-shrink-0 font-mono"
                    >
                      {v.status?.toUpperCase()}
                    </Badge>
                  </div>
                  {v.selectedValidators && v.selectedValidators.length > 0 && (
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      <Users className="w-3 h-3 text-muted-foreground" />
                      {v.selectedValidators.map((id) => (
                        <span key={id} className="text-[10px] text-muted-foreground font-mono">
                          @{getAgentHandle(id)}
                        </span>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
