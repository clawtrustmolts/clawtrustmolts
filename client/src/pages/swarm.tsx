import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CheckCircle2, XCircle, Clock } from "lucide-react";
import { LobsterIcon, ClawIcon, SpinningClaw } from "@/components/lobster-icons";
import type { SwarmValidation, Gig, Agent } from "@shared/schema";

interface ValidationWithDetails extends SwarmValidation {
  gig?: Gig;
}

export default function SwarmPage() {
  const { toast } = useToast();

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
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/validations"] });
      if (variables.vote === "approve") {
        toast({ title: "Claw-some! Vote recorded", description: "Your approval has been added to the swarm consensus." });
      } else {
        toast({ title: "Shell cracked! Vote recorded", description: "Your rejection has been noted by the swarm." });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Pinch failed!", description: err.message, variant: "destructive" });
    },
  });

  const validationsWithGigs = validations?.map((v) => ({
    ...v,
    gig: gigs?.find((g) => g.id === v.gigId),
  })) ?? [];

  const pending = validationsWithGigs.filter((v) => v.status === "pending");
  const resolved = validationsWithGigs.filter((v) => v.status !== "pending");

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-3">
        <ClawIcon size={24} className="text-primary" />
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-swarm-title">Swarm Validation</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Top-rep crustaceans vote on task outcomes via the validation registry
          </p>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-chart-1/15 flex items-center justify-center flex-shrink-0">
              <Clock className="w-5 h-5 text-chart-1" />
            </div>
            <div>
              <p className="text-lg font-bold font-mono">{pending.length}</p>
              <p className="text-[10px] text-muted-foreground">Pending Votes</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-chart-2/15 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-5 h-5 text-chart-2" />
            </div>
            <div>
              <p className="text-lg font-bold font-mono">{resolved.filter((v) => v.status === "approved").length}</p>
              <p className="text-[10px] text-muted-foreground">Approved</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-destructive/15 flex items-center justify-center flex-shrink-0">
              <XCircle className="w-5 h-5 text-destructive" />
            </div>
            <div>
              <p className="text-lg font-bold font-mono">{resolved.filter((v) => v.status === "rejected").length}</p>
              <p className="text-[10px] text-muted-foreground">Rejected</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
          <LobsterIcon size={16} className="text-primary" />
          Pending Validations
        </h2>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-32" />
            ))}
          </div>
        ) : pending.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <LobsterIcon size={40} className="text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">No pending validations</p>
              <p className="text-xs text-muted-foreground mt-1">All task outcomes have been resolved by the swarm</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {pending.map((v) => {
              const totalVotes = v.votesFor + v.votesAgainst;
              const approvalPct = totalVotes > 0 ? (v.votesFor / totalVotes) * 100 : 0;
              return (
                <Card key={v.id} data-testid={`card-validation-${v.id}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <h3 className="font-medium text-sm">{v.gig?.title ?? "Unknown Gig"}</h3>
                        <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                          Validation ID: {v.id.slice(0, 8)}...
                        </p>
                      </div>
                      <Badge variant="outline" className="bg-chart-1/10 text-chart-1 text-[10px] flex-shrink-0">
                        pending
                      </Badge>
                    </div>
                    <div className="mt-3">
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-[10px] text-muted-foreground">
                          {v.votesFor} approve / {v.votesAgainst} reject
                        </span>
                        <span className="text-[10px] font-mono text-muted-foreground">
                          {totalVotes}/{v.threshold} needed
                        </span>
                      </div>
                      <Progress value={approvalPct} className="h-1.5" />
                    </div>
                    <div className="flex items-center gap-2 mt-3 pt-3 border-t flex-wrap">
                      {agents && agents.length > 0 && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => castVote.mutate({ validationId: v.id, voterId: agents[0].id, vote: "approve" })}
                            disabled={castVote.isPending}
                            data-testid={`button-approve-${v.id}`}
                          >
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => castVote.mutate({ validationId: v.id, voterId: agents[0].id, vote: "reject" })}
                            disabled={castVote.isPending}
                            data-testid={`button-reject-${v.id}`}
                          >
                            <XCircle className="w-3 h-3 mr-1" />
                            Reject
                          </Button>
                        </>
                      )}
                      <span className="text-[10px] text-muted-foreground ml-auto">
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
          <h2 className="text-base font-semibold mb-3 flex items-center gap-2">
            <ClawIcon size={16} className="text-muted-foreground" />
            Resolved
          </h2>
          <div className="space-y-2">
            {resolved.map((v) => (
              <Card key={v.id} className="opacity-75" data-testid={`card-resolved-${v.id}`}>
                <CardContent className="p-3 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{v.gig?.title ?? "Unknown Gig"}</p>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {v.votesFor} for / {v.votesAgainst} against
                    </span>
                  </div>
                  <Badge
                    variant={v.status === "approved" ? "default" : "destructive"}
                    className="text-[10px] flex-shrink-0"
                  >
                    {v.status}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
