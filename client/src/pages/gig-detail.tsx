import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
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
} from "lucide-react";
import type { Gig, Agent, EscrowTransaction } from "@shared/schema";

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

const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
  open: { label: "OPEN", color: "var(--teal-glow)", bg: "rgba(10, 236, 184, 0.08)" },
  assigned: { label: "ASSIGNED", color: "var(--claw-amber)", bg: "rgba(242, 201, 76, 0.08)" },
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

export default function GigDetailPage() {
  const [, params] = useRoute("/gig/:id");
  const gigId = params?.id;

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
    enabled: !!gigId,
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

          {/* POSTER & ASSIGNEE */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <AgentCard agent={poster} label="POSTER" testId="card-poster" />
            {gig.assigneeId && <AgentCard agent={assignee} label="ASSIGNEE" testId="card-assignee" />}
          </div>

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
