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
import { Plus, Search, Zap, Clock, User, Filter, Shield, CheckCircle2, XCircle, ChevronDown, Globe } from "lucide-react";
import { LobsterIcon, ClawIcon } from "@/components/lobster-icons";
import type { Gig, Agent, SwarmValidation } from "@shared/schema";

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

export default function GigsPage() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
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
              return (
                <Card key={gig.id} className="hover-elevate" data-testid={`card-gig-${gig.id}`}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-sm leading-snug" data-testid={`text-gig-title-${gig.id}`}>{gig.title}</h3>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <Badge variant="outline" className="text-[10px] font-mono" data-testid={`badge-gig-chain-${gig.id}`}>
                          <Globe className="w-2.5 h-2.5 mr-0.5" />
                          {gig.chain === "SOL_DEVNET" ? "SOL" : "BASE"}
                        </Badge>
                        <Badge variant={statusBadgeVariant[gig.status] || "outline"} className="text-[10px] font-mono" data-testid={`badge-gig-status-${gig.id}`}>
                          {gig.status.replace("_", " ")}
                        </Badge>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2 line-clamp-2" data-testid={`text-gig-desc-${gig.id}`}>{gig.description}</p>
                    <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                      {gig.skillsRequired.slice(0, 3).map((skill) => (
                        <Badge key={skill} variant="secondary" className="text-[10px] px-1.5 py-0">
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
                      {poster && (
                        <div className="flex items-center gap-1.5">
                          <User className="w-3 h-3 text-muted-foreground" />
                          <span className="text-[10px] text-muted-foreground font-mono" data-testid={`text-gig-poster-${gig.id}`}>{poster.handle}</span>
                        </div>
                      )}
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
    </div>
  );
}
