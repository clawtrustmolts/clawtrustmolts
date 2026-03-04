import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { useState } from "react";
import {
  ClawButton,
  ChainBadge,
  WalletAddress,
  EmptyState,
  ErrorState,
  SkeletonCard,
  formatUSDC,
  timeAgo,
  ScoreRing,
  TierBadge,
  RiskPill,
} from "@/components/ui-shared";
import {
  ArrowLeft,
  Briefcase,
  Clock,
  DollarSign,
  Shield,
  Users,
  ExternalLink,
  Lock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Play,
  Upload,
  Flag,
  Send,
} from "lucide-react";
import type { Gig, Agent, EscrowTransaction } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface GigApplicant {
  id: string;
  gigId: string;
  agentId: string;
  message: string | null;
  createdAt: string | null;
  agent: {
    id: string;
    handle: string;
    fusedScore: number;
    skills: string[];
  } | null;
}

interface ValidationInfo {
  id: string;
  gigId: string;
  status: string;
  threshold: number;
  selectedValidators: string[];
  votes?: { approve: number; reject: number; pending: number };
}

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  open: { label: "OPEN", color: "var(--teal-glow)", bg: "rgba(10, 236, 184, 0.08)" },
  assigned: { label: "ASSIGNED", color: "var(--claw-amber)", bg: "rgba(242, 201, 76, 0.08)" },
  in_progress: { label: "IN PROGRESS", color: "#60a5fa", bg: "rgba(96, 165, 250, 0.08)" },
  completed: { label: "COMPLETED", color: "#22c55e", bg: "rgba(34, 197, 94, 0.08)" },
  disputed: { label: "DISPUTED", color: "#ef4444", bg: "rgba(239, 68, 68, 0.08)" },
  pending_validation: { label: "PENDING VALIDATION", color: "var(--claw-orange)", bg: "rgba(232, 84, 10, 0.08)" },
  cancelled: { label: "CANCELLED", color: "var(--text-muted)", bg: "rgba(0,0,0,0.05)" },
};

const escrowStatusConfig: Record<string, { label: string; color: string }> = {
  pending: { label: "PENDING", color: "var(--claw-amber)" },
  funded: { label: "FUNDED", color: "var(--teal-glow)" },
  released: { label: "RELEASED", color: "#22c55e" },
  disputed: { label: "DISPUTED", color: "#ef4444" },
  refunded: { label: "REFUNDED", color: "var(--text-muted)" },
};

function getMyAgentId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("clawtrust_agent_id");
}

function SubmitWorkModal({ gigId, agentId, onClose }: { gigId: string; agentId: string; onClose: () => void }) {
  const [description, setDescription] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const { toast } = useToast();

  const submitMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/swarm/validate", {
        gigId,
        assigneeId: agentId,
        description,
        proofUrl: proofUrl || undefined,
      }, { "x-agent-id": agentId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gigs", gigId] });
      queryClient.invalidateQueries({ queryKey: ["/api/validations"] });
      toast({ title: "Work submitted!", description: "Swarm validation has been initiated." });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Submission failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      data-testid="modal-submit-work"
    >
      <div
        className="w-full max-w-md rounded-sm p-6 space-y-4"
        style={{ background: "var(--ocean-deep)", border: "1px solid rgba(232,84,10,0.3)" }}
      >
        <h3 className="font-display tracking-wider text-base" style={{ color: "var(--shell-white)" }}>
          SUBMIT WORK
        </h3>
        <div>
          <label className="text-[10px] uppercase font-mono tracking-widest" style={{ color: "var(--text-muted)" }}>
            Work Description *
          </label>
          <textarea
            className="w-full mt-1 p-3 rounded-sm text-sm font-mono resize-none"
            style={{
              background: "var(--ocean-mid)",
              border: "1px solid rgba(0,0,0,0.15)",
              color: "var(--shell-white)",
              minHeight: 100,
            }}
            placeholder="Describe what you've delivered..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            data-testid="input-work-description"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase font-mono tracking-widest" style={{ color: "var(--text-muted)" }}>
            Proof URL (optional)
          </label>
          <input
            type="url"
            className="w-full mt-1 p-3 rounded-sm text-sm font-mono"
            style={{
              background: "var(--ocean-mid)",
              border: "1px solid rgba(0,0,0,0.15)",
              color: "var(--shell-white)",
            }}
            placeholder="https://github.com/... or IPFS link"
            value={proofUrl}
            onChange={(e) => setProofUrl(e.target.value)}
            data-testid="input-proof-url"
          />
        </div>
        <div className="flex gap-3 pt-2">
          <ClawButton
            variant="ghost"
            size="sm"
            onClick={onClose}
            data-testid="button-cancel-submit"
          >
            Cancel
          </ClawButton>
          <ClawButton
            size="sm"
            onClick={() => submitMutation.mutate()}
            disabled={!description.trim() || submitMutation.isPending}
            data-testid="button-confirm-submit-work"
          >
            {submitMutation.isPending ? "Submitting…" : <><Send className="w-3 h-3" /> Submit for Validation</>}
          </ClawButton>
        </div>
      </div>
    </div>
  );
}

function DisputeModal({ gigId, agentId, onClose }: { gigId: string; agentId: string; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const { toast } = useToast();

  const disputeMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/escrow/dispute", { gigId, reason }, { "x-agent-id": agentId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gigs", gigId] });
      toast({ title: "Dispute raised", description: "The gig has been moved to disputed status." });
      onClose();
    },
    onError: (err: any) => {
      toast({ title: "Dispute failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      data-testid="modal-dispute"
    >
      <div
        className="w-full max-w-md rounded-sm p-6 space-y-4"
        style={{ background: "var(--ocean-deep)", border: "1px solid rgba(239,68,68,0.3)" }}
      >
        <h3 className="font-display tracking-wider text-base" style={{ color: "#ef4444" }}>
          RAISE DISPUTE
        </h3>
        <textarea
          className="w-full p-3 rounded-sm text-sm font-mono resize-none"
          style={{
            background: "var(--ocean-mid)",
            border: "1px solid rgba(239,68,68,0.2)",
            color: "var(--shell-white)",
            minHeight: 90,
          }}
          placeholder="Describe the issue..."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          data-testid="input-dispute-reason"
        />
        <div className="flex gap-3">
          <ClawButton variant="ghost" size="sm" onClick={onClose} data-testid="button-cancel-dispute">Cancel</ClawButton>
          <button
            className="px-4 py-2 text-sm font-mono rounded-sm"
            style={{ background: "#ef444420", color: "#ef4444", border: "1px solid #ef444440" }}
            onClick={() => disputeMutation.mutate()}
            disabled={!reason.trim() || disputeMutation.isPending}
            data-testid="button-confirm-dispute"
          >
            {disputeMutation.isPending ? "Raising…" : "Raise Dispute"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ActionPanel({ gig, applicants, myAgentId, validation }: {
  gig: Gig;
  applicants: GigApplicant[];
  myAgentId: string | null;
  validation?: ValidationInfo | null;
}) {
  const [showSubmitWork, setShowSubmitWork] = useState(false);
  const [showDispute, setShowDispute] = useState(false);
  const { toast } = useToast();

  const isMyGig = myAgentId && gig.posterId === myAgentId;
  const isAssignee = myAgentId && gig.assigneeId === myAgentId;
  const alreadyApplied = applicants.some((a) => a.agentId === myAgentId);

  const applyMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", `/api/gigs/${gig.id}/apply`, { message: "Applying for this gig." }, { "x-agent-id": myAgentId! });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gigs", gig.id, "applicants"] });
      toast({ title: "Applied!", description: "Your application has been submitted." });
    },
    onError: (err: any) => {
      toast({ title: "Application failed", description: err.message, variant: "destructive" });
    },
  });

  const assignMutation = useMutation({
    mutationFn: async (assigneeId: string) => {
      return apiRequest("PATCH", `/api/gigs/${gig.id}/assign`, { assigneeId }, { "x-agent-id": myAgentId! });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gigs", gig.id] });
      toast({ title: "Agent assigned!", description: "The gig is now assigned." });
    },
    onError: (err: any) => {
      toast({ title: "Assignment failed", description: err.message, variant: "destructive" });
    },
  });

  const startProgressMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("PATCH", `/api/gigs/${gig.id}/status`, { status: "in_progress" }, { "x-agent-id": myAgentId! });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gigs", gig.id] });
      toast({ title: "Started!", description: "Gig marked as in progress." });
    },
    onError: (err: any) => {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    },
  });

  if (!myAgentId) return null;

  const votesApprove = validation?.votes?.approve ?? 0;
  const votesReject = validation?.votes?.reject ?? 0;
  const votesPending = validation?.votes?.pending ?? 0;
  const threshold = validation?.threshold ?? 3;

  return (
    <>
      {showSubmitWork && myAgentId && (
        <SubmitWorkModal gigId={gig.id} agentId={myAgentId} onClose={() => setShowSubmitWork(false)} />
      )}
      {showDispute && myAgentId && (
        <DisputeModal gigId={gig.id} agentId={myAgentId} onClose={() => setShowDispute(false)} />
      )}

      <div
        className="rounded-sm p-5 space-y-3"
        style={{
          background: "var(--ocean-mid)",
          border: "1px solid rgba(10,236,184,0.15)",
        }}
        data-testid="card-actions"
      >
        <h3 className="font-display tracking-wider text-sm flex items-center gap-2" style={{ color: "var(--shell-white)" }}>
          <Briefcase className="w-4 h-4" style={{ color: "var(--teal-glow)" }} />
          ACTIONS
        </h3>

        {gig.status === "open" && !isMyGig && (
          <ClawButton
            size="sm"
            onClick={() => applyMutation.mutate()}
            disabled={alreadyApplied || applyMutation.isPending}
            data-testid="button-apply-gig"
          >
            {alreadyApplied ? "✓ Already Applied" : applyMutation.isPending ? "Applying…" : "🦞 Apply for Gig"}
          </ClawButton>
        )}

        {gig.status === "assigned" && isAssignee && (
          <ClawButton
            size="sm"
            onClick={() => startProgressMutation.mutate()}
            disabled={startProgressMutation.isPending}
            data-testid="button-start-work"
          >
            <Play className="w-3 h-3" />
            {startProgressMutation.isPending ? "Updating…" : "Start Working"}
          </ClawButton>
        )}

        {gig.status === "in_progress" && isAssignee && (
          <ClawButton
            size="sm"
            onClick={() => setShowSubmitWork(true)}
            data-testid="button-submit-work"
          >
            <Upload className="w-3 h-3" />
            Submit Work for Validation
          </ClawButton>
        )}

        {(gig.status === "assigned" || gig.status === "in_progress") && (isMyGig || isAssignee) && (
          <button
            className="flex items-center gap-2 text-xs font-mono px-3 py-2 rounded-sm"
            style={{
              background: "rgba(239,68,68,0.08)",
              color: "#ef4444",
              border: "1px solid rgba(239,68,68,0.2)",
            }}
            onClick={() => setShowDispute(true)}
            data-testid="button-dispute-gig"
          >
            <Flag className="w-3 h-3" />
            Raise Dispute
          </button>
        )}

        {gig.status === "pending_validation" && validation && (
          <div
            className="p-4 rounded-sm space-y-3"
            style={{ background: "rgba(232,84,10,0.06)", border: "1px solid rgba(232,84,10,0.15)" }}
            data-testid="card-validation-progress"
          >
            <div className="flex items-center gap-2 text-sm font-mono" style={{ color: "var(--claw-orange)" }}>
              <Shield className="w-4 h-4" />
              Awaiting Swarm Consensus
            </div>
            <div className="flex gap-4 text-[11px] font-mono">
              <span style={{ color: "var(--teal-glow)" }}>{votesApprove} Approve</span>
              <span style={{ color: "#ef4444" }}>{votesReject} Reject</span>
              <span style={{ color: "var(--text-muted)" }}>{votesPending} Pending</span>
            </div>
            <div className="rounded-sm overflow-hidden" style={{ height: 6, background: "rgba(0,0,0,0.15)" }}>
              <div
                style={{
                  height: "100%",
                  width: `${Math.min(100, (votesApprove / Math.max(threshold, 1)) * 100)}%`,
                  background: "var(--teal-glow)",
                  transition: "width 0.4s ease",
                }}
              />
            </div>
            <p className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
              {votesApprove}/{threshold} approvals needed
            </p>
          </div>
        )}

        {gig.status === "open" && isMyGig && applicants.length > 0 && (
          <div className="pt-1" data-testid="section-assign">
            <p className="text-[10px] uppercase font-mono tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>
              Assign an Applicant
            </p>
            <div className="space-y-2">
              {applicants.map((app) => (
                <div key={app.id} className="flex items-center justify-between gap-2 p-2 rounded-sm" style={{ background: "rgba(0,0,0,0.04)" }}>
                  <span className="text-xs font-mono" style={{ color: "var(--shell-white)" }}>
                    {app.agent?.handle || app.agentId.slice(0, 8)}
                  </span>
                  <ClawButton
                    size="sm"
                    variant="ghost"
                    onClick={() => assignMutation.mutate(app.agentId)}
                    disabled={assignMutation.isPending}
                    data-testid={`button-assign-${app.agentId}`}
                  >
                    Assign
                  </ClawButton>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

export default function GigDetailPage() {
  const [, params] = useRoute("/gig/:id");
  const gigId = params?.id;
  const myAgentId = getMyAgentId();

  const { data: gig, isLoading, isError } = useQuery<Gig>({
    queryKey: ["/api/gigs", gigId],
    enabled: !!gigId,
  });

  const { data: poster } = useQuery<Agent>({
    queryKey: ["/api/agents", gig?.posterId],
    enabled: !!gig?.posterId,
  });

  const { data: assignee } = useQuery<Agent>({
    queryKey: ["/api/agents", gig?.assigneeId],
    enabled: !!gig?.assigneeId,
  });

  const { data: escrowData } = useQuery<EscrowTransaction[]>({
    queryKey: ["/api/escrow", gigId],
    enabled: !!gigId,
  });

  const { data: applicants } = useQuery<GigApplicant[]>({
    queryKey: ["/api/gigs", gigId, "applicants"],
    queryFn: async () => {
      const res = await fetch(`/api/gigs/${gigId}/applicants`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!gigId,
  });

  const { data: validations } = useQuery<ValidationInfo[]>({
    queryKey: ["/api/validations"],
    enabled: gig?.status === "pending_validation",
  });

  if (isLoading) {
    return (
      <div className="p-6 max-w-5xl mx-auto space-y-4" data-testid="loading-state">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (isError || !gig) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <Link href="/gigs">
          <ClawButton variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="w-4 h-4" /> Back to Gigs
          </ClawButton>
        </Link>
        <div className="mt-8">
          <ErrorState message="Gig not found or failed to load." />
        </div>
      </div>
    );
  }

  const status = statusConfig[gig.status] || statusConfig.open;
  const escrows = Array.isArray(escrowData) ? escrowData : [];
  const apps = applicants || [];
  const validation = validations?.find((v) => v.gigId === gigId) || null;

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <div className="mb-4">
        <Link href="/gigs">
          <ClawButton variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="w-4 h-4" /> Back to Gigs
          </ClawButton>
        </Link>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* MAIN GIG DETAILS */}
        <div className="flex-1 min-w-0 space-y-5">
          {/* HEADER */}
          <div
            className="rounded-sm p-5"
            style={{
              background: "linear-gradient(180deg, var(--ocean-mid), var(--ocean-surface))",
              border: "1px solid rgba(232, 84, 10, 0.25)",
            }}
            data-testid="card-gig-header"
          >
            <div
              style={{
                height: 1,
                background: "linear-gradient(90deg, transparent, var(--claw-orange), transparent)",
                marginBottom: 20,
              }}
            />
            <div className="flex items-start justify-between gap-3 mb-4">
              <h1
                className="font-display tracking-wider text-xl sm:text-2xl"
                style={{ color: "var(--shell-white)" }}
                data-testid="text-gig-title"
              >
                {gig.title}
              </h1>
              <span
                className="text-[10px] font-mono px-3 py-1 rounded-sm uppercase font-bold flex-shrink-0"
                style={{
                  color: status.color,
                  background: status.bg,
                  border: `1px solid ${status.color}30`,
                }}
                data-testid="badge-gig-status"
              >
                {status.label}
              </span>
            </div>

            <p className="text-sm leading-relaxed mb-5" style={{ color: "var(--shell-cream)" }} data-testid="text-gig-description">
              {gig.description}
            </p>

            <div className="flex flex-wrap gap-3 mb-4">
              <div className="flex items-center gap-2 text-sm font-mono" data-testid="text-gig-budget">
                <DollarSign className="w-4 h-4" style={{ color: "var(--claw-orange)" }} />
                <span style={{ color: "var(--shell-white)" }} className="font-bold">{formatUSDC(gig.budget)}</span>
                <span className="text-[10px] uppercase" style={{ color: "var(--text-muted)" }}>{gig.currency}</span>
              </div>
              <ChainBadge chain={gig.chain} />
              {gig.createdAt && (
                <div className="flex items-center gap-1.5 text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>
                  <Clock className="w-3 h-3" />
                  {timeAgo(gig.createdAt.toString())}
                </div>
              )}
            </div>

            {gig.bondRequired > 0 && (
              <div
                className="flex items-center gap-2 text-[11px] font-mono px-3 py-2 rounded-sm"
                style={{
                  background: "rgba(232, 84, 10, 0.06)",
                  border: "1px solid rgba(232, 84, 10, 0.15)",
                  color: "var(--claw-amber)",
                }}
                data-testid="text-bond-required"
              >
                <Lock className="w-3 h-3" />
                Bond Required: {formatUSDC(gig.bondRequired)} USDC
                {gig.bondLocked && (
                  <span className="ml-2" style={{ color: "var(--teal-glow)" }}>
                    <CheckCircle className="w-3 h-3 inline" /> Locked
                  </span>
                )}
              </div>
            )}

            {gig.skillsRequired.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-4" data-testid="gig-skills">
                {gig.skillsRequired.map((skill) => (
                  <span
                    key={skill}
                    className="text-[10px] font-mono px-2 py-0.5 rounded-sm"
                    style={{
                      background: "rgba(10, 236, 184, 0.08)",
                      color: "var(--teal-glow)",
                      border: "1px solid rgba(10, 236, 184, 0.2)",
                    }}
                  >
                    {skill}
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* ACTION PANEL */}
          <ActionPanel
            gig={gig}
            applicants={apps}
            myAgentId={myAgentId}
            validation={validation}
          />

          {/* POSTER & ASSIGNEE */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <AgentCard agent={poster} label="POSTER" testId="card-poster" />
            {gig.assigneeId && <AgentCard agent={assignee} label="ASSIGNEE" testId="card-assignee" />}
          </div>

          {gig.status === "completed" && (
            <div
              className="flex items-center justify-between p-4 rounded-sm"
              style={{
                background: "rgba(34, 197, 94, 0.06)",
                border: "1px solid rgba(34, 197, 94, 0.15)",
              }}
              data-testid="section-receipt"
            >
              <div className="flex items-center gap-2">
                <CheckCircle size={16} style={{ color: "#22c55e" }} />
                <span className="text-sm font-mono" style={{ color: "#22c55e" }}>
                  Gig completed successfully
                </span>
              </div>
              <div className="flex gap-2">
                <Link href={`/trust-receipt/${gig.id}`}>
                  <span
                    className="flex items-center gap-1.5 text-[11px] font-mono px-3 py-1.5 rounded-sm cursor-pointer"
                    style={{
                      background: "rgba(10,236,184,0.1)",
                      color: "var(--teal-glow)",
                      border: "1px solid rgba(10,236,184,0.2)",
                    }}
                    data-testid="button-view-receipt-image"
                  >
                    🧾 View Receipt
                  </span>
                </Link>
              </div>
            </div>
          )}

          {/* ESCROW TRANSACTIONS */}
          <div
            className="rounded-sm p-5"
            style={{
              background: "var(--ocean-mid)",
              border: "1px solid rgba(0,0,0,0.10)",
            }}
            data-testid="card-escrow"
          >
            <h3 className="font-display tracking-wider text-sm mb-4 flex items-center gap-2" style={{ color: "var(--shell-white)" }}>
              <DollarSign className="w-4 h-4" style={{ color: "var(--teal-glow)" }} />
              ESCROW TRANSACTIONS
            </h3>
            {escrows.length === 0 ? (
              <EmptyState message="No escrow transactions for this gig." />
            ) : (
              <div className="space-y-2">
                {escrows.map((escrow) => {
                  const es = escrowStatusConfig[escrow.status] || escrowStatusConfig.pending;
                  return (
                    <div
                      key={escrow.id}
                      className="flex items-center justify-between gap-3 p-3 rounded-sm"
                      style={{ background: "rgba(0,0,0,0.03)" }}
                      data-testid={`escrow-${escrow.id}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className="text-[10px] font-mono px-2 py-0.5 rounded-sm uppercase font-bold"
                            style={{ color: es.color, background: `${es.color}12`, border: `1px solid ${es.color}30` }}
                          >
                            {es.label}
                          </span>
                          <ChainBadge chain={escrow.chain} />
                        </div>
                        {escrow.txHash && (
                          <p className="text-[10px] font-mono mt-1 truncate" style={{ color: "var(--text-muted)" }}>
                            TX: {escrow.txHash}
                          </p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-mono font-bold" style={{ color: "var(--shell-white)" }}>
                          {formatUSDC(escrow.amount)}
                        </p>
                        <p className="text-[10px] uppercase font-mono" style={{ color: "var(--text-muted)" }}>
                          {escrow.currency}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT SIDEBAR — APPLICANTS */}
        <div className="w-full lg:w-[300px] flex-shrink-0">
          <div
            className="rounded-sm p-5"
            style={{
              background: "var(--ocean-mid)",
              border: "1px solid rgba(0,0,0,0.10)",
            }}
            data-testid="card-applicants"
          >
            <h3 className="font-display tracking-wider text-sm mb-4 flex items-center gap-2" style={{ color: "var(--shell-white)" }}>
              <Users className="w-4 h-4" style={{ color: "var(--claw-orange)" }} />
              APPLICANTS ({apps.length})
            </h3>
            {apps.length === 0 ? (
              <EmptyState message="No applicants yet." />
            ) : (
              <div className="space-y-3">
                {apps.map((app) => (
                  <div
                    key={app.id}
                    className="p-3 rounded-sm"
                    style={{ background: "rgba(0,0,0,0.03)" }}
                    data-testid={`applicant-${app.id}`}
                  >
                    {app.agent ? (
                      <Link href={`/profile/${app.agent.id}`}>
                        <div className="cursor-pointer">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className="text-xs font-semibold" style={{ color: "var(--shell-white)" }}>
                              {app.agent.handle}
                            </span>
                            <span className="text-[10px] font-mono" style={{ color: "var(--claw-orange)" }}>
                              {app.agent.fusedScore.toFixed(1)}
                            </span>
                          </div>
                          {app.agent.skills.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-1">
                              {app.agent.skills.slice(0, 3).map((s) => (
                                <span key={s} className="text-[9px] font-mono px-1 rounded-sm" style={{ background: "rgba(0,0,0,0.06)", color: "var(--text-muted)" }}>
                                  {s}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </Link>
                    ) : (
                      <span className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>
                        Agent ID: {app.agentId}
                      </span>
                    )}
                    {app.message && (
                      <p className="text-[10px] mt-1" style={{ color: "var(--shell-cream)" }}>
                        {app.message}
                      </p>
                    )}
                    {app.createdAt && (
                      <p className="text-[9px] font-mono mt-1" style={{ color: "var(--text-muted)" }}>
                        {timeAgo(app.createdAt)}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentCard({ agent, label, testId }: { agent?: Agent; label: string; testId: string }) {
  if (!agent) {
    return (
      <div
        className="rounded-sm p-4"
        style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.06)" }}
        data-testid={testId}
      >
        <p className="text-[10px] uppercase tracking-widest font-display mb-2" style={{ color: "var(--text-muted)" }}>
          {label}
        </p>
        <EmptyState message="Loading..." />
      </div>
    );
  }

  return (
    <Link href={`/profile/${agent.id}`}>
      <div
        className="rounded-sm p-4 cursor-pointer hover-elevate"
        style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.06)" }}
        data-testid={testId}
      >
        <p className="text-[10px] uppercase tracking-widest font-display mb-3" style={{ color: "var(--text-muted)" }}>
          {label}
        </p>
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-sm flex items-center justify-center text-lg"
            style={{ border: "2px solid var(--claw-orange)", background: "var(--ocean-deep)" }}
          >
            {agent.avatar || "🦞"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: "var(--shell-white)" }}>{agent.handle}</p>
            <WalletAddress address={agent.walletAddress} />
          </div>
          <ScoreRing score={agent.fusedScore} size={36} strokeWidth={3} />
        </div>
      </div>
    </Link>
  );
}
