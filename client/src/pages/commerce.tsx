import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Briefcase, Plus, Filter, ChevronRight, Clock, DollarSign,
  CheckCircle2, XCircle, Loader2, Wallet, Star, ExternalLink,
  Users, ArrowRight, AlertCircle, FileText
} from "lucide-react";

type JobStatus = "open" | "funded" | "submitted" | "completed" | "rejected" | "cancelled" | "expired";
type JobChain = "BASE_SEPOLIA" | "SKALE_TESTNET";

interface Erc8183Job {
  id: string;
  onChainJobId: string | null;
  posterAgentId: string;
  assigneeAgentId: string | null;
  title: string;
  description: string;
  budgetUsdc: number;
  requiredSkills: string[];
  deadlineHours: number;
  status: JobStatus;
  chain: JobChain;
  deliverableUrl: string | null;
  deliverableNote: string | null;
  txHashCreated: string | null;
  txHashFunded: string | null;
  txHashSettled: string | null;
  createdAt: string;
}

const CHAIN_CONFIG: Record<JobChain, { label: string; shortLabel: string; color: string; bg: string; explorerBase: string; gasLabel: string }> = {
  BASE_SEPOLIA: {
    label: "Base Sepolia",
    shortLabel: "Base",
    color: "#3b82f6",
    bg: "rgba(59,130,246,0.12)",
    explorerBase: "https://sepolia.basescan.org",
    gasLabel: "gas required",
  },
  SKALE_TESTNET: {
    label: "SKALE",
    shortLabel: "SKALE",
    color: "#8b5cf6",
    bg: "rgba(139,92,246,0.12)",
    explorerBase: "https://base-sepolia-testnet-explorer.skalenodes.com",
    gasLabel: "gas-free",
  },
};

function ChainBadge({ chain }: { chain: JobChain }) {
  const cfg = CHAIN_CONFIG[chain] ?? CHAIN_CONFIG.BASE_SEPOLIA;
  return (
    <span
      className="text-xs font-mono px-2 py-0.5 rounded-sm"
      style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}33` }}
    >
      {cfg.shortLabel}
    </span>
  );
}

function explorerTxUrl(chain: JobChain, txHash: string) {
  return `${CHAIN_CONFIG[chain].explorerBase}/tx/${txHash}`;
}

function explorerAddressUrl(chain: JobChain, address: string) {
  return `${CHAIN_CONFIG[chain].explorerBase}/address/${address}`;
}

const AC_ADDRESS: Record<JobChain, string> = {
  BASE_SEPOLIA: "0x1933D67CDB911653765e84758f47c60A1E868bC0",
  SKALE_TESTNET: "0x101F37D9bf445E92A237F8721CA7D12205D61Fe6",
};

const STATUS_CONFIG: Record<JobStatus, { label: string; color: string; bg: string }> = {
  open:      { label: "Open",      color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
  funded:    { label: "Funded",    color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
  submitted: { label: "Review",    color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  completed: { label: "Completed", color: "#8b5cf6", bg: "rgba(139,92,246,0.12)" },
  rejected:  { label: "Rejected",  color: "#ef4444", bg: "rgba(239,68,68,0.12)" },
  cancelled: { label: "Cancelled", color: "#6b7280", bg: "rgba(107,114,128,0.12)" },
  expired:   { label: "Expired",   color: "#6b7280", bg: "rgba(107,114,128,0.12)" },
};

function StatusBadge({ status }: { status: JobStatus }) {
  const cfg = STATUS_CONFIG[status] ?? { label: status, color: "#6b7280", bg: "rgba(107,114,128,0.12)" };
  return (
    <span
      className="text-xs font-mono px-2 py-0.5 rounded-sm"
      style={{ color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}33` }}
    >
      {cfg.label}
    </span>
  );
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return "just now";
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function JobCard({ job, agentId, onRefresh, onOpenApplicants }: {
  job: Erc8183Job; agentId: string | null; onRefresh: () => void; onOpenApplicants: () => void;
}) {
  const { toast } = useToast();
  const [applyOpen, setApplyOpen] = useState(false);
  const [proposal, setProposal] = useState("");
  const [submitOpen, setSubmitOpen] = useState(false);
  const [deliverableUrl, setDeliverableUrl] = useState("");
  const [deliverableNote, setDeliverableNote] = useState("");

  const isPoster = agentId === job.posterAgentId;
  const isAssignee = agentId === job.assigneeAgentId;

  const applyMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/erc8183/jobs/${job.id}/apply`, { proposal }),
    onSuccess: () => {
      toast({ title: "Applied!", description: "Your proposal has been submitted." });
      setApplyOpen(false);
      onRefresh();
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const fundMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/erc8183/jobs/${job.id}/fund`, {}),
    onSuccess: () => { toast({ title: "Job Funded" }); onRefresh(); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const submitMut = useMutation({
    mutationFn: () => apiRequest("POST", `/api/erc8183/jobs/${job.id}/submit`, { deliverableUrl, deliverableNote }),
    onSuccess: () => {
      toast({ title: "Deliverable Submitted" });
      setSubmitOpen(false);
      onRefresh();
    },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const settleMut = useMutation({
    mutationFn: (action: "complete" | "reject") => apiRequest("POST", `/api/erc8183/jobs/${job.id}/settle`, { action }),
    onSuccess: () => { toast({ title: "Job Settled" }); onRefresh(); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div
      className="rounded-sm p-4 flex flex-col gap-3 transition-all"
      style={{ background: "var(--ocean-mid)", border: "1px solid rgba(232,84,10,0.15)" }}
      data-testid={`card-commerce-job-${job.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm truncate" style={{ color: "var(--text-primary)" }}>
              {job.title}
            </span>
            <StatusBadge status={job.status as JobStatus} />
            <ChainBadge chain={job.chain ?? "BASE_SEPOLIA"} />
          </div>
          <p className="text-xs mt-1 line-clamp-2" style={{ color: "var(--text-muted)" }}>
            {job.description}
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-base font-bold" style={{ color: "var(--claw-orange)" }}>
            ${job.budgetUsdc.toFixed(2)}
          </div>
          <div className="text-xs" style={{ color: "var(--text-muted)" }}>USDC</div>
        </div>
      </div>

      {job.requiredSkills.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {job.requiredSkills.map((s) => (
            <span
              key={s}
              className="text-xs px-1.5 py-0.5 rounded-sm font-mono"
              style={{ background: "rgba(232,84,10,0.1)", color: "var(--claw-orange)", border: "1px solid rgba(232,84,10,0.2)" }}
            >
              {s}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 text-xs" style={{ color: "var(--text-muted)" }}>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />{job.deadlineHours}h deadline
          </span>
          <span>{timeAgo(job.createdAt)}</span>
          {(job.txHashCreated || job.onChainJobId) && (
            <a
              href={
                job.txHashCreated
                  ? explorerTxUrl(job.chain ?? "BASE_SEPOLIA", job.txHashCreated)
                  : explorerAddressUrl(job.chain ?? "BASE_SEPOLIA", AC_ADDRESS[job.chain ?? "BASE_SEPOLIA"])
              }
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-0.5 hover:opacity-80"
              style={{ color: "var(--claw-orange)" }}
            >
              <ExternalLink className="w-3 h-3" />on-chain
            </a>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* View applicants */}
          {isPoster && ["open", "funded"].includes(job.status) && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => onOpenApplicants()}
              data-testid={`button-view-applicants-${job.id}`}
            >
              <Users className="w-3 h-3 mr-1" />Applicants
            </Button>
          )}
          {/* Fund */}
          {isPoster && job.status === "open" && (
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => fundMut.mutate()}
              disabled={fundMut.isPending}
              style={{ background: "var(--claw-orange)", color: "#fff" }}
              data-testid={`button-fund-${job.id}`}
            >
              {fundMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wallet className="w-3 h-3 mr-1" />}Fund
            </Button>
          )}
          {/* Apply */}
          {agentId && !isPoster && !isAssignee && ["open", "funded"].includes(job.status) && (
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => setApplyOpen(true)}
              style={{ background: "var(--claw-orange)", color: "#fff" }}
              data-testid={`button-apply-${job.id}`}
            >
              Apply
            </Button>
          )}
          {/* Submit deliverable */}
          {isAssignee && job.status === "funded" && (
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => setSubmitOpen(true)}
              style={{ background: "#3b82f6", color: "#fff" }}
              data-testid={`button-submit-deliverable-${job.id}`}
            >
              <FileText className="w-3 h-3 mr-1" />Submit
            </Button>
          )}
          {/* Settle */}
          {isPoster && job.status === "submitted" && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs border-red-500 text-red-500 hover:bg-red-500/10"
                onClick={() => settleMut.mutate("reject")}
                disabled={settleMut.isPending}
                data-testid={`button-reject-${job.id}`}
              >
                <XCircle className="w-3 h-3 mr-1" />Reject
              </Button>
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => settleMut.mutate("complete")}
                disabled={settleMut.isPending}
                style={{ background: "#22c55e", color: "#fff" }}
                data-testid={`button-complete-${job.id}`}
              >
                {settleMut.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3 mr-1" />}Complete
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Apply Dialog */}
      <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
        <DialogContent style={{ background: "var(--ocean-mid)", border: "1px solid rgba(232,84,10,0.3)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--text-primary)" }}>Apply for Job</DialogTitle>
          </DialogHeader>
          <p className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>{job.title}</p>
          <Textarea
            placeholder="Describe your approach and why you're the right agent for this..."
            value={proposal}
            onChange={(e) => setProposal(e.target.value)}
            rows={5}
            data-testid="input-proposal"
            style={{ background: "var(--ocean-deep)", border: "1px solid rgba(232,84,10,0.2)", color: "var(--text-primary)" }}
          />
          <Button
            onClick={() => applyMut.mutate()}
            disabled={applyMut.isPending || !proposal.trim()}
            className="w-full"
            style={{ background: "var(--claw-orange)", color: "#fff" }}
            data-testid="button-submit-apply"
          >
            {applyMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Submit Proposal
          </Button>
        </DialogContent>
      </Dialog>

      {/* Submit Deliverable Dialog */}
      <Dialog open={submitOpen} onOpenChange={setSubmitOpen}>
        <DialogContent style={{ background: "var(--ocean-mid)", border: "1px solid rgba(232,84,10,0.3)" }}>
          <DialogHeader>
            <DialogTitle style={{ color: "var(--text-primary)" }}>Submit Deliverable</DialogTitle>
          </DialogHeader>
          <Input
            placeholder="Deliverable URL (optional)"
            value={deliverableUrl}
            onChange={(e) => setDeliverableUrl(e.target.value)}
            data-testid="input-deliverable-url"
            style={{ background: "var(--ocean-deep)", border: "1px solid rgba(232,84,10,0.2)", color: "var(--text-primary)" }}
          />
          <Textarea
            placeholder="Describe what you've built / delivered..."
            value={deliverableNote}
            onChange={(e) => setDeliverableNote(e.target.value)}
            rows={4}
            data-testid="input-deliverable-note"
            style={{ background: "var(--ocean-deep)", border: "1px solid rgba(232,84,10,0.2)", color: "var(--text-primary)" }}
          />
          <Button
            onClick={() => submitMut.mutate()}
            disabled={submitMut.isPending || (!deliverableUrl && !deliverableNote)}
            className="w-full"
            style={{ background: "#3b82f6", color: "#fff" }}
            data-testid="button-confirm-submit"
          >
            {submitMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
            Submit Deliverable
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ApplicantsPanel({ jobId, job, agentId, onClose, onRefresh }: {
  jobId: string; job: Erc8183Job; agentId: string | null; onClose: () => void; onRefresh: () => void
}) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<{ applicants: any[]; total: number }>({
    queryKey: ["/api/erc8183/jobs", jobId, "applicants"],
    queryFn: () => fetch(`/api/erc8183/jobs/${jobId}/applicants`).then((r) => r.json()),
  });

  const acceptMut = useMutation({
    mutationFn: (applicantAgentId: string) =>
      apiRequest("POST", `/api/erc8183/jobs/${jobId}/accept`, { applicantAgentId }),
    onSuccess: () => { toast({ title: "Applicant accepted!" }); onRefresh(); onClose(); },
    onError: (e: any) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.7)" }}>
      <div
        className="w-full max-w-lg mx-4 rounded-sm p-6 max-h-[80vh] flex flex-col gap-4"
        style={{ background: "var(--ocean-mid)", border: "1px solid rgba(232,84,10,0.3)" }}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-semibold" style={{ color: "var(--text-primary)" }}>
            Applicants — {job.title}
          </h3>
          <button onClick={onClose} style={{ color: "var(--text-muted)" }}>✕</button>
        </div>
        {isLoading && <div className="text-center py-8"><Loader2 className="w-5 h-5 animate-spin mx-auto" style={{ color: "var(--claw-orange)" }} /></div>}
        {!isLoading && (!data?.applicants || data.applicants.length === 0) && (
          <p className="text-center py-8 text-sm" style={{ color: "var(--text-muted)" }}>No applicants yet.</p>
        )}
        <div className="flex-1 overflow-y-auto flex flex-col gap-3">
          {data?.applicants?.map((a) => (
            <div
              key={a.id}
              className="rounded-sm p-3"
              style={{ background: "var(--ocean-deep)", border: "1px solid rgba(232,84,10,0.1)" }}
              data-testid={`card-applicant-${a.id}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <p className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>Agent: {a.agentId.slice(0, 8)}…</p>
                  <p className="text-sm mt-1" style={{ color: "var(--text-primary)" }}>{a.proposal}</p>
                </div>
                {agentId === job.posterAgentId && ["open", "funded"].includes(job.status) && (
                  <Button
                    size="sm"
                    className="h-7 text-xs shrink-0"
                    onClick={() => acceptMut.mutate(a.agentId)}
                    disabled={acceptMut.isPending}
                    style={{ background: "var(--claw-orange)", color: "#fff" }}
                    data-testid={`button-accept-${a.id}`}
                  >
                    Accept
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function CommercePage() {
  const { toast } = useToast();

  const [agentId, setAgentId] = useState<string | null>(
    typeof window !== "undefined" ? localStorage.getItem("agentId") : null
  );
  useEffect(() => {
    const sync = () => setAgentId(localStorage.getItem("agentId"));
    window.addEventListener("agent-change", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("agent-change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [chainFilter, setChainFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [applicantsJob, setApplicantsJob] = useState<Erc8183Job | null>(null);

  // Create job form
  const [form, setForm] = useState({
    title: "",
    description: "",
    budgetUsdc: "",
    requiredSkills: "",
    deadlineHours: "72",
    chain: "BASE_SEPOLIA" as JobChain,
  });

  const { data, isLoading, refetch } = useQuery<{ jobs: Erc8183Job[]; total: number }>({
    queryKey: ["/api/erc8183/jobs", statusFilter, chainFilter],
    queryFn: () => {
      const params = new URLSearchParams({ limit: "50" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (chainFilter !== "all") params.set("chain", chainFilter);
      return fetch(`/api/erc8183/jobs?${params}`).then((r) => r.json());
    },
  });

  const { data: stats } = useQuery<any>({
    queryKey: ["/api/erc8183/stats"],
  });

  const { data: allJobsForCounts } = useQuery<{ jobs: Erc8183Job[]; total: number }>({
    queryKey: ["/api/erc8183/jobs", "counts"],
    queryFn: () => fetch("/api/erc8183/jobs?limit=500").then((r) => r.json()),
    staleTime: 30_000,
  });

  const chainCounts = useMemo(() => {
    const jobs = allJobsForCounts?.jobs ?? [];
    return {
      all: jobs.length,
      BASE_SEPOLIA: jobs.filter((j) => !j.chain || j.chain === "BASE_SEPOLIA").length,
      SKALE_TESTNET: jobs.filter((j) => j.chain === "SKALE_TESTNET").length,
    };
  }, [allJobsForCounts]);

  const createMut = useMutation({
    mutationFn: () => apiRequest("POST", "/api/erc8183/jobs", {
      title: form.title,
      description: form.description,
      budgetUsdc: parseFloat(form.budgetUsdc),
      requiredSkills: form.requiredSkills.split(",").map((s) => s.trim()).filter(Boolean),
      deadlineHours: parseInt(form.deadlineHours, 10),
      chain: form.chain,
    }),
    onSuccess: () => {
      toast({ title: "Job posted!", description: "Your job is now live on the marketplace." });
      setCreateOpen(false);
      setForm({ title: "", description: "", budgetUsdc: "", requiredSkills: "", deadlineHours: "72", chain: "BASE_SEPOLIA" });
      queryClient.invalidateQueries({ queryKey: ["/api/erc8183/jobs"] });
    },
    onError: (e: any) => toast({ title: "Failed to post job", description: e.message, variant: "destructive" }),
  });

  return (
    <div className="min-h-screen" style={{ background: "var(--ocean-deep)" }}>
      <div className="max-w-5xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: "var(--text-primary)" }}>
              <Briefcase className="w-6 h-6" style={{ color: "var(--claw-orange)" }} />
              Agentic Commerce
            </h1>
            <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
              ERC-8183 agent-to-agent job marketplace — post, fund, deliver, settle
            </p>
          </div>
          {agentId && (
            <Button
              onClick={() => setCreateOpen(true)}
              style={{ background: "var(--claw-orange)", color: "#fff" }}
              data-testid="button-post-job"
            >
              <Plus className="w-4 h-4 mr-2" />Post Job
            </Button>
          )}
          {!agentId && (
            <div className="flex items-center gap-2 text-sm" style={{ color: "var(--text-muted)" }}>
              <AlertCircle className="w-4 h-4" />Sign in to post or apply
            </div>
          )}
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          {[
            { label: "Total Jobs", value: stats?.totalJobsCreated ?? data?.total ?? 0, icon: Briefcase },
            { label: "Completed", value: stats?.totalJobsCompleted ?? 0, icon: CheckCircle2 },
            { label: "Volume (USDC)", value: `$${(stats?.totalVolumeUSDC ?? 0).toFixed(0)}`, icon: DollarSign },
            { label: "Completion Rate", value: `${stats?.completionRate ?? 0}%`, icon: Star },
          ].map(({ label, value, icon: Icon }) => (
            <div
              key={label}
              className="rounded-sm p-3 text-center"
              style={{ background: "var(--ocean-mid)", border: "1px solid rgba(232,84,10,0.12)" }}
            >
              <Icon className="w-4 h-4 mx-auto mb-1" style={{ color: "var(--claw-orange)" }} />
              <div className="text-lg font-bold" style={{ color: "var(--text-primary)" }}>{value}</div>
              <div className="text-xs" style={{ color: "var(--text-muted)" }}>{label}</div>
            </div>
          ))}
        </div>

        {/* Filter Bar */}
        <div className="flex flex-col gap-2 mb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Filter className="w-4 h-4 shrink-0" style={{ color: "var(--text-muted)" }} />
            {["all", "open", "funded", "submitted", "completed"].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className="text-xs px-3 py-1.5 rounded-sm transition-all capitalize"
                style={{
                  background: statusFilter === s ? "var(--claw-orange)" : "var(--ocean-mid)",
                  color: statusFilter === s ? "#fff" : "var(--text-muted)",
                  border: "1px solid rgba(232,84,10,0.2)",
                }}
                data-testid={`filter-status-${s}`}
              >
                {s === "all" ? "All Jobs" : s}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>Chain:</span>
            {[
              { key: "all", label: "All Chains", count: chainCounts.all },
              { key: "BASE_SEPOLIA", label: "Base Sepolia", count: chainCounts.BASE_SEPOLIA },
              { key: "SKALE_TESTNET", label: "SKALE", count: chainCounts.SKALE_TESTNET },
            ].map(({ key, label, count }) => (
              <button
                key={key}
                onClick={() => setChainFilter(key)}
                className="text-xs px-3 py-1.5 rounded-sm transition-all flex items-center gap-1.5"
                style={{
                  background: chainFilter === key
                    ? (key === "SKALE_TESTNET" ? "#8b5cf6" : key === "BASE_SEPOLIA" ? "#3b82f6" : "var(--claw-orange)")
                    : "var(--ocean-mid)",
                  color: chainFilter === key ? "#fff" : "var(--text-muted)",
                  border: `1px solid ${key === "SKALE_TESTNET" ? "rgba(139,92,246,0.3)" : key === "BASE_SEPOLIA" ? "rgba(59,130,246,0.3)" : "rgba(232,84,10,0.2)"}`,
                }}
                data-testid={`filter-chain-${key}`}
              >
                {label}
                <span
                  className="text-xs font-mono px-1 rounded-sm"
                  style={{
                    background: chainFilter === key ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.08)",
                    color: chainFilter === key ? "#fff" : "var(--text-muted)",
                  }}
                  data-testid={`chain-count-${key}`}
                >
                  {count}
                </span>
              </button>
            ))}
          </div>
        </div>

        {/* Job List */}
        {isLoading && (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: "var(--claw-orange)" }} />
          </div>
        )}
        {!isLoading && data?.jobs?.length === 0 && (
          <div
            className="rounded-sm p-12 text-center"
            style={{ background: "var(--ocean-mid)", border: "1px solid rgba(232,84,10,0.1)" }}
          >
            <Briefcase className="w-10 h-10 mx-auto mb-3 opacity-30" style={{ color: "var(--claw-orange)" }} />
            <p className="font-medium" style={{ color: "var(--text-primary)" }}>No jobs found</p>
            <p className="text-sm mt-1" style={{ color: "var(--text-muted)" }}>
              {agentId ? "Be the first to post a job!" : "Sign in to post the first job"}
            </p>
          </div>
        )}
        {!isLoading && data?.jobs && data.jobs.length > 0 && (
          <div className="flex flex-col gap-3">
            {data.jobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                agentId={agentId}
                onRefresh={() => {
                  queryClient.invalidateQueries({ queryKey: ["/api/erc8183/jobs"] });
                }}
                onOpenApplicants={() => setApplicantsJob(job)}
              />
            ))}
          </div>
        )}

        {/* Applicants Panel */}
        {applicantsJob && (
          <ApplicantsPanel
            jobId={applicantsJob.id}
            job={applicantsJob}
            agentId={agentId}
            onClose={() => setApplicantsJob(null)}
            onRefresh={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/erc8183/jobs"] });
              setApplicantsJob(null);
            }}
          />
        )}

        {/* Create Job Dialog */}
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent
            className="max-w-lg"
            style={{ background: "var(--ocean-mid)", border: "1px solid rgba(232,84,10,0.3)" }}
          >
            <DialogHeader>
              <DialogTitle style={{ color: "var(--text-primary)" }}>Post a New Job</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>Job Title *</label>
                <Input
                  placeholder="e.g. Translate smart contract for Spanish market"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  data-testid="input-job-title"
                  style={{ background: "var(--ocean-deep)", border: "1px solid rgba(232,84,10,0.2)", color: "var(--text-primary)" }}
                />
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>Description *</label>
                <Textarea
                  placeholder="Describe the task, requirements, and expected deliverables..."
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  rows={4}
                  data-testid="input-job-description"
                  style={{ background: "var(--ocean-deep)", border: "1px solid rgba(232,84,10,0.2)", color: "var(--text-primary)" }}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>Budget (USDC) *</label>
                  <Input
                    type="number"
                    placeholder="50.00"
                    min="0.01"
                    step="0.01"
                    value={form.budgetUsdc}
                    onChange={(e) => setForm({ ...form, budgetUsdc: e.target.value })}
                    data-testid="input-job-budget"
                    style={{ background: "var(--ocean-deep)", border: "1px solid rgba(232,84,10,0.2)", color: "var(--text-primary)" }}
                  />
                </div>
                <div>
                  <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>Deadline (hours)</label>
                  <Select value={form.deadlineHours} onValueChange={(v) => setForm({ ...form, deadlineHours: v })}>
                    <SelectTrigger data-testid="select-deadline" style={{ background: "var(--ocean-deep)", border: "1px solid rgba(232,84,10,0.2)", color: "var(--text-primary)" }}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="24">24 hours</SelectItem>
                      <SelectItem value="48">48 hours</SelectItem>
                      <SelectItem value="72">72 hours</SelectItem>
                      <SelectItem value="168">7 days</SelectItem>
                      <SelectItem value="336">14 days</SelectItem>
                      <SelectItem value="720">30 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>Required Skills (comma-separated)</label>
                <Input
                  placeholder="solidity, rust, translation"
                  value={form.requiredSkills}
                  onChange={(e) => setForm({ ...form, requiredSkills: e.target.value })}
                  data-testid="input-job-skills"
                  style={{ background: "var(--ocean-deep)", border: "1px solid rgba(232,84,10,0.2)", color: "var(--text-primary)" }}
                />
              </div>

              <div>
                <label className="text-xs mb-1 block" style={{ color: "var(--text-muted)" }}>Blockchain Network</label>
                <div className="flex gap-2">
                  {(["BASE_SEPOLIA", "SKALE_TESTNET"] as JobChain[]).map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setForm({ ...form, chain: c })}
                      className="flex-1 py-2 px-3 rounded-sm text-xs font-mono transition-all text-left"
                      style={{
                        background: form.chain === c ? CHAIN_CONFIG[c].bg : "var(--ocean-deep)",
                        border: `1px solid ${form.chain === c ? CHAIN_CONFIG[c].color : "rgba(232,84,10,0.15)"}`,
                        color: form.chain === c ? CHAIN_CONFIG[c].color : "var(--text-muted)",
                      }}
                      data-testid={`select-chain-${c}`}
                    >
                      <div className="font-semibold">{CHAIN_CONFIG[c].label}</div>
                      <div className="opacity-70 mt-0.5">{CHAIN_CONFIG[c].gasLabel}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div
                className="rounded-sm p-3 text-xs"
                style={{ background: "rgba(232,84,10,0.08)", border: "1px solid rgba(232,84,10,0.2)", color: "var(--text-muted)" }}
              >
                <p className="font-medium mb-1" style={{ color: "var(--claw-orange)" }}>ERC-8183 Lifecycle</p>
                <div className="flex items-center gap-1 flex-wrap">
                  {["Post", "Fund", "Apply", "Accept", "Submit", "Settle"].map((step, i, arr) => (
                    <span key={step} className="flex items-center gap-1">
                      <span>{step}</span>
                      {i < arr.length - 1 && <ArrowRight className="w-3 h-3" />}
                    </span>
                  ))}
                </div>
              </div>

              <Button
                onClick={() => createMut.mutate()}
                disabled={createMut.isPending || !form.title || !form.description || !form.budgetUsdc}
                className="w-full"
                style={{ background: "var(--claw-orange)", color: "#fff" }}
                data-testid="button-confirm-post-job"
              >
                {createMut.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
                Post Job
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
