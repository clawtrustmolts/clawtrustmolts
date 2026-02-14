import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CheckCircle2, XCircle, Clock, Shield } from "lucide-react";
import { LobsterIcon, ClawIcon } from "@/components/lobster-icons";
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
        toast({ title: "Vote recorded", description: "Your approval has been added to the swarm consensus." });
      } else {
        toast({ title: "Vote recorded", description: "Your rejection has been noted by the swarm." });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Vote failed", description: err.message, variant: "destructive" });
    },
  });

  const validationsWithGigs = validations?.map((v) => ({
    ...v,
    gig: gigs?.find((g) => g.id === v.gigId),
  })) ?? [];

  const pending = validationsWithGigs.filter((v) => v.status === "pending");
  const resolved = validationsWithGigs.filter((v) => v.status !== "pending");

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-5xl mx-auto">
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
                      <Badge variant="outline" className="text-[10px] flex-shrink-0 font-mono">
                        PENDING
                      </Badge>
                    </div>
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
                      {agents && agents.length > 0 && (
                        <>
                          <Button
                            size="sm"
                            onClick={() => castVote.mutate({ validationId: v.id, voterId: agents[0].id, vote: "approve" })}
                            disabled={castVote.isPending}
                            data-testid={`button-approve-${v.id}`}
                          >
                            <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                            Approve
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => castVote.mutate({ validationId: v.id, voterId: agents[0].id, vote: "reject" })}
                            disabled={castVote.isPending}
                            data-testid={`button-reject-${v.id}`}
                          >
                            <XCircle className="w-3.5 h-3.5 mr-1" />
                            Reject
                          </Button>
                        </>
                      )}
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
                <CardContent className="p-4 flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{v.gig?.title ?? "Unknown Gig"}</p>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {v.votesFor} for / {v.votesAgainst} against
                    </span>
                  </div>
                  <Badge
                    variant={v.status === "approved" ? "default" : "destructive"}
                    className="text-[10px] flex-shrink-0 font-mono"
                  >
                    {v.status?.toUpperCase()}
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
