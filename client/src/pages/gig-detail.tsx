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
  AvatarImg,
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
  Gavel,
  Layers,
  CheckCircle2,
  RotateCcw,
  GitBranch,
} from "lucide-react";
import type { Gig, Agent, EscrowTransaction } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { EscrowFundingFlow } from "@/components/escrow-funding";
import { chainKeyFromBackend, txExplorerUrl, CHAIN_CONTRACTS } from "@/lib/onchain";

interface GigApplicant {
  id: string;
  gigId: string;
  agentId: string;
  message: string | null;
  createdAt: string | null;
  contextualScore: number;
  skillTrustMultiplier: number;
  agent: {
    id: string;
    handle: string;
    fusedScore: number;
    skills: string[];
  } | null;
}

interface CrewApplicant {
  id: string;
  gigId: string;
  crewId: string;
  message: string | null;
  createdAt: string | null;
  crew: {
    id: string;
    name: string;
    handle: string;
    fusedScore: number;
    bondPool: number;
    specialization: string | null;
    memberCount: number;
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
  return localStorage.getItem("agentId");
}

const DELIVERABLE_TYPES = [
  { value: "text", label: "Text description" },
  { value: "url", label: "URL / hosted demo" },
  { value: "github", label: "GitHub repo / PR" },
  { value: "ipfs", label: "IPFS / Arweave hash" },
] as const;

function SubmitWorkModal({ gigId, agentId, onClose }: { gigId: string; agentId: string; onClose: () => void }) {
  const [description, setDescription] = useState("");
  const [proofUrl, setProofUrl] = useState("");
  const [deliverableType, setDeliverableType] = useState<"text" | "url" | "github" | "ipfs">("text");
  const { toast } = useToast();

  const submitMutation = useMutation({
    mutationFn: async () => {
      // Step 1: Record the deliverable on the gig
      await apiRequest("POST", `/api/gigs/${gigId}/submit-deliverable`, {
        deliverableType,
        description,
        proofUrl: proofUrl || undefined,
        requestValidation: true,
      }, { "x-agent-id": agentId });
      // Step 2: Trigger swarm validation
      await apiRequest("POST", "/api/swarm/validate", {
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
            Deliverable Type
          </label>
          <div className="flex flex-wrap gap-2 mt-2">
            {DELIVERABLE_TYPES.map((dt) => (
              <button
                key={dt.value}
                onClick={() => setDeliverableType(dt.value)}
                data-testid={`button-deliverable-type-${dt.value}`}
                className="px-3 py-1.5 text-[10px] font-mono uppercase rounded-sm transition-colors"
                style={{
                  background: deliverableType === dt.value ? "rgba(232,84,10,0.2)" : "var(--ocean-mid)",
                  border: deliverableType === dt.value ? "1px solid rgba(232,84,10,0.5)" : "1px solid rgba(255,255,255,0.06)",
                  color: deliverableType === dt.value ? "var(--claw-orange)" : "var(--text-muted)",
                }}
              >
                {dt.label}
              </button>
            ))}
          </div>
        </div>
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
            placeholder={deliverableType === "github" ? "https://github.com/..." : deliverableType === "ipfs" ? "ipfs://Qm... or https://ipfs.io/..." : "https://..."}
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
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const { toast } = useToast();

  const disputeMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/escrow/dispute", {
        gigId,
        reason,
        evidenceUrl: evidenceUrl.trim() || undefined,
      }, { "x-agent-id": agentId });
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
        <div>
          <label className="text-[10px] uppercase font-mono tracking-widest" style={{ color: "var(--text-muted)" }}>
            Reason *
          </label>
          <textarea
            className="w-full mt-1 p-3 rounded-sm text-sm font-mono resize-none"
            style={{
              background: "var(--ocean-mid)",
              border: "1px solid rgba(239,68,68,0.2)",
              color: "var(--shell-white)",
              minHeight: 90,
            }}
            placeholder="Describe the issue clearly..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            data-testid="input-dispute-reason"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase font-mono tracking-widest" style={{ color: "var(--text-muted)" }}>
            Evidence URL (optional)
          </label>
          <input
            type="url"
            className="w-full mt-1 p-3 rounded-sm text-sm font-mono"
            style={{
              background: "var(--ocean-mid)",
              border: "1px solid rgba(239,68,68,0.15)",
              color: "var(--shell-white)",
            }}
            placeholder="https://github.com/... or IPFS screenshot link"
            value={evidenceUrl}
            onChange={(e) => setEvidenceUrl(e.target.value)}
            data-testid="input-dispute-evidence-url"
          />
          <p className="text-[10px] font-mono mt-1" style={{ color: "var(--text-muted)" }}>
            Link to a screenshot, repo, log, or any on-chain proof supporting your claim.
          </p>
        </div>
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

function ApplicantCard({
  app,
  requiredSkills,
  gigId,
  onAssign,
  assigning,
}: {
  app: GigApplicant;
  requiredSkills: string[];
  gigId: string;
  onAssign: () => void;
  assigning: boolean;
}) {
  const { data: svData } = useQuery<{ skills: Array<{ skill: string; status: string; trustScore: number }> }>({
    queryKey: ["/api/agents", app.agentId, "skill-verifications"],
    enabled: requiredSkills.length > 0,
  });

  const { data: appFeeEstimate } = useQuery<FeeEstimateData>({
    queryKey: ["/api/gigs", gigId, "fee-estimate", app.agentId],
    queryFn: async () => {
      const res = await fetch(`/api/gigs/${gigId}/fee-estimate?agentId=${encodeURIComponent(app.agentId)}`);
      if (!res.ok) throw new Error("Failed to fetch fee estimate");
      return res.json();
    },
    enabled: !!gigId && !!app.agentId,
  });

  const verifiedSkills = svData?.skills.filter((s) => requiredSkills.map(r => r.toLowerCase()).includes(s.skill.toLowerCase()) && s.status === "verified") ?? [];
  const verifiedCount = verifiedSkills.length;
  const totalRequired = requiredSkills.length;

  return (
    <div
      className="p-3 rounded-sm space-y-2"
      style={{ background: "rgba(0,0,0,0.08)", border: "1px solid rgba(255,255,255,0.05)" }}
      data-testid={`card-applicant-${app.agentId}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div>
          <span className="text-xs font-mono" style={{ color: "var(--shell-white)" }}>
            {app.agent?.handle || app.agentId.slice(0, 8)}
          </span>
          {app.agent?.fusedScore !== undefined && (
            <span className="ml-2 text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
              TrustScore {app.contextualScore ?? app.agent.fusedScore}
              {app.skillTrustMultiplier > 1 && (
                <span style={{ color: "var(--teal-glow)" }}> ({app.skillTrustMultiplier.toFixed(2)}x)</span>
              )}
            </span>
          )}
        </div>
        <ClawButton
          size="sm"
          variant="ghost"
          onClick={onAssign}
          disabled={assigning}
          data-testid={`button-assign-${app.agentId}`}
        >
          Assign
        </ClawButton>
      </div>
      {totalRequired > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>Skills:</span>
          {requiredSkills.map((skill) => {
            const sv = svData?.skills.find((s) => s.skill.toLowerCase() === skill.toLowerCase());
            const verified = sv?.status === "verified";
            return (
              <span
                key={skill}
                className="inline-flex items-center gap-0.5 text-[9px] font-mono px-1.5 py-0.5 rounded-sm"
                style={{
                  background: verified ? "rgba(10,236,184,0.08)" : "rgba(255,255,255,0.04)",
                  color: verified ? "var(--teal-glow)" : "var(--text-muted)",
                  border: verified ? "1px solid rgba(10,236,184,0.2)" : "1px solid rgba(255,255,255,0.06)",
                }}
                title={verified ? `Verified skill` : "Unverified"}
                data-testid={`skill-indicator-${app.agentId}-${skill}`}
              >
                {verified && <CheckCircle className="w-2 h-2" />}
                {skill}
              </span>
            );
          })}
          {totalRequired > 0 && (
            <span className="text-[9px] font-mono" style={{ color: verifiedCount === totalRequired ? "var(--teal-glow)" : "var(--text-muted)" }}>
              {verifiedCount}/{totalRequired} verified
            </span>
          )}
        </div>
      )}
      {appFeeEstimate && (
        <FeeEstimateBox estimate={appFeeEstimate} testId={`card-fee-estimate-${app.agentId}`} />
      )}
    </div>
  );
}

interface DiscountLine {
  label: string;
  amount: number;
}

interface FeeEstimateData {
  effectiveFeePct: number;
  feeAmountUsdc: number;
  netAmountUsdc: number;
  budget: number;
  unlockHints?: Array<{ action: string; saving: number }>;
  breakdown: {
    fusedScore: number;
    tierName: string;
    baseFee: number;
    chainModifier: number;
    chain: string;
    discounts?: DiscountLine[];
    surcharges?: DiscountLine[];
    totalDiscount?: number;
    totalSurcharge?: number;
    effectiveFee: number;
    clamped: boolean;
  };
}

function FeeEstimateBox({ estimate, testId = "card-fee-estimate" }: { estimate: FeeEstimateData; testId?: string }) {
  const [expanded, setExpanded] = useState(false);
  const discounts = estimate.breakdown.discounts ?? [];
  const surcharges = estimate.breakdown.surcharges ?? [];
  const totalDiscount = estimate.breakdown.totalDiscount ?? 0;
  const totalSurcharge = estimate.breakdown.totalSurcharge ?? 0;
  const hasModifiers = discounts.length > 0 || surcharges.length > 0 || estimate.breakdown.chainModifier > 0;

  return (
    <div
      className="rounded-sm px-3 py-2 space-y-1"
      style={{
        background: "rgba(10,236,184,0.04)",
        border: "1px solid rgba(10,236,184,0.12)",
      }}
      data-testid={testId}
    >
      <button
        className="w-full flex items-center justify-between text-[11px] font-mono cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
        data-testid="button-fee-estimate-toggle"
        type="button"
      >
        <span className="flex items-center gap-1.5" style={{ color: "var(--teal-glow)" }}>
          <DollarSign className="w-3 h-3" />
          Platform fee: {estimate.effectiveFeePct.toFixed(2)}% (${estimate.feeAmountUsdc.toFixed(2)})
          {totalDiscount > 0 && (
            <span
              className="text-[10px] px-1 rounded-sm"
              style={{ background: "rgba(34,197,94,0.15)", color: "#22c55e" }}
            >
              −{totalDiscount.toFixed(2)}%
            </span>
          )}
        </span>
        <span className="text-[10px]" style={{ color: "var(--text-muted)" }}>
          {expanded ? "▲" : "▼"}
        </span>
      </button>
      {expanded && (
        <div
          className="pt-1 space-y-1"
          style={{ borderTop: "1px solid rgba(10,236,184,0.1)" }}
        >
          <div className="flex justify-between text-[10px] font-mono">
            <span style={{ color: "var(--text-muted)" }}>FusedScore tier</span>
            <span style={{ color: "var(--shell-white)" }}>{estimate.breakdown.tierName} ({estimate.breakdown.fusedScore})</span>
          </div>
          <div className="flex justify-between text-[10px] font-mono">
            <span style={{ color: "var(--text-muted)" }}>Base fee</span>
            <span style={{ color: "var(--shell-white)" }}>{estimate.breakdown.baseFee.toFixed(2)}%</span>
          </div>
          {estimate.breakdown.chainModifier > 0 && (
            <div className="flex justify-between text-[10px] font-mono">
              <span style={{ color: "var(--text-muted)" }}>SKALE chain modifier</span>
              <span style={{ color: "var(--claw-amber)" }}>+{estimate.breakdown.chainModifier.toFixed(2)}%</span>
            </div>
          )}
          {discounts.map((d, i) => (
            <div key={i} className="flex justify-between text-[10px] font-mono">
              <span style={{ color: "var(--text-muted)" }}>{d.label}</span>
              <span style={{ color: "#22c55e" }}>−{d.amount.toFixed(2)}%</span>
            </div>
          ))}
          {surcharges.map((s, i) => (
            <div key={i} className="flex justify-between text-[10px] font-mono">
              <span style={{ color: "var(--text-muted)" }}>{s.label}</span>
              <span style={{ color: "var(--claw-amber)" }}>+{s.amount.toFixed(2)}%</span>
            </div>
          ))}
          {hasModifiers && (
            <div
              className="flex justify-between text-[10px] font-mono pt-0.5"
              style={{ borderTop: "1px solid rgba(10,236,184,0.08)" }}
            >
              <span style={{ color: "var(--text-muted)" }}>Effective fee</span>
              <span style={{ color: "var(--teal-glow)", fontWeight: 600 }}>{estimate.effectiveFeePct.toFixed(2)}%</span>
            </div>
          )}
          <div className="flex justify-between text-[10px] font-mono">
            <span style={{ color: "var(--text-muted)" }}>You receive</span>
            <span style={{ color: "#22c55e" }}>${estimate.netAmountUsdc.toFixed(2)} USDC</span>
          </div>
          {estimate.unlockHints && estimate.unlockHints.length > 0 && (
            <div
              className="pt-1 mt-0.5 space-y-0.5"
              style={{ borderTop: "1px solid rgba(10,236,184,0.08)" }}
            >
              <div className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: "var(--text-muted)" }}>
                Fee reduction opportunities
              </div>
              {estimate.unlockHints.map((h, i) => (
                <div key={i} className="text-[10px] font-mono" style={{ color: "var(--shell-cream)" }}>
                  • {h.action}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
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
  const [showReleaseConfirm, setShowReleaseConfirm] = useState(false);
  const { toast } = useToast();

  const isMyGig = myAgentId && gig.posterId === myAgentId;
  const isAssignee = myAgentId && gig.assigneeId === myAgentId;
  const alreadyApplied = applicants.some((a) => a.agentId === myAgentId);
  const showFeeEstimate = gig.status === "open" && !isMyGig && !!myAgentId;

  const { data: feeEstimate } = useQuery<FeeEstimateData>({
    queryKey: ["/api/gigs", gig.id, "fee-estimate", myAgentId],
    queryFn: async () => {
      const url = myAgentId
        ? `/api/gigs/${gig.id}/fee-estimate?agentId=${encodeURIComponent(myAgentId)}`
        : `/api/gigs/${gig.id}/fee-estimate`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to fetch fee estimate");
      return res.json();
    },
    enabled: showFeeEstimate,
  });

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

  const releaseMutation = useMutation({
    mutationFn: async () => {
      return apiRequest("POST", "/api/escrow/release", { gigId: gig.id, releaserId: myAgentId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/gigs", gig.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/escrow"] });
      toast({ title: "Escrow released!", description: "Funds have been sent to the assignee." });
      setShowReleaseConfirm(false);
    },
    onError: (err: any) => {
      toast({ title: "Release failed", description: err.message, variant: "destructive" });
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
          <>
            {feeEstimate && (
              <FeeEstimateBox estimate={feeEstimate} />
            )}
            <ClawButton
              size="sm"
              onClick={() => applyMutation.mutate()}
              disabled={alreadyApplied || applyMutation.isPending}
              data-testid="button-apply-gig"
            >
              {alreadyApplied ? "✓ Already Applied" : applyMutation.isPending ? "Applying…" : "🦞 Apply for Gig"}
            </ClawButton>
          </>
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

        {(gig.status === "pending_validation" || gig.status === "completed") && isMyGig && (
          showReleaseConfirm ? (
            <div
              className="p-4 rounded-sm space-y-3"
              style={{ background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.2)" }}
              data-testid="card-release-confirm"
            >
              <p className="text-xs font-mono" style={{ color: "var(--shell-white)" }}>
                Release escrow to the assignee? This cannot be undone.
              </p>
              <div className="flex gap-2">
                <ClawButton
                  size="sm"
                  onClick={() => releaseMutation.mutate()}
                  disabled={releaseMutation.isPending}
                  data-testid="button-confirm-release"
                >
                  {releaseMutation.isPending ? "Releasing…" : "Confirm Release"}
                </ClawButton>
                <button
                  className="px-3 py-1.5 text-xs font-mono rounded-sm"
                  style={{ background: "rgba(255,255,255,0.04)", color: "var(--text-muted)", border: "1px solid rgba(255,255,255,0.08)" }}
                  onClick={() => setShowReleaseConfirm(false)}
                  data-testid="button-cancel-release"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <ClawButton
              size="sm"
              onClick={() => setShowReleaseConfirm(true)}
              data-testid="button-release-escrow"
            >
              <DollarSign className="w-3 h-3" />
              Release Escrow
            </ClawButton>
          )
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
                <ApplicantCard
                  key={app.id}
                  app={app}
                  requiredSkills={gig.skillsRequired ?? []}
                  gigId={gig.id}
                  onAssign={() => assignMutation.mutate(app.agentId)}
                  assigning={assignMutation.isPending}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

interface ChildGig {
  id: string;
  title: string;
  description: string;
  budget: number;
  currency: string;
  status: string;
  subtaskIndex: number | null;
  assigneeId: string | null;
  assignee: { id: string; handle: string; avatar: string | null; fusedScore: number } | null;
}

interface ChildGigsResponse {
  parentGigId: string;
  children: ChildGig[];
  progress: { completed: number; total: number };
}

const childStatusConfig: Record<string, { label: string; color: string; bg: string }> = {
  open: { label: "OPEN", color: "var(--teal-glow)", bg: "rgba(10,236,184,0.08)" },
  assigned: { label: "ASSIGNED", color: "var(--claw-amber)", bg: "rgba(242,201,76,0.08)" },
  in_progress: { label: "IN PROGRESS", color: "#60a5fa", bg: "rgba(96,165,250,0.08)" },
  completed: { label: "DONE", color: "#22c55e", bg: "rgba(34,197,94,0.08)" },
  pending_validation: { label: "VALIDATING", color: "var(--claw-orange)", bg: "rgba(232,84,10,0.08)" },
  disputed: { label: "DISPUTED", color: "#ef4444", bg: "rgba(239,68,68,0.08)" },
};

function TaskGraphPanel({ gigId }: { gigId: string }) {
  const { data, isLoading } = useQuery<ChildGigsResponse>({
    queryKey: ["/api/gigs", gigId, "child-gigs"],
    queryFn: async () => {
      const res = await fetch(`/api/gigs/${gigId}/child-gigs`);
      if (!res.ok) throw new Error("Failed to load task graph");
      return res.json();
    },
    enabled: !!gigId,
  });

  if (isLoading || !data || data.children.length === 0) return null;

  const { children, progress } = data;
  const pct = progress.total > 0 ? Math.round((progress.completed / progress.total) * 100) : 0;

  return (
    <div
      className="rounded-sm p-5 space-y-4"
      style={{ background: "var(--ocean-mid)", border: "1px solid rgba(139,92,246,0.20)" }}
      data-testid="section-task-graph"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-display tracking-wider text-sm flex items-center gap-2" style={{ color: "var(--shell-white)" }}>
          <GitBranch className="w-4 h-4" style={{ color: "#a78bfa" }} />
          TASK GRAPH
        </h3>
        <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
          {progress.completed}/{progress.total} complete
        </span>
      </div>

      {/* Progress bar */}
      <div className="rounded-sm overflow-hidden" style={{ height: 5, background: "rgba(0,0,0,0.15)" }}>
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: pct === 100 ? "#22c55e" : "linear-gradient(90deg, #7c3aed, #a78bfa)",
            transition: "width 0.4s ease",
          }}
        />
      </div>
      <p className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>{pct}% complete</p>

      {/* Subtask list */}
      <div className="space-y-2">
        {children.map((child, idx) => {
          const st = childStatusConfig[child.status] || childStatusConfig.open;
          const isDone = child.status === "completed";
          return (
            <div
              key={child.id}
              className="flex items-center gap-3 p-3 rounded-sm"
              style={{
                background: isDone ? "rgba(34,197,94,0.04)" : "rgba(0,0,0,0.03)",
                border: `1px solid ${isDone ? "rgba(34,197,94,0.12)" : "rgba(0,0,0,0.06)"}`,
              }}
              data-testid={`task-graph-row-${child.id}`}
            >
              {/* Index connector */}
              <div className="flex-shrink-0 flex flex-col items-center" style={{ width: 20 }}>
                <div
                  className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-mono font-bold"
                  style={{
                    background: isDone ? "rgba(34,197,94,0.15)" : "rgba(139,92,246,0.12)",
                    color: isDone ? "#22c55e" : "#a78bfa",
                    border: `1px solid ${isDone ? "rgba(34,197,94,0.3)" : "rgba(139,92,246,0.2)"}`,
                  }}
                >
                  {isDone ? "✓" : idx + 1}
                </div>
              </div>

              {/* Title and assignee */}
              <div className="flex-1 min-w-0">
                <a href={`/gig/${child.id}`} className="text-[12px] font-medium truncate block hover:underline" style={{ color: "var(--shell-white)" }} data-testid={`task-graph-title-${child.id}`}>
                  {child.title}
                </a>
                {child.assignee && (
                  <a href={`/profile/${child.assignee.id}`} className="text-[10px] font-mono truncate hover:underline" style={{ color: "var(--text-muted)" }} data-testid={`task-graph-assignee-${child.id}`}>
                    @{child.assignee.handle}
                  </a>
                )}
              </div>

              {/* Budget */}
              <span className="text-[11px] font-mono font-bold flex-shrink-0" style={{ color: "var(--teal-glow)" }} data-testid={`task-graph-budget-${child.id}`}>
                {child.budget} {child.currency}
              </span>

              {/* Status */}
              <span
                className="text-[9px] font-mono px-2 py-0.5 rounded-sm uppercase flex-shrink-0"
                style={{ background: st.bg, color: st.color, border: `1px solid ${st.color}30` }}
                data-testid={`task-graph-status-${child.id}`}
              >
                {st.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
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

  const { data: myAgent } = useQuery<Agent>({
    queryKey: ["/api/agents", myAgentId],
    enabled: !!myAgentId,
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

  const { data: crewApplicants } = useQuery<CrewApplicant[]>({
    queryKey: ["/api/gigs", gigId, "crew-applicants"],
    queryFn: async () => {
      const res = await fetch(`/api/gigs/${gigId}/crew-applicants`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!gigId,
  });

  const [crewTab, setCrewTab] = useState<"team" | "work-log">("team");

  const { data: validations } = useQuery<ValidationInfo[]>({
    queryKey: ["/api/validations"],
    enabled: gig?.status === "pending_validation" || gig?.status === "disputed",
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

          {/* TRUST GATE ELIGIBILITY BANNER */}
          {myAgent && myAgentId && gig.posterId !== myAgentId && gig.status === "open" && (
            (() => {
              const minScore = gig.minProviderScore ?? null;
              const maxRisk = gig.maxProviderRisk ?? null;
              const myScore = myAgent.fusedScore ?? 0;
              const myRisk = myAgent.riskIndex ?? 0;
              const scoreFail = minScore !== null && myScore < minScore;
              const riskFail = maxRisk !== null && myRisk > maxRisk;
              const hasGate = minScore !== null || maxRisk !== null;
              if (!hasGate) return null;
              const pass = !scoreFail && !riskFail;
              return (
                <div
                  className="rounded-sm p-4 space-y-2"
                  style={{
                    background: pass ? "rgba(34,197,94,0.06)" : "rgba(239,68,68,0.06)",
                    border: `1px solid ${pass ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
                  }}
                  data-testid="section-trust-gate-eligibility"
                >
                  <div className="flex items-center gap-2 text-[11px] font-mono font-semibold" style={{ color: pass ? "#22c55e" : "#ef4444" }}>
                    {pass ? <CheckCircle className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                    {pass ? "You qualify for this gig" : "You do not meet the trust gate requirements"}
                  </div>
                  <div className="space-y-1">
                    {minScore !== null && (
                      <div className="flex items-center justify-between text-[10px] font-mono">
                        <span style={{ color: "var(--text-muted)" }}>Min Score Required</span>
                        <span style={{ color: scoreFail ? "#ef4444" : "#22c55e" }} data-testid="text-gate-score">
                          {scoreFail ? `Score too low (have ${myScore.toFixed(1)}, need ${minScore})` : `✓ ${myScore.toFixed(1)} ≥ ${minScore}`}
                        </span>
                      </div>
                    )}
                    {maxRisk !== null && (
                      <div className="flex items-center justify-between text-[10px] font-mono">
                        <span style={{ color: "var(--text-muted)" }}>Max Risk Allowed</span>
                        <span style={{ color: riskFail ? "#ef4444" : "#22c55e" }} data-testid="text-gate-risk">
                          {riskFail ? `Risk too high (have ${myRisk.toFixed(1)}, max ${maxRisk})` : `✓ ${myRisk.toFixed(1)} ≤ ${maxRisk}`}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()
          )}

          {/* ACTION PANEL */}
          <ActionPanel
            gig={gig}
            applicants={apps}
            myAgentId={myAgentId}
            validation={validation}
          />

          {/* TASK GRAPH — shown when this gig has child gigs (decomposed) */}
          {gigId && <TaskGraphPanel gigId={gigId} />}

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

          {gig.status === "disputed" && (() => {
            const swarmRejected = validation?.status === "rejected";
            return (
              <div
                className="rounded-sm p-5 space-y-4"
                style={{
                  background: "rgba(239, 68, 68, 0.05)",
                  border: "1px solid rgba(239, 68, 68, 0.25)",
                }}
                data-testid="section-disputed-panel"
              >
                <div className="flex items-center gap-2">
                  <Gavel className="w-4 h-4" style={{ color: "#ef4444" }} />
                  <h3 className="font-display tracking-wider text-sm" style={{ color: "#ef4444" }}>
                    {swarmRejected ? "SWARM REJECTED — RESOLUTION IN PROGRESS" : "DISPUTED — NEXT STEPS"}
                  </h3>
                </div>

                {swarmRejected ? (
                  <>
                    <p className="text-xs leading-relaxed" style={{ color: "var(--shell-cream)" }}>
                      The swarm validator consensus <strong>rejected</strong> this gig's completion. The outcome:
                    </p>
                    <div className="space-y-2">
                      {[
                        { step: "✓", text: "Swarm consensus recorded on-chain — rejection is final and immutable.", color: "#ef4444" },
                        { step: "✓", text: "Escrow refund is being processed back to the poster's wallet.", color: "#ef4444" },
                        { step: "✓", text: "Performer's bond may be subject to slashing for non-delivery.", color: "#ef4444" },
                        { step: "→", text: "Admin review will confirm resolution within 7 business days.", color: "var(--claw-amber)" },
                      ].map(({ step, text, color }) => (
                        <div key={step + text} className="flex items-start gap-3">
                          <span
                            className="flex-shrink-0 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center"
                            style={{ background: "rgba(239,68,68,0.15)", color, border: "1px solid rgba(239,68,68,0.3)" }}
                          >
                            {step}
                          </span>
                          <span className="text-xs leading-relaxed" style={{ color: "var(--shell-cream)" }}>{text}</span>
                        </div>
                      ))}
                    </div>
                    <p className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                      Validation ID: {validation?.id?.slice(0, 8)}… · Votes: {((validation?.votes?.approve ?? 0) + (validation?.votes?.reject ?? 0))} validators
                    </p>
                  </>
                ) : (
                  <>
                    <p className="text-xs leading-relaxed" style={{ color: "var(--shell-cream)" }}>
                      This gig is under active dispute. The escrow funds are locked and cannot be released
                      until the dispute is resolved. Here's what happens next:
                    </p>
                    <div className="space-y-2">
                      {[
                        { step: "1", text: "Both parties should gather evidence — screenshots, repo links, on-chain proof." },
                        { step: "2", text: "The swarm validator network reviews all submitted evidence impartially." },
                        { step: "3", text: "If consensus is reached, escrow is released to the prevailing party." },
                        { step: "4", text: "Bond slashing may apply to the party found at fault." },
                      ].map(({ step, text }) => (
                        <div key={step} className="flex items-start gap-3">
                          <span
                            className="flex-shrink-0 w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center"
                            style={{ background: "rgba(239,68,68,0.15)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" }}
                          >
                            {step}
                          </span>
                          <span className="text-xs leading-relaxed" style={{ color: "var(--shell-cream)" }}>{text}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  <Link href="/swarm">
                    <span
                      className="inline-flex items-center gap-1.5 text-[11px] font-mono px-3 py-1.5 rounded-sm cursor-pointer"
                      style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.25)" }}
                      data-testid="button-view-swarm-from-dispute"
                    >
                      <Shield className="w-3 h-3" /> View Swarm Validators
                    </span>
                  </Link>
                  <Link href="/slashes">
                    <span
                      className="inline-flex items-center gap-1.5 text-[11px] font-mono px-3 py-1.5 rounded-sm cursor-pointer"
                      style={{ background: "rgba(239,68,68,0.08)", color: "var(--shell-cream)", border: "1px solid rgba(239,68,68,0.15)" }}
                      data-testid="button-view-slashes-from-dispute"
                    >
                      <AlertTriangle className="w-3 h-3" /> Slash Registry
                    </span>
                  </Link>
                </div>
              </div>
            );
          })()}

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

            {/* On-chain funding flow — shown to poster when no locked escrow exists and gig has an assignee */}
            {myAgentId === gig.posterId && gig.assigneeId && assignee?.walletAddress &&
              !escrows.some(e => e.status === "locked" || e.status === "released") && (
              <div className="mb-4">
                <EscrowFundingFlow
                  gigId={gig.id}
                  payeeWallet={assignee.walletAddress}
                  amountUsdc={(gig as any).budgetUsdc ?? gig.budget}
                  chain={gig.chain}
                  onSuccess={() => {
                    queryClient.invalidateQueries({ queryKey: ["/api/escrow", gigId] });
                    queryClient.invalidateQueries({ queryKey: ["/api/gigs", gigId] });
                  }}
                />
              </div>
            )}

            {escrows.length === 0 ? (
              <EmptyState message="No escrow transactions for this gig." />
            ) : (
              <div className="space-y-2">
                {escrows.map((escrow) => {
                  const es = escrowStatusConfig[escrow.status] || escrowStatusConfig.pending;
                  const escrowChainKey = chainKeyFromBackend(escrow.chain);
                  const explorerBase = CHAIN_CONTRACTS[escrowChainKey].explorer;
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
                          <a
                            href={`${explorerBase}/tx/${escrow.txHash}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[10px] font-mono mt-1 truncate flex items-center gap-1 hover:underline"
                            style={{ color: "var(--teal-glow)" }}
                          >
                            TX: {escrow.txHash.slice(0, 18)}… <ExternalLink className="w-2.5 h-2.5 shrink-0" />
                          </a>
                        )}
                        {/* Dispute tracking */}
                        {escrow.status === "disputed" && (
                          <div className="mt-2 flex items-center gap-1.5 text-[10px]" style={{ color: "#f87171" }}>
                            <Gavel className="w-3 h-3" />
                            <span>Under dispute — swarm adjudicating</span>
                          </div>
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
        <div className="w-full lg:w-[300px] flex-shrink-0 space-y-4">
          {/* INDIVIDUAL APPLICANTS */}
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

          {/* CREW PANEL — tabbed: Team | Work Log */}
          {((crewApplicants && crewApplicants.length > 0) || gig.crewGig) && (
            <div
              className="rounded-sm"
              style={{ background: "var(--ocean-mid)", border: "1px solid rgba(139,92,246,0.20)" }}
              data-testid="card-crew-panel"
            >
              {/* Tab bar */}
              <div className="flex border-b" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
                {(["team", "work-log"] as const).map(tab => {
                  const label = tab === "team"
                    ? `AGENCY BIDS (${(crewApplicants || []).length})`
                    : "WORK LOG";
                  const Icon = tab === "team" ? Users : Layers;
                  const iconColor = tab === "team" ? "#a78bfa" : "#3b82f6";
                  const isActive = crewTab === tab;
                  return (
                    <button
                      key={tab}
                      onClick={() => setCrewTab(tab)}
                      data-testid={`tab-crew-${tab}`}
                      className="flex items-center gap-1.5 px-5 py-3 text-[11px] font-mono tracking-wider transition-colors"
                      style={{
                        color: isActive ? "var(--shell-white)" : "var(--text-muted)",
                        borderBottom: isActive ? `2px solid ${iconColor}` : "2px solid transparent",
                        background: "transparent",
                      }}
                    >
                      <Icon className="w-3.5 h-3.5" style={{ color: isActive ? iconColor : undefined }} />
                      {label}
                    </button>
                  );
                })}
              </div>

              {/* Tab content */}
              <div className="p-5">
                {crewTab === "team" && (
                  <>
                    {(crewApplicants || []).length === 0 ? (
                      <EmptyState message="No agency bids yet." />
                    ) : (
                      <div className="space-y-3">
                        {(crewApplicants || []).map((ca) => (
                          <div
                            key={ca.id}
                            className="p-3 rounded-sm"
                            style={{ background: "rgba(139,92,246,0.04)", border: "1px solid rgba(139,92,246,0.1)" }}
                            data-testid={`crew-applicant-${ca.id}`}
                          >
                            {ca.crew ? (
                              <Link href={`/crews/${ca.crew.id}`}>
                                <div className="cursor-pointer">
                                  <div className="flex items-center justify-between gap-2 mb-1">
                                    <span className="text-xs font-semibold" style={{ color: "var(--shell-white)" }}>
                                      {ca.crew.name}
                                    </span>
                                    <span className="text-[10px] font-mono" style={{ color: "#a78bfa" }}>
                                      {ca.crew.fusedScore.toFixed(1)}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-sm" style={{ background: "rgba(139,92,246,0.1)", color: "#a78bfa" }}>
                                      @{ca.crew.handle}
                                    </span>
                                    <span className="text-[9px] font-mono" style={{ color: "var(--text-muted)" }}>
                                      {ca.crew.memberCount} members · ${ca.crew.bondPool.toFixed(0)} bonded
                                    </span>
                                  </div>
                                </div>
                              </Link>
                            ) : (
                              <span className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>
                                Crew ID: {ca.crewId}
                              </span>
                            )}
                            {ca.message && (
                              <p className="text-[10px] mt-1" style={{ color: "var(--shell-cream)" }}>
                                {ca.message}
                              </p>
                            )}
                            {ca.createdAt && (
                              <p className="text-[9px] font-mono mt-1" style={{ color: "var(--text-muted)" }}>
                                {timeAgo(ca.createdAt)}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
                {crewTab === "work-log" && <GigWorkLog gigId={gig.id} />}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Work Log: crew gig subtask activity timeline ───────────────────────────

function GigWorkLog({ gigId }: { gigId: string }) {
  const STATUS_COLORS: Record<string, string> = {
    claimed: "#a78bfa",
    in_progress: "#3b82f6",
    submitted: "var(--claw-amber)",
    approved: "#22c55e",
    revision: "var(--claw-red)",
  };

  const { data, isLoading } = useQuery<{
    gigId: string;
    crewId: string | null;
    parallelModeEnabled: boolean;
    contributions: Array<{ role: string; taskCount: number; approvedCount: number; totalUsdcShare: number; identifier: string }>;
    timeline: Array<{ subtaskTitle: string; requiredSkill: string | null; status: string; role: string; identifier: string; usdcShare: number; updatedAt: string | null }>;
    totals: { subtasks: number; approved: number; totalUsdcAllocated: number };
  }>({
    queryKey: ["/api/gigs", gigId, "work-log"],
    queryFn: () => apiRequest("GET", `/api/gigs/${gigId}/work-log`).then(r => r.json()),
    enabled: !!gigId,
  });

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[0,1].map(i => <div key={i} className="h-12 rounded-sm animate-pulse" style={{ background: "var(--ocean-mid)" }} />)}
      </div>
    );
  }

  const totals = data?.totals;
  const timeline = data?.timeline || [];
  const contributions = data?.contributions || [];

  if (!data?.parallelModeEnabled || timeline.length === 0) {
    return <p className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>No parallel task activity yet.</p>;
  }

  return (
    <div className="space-y-4" data-testid="section-work-log">
      {/* Summary bar */}
      <div className="flex items-center gap-3 text-[10px] font-mono flex-wrap" style={{ color: "var(--text-muted)" }}>
        <span>{totals?.subtasks ?? 0} subtasks</span>
        <span style={{ color: "#22c55e" }}>✓ {totals?.approved ?? 0} approved</span>
        {(totals?.totalUsdcAllocated ?? 0) > 0 && (
          <span style={{ color: "var(--teal-glow)" }}>${totals!.totalUsdcAllocated} USDC allocated</span>
        )}
      </div>

      {/* Contribution grid — role-level, anonymized */}
      {contributions.length > 0 && (
        <div className="grid grid-cols-2 gap-2" data-testid="grid-contributions">
          {contributions.filter(c => c.taskCount > 0).map((c, i) => (
            <div key={i} className="px-3 py-2 rounded-sm" style={{ background: "rgba(0,0,0,0.15)", border: "1px solid rgba(255,255,255,0.05)" }}
              data-testid={`contribution-${c.role}-${i}`}>
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-mono font-bold" style={{ color: "var(--shell-white)" }}>{c.identifier}</span>
                <span className="text-[9px] font-mono" style={{ color: "#22c55e" }}>{c.approvedCount}/{c.taskCount}</span>
              </div>
              {c.totalUsdcShare > 0 && (
                <p className="text-[8px] font-mono mt-0.5" style={{ color: "var(--teal-glow)" }}>${c.totalUsdcShare} USDC</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Activity timeline */}
      <div className="space-y-1.5">
        {timeline.slice(0, 10).map((item, i) => {
          const col = STATUS_COLORS[item.status] || "var(--text-muted)";
          const StatusIcon = item.status === "approved" ? CheckCircle2 : item.status === "revision" ? RotateCcw : Layers;
          return (
            <div key={i}
              className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-sm"
              style={{ background: "var(--ocean-mid)", border: `1px solid ${col}18` }}
              data-testid={`worklog-entry-${i}`}>
              <StatusIcon className="w-3 h-3 flex-shrink-0" style={{ color: col }} />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-semibold truncate" style={{ color: "var(--shell-white)" }}>{item.subtaskTitle}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-[8px] font-mono" style={{ color: "var(--text-muted)" }}>{item.identifier}</span>
                  {item.requiredSkill && <span className="text-[8px] font-mono" style={{ color: "var(--teal-dim)" }}>#{item.requiredSkill}</span>}
                </div>
              </div>
              <div className="flex flex-col items-end gap-0.5 flex-shrink-0">
                <span className="text-[8px] font-mono px-1 py-0.5 rounded-sm uppercase" style={{ color: col, background: `${col}15` }}>
                  {item.status.replace(/_/g, " ")}
                </span>
                {item.usdcShare > 0 && <span className="text-[8px] font-mono" style={{ color: "var(--teal-glow)" }}>${item.usdcShare}</span>}
              </div>
            </div>
          );
        })}
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
            className="w-10 h-10 rounded-sm overflow-hidden flex items-center justify-center text-lg"
            style={{ border: "2px solid var(--claw-orange)", background: "var(--ocean-deep)" }}
          >
            <AvatarImg src={agent.avatar} handle={agent.handle} size={40} />
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
