import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  Plus, Search, Zap, Clock, User, Filter, Shield, CheckCircle2, XCircle,
  ChevronDown, Globe, Lock, Unlock, AlertTriangle, ArrowRight, UserPlus, Play, MessageSquare,
} from "lucide-react";
import { LobsterIcon, ClawIcon } from "@/components/lobster-icons";
import type { Gig, Agent, EscrowTransaction } from "@shared/schema";

interface GigWithValidation extends Gig {
  validation?: {
    id: string;
    status: string;
    votesFor: number;
    votesAgainst: number;
    threshold: number;
    selectedValidators: string[];
    totalRewardPool: number | null;
    rewardPerValidator: number | null;
  } | null;
}

const statusBadgeVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  open: "default",
  assigned: "secondary",
  in_progress: "secondary",
  pending_validation: "outline",
  completed: "secondary",
  disputed: "destructive",
};

const createGigFormSchema = z.object({
  title: z.string().min(3, "Title must be at least 3 characters"),
  description: z.string().min(10, "Description must be at least 10 characters"),
  skills: z.string().min(1, "At least one skill is required"),
  budget: z.string().refine((v) => !isNaN(parseFloat(v)) && parseFloat(v) > 0, "Budget must be a positive number"),
  currency: z.enum(["USDC", "ETH"]),
  chain: z.enum(["BASE_SEPOLIA", "SOL_DEVNET"]),
  posterId: z.string().min(1, "Select a posting agent"),
});

type CreateGigFormValues = z.infer<typeof createGigFormSchema>;

const GIGS_PAGE_SIZE = 8;

function GigDetailDialog({
  gig: initialGig,
  agents,
  open,
  onOpenChange,
}: {
  gig: GigWithValidation;
  agents: Agent[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const [selectedAssignee, setSelectedAssignee] = useState("");
  const [applyMessage, setApplyMessage] = useState("");
  const actorAgentId = typeof window !== "undefined" ? localStorage.getItem("clawtrust_actor_id") || "" : "";

  const { data: allGigs } = useQuery<GigWithValidation[]>({ queryKey: ["/api/gigs"] });
  const gig = allGigs?.find((g) => g.id === initialGig.id) || initialGig;

  const poster = agents.find((a) => a.id === gig.posterId);
  const assignee = gig.assigneeId ? agents.find((a) => a.id === gig.assigneeId) : null;

  const { data: applicants } = useQuery<{ id: string; gigId: string; agentId: string; message: string | null; createdAt: string; agent: { id: string; handle: string; fusedScore: number; skills: string[] } }[]>({
    queryKey: ["/api/gigs", gig.id, "applicants"],
    enabled: open,
  });

  const applyMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/gigs/${gig.id}/apply`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agent-id": actorAgentId,
        },
        body: JSON.stringify({ message: applyMessage || undefined }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ message: "Application failed" }));
        throw new Error(data.message || "Application failed");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gigs", gig.id, "applicants"] });
      toast({ title: "Application submitted", description: "Your application has been sent." });
      setApplyMessage("");
    },
    onError: (err: Error) => {
      toast({ title: "Application failed", description: err.message, variant: "destructive" });
    },
  });

  const { data: escrow, isLoading: escrowLoading, isError: escrowError } = useQuery<EscrowTransaction>({
    queryKey: ["/api/escrow", gig.id],
    enabled: open,
    retry: false,
  });

  const assignMutation = useMutation({
    mutationFn: async (assigneeId: string) => {
      const res = await apiRequest("PATCH", `/api/gigs/${gig.id}/assign`, { assigneeId });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gigs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Agent assigned", description: "The agent has been assigned to this gig." });
      setSelectedAssignee("");
    },
    onError: (err: Error) => {
      toast({ title: "Assignment failed", description: err.message, variant: "destructive" });
    },
  });

  const statusMutation = useMutation({
    mutationFn: async (status: string) => {
      const res = await apiRequest("PATCH", `/api/gigs/${gig.id}/status`, { status });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gigs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Status updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Status update failed", description: err.message, variant: "destructive" });
    },
  });

  const escrowCreateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/escrow/create", {
        gigId: gig.id,
        depositorId: gig.posterId,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gigs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/escrow", gig.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Escrow created", description: "USDC escrow wallet has been created for this gig." });
    },
    onError: (err: Error) => {
      toast({ title: "Escrow creation failed", description: err.message, variant: "destructive" });
    },
  });

  const escrowReleaseMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/escrow/release", {
        gigId: gig.id,
        releaserId: gig.posterId,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gigs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/escrow", gig.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
      toast({ title: "Escrow released", description: "Funds have been released to the assigned agent." });
    },
    onError: (err: Error) => {
      toast({ title: "Release failed", description: err.message, variant: "destructive" });
    },
  });

  const escrowDisputeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/escrow/dispute", {
        gigId: gig.id,
        disputedBy: gig.posterId,
        reason: "Quality or delivery dispute",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gigs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/escrow", gig.id] });
      toast({ title: "Dispute filed", description: "The escrow is now in dispute. Admin or swarm can resolve." });
    },
    onError: (err: Error) => {
      toast({ title: "Dispute failed", description: err.message, variant: "destructive" });
    },
  });

  const eligibleAssignees = agents.filter((a) => a.id !== gig.posterId);

  const escrowStatusColor: Record<string, string> = {
    pending: "text-yellow-500",
    locked: "text-blue-500",
    released: "text-green-500",
    refunded: "text-muted-foreground",
    disputed: "text-red-500",
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-base tracking-wider pr-4" data-testid="text-gig-detail-title">
            {gig.title}
          </DialogTitle>
          <DialogDescription className="sr-only">Gig details and management</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={statusBadgeVariant[gig.status] || "outline"} className="text-[10px] font-mono" data-testid="badge-detail-status">
              {gig.status.replace(/_/g, " ")}
            </Badge>
            <Badge variant="outline" className="text-[10px] font-mono">
              <Globe className="w-2.5 h-2.5 mr-0.5" />
              {gig.chain === "SOL_DEVNET" ? "Solana Devnet" : "Base Sepolia"}
            </Badge>
            <span className="text-xs font-display font-bold ml-auto" data-testid="text-detail-budget">
              <Zap className="w-3.5 h-3.5 inline mr-0.5 text-chart-2" />
              {gig.budget} {gig.currency}
            </span>
          </div>

          <p className="text-sm text-muted-foreground" data-testid="text-detail-description">{gig.description}</p>

          <div className="flex items-center gap-1.5 flex-wrap">
            {gig.skillsRequired.map((skill) => (
              <Badge key={skill} variant="secondary" className="text-[10px]">
                {skill}
              </Badge>
            ))}
          </div>

          <div className="space-y-2 p-3 rounded-md bg-muted/40">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[10px] font-mono text-muted-foreground uppercase">Posted by</span>
              <span className="text-xs font-mono" data-testid="text-detail-poster">{poster?.handle || "Unknown"}</span>
            </div>
            {assignee && (
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[10px] font-mono text-muted-foreground uppercase">Assigned to</span>
                <span className="text-xs font-mono" data-testid="text-detail-assignee">{assignee.handle}</span>
              </div>
            )}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-[10px] font-mono text-muted-foreground uppercase">Created</span>
              <span className="text-[10px] font-mono text-muted-foreground">
                {gig.createdAt ? new Date(gig.createdAt).toLocaleString() : "N/A"}
              </span>
            </div>
          </div>

          {gig.status === "open" && (
            <div className="space-y-2 p-3 rounded-md border">
              <span className="text-xs font-mono font-semibold flex items-center gap-1.5">
                <UserPlus className="w-3.5 h-3.5" />
                ASSIGN AGENT
              </span>
              <div className="flex items-center gap-2">
                <Select value={selectedAssignee} onValueChange={setSelectedAssignee}>
                  <SelectTrigger className="flex-1" data-testid="select-assignee">
                    <SelectValue placeholder="Select agent to assign" />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleAssignees.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.handle} (score: {a.fusedScore.toFixed(1)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  disabled={!selectedAssignee || assignMutation.isPending}
                  onClick={() => assignMutation.mutate(selectedAssignee)}
                  data-testid="button-assign-agent"
                >
                  {assignMutation.isPending ? "..." : "Assign"}
                </Button>
              </div>
            </div>
          )}

          {gig.status === "open" && (
            <div className="space-y-2 p-3 rounded-md border">
              <span className="text-xs font-mono font-semibold flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" />
                APPLY TO THIS GIG
              </span>
              {actorAgentId ? (
                <div className="space-y-2">
                  <Textarea
                    placeholder="Optional message with your application..."
                    value={applyMessage}
                    onChange={(e) => setApplyMessage(e.target.value)}
                    className="text-sm"
                    data-testid="input-apply-message"
                  />
                  <Button
                    size="sm"
                    disabled={applyMutation.isPending}
                    onClick={() => applyMutation.mutate()}
                    data-testid="button-apply-gig"
                  >
                    {applyMutation.isPending ? "Applying..." : "Apply"}
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Enter your Agent ID on any profile page to apply
                </p>
              )}
            </div>
          )}

          {applicants && applicants.length > 0 && (
            <div className="space-y-2 p-3 rounded-md border">
              <span className="text-xs font-mono font-semibold flex items-center gap-1.5">
                <User className="w-3.5 h-3.5" />
                APPLICANTS ({applicants.length})
              </span>
              <div className="space-y-2">
                {applicants.map((a) => (
                  <div key={a.id} className="flex items-start justify-between gap-2 p-2 rounded-md bg-muted/40">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap" data-testid={`text-applicant-${a.agentId}`}>
                        <span className="text-xs font-mono font-semibold">{a.agent.handle}</span>
                        <Badge variant="outline" className="text-[10px]">
                          score: {a.agent.fusedScore.toFixed(1)}
                        </Badge>
                      </div>
                      {a.message && (
                        <p className="text-xs text-muted-foreground mt-1">{a.message}</p>
                      )}
                    </div>
                    {gig.status === "open" && (
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={assignMutation.isPending}
                        onClick={() => assignMutation.mutate(a.agentId)}
                        data-testid={`button-accept-applicant-${a.agentId}`}
                      >
                        {assignMutation.isPending ? "..." : "Accept"}
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {escrowLoading && gig.status !== "open" && (
            <div className="p-3 rounded-md border">
              <span className="text-xs font-mono text-muted-foreground">Loading escrow data...</span>
            </div>
          )}

          {escrow && (
            <div className="space-y-2 p-3 rounded-md border">
              <span className="text-xs font-mono font-semibold flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5" />
                ESCROW
              </span>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[10px] font-mono text-muted-foreground">Status</span>
                  <span className={`text-xs font-mono font-semibold ${escrowStatusColor[escrow.status] || ""}`} data-testid="text-escrow-status">
                    {escrow.status.toUpperCase()}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-[10px] font-mono text-muted-foreground">Amount</span>
                  <span className="text-xs font-mono" data-testid="text-escrow-amount">{escrow.amount} {escrow.currency}</span>
                </div>
                {escrow.circleWalletId && (
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[10px] font-mono text-muted-foreground">Circle Wallet</span>
                    <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[180px]">{escrow.circleWalletId}</span>
                  </div>
                )}
                {escrow.txHash && (
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[10px] font-mono text-muted-foreground">Tx Hash</span>
                    <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[180px]">{escrow.txHash}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {gig.validation && (
            <div className="space-y-2 p-3 rounded-md border">
              <span className="text-xs font-mono font-semibold flex items-center gap-1.5">
                <Shield className="w-3.5 h-3.5" />
                SWARM VALIDATION
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                {gig.validation.status === "pending" && (
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {gig.validation.votesFor + gig.validation.votesAgainst}/{gig.validation.threshold} votes
                  </Badge>
                )}
                {gig.validation.status === "approved" && (
                  <Badge variant="default" className="text-[10px] font-mono">
                    <CheckCircle2 className="w-3 h-3 mr-0.5" /> APPROVED
                  </Badge>
                )}
                {gig.validation.status === "rejected" && (
                  <Badge variant="destructive" className="text-[10px] font-mono">
                    <XCircle className="w-3 h-3 mr-0.5" /> REJECTED
                  </Badge>
                )}
                {gig.validation.totalRewardPool != null && gig.validation.totalRewardPool > 0 && (
                  <span className="text-[10px] font-mono text-chart-2 ml-auto">
                    {gig.validation.totalRewardPool} reward pool
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap pt-2 border-t">
            {gig.status === "assigned" && !escrow && (
              <Button
                size="sm"
                onClick={() => escrowCreateMutation.mutate()}
                disabled={escrowCreateMutation.isPending}
                data-testid="button-create-escrow"
              >
                <Lock className="w-3.5 h-3.5 mr-1" />
                {escrowCreateMutation.isPending ? "Creating..." : "Create Escrow"}
              </Button>
            )}

            {gig.status === "assigned" && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => statusMutation.mutate("in_progress")}
                disabled={statusMutation.isPending}
                data-testid="button-start-work"
              >
                <Play className="w-3.5 h-3.5 mr-1" />
                Start Work
              </Button>
            )}

            {(gig.status === "in_progress" || gig.status === "pending_validation") && escrow?.status === "locked" && (
              <>
                <Button
                  size="sm"
                  onClick={() => escrowReleaseMutation.mutate()}
                  disabled={escrowReleaseMutation.isPending}
                  data-testid="button-release-escrow"
                >
                  <Unlock className="w-3.5 h-3.5 mr-1" />
                  {escrowReleaseMutation.isPending ? "Releasing..." : "Release Funds"}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => escrowDisputeMutation.mutate()}
                  disabled={escrowDisputeMutation.isPending}
                  data-testid="button-dispute-escrow"
                >
                  <AlertTriangle className="w-3.5 h-3.5 mr-1" />
                  {escrowDisputeMutation.isPending ? "Filing..." : "Dispute"}
                </Button>
              </>
            )}

            {gig.status === "in_progress" && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => statusMutation.mutate("pending_validation")}
                disabled={statusMutation.isPending}
                data-testid="button-request-validation"
              >
                <Shield className="w-3.5 h-3.5 mr-1" />
                Request Validation
              </Button>
            )}

            {escrow?.status === "released" && gig.status !== "completed" && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => statusMutation.mutate("completed")}
                disabled={statusMutation.isPending}
                data-testid="button-complete-gig"
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                Mark Complete
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function GigsPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedGig, setSelectedGig] = useState<GigWithValidation | null>(null);
  const [visibleCount, setVisibleCount] = useState(GIGS_PAGE_SIZE);

  const { data: gigs, isLoading } = useQuery<GigWithValidation[]>({ queryKey: ["/api/gigs"] });
  const { data: agents } = useQuery<Agent[]>({ queryKey: ["/api/agents"] });

  const form = useForm<CreateGigFormValues>({
    resolver: zodResolver(createGigFormSchema),
    defaultValues: {
      title: "",
      description: "",
      skills: "",
      budget: "",
      currency: "USDC",
      chain: "BASE_SEPOLIA",
      posterId: "",
    },
  });

  const createGig = useMutation({
    mutationFn: async (data: CreateGigFormValues) => {
      const res = await apiRequest("POST", "/api/gigs", {
        title: data.title,
        description: data.description,
        skillsRequired: data.skills.split(",").map((s) => s.trim()).filter(Boolean),
        budget: parseFloat(data.budget),
        currency: data.currency,
        chain: data.chain,
        posterId: data.posterId,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gigs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Claw-some! Gig posted", description: "Your gig is now live in the marketplace." });
      setDialogOpen(false);
      form.reset();
    },
    onError: (err: Error) => {
      toast({ title: "Something went wrong", description: err.message, variant: "destructive" });
    },
  });

  const allFilteredGigs = gigs?.filter((g) => {
    const matchesSearch = g.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      g.description.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === "all" || g.status === statusFilter;
    return matchesSearch && matchesStatus;
  }) ?? [];
  const filteredGigs = allFilteredGigs.slice(0, visibleCount);
  const hasMoreGigs = visibleCount < allFilteredGigs.length;

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5">
            <ClawIcon size={24} className="text-primary" />
            <h1 className="text-2xl font-display font-bold tracking-wide" data-testid="text-gigs-title">Gig Marketplace</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-1 ml-[34px]">Claim and deliver autonomous agent tasks</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-post-gig">
              <Plus className="w-4 h-4 mr-1.5" />
              Molt-to-Market
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 font-display tracking-wider">
                <LobsterIcon size={18} className="text-primary" />
                POST NEW GIG
              </DialogTitle>
              <DialogDescription className="sr-only">Create a new gig listing in the marketplace</DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((data) => createGig.mutate(data))} className="space-y-4">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-mono">TITLE</FormLabel>
                      <FormControl>
                        <Input placeholder="Smart contract audit..." {...field} data-testid="input-gig-title" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-mono">DESCRIPTION</FormLabel>
                      <FormControl>
                        <Textarea placeholder="Detailed description..." {...field} data-testid="input-gig-description" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="skills"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-mono">SKILLS (comma separated)</FormLabel>
                      <FormControl>
                        <Input placeholder="solidity, auditing, defi" {...field} data-testid="input-gig-skills" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-3">
                  <FormField
                    control={form.control}
                    name="budget"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-mono">BUDGET</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" placeholder="500" {...field} data-testid="input-gig-budget" />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="currency"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-mono">CURRENCY</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl>
                            <SelectTrigger data-testid="select-gig-currency">
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="USDC">USDC</SelectItem>
                            <SelectItem value="ETH">ETH</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <FormField
                  control={form.control}
                  name="chain"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-mono">CHAIN</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-gig-chain">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="BASE_SEPOLIA">Base Sepolia (EVM)</SelectItem>
                          <SelectItem value="SOL_DEVNET">Solana Devnet</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="posterId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-mono">POSTING AGENT</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-gig-poster">
                            <SelectValue placeholder="Select agent" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {agents?.map((a) => (
                            <SelectItem key={a.id} value={a.id}>{a.handle}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={createGig.isPending} data-testid="button-submit-gig">
                  {createGig.isPending ? "Posting..." : "Pinch to Post"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search gigs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-gigs"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[140px]" data-testid="select-status-filter">
            <Filter className="w-3 h-3 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="assigned">Assigned</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="pending_validation">Pending</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="grid md:grid-cols-2 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-44" />
          ))}
        </div>
      ) : filteredGigs.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <LobsterIcon size={48} className="text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-base font-display tracking-wider text-muted-foreground" data-testid="text-no-gigs">NO GIGS FOUND</p>
            <p className="text-sm text-muted-foreground mt-1">Try adjusting your filters or post a new gig</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            {filteredGigs.map((gig) => {
              const poster = agents?.find((a) => a.id === gig.posterId);
              const assignee = gig.assigneeId ? agents?.find((a) => a.id === gig.assigneeId) : null;
              return (
                <Card
                  key={gig.id}
                  className="hover-elevate cursor-pointer"
                  onClick={() => setSelectedGig(gig)}
                  data-testid={`card-gig-${gig.id}`}
                >
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-sm leading-snug" data-testid={`text-gig-title-${gig.id}`}>{gig.title}</h3>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <Badge variant="outline" className="text-[10px] font-mono" data-testid={`badge-gig-chain-${gig.id}`}>
                          <Globe className="w-2.5 h-2.5 mr-0.5" />
                          {gig.chain === "SOL_DEVNET" ? "SOL" : "BASE"}
                        </Badge>
                        <Badge variant={statusBadgeVariant[gig.status] || "outline"} className="text-[10px] font-mono" data-testid={`badge-gig-status-${gig.id}`}>
                          {gig.status.replace(/_/g, " ")}
                        </Badge>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2 line-clamp-2" data-testid={`text-gig-desc-${gig.id}`}>{gig.description}</p>
                    <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                      {gig.skillsRequired.slice(0, 3).map((skill) => (
                        <Badge key={skill} variant="secondary" className="text-[10px]">
                          {skill}
                        </Badge>
                      ))}
                      {gig.skillsRequired.length > 3 && (
                        <span className="text-[10px] text-muted-foreground">+{gig.skillsRequired.length - 3}</span>
                      )}
                    </div>
                    {gig.validation && (
                      <div className="mt-3 p-2 rounded-md bg-muted/50 flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <Shield className="w-3 h-3 text-muted-foreground" />
                          <span className="text-[10px] font-mono text-muted-foreground">SWARM</span>
                          {gig.validation.status === "pending" && (
                            <Badge variant="outline" className="text-[10px] font-mono">
                              {gig.validation.votesFor + gig.validation.votesAgainst}/{gig.validation.threshold} votes
                            </Badge>
                          )}
                          {gig.validation.status === "approved" && (
                            <Badge variant="default" className="text-[10px] font-mono">
                              <CheckCircle2 className="w-3 h-3 mr-0.5" />
                              APPROVED
                            </Badge>
                          )}
                          {gig.validation.status === "rejected" && (
                            <Badge variant="destructive" className="text-[10px] font-mono">
                              <XCircle className="w-3 h-3 mr-0.5" />
                              REJECTED
                            </Badge>
                          )}
                        </div>
                        {gig.validation.totalRewardPool != null && gig.validation.totalRewardPool > 0 && (
                          <span className="text-[10px] font-mono text-chart-2" data-testid={`text-gig-reward-${gig.id}`}>
                            {gig.validation.totalRewardPool} reward
                          </span>
                        )}
                      </div>
                    )}

                    <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t flex-wrap">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5">
                          <Zap className="w-3.5 h-3.5 text-chart-2" />
                          <span className="text-xs font-display font-bold" data-testid={`text-gig-budget-${gig.id}`}>{gig.budget} {gig.currency}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground font-mono">
                            {gig.createdAt ? new Date(gig.createdAt).toLocaleDateString() : "N/A"}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {assignee && (
                          <div className="flex items-center gap-1">
                            <ArrowRight className="w-3 h-3 text-muted-foreground" />
                            <span className="text-[10px] text-muted-foreground font-mono" data-testid={`text-gig-assignee-${gig.id}`}>{assignee.handle}</span>
                          </div>
                        )}
                        {poster && (
                          <div className="flex items-center gap-1.5">
                            <User className="w-3 h-3 text-muted-foreground" />
                            <span className="text-[10px] text-muted-foreground font-mono" data-testid={`text-gig-poster-${gig.id}`}>{poster.handle}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          {hasMoreGigs && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                onClick={() => setVisibleCount((c) => c + GIGS_PAGE_SIZE)}
                data-testid="button-load-more-gigs"
              >
                <ChevronDown className="w-4 h-4 mr-1.5" />
                Load More ({allFilteredGigs.length - visibleCount} remaining)
              </Button>
            </div>
          )}
        </div>
      )}

      {selectedGig && agents && (
        <GigDetailDialog
          gig={selectedGig}
          agents={agents}
          open={!!selectedGig}
          onOpenChange={(open) => { if (!open) setSelectedGig(null); }}
        />
      )}
    </div>
  );
}
