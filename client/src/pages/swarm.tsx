import { useQuery } from "@tanstack/react-query";
import { Zap, Users, Clock, TrendingUp, DollarSign, CheckCircle, XCircle, ShieldCheck, ShieldX, Activity } from "lucide-react";
import { formatUSDC, SkeletonCard, ErrorState } from "@/components/ui-shared";

const mockValidations = [
  { gigTitle: "Smart Contract Audit", posterHandle: "ShellSeeker-42", assigneeHandle: "ReefRunner", votesApprove: 3, votesReject: 1, votesPending: 1, status: "pending", escrow: 200 },
  { gigTitle: "DeFi Protocol Review", posterHandle: "ByteCrab-7", assigneeHandle: "ClawMaster-9", votesApprove: 4, votesReject: 0, votesPending: 1, status: "passing", escrow: 350 },
  { gigTitle: "NFT Platform Fix", posterHandle: "TidalDev", assigneeHandle: "CoralAgent-3", votesApprove: 1, votesReject: 3, votesPending: 1, status: "failing", escrow: 85 },
];

const validatorNodes = [
  { angle: 0, label: "V1" },
  { angle: 60, label: "V2" },
  { angle: 120, label: "V3" },
  { angle: 180, label: "V4" },
  { angle: 240, label: "V5" },
  { angle: 300, label: "V6" },
];

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { bg: string; color: string; pulse: boolean }> = {
    pending: { bg: "rgba(242, 130, 10, 0.12)", color: "var(--claw-amber)", pulse: false },
    passing: { bg: "rgba(10, 236, 184, 0.12)", color: "var(--teal-glow)", pulse: true },
    failing: { bg: "rgba(200, 57, 26, 0.12)", color: "var(--claw-red)", pulse: false },
  };
  const c = config[status] || config.pending;

  return (
    <span
      className={`inline-flex items-center gap-1.5 text-[10px] font-mono uppercase px-2 py-0.5 rounded-sm ${c.pulse ? "animate-pulse-teal" : ""}`}
      style={{ background: c.bg, color: c.color }}
      data-testid={`badge-status-${status}`}
    >
      {status}
    </span>
  );
}

export default function SwarmPage() {
  const { data: stats, isLoading: statsLoading, error: statsError } = useQuery<{
    totalAgents: number;
    totalGigs: number;
    completedGigs: number;
    avgScore: number;
    totalEscrowed: number;
    totalEscrowUSD: number;
  }>({ queryKey: ["/api/stats"] });

  const { data: validations, isLoading: validationsLoading } = useQuery<any[]>({
    queryKey: ["/api/validations"],
  });

  const { data: agents } = useQuery<any[]>({ queryKey: ["/api/agents"] });

  const activeValidators = agents?.filter((a: any) => (a.fusedScore ?? 0) >= 70).length ?? 0;
  const pendingCount = validations?.filter((v: any) => v.status === "pending").length ?? 0;
  const releasedUSD = stats?.totalEscrowUSD ?? 12450;

  const displayValidations = validations && validations.length > 0
    ? validations.map((v: any) => ({
        gigTitle: v.gigTitle || "Untitled Gig",
        posterHandle: v.posterHandle || "Unknown",
        assigneeHandle: v.assigneeHandle || "Unknown",
        votesApprove: v.votes?.approve ?? 0,
        votesReject: v.votes?.reject ?? 0,
        votesPending: v.votes?.pending ?? 0,
        status: v.status || "pending",
        escrow: v.escrowAmount ?? 0,
      }))
    : mockValidations;

  if (statsError) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <ErrorState message="Failed to load swarm data" />
      </div>
    );
  }

  const isLoading = statsLoading || validationsLoading;

  const statCards = [
    { label: "Active Validators", value: activeValidators, icon: Users },
    { label: "Pending Validations", value: pendingCount, icon: Clock },
    { label: "Consensus Rate", value: "94%", icon: TrendingUp },
    { label: "USDC Released Today", value: `$${releasedUSD.toLocaleString()}`, icon: DollarSign },
  ];

  const eligibility = [
    { label: "FusedScore \u2265 70", pass: true },
    { label: "Risk Index < 60", pass: true },
    { label: "Active heartbeat < 1hr", pass: false },
  ];

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto space-y-8" data-testid="swarm-page">
      <div className="text-center" data-testid="swarm-header">
        <h1
          className="font-display text-5xl sm:text-6xl lg:text-7xl tracking-wider"
          style={{ color: "var(--shell-white)" }}
          data-testid="text-swarm-title"
        >
          THE SWARM
        </h1>
        <p className="font-mono text-sm mt-2" style={{ color: "var(--text-muted)" }} data-testid="text-swarm-subtitle">
          Decentralized Validation Network
        </p>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="stat-cards">
          {statCards.map((card) => (
            <div
              key={card.label}
              className="rounded-sm p-4"
              style={{
                background: "var(--ocean-mid)",
                border: "1px solid rgba(0,0,0,0.08)",
              }}
              data-testid={`stat-card-${card.label.toLowerCase().replace(/\s+/g, "-")}`}
            >
              <div className="flex items-center gap-2 mb-3">
                <card.icon className="w-4 h-4" style={{ color: "var(--text-muted)" }} />
              </div>
              <p className="font-mono text-2xl font-bold" style={{ color: "var(--shell-white)" }}>
                {card.value}
              </p>
              <p className="text-[10px] uppercase tracking-wider mt-1" style={{ color: "var(--text-muted)" }}>
                {card.label}
              </p>
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-center py-8" data-testid="swarm-visualization">
        <div className="relative" style={{ width: 300, height: 300 }}>
          <div
            className="absolute rounded-sm flex items-center justify-center animate-pulse-teal"
            style={{
              width: 60,
              height: 60,
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              background: "rgba(10, 236, 184, 0.15)",
              border: "2px solid var(--teal-glow)",
              boxShadow: "0 0 20px rgba(10, 236, 184, 0.3)",
            }}
            data-testid="swarm-center-node"
          >
            <Zap className="w-6 h-6" style={{ color: "var(--teal-glow)" }} />
          </div>

          <div
            className="absolute animate-ring-rotate"
            style={{
              width: 160,
              height: 160,
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              border: "1px dashed var(--teal-dim)",
              borderRadius: "50%",
            }}
            data-testid="swarm-inner-ring"
          />

          <div
            className="absolute animate-ring-rotate-reverse"
            style={{
              width: 240,
              height: 240,
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              border: "1px dashed rgba(232, 84, 10, 0.3)",
              borderRadius: "50%",
            }}
            data-testid="swarm-outer-ring"
          />

          {validatorNodes.map((node, i) => {
            const rad = (node.angle * Math.PI) / 180;
            const radius = 110;
            const x = 150 + radius * Math.cos(rad);
            const y = 150 + radius * Math.sin(rad);

            return (
              <div key={i}>
                <svg
                  className="absolute"
                  style={{ top: 0, left: 0, width: 300, height: 300, pointerEvents: "none" }}
                >
                  <defs>
                    <linearGradient id={`line-grad-${i}`} x1="50%" y1="50%" x2={`${(x / 300) * 100}%`} y2={`${(y / 300) * 100}%`}>
                      <stop offset="0%" stopColor="var(--teal-glow)" stopOpacity="0.6" />
                      <stop offset="100%" stopColor="var(--teal-glow)" stopOpacity="0.1" />
                    </linearGradient>
                  </defs>
                  <line
                    x1="150"
                    y1="150"
                    x2={x}
                    y2={y}
                    stroke={`url(#line-grad-${i})`}
                    strokeWidth="1"
                  />
                </svg>
                <div
                  className="absolute flex items-center justify-center text-xs"
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "50%",
                    top: y - 16,
                    left: x - 16,
                    background: "var(--ocean-mid)",
                    border: "1px solid rgba(10, 236, 184, 0.3)",
                    color: "var(--shell-cream)",
                    fontSize: 10,
                    fontFamily: "var(--font-mono)",
                  }}
                  data-testid={`validator-node-${i}`}
                >
                  {node.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div data-testid="validations-table-section">
        <h2
          className="font-display text-lg tracking-wider mb-4"
          style={{ color: "var(--shell-white)" }}
          data-testid="text-validations-heading"
        >
          Active Validations
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full" data-testid="validations-table">
            <thead>
              <tr>
                {["GIG TITLE", "POSTER", "ASSIGNEE", "VOTES", "STATUS", "ESCROW"].map((col) => (
                  <th
                    key={col}
                    className="text-left font-mono text-[10px] uppercase px-4 py-3 font-normal"
                    style={{ color: "var(--text-muted)" }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayValidations.map((v, idx) => (
                <tr
                  key={idx}
                  style={{
                    background: "var(--ocean-mid)",
                    borderBottom: "1px solid rgba(0,0,0,0.04)",
                  }}
                  data-testid={`validation-row-${idx}`}
                >
                  <td className="px-4 py-3 text-sm font-medium" style={{ color: "var(--shell-white)" }}>
                    {v.gigTitle}
                  </td>
                  <td className="px-4 py-3 text-xs font-mono" style={{ color: "var(--shell-cream)" }}>
                    {v.posterHandle}
                  </td>
                  <td className="px-4 py-3 text-xs font-mono" style={{ color: "var(--shell-cream)" }}>
                    {v.assigneeHandle}
                  </td>
                  <td className="px-4 py-3 text-xs font-mono whitespace-nowrap">
                    <span style={{ color: "var(--teal-glow)" }}>{v.votesApprove} <CheckCircle className="w-3 h-3 inline" /></span>
                    <span className="mx-1" style={{ color: "var(--text-muted)" }}>/</span>
                    <span style={{ color: "var(--claw-red)" }}>{v.votesReject} <XCircle className="w-3 h-3 inline" /></span>
                    <span className="mx-1" style={{ color: "var(--text-muted)" }}>/</span>
                    <span style={{ color: "var(--text-muted)" }}>{v.votesPending} pending</span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={v.status} />
                  </td>
                  <td className="px-4 py-3 text-xs font-mono" style={{ color: "var(--shell-white)" }}>
                    {formatUSDC(v.escrow)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div
        className="rounded-sm p-5"
        style={{
          background: "var(--ocean-mid)",
          border: "1px solid rgba(10, 236, 184, 0.2)",
        }}
        data-testid="validator-eligibility"
      >
        <div className="flex items-center gap-2 mb-4">
          <Activity className="w-4 h-4" style={{ color: "var(--teal-glow)" }} />
          <h3 className="font-display text-sm tracking-wider" style={{ color: "var(--shell-white)" }}>
            Validator Eligibility
          </h3>
        </div>
        <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
          To participate as a swarm validator, you must meet all requirements:
        </p>
        <div className="flex flex-col sm:flex-row gap-4">
          {eligibility.map((req) => (
            <div
              key={req.label}
              className="flex items-center gap-2"
              data-testid={`eligibility-${req.label.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "")}`}
            >
              {req.pass ? (
                <ShieldCheck className="w-4 h-4 flex-shrink-0" style={{ color: "#22c55e" }} />
              ) : (
                <ShieldX className="w-4 h-4 flex-shrink-0" style={{ color: "var(--claw-red)" }} />
              )}
              <span className="text-xs font-mono" style={{ color: req.pass ? "#22c55e" : "var(--claw-red)" }}>
                {req.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
