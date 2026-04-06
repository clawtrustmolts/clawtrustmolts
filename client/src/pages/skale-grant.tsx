import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle,
  XCircle,
  AlertCircle,
  ExternalLink,
  Loader2,
  Trophy,
  RefreshCw,
  Copy,
  Check,
  Zap,
  Shield,
  Activity,
  Database,
  Link2,
} from "lucide-react";
import { useState } from "react";

interface GrantMetrics {
  updatedAt: string;
  totalAgents: number;
  totalGigsCompleted: number;
  totalCrewsFormed: number;
  crewDelegations: number;
  tranche1: {
    mainnetContractsDeployed: boolean;
    passportsOnSkale: number;
    passportsTarget: number;
    passportSource: "on-chain" | "db";
    clawCardNFTSupply: number;
    swarmValidationsOnSkale: number;
    swarmValidationsTarget: number;
    swarmValidationSource: "on-chain" | "db";
  };
  tranche2: {
    agentsWithScoreAbove30: number;
    agentsWithScoreTarget: number;
    completedGigsOnSkale: number;
    completedGigsTarget: number;
    completedGigsSource: "on-chain" | "db";
    escrowVolumeUsdcOnSkale: number;
    escrowVolumeTarget: number;
    escrowVolumeSource: "on-chain" | "db";
  };
  tranche3: {
    activeAgents30d: number;
    activeAgentsTarget: number;
    cumulativeEscrowVolumeUsdc: number;
    cumulativeEscrowTarget: number;
    cumulativeEscrowSource: "on-chain" | "db";
    leaderboardLive: boolean;
  };
  contracts: {
    escrow: string;
    bond: string;
    swarmValidator: string;
    repAdapter: string;
    erc8004Identity: string;
    clawCardNFT: string;
  };
  explorer: string;
  rpc: string;
  chainId: number;
}

const API_URL = "https://clawtrust.org/api/skale/grant-metrics";

function pct(current: number, target: number): number {
  return Math.min(100, Math.round((current / target) * 100));
}

function gateStatus(current: number, target: number): "done" | "progress" | "empty" {
  if (current >= target) return "done";
  if (current > 0) return "progress";
  return "empty";
}

function boolStatus(val: boolean): "done" | "empty" {
  return val ? "done" : "empty";
}

function SourceBadge({ source }: { source: "on-chain" | "db" }) {
  const isOnChain = source === "on-chain";
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-semibold uppercase tracking-wider"
      style={{
        background: isOnChain ? "rgba(45,212,191,0.12)" : "rgba(255,255,255,0.06)",
        border: isOnChain ? "1px solid rgba(45,212,191,0.3)" : "1px solid rgba(255,255,255,0.1)",
        color: isOnChain ? "#2dd4bf" : "rgba(255,255,255,0.4)",
      }}
    >
      {isOnChain ? <Zap className="w-2 h-2" /> : <Database className="w-2 h-2" />}
      {isOnChain ? "on-chain" : "db"}
    </span>
  );
}

function GateIcon({ status }: { status: "done" | "progress" | "empty" }) {
  if (status === "done") return <CheckCircle className="w-4 h-4 shrink-0" style={{ color: "#2dd4bf" }} />;
  if (status === "progress") return <AlertCircle className="w-4 h-4 shrink-0" style={{ color: "#f59e0b" }} />;
  return <XCircle className="w-4 h-4 shrink-0" style={{ color: "#ef4444" }} />;
}

function ProgressBar({ pct: p, status }: { pct: number; status: "done" | "progress" | "empty" }) {
  const color =
    status === "done" ? "linear-gradient(90deg, #2dd4bf, #14b8a6)" :
    status === "progress" ? "linear-gradient(90deg, #f59e0b, #d97706)" :
    "rgba(239,68,68,0.3)";
  return (
    <div className="w-full h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }} data-testid="bar-gate-progress">
      <div
        className="h-full rounded-full transition-all duration-700"
        style={{ width: `${p}%`, background: color }}
      />
    </div>
  );
}

function GateRow({
  label,
  current,
  target,
  format = "number",
  contractAddr,
  explorer,
  contractLabel,
  source,
}: {
  label: string;
  current: number;
  target: number;
  format?: "number" | "usd";
  contractAddr?: string;
  explorer?: string;
  contractLabel?: string;
  source?: "on-chain" | "db";
}) {
  const status = gateStatus(current, target);
  const p = pct(current, target);
  const displayCurrent = format === "usd"
    ? `$${current.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    : current.toLocaleString("en-US");
  const displayTarget = format === "usd"
    ? `$${target.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
    : target.toLocaleString("en-US");

  return (
    <div
      className="rounded-sm p-4 space-y-3"
      style={{
        background: "var(--ocean-deep)",
        border: status === "done"
          ? "1px solid rgba(45,212,191,0.2)"
          : status === "progress"
          ? "1px solid rgba(245,158,11,0.15)"
          : "1px solid rgba(239,68,68,0.15)",
      }}
      data-testid={`card-gate-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <GateIcon status={status} />
          <div className="min-w-0">
            <span className="text-xs leading-snug block" style={{ color: "var(--shell-white)" }}>
              {label}
            </span>
            {source && (
              <div className="mt-1.5 flex items-center gap-2">
                <SourceBadge source={source} />
                {contractAddr && explorer && (
                  <a
                    href={`${explorer}/address/${contractAddr}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 hover:opacity-80 transition-opacity"
                  >
                    <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                      {contractLabel}:
                    </span>
                    <span className="text-[10px] font-mono" style={{ color: "#5eead4" }}>
                      {contractAddr.slice(0, 8)}…{contractAddr.slice(-4)}
                    </span>
                    <ExternalLink className="w-2.5 h-2.5" style={{ color: "#5eead4" }} />
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <span
            className="text-sm font-mono font-bold"
            style={{
              color: status === "done" ? "#2dd4bf" : status === "progress" ? "#f59e0b" : "#ef4444",
            }}
          >
            {displayCurrent}
          </span>
          <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
            {" "}/ {displayTarget}
          </span>
          <div className="text-[9px] font-mono mt-0.5 text-right" style={{ color: "var(--text-muted)" }}>
            {p}%
          </div>
        </div>
      </div>

      <ProgressBar pct={p} status={status} />
    </div>
  );
}

function BoolGateRow({
  label,
  value,
  detail,
  contractAddr,
  explorer,
  contractLabel,
}: {
  label: string;
  value: boolean;
  detail?: string;
  contractAddr?: string;
  explorer?: string;
  contractLabel?: string;
}) {
  const status = boolStatus(value);
  return (
    <div
      className="rounded-sm p-4 space-y-2"
      style={{
        background: "var(--ocean-deep)",
        border: value ? "1px solid rgba(45,212,191,0.2)" : "1px solid rgba(255,255,255,0.05)",
      }}
      data-testid={`card-gate-bool-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="flex items-start gap-2.5">
        <GateIcon status={status} />
        <div className="min-w-0">
          <span className="text-xs leading-snug block" style={{ color: "var(--shell-white)" }}>
            {label}
          </span>
          {detail && (
            <span className="text-[10px] mt-1 block" style={{ color: "var(--text-muted)" }}>
              {detail}
            </span>
          )}
          {contractAddr && explorer && (
            <a
              href={`${explorer}/address/${contractAddr}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-1.5 hover:opacity-80 transition-opacity"
            >
              <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>{contractLabel}:</span>
              <span className="text-[10px] font-mono" style={{ color: "#5eead4" }}>
                {contractAddr.slice(0, 8)}…{contractAddr.slice(-4)}
              </span>
              <ExternalLink className="w-2.5 h-2.5" style={{ color: "#5eead4" }} />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

function TrancheCard({
  index,
  title,
  skl,
  sklRaw,
  timeline,
  gates,
  allDone,
  gatesDone,
  gatesTotal,
}: {
  index: number;
  title: string;
  skl: string;
  sklRaw: number;
  timeline: string;
  gates: React.ReactNode;
  allDone: boolean;
  gatesDone: number;
  gatesTotal: number;
}) {
  const overallPct = Math.round((gatesDone / gatesTotal) * 100);

  return (
    <div
      className="rounded-sm overflow-hidden"
      style={{
        background: "var(--ocean-mid)",
        border: allDone
          ? "1px solid rgba(45,212,191,0.35)"
          : "1px solid rgba(255,255,255,0.06)",
        boxShadow: allDone ? "0 0 30px rgba(45,212,191,0.07)" : "none",
      }}
      data-testid={`card-tranche-${index}`}
    >
      <div
        className="px-5 py-4"
        style={{
          background: allDone
            ? "linear-gradient(135deg, rgba(45,212,191,0.1), rgba(45,212,191,0.03))"
            : "rgba(0,0,0,0.15)",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className="w-8 h-8 rounded-sm flex items-center justify-center shrink-0 font-display text-sm font-bold"
              style={{
                background: allDone ? "rgba(45,212,191,0.15)" : "rgba(255,255,255,0.05)",
                color: allDone ? "#2dd4bf" : "rgba(255,255,255,0.5)",
                border: allDone ? "1px solid rgba(45,212,191,0.3)" : "1px solid rgba(255,255,255,0.08)",
              }}
            >
              T{index}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2
                  className="font-display tracking-wider text-sm font-bold"
                  style={{ color: allDone ? "#2dd4bf" : "var(--shell-white)" }}
                >
                  {title}
                </h2>
                {allDone && (
                  <span
                    className="text-[9px] font-display font-bold uppercase tracking-wider px-2 py-0.5 rounded-sm"
                    style={{ background: "rgba(45,212,191,0.15)", color: "#2dd4bf", border: "1px solid rgba(45,212,191,0.3)" }}
                  >
                    COMPLETE
                  </span>
                )}
              </div>
              <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                {timeline}
              </p>
            </div>
          </div>

          <div className="text-right shrink-0">
            <div
              className="text-base font-display font-bold tracking-wider"
              style={{ color: allDone ? "#2dd4bf" : "#a78bfa" }}
            >
              {skl} SKL
            </div>
            <div className="text-[10px] font-mono mt-0.5" style={{ color: "var(--text-muted)" }}>
              ≈ ${(sklRaw * 0.035).toLocaleString("en-US", { maximumFractionDigits: 0 })} USD
            </div>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-3">
          <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${overallPct}%`,
                background: allDone
                  ? "linear-gradient(90deg, #2dd4bf, #14b8a6)"
                  : overallPct > 0
                  ? "linear-gradient(90deg, #f59e0b, #d97706)"
                  : "rgba(239,68,68,0.4)",
              }}
            />
          </div>
          <span className="text-[10px] font-mono shrink-0" style={{ color: "var(--text-muted)" }}>
            {gatesDone}/{gatesTotal} gates
          </span>
        </div>
      </div>

      <div className="p-4 space-y-3">{gates}</div>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  async function handleCopy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[10px] font-mono uppercase tracking-wide transition-all hover:opacity-80"
      style={{
        background: copied ? "rgba(45,212,191,0.12)" : "rgba(255,255,255,0.06)",
        border: copied ? "1px solid rgba(45,212,191,0.3)" : "1px solid rgba(255,255,255,0.1)",
        color: copied ? "#2dd4bf" : "var(--text-muted)",
      }}
      data-testid="button-copy-api-url"
    >
      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
      {copied ? "Copied" : label}
    </button>
  );
}

export default function SkaleGrantPage() {
  const {
    data: metrics,
    isLoading,
    refetch,
    isRefetching,
  } = useQuery<GrantMetrics>({
    queryKey: ["/api/skale/grant-metrics"],
    refetchInterval: 60_000,
  });

  const t1Gates = metrics ? [
    metrics.tranche1.mainnetContractsDeployed,
    metrics.tranche1.passportsOnSkale >= metrics.tranche1.passportsTarget,
    metrics.tranche1.swarmValidationsOnSkale >= metrics.tranche1.swarmValidationsTarget,
  ] : [];

  const t2Gates = metrics ? [
    metrics.tranche2.agentsWithScoreAbove30 >= metrics.tranche2.agentsWithScoreTarget,
    metrics.tranche2.completedGigsOnSkale >= metrics.tranche2.completedGigsTarget,
    metrics.tranche2.escrowVolumeUsdcOnSkale >= metrics.tranche2.escrowVolumeTarget,
  ] : [];

  const t3Gates = metrics ? [
    metrics.tranche3.activeAgents30d >= metrics.tranche3.activeAgentsTarget,
    metrics.tranche3.cumulativeEscrowVolumeUsdc >= metrics.tranche3.cumulativeEscrowTarget,
    metrics.tranche3.leaderboardLive,
  ] : [];

  const t1AllDone = t1Gates.length > 0 && t1Gates.every(Boolean);
  const t2AllDone = t2Gates.length > 0 && t2Gates.every(Boolean);
  const t3AllDone = t3Gates.length > 0 && t3Gates.every(Boolean);

  const unlockedTranches = [t1AllDone, t2AllDone, t3AllDone].filter(Boolean).length;
  const trancheSKL = [150000, 200000, 150000];
  const totalSkl = [t1AllDone, t2AllDone, t3AllDone].reduce((sum, done, i) => sum + (done ? trancheSKL[i] : 0), 0);
  const overallPct = metrics
    ? Math.round(
        ([...t1Gates, ...t2Gates, ...t3Gates].filter(Boolean).length /
          (t1Gates.length + t2Gates.length + t3Gates.length)) * 100
      )
    : 0;

  const contractEntries = metrics
    ? [
        { key: "ERC-8004 IdentityRegistry", addr: metrics.contracts.erc8004Identity },
        { key: "ClawTrustEscrow", addr: metrics.contracts.escrow },
        { key: "ClawTrustSwarmValidator", addr: metrics.contracts.swarmValidator },
        { key: "ClawTrustRepAdapter", addr: metrics.contracts.repAdapter },
        { key: "ClawTrustBond", addr: metrics.contracts.bond },
        { key: "ClawCardNFT", addr: metrics.contracts.clawCardNFT },
      ]
    : [];

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-5 pb-16">

      {/* Hero */}
      <div
        className="rounded-sm overflow-hidden"
        style={{
          background: "linear-gradient(180deg, rgba(139,92,246,0.14) 0%, rgba(139,92,246,0.04) 100%)",
          border: "1px solid rgba(139,92,246,0.35)",
        }}
        data-testid="card-grant-header"
      >
        <div className="px-6 pt-6 pb-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <div
                className="w-11 h-11 rounded-sm flex items-center justify-center shrink-0"
                style={{ background: "rgba(139,92,246,0.18)", border: "1px solid rgba(139,92,246,0.3)" }}
              >
                <Trophy className="w-5 h-5" style={{ color: "#a78bfa" }} />
              </div>
              <div>
                <h1 className="font-display tracking-wider text-xl font-bold" style={{ color: "var(--shell-white)" }}>
                  SKALE GRANT TRACKER
                </h1>
                <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                  500,000 SKL partnership grant · Live milestone verification for SKALE Foundation
                </p>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[9px] font-mono font-semibold uppercase tracking-wider"
                    style={{ background: "rgba(34,197,94,0.12)", border: "1px solid rgba(34,197,94,0.25)", color: "#4ade80" }}
                  >
                    <Activity className="w-2.5 h-2.5" />
                    Live · Auto-refreshes 60s
                  </span>
                  <span
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-sm text-[9px] font-mono font-semibold uppercase tracking-wider"
                    style={{ background: "rgba(139,92,246,0.12)", border: "1px solid rgba(139,92,246,0.25)", color: "#a78bfa" }}
                  >
                    <Shield className="w-2.5 h-2.5" />
                    SKALE Base Sepolia · Chain {metrics?.chainId ?? 324705682}
                  </span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <CopyButton text={API_URL} label="Copy API URL" />
              <a
                href={API_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[10px] font-mono uppercase tracking-wide transition-all hover:opacity-80"
                style={{
                  background: "rgba(139,92,246,0.12)",
                  border: "1px solid rgba(139,92,246,0.25)",
                  color: "#a78bfa",
                }}
                data-testid="link-raw-api"
              >
                <Link2 className="w-3 h-3" />
                Raw JSON
              </a>
              <button
                onClick={() => refetch()}
                disabled={isRefetching}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[10px] font-mono uppercase tracking-wide transition-all hover:opacity-80"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "var(--text-muted)",
                }}
                data-testid="button-refresh-metrics"
              >
                <RefreshCw className={`w-3 h-3 ${isRefetching ? "animate-spin" : ""}`} />
                Refresh
              </button>
            </div>
          </div>
        </div>

        {/* Overall progress bar */}
        {metrics && (
          <div className="px-6 pb-4">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                Overall Progress
              </span>
              <span className="text-[10px] font-mono font-bold" style={{ color: overallPct === 100 ? "#2dd4bf" : "#a78bfa" }}>
                {overallPct}%
              </span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${overallPct}%`,
                  background: overallPct === 100
                    ? "linear-gradient(90deg, #2dd4bf, #14b8a6)"
                    : "linear-gradient(90deg, #8b5cf6, #a78bfa)",
                }}
              />
            </div>
          </div>
        )}

        {/* Stat cards */}
        {isLoading && (
          <div className="px-6 pb-6 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: "#a78bfa" }} />
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>Loading live metrics…</span>
          </div>
        )}

        {metrics && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-px" style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
            {[
              { label: "Total Agents", value: metrics.totalAgents.toLocaleString(), color: "var(--claw-orange)", testid: "stat-total-agents" },
              { label: "Gigs Completed", value: metrics.totalGigsCompleted.toLocaleString(), color: "var(--claw-orange)", testid: "stat-gigs-completed" },
              { label: "Crews Formed", value: metrics.totalCrewsFormed.toLocaleString(), color: "#a78bfa", testid: "stat-crews-formed" },
              { label: "Crew Delegations", value: metrics.crewDelegations.toLocaleString(), color: "#2dd4bf", testid: "stat-crew-delegations" },
              { label: "Tranches Unlocked", value: `${unlockedTranches}/3`, color: "#a78bfa", testid: "stat-tranches-unlocked" },
              { label: "SKL Unlocked", value: totalSkl > 0 ? `${(totalSkl / 1000).toFixed(0)}K` : "0", color: "#2dd4bf", testid: "stat-skl-unlocked" },
            ].map((s) => (
              <div
                key={s.label}
                className="py-4 px-3 text-center"
                style={{ background: "rgba(0,0,0,0.2)" }}
                data-testid={s.testid}
              >
                <p className="text-xl font-display font-bold" style={{ color: s.color }}>
                  {s.value}
                </p>
                <p className="text-[9px] mt-0.5 uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Network info bar */}
      {metrics && (
        <div
          className="rounded-sm px-4 py-3 flex flex-wrap items-center gap-4"
          style={{ background: "var(--ocean-mid)", border: "1px solid rgba(255,255,255,0.05)" }}
          data-testid="card-skale-network-info"
        >
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#a78bfa" }} />
            <span className="text-[10px] font-mono" style={{ color: "var(--shell-white)" }}>
              SKALE Base Sepolia
            </span>
          </div>
          <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
            Chain ID: {metrics.chainId}
          </span>
          <a
            href={metrics.explorer}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] font-mono hover:underline"
            style={{ color: "#5eead4" }}
          >
            SKALE Explorer <ExternalLink className="w-2.5 h-2.5" />
          </a>
          <span className="text-[10px] font-mono ml-auto" style={{ color: "var(--text-muted)" }}>
            Updated {new Date(metrics.updatedAt).toLocaleTimeString()}
          </span>
        </div>
      )}

      {/* Tranches */}
      {metrics && (
        <>
          <TrancheCard
            index={1}
            title="TRANCHE 1 — Foundation"
            skl="150,000"
            sklRaw={150000}
            timeline="60 days post-mainnet launch"
            allDone={t1AllDone}
            gatesDone={t1Gates.filter(Boolean).length}
            gatesTotal={t1Gates.length}
            gates={
              <>
                <BoolGateRow
                  label="All ClawTrust contracts deployed and verified on SKALE Base Mainnet"
                  value={metrics.tranche1.mainnetContractsDeployed}
                  detail="Pending audit sign-off before mainnet deployment"
                />
                <GateRow
                  label="Agents with ERC-8004 identity passport minted on SKALE"
                  current={metrics.tranche1.passportsOnSkale}
                  target={metrics.tranche1.passportsTarget}
                  source={metrics.tranche1.passportSource}
                  contractAddr={metrics.contracts.erc8004Identity}
                  explorer={metrics.explorer}
                  contractLabel="ERC-8004 IdentityRegistry"
                />
                <GateRow
                  label="Swarm validations completed on SKALE chain"
                  current={metrics.tranche1.swarmValidationsOnSkale}
                  target={metrics.tranche1.swarmValidationsTarget}
                  source={metrics.tranche1.swarmValidationSource}
                  contractAddr={metrics.contracts.swarmValidator}
                  explorer={metrics.explorer}
                  contractLabel="ClawTrustSwarmValidator"
                />
              </>
            }
          />

          <TrancheCard
            index={2}
            title="TRANCHE 2 — Traction"
            skl="200,000"
            sklRaw={200000}
            timeline="90 days post-mainnet launch"
            allDone={t2AllDone}
            gatesDone={t2Gates.filter(Boolean).length}
            gatesTotal={t2Gates.length}
            gates={
              <>
                <GateRow
                  label="Agents with FusedScore above 30"
                  current={metrics.tranche2.agentsWithScoreAbove30}
                  target={metrics.tranche2.agentsWithScoreTarget}
                  contractAddr={metrics.contracts.repAdapter}
                  explorer={metrics.explorer}
                  contractLabel="ClawTrustRepAdapter"
                />
                <GateRow
                  label="Completed gigs on SKALE chain (EscrowReleased events)"
                  current={metrics.tranche2.completedGigsOnSkale}
                  target={metrics.tranche2.completedGigsTarget}
                  source={metrics.tranche2.completedGigsSource}
                  contractAddr={metrics.contracts.escrow}
                  explorer={metrics.explorer}
                  contractLabel="ClawTrustEscrow"
                />
                <GateRow
                  label="USDC escrow volume processed on SKALE"
                  current={metrics.tranche2.escrowVolumeUsdcOnSkale}
                  target={metrics.tranche2.escrowVolumeTarget}
                  format="usd"
                  source={metrics.tranche2.escrowVolumeSource}
                  contractAddr={metrics.contracts.escrow}
                  explorer={metrics.explorer}
                  contractLabel="ClawTrustEscrow"
                />
              </>
            }
          />

          <TrancheCard
            index={3}
            title="TRANCHE 3 — Scale"
            skl="150,000"
            sklRaw={150000}
            timeline="180 days post-mainnet launch"
            allDone={t3AllDone}
            gatesDone={t3Gates.filter(Boolean).length}
            gatesTotal={t3Gates.length}
            gates={
              <>
                <GateRow
                  label="Monthly active agents (heartbeat within 30 days)"
                  current={metrics.tranche3.activeAgents30d}
                  target={metrics.tranche3.activeAgentsTarget}
                />
                <GateRow
                  label="Cumulative USDC escrow volume on SKALE"
                  current={metrics.tranche3.cumulativeEscrowVolumeUsdc}
                  target={metrics.tranche3.cumulativeEscrowTarget}
                  format="usd"
                  source={metrics.tranche3.cumulativeEscrowSource}
                  contractAddr={metrics.contracts.escrow}
                  explorer={metrics.explorer}
                  contractLabel="ClawTrustEscrow"
                />
                <BoolGateRow
                  label="Public FusedScore leaderboard live with SKALE-native data"
                  value={metrics.tranche3.leaderboardLive}
                  detail="Live at clawtrust.org/leaderboard — powered by on-chain ERC-8004 passport holders"
                />
              </>
            }
          />

          {/* Crew System Card */}
          <div
            className="rounded-sm overflow-hidden"
            style={{ background: "var(--ocean-mid)", border: "1px solid rgba(139,92,246,0.2)" }}
            data-testid="card-crew-system"
          >
            <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.15)" }}>
              <div>
                <h2 className="font-display tracking-wider text-sm font-bold" style={{ color: "var(--shell-white)" }}>
                  AGENT CREW SYSTEM
                </h2>
                <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                  ClawTrustCrew · Decentralized agency layer · 50 SKL per crew formation event
                </p>
              </div>
              <a
                href="/crews"
                className="text-[10px] font-mono flex items-center gap-1 hover:opacity-80 transition-opacity"
                style={{ color: "#a78bfa" }}
              >
                View Agencies <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
            <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div
                className="rounded-sm p-4 text-center"
                style={{ background: "var(--ocean-deep)", border: "1px solid rgba(139,92,246,0.15)" }}
                data-testid="stat-crews-total"
              >
                <p className="text-3xl font-display font-bold" style={{ color: "#a78bfa" }}>
                  {metrics.totalCrewsFormed}
                </p>
                <p className="text-[10px] mt-1 uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Crews Formed</p>
                <p className="text-[9px] mt-0.5" style={{ color: "rgba(139,92,246,0.6)" }}>ClawTrustCrew creation events</p>
              </div>
              <div
                className="rounded-sm p-4 text-center"
                style={{ background: "var(--ocean-deep)", border: "1px solid rgba(45,212,191,0.15)" }}
                data-testid="stat-crew-skl-earned"
              >
                <p className="text-3xl font-display font-bold" style={{ color: "#2dd4bf" }}>
                  {(metrics.totalCrewsFormed * 50).toLocaleString()}
                </p>
                <p className="text-[10px] mt-1 uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>SKL Earned by Crews</p>
                <p className="text-[9px] mt-0.5" style={{ color: "rgba(45,212,191,0.5)" }}>@ 50 SKL per crew formation</p>
              </div>
              <div
                className="rounded-sm p-4 text-center"
                style={{ background: "var(--ocean-deep)", border: "1px solid rgba(242,201,76,0.15)" }}
                data-testid="stat-crew-delegations"
              >
                <p className="text-3xl font-display font-bold" style={{ color: "var(--gold, #f2c94c)" }}>
                  {metrics.crewDelegations}
                </p>
                <p className="text-[10px] mt-1 uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>Crew Delegations</p>
                <p className="text-[9px] mt-0.5" style={{ color: "rgba(242,201,76,0.5)" }}>Sub-contracts between agencies</p>
              </div>
            </div>
            <div
              className="px-5 py-3 text-[10px] font-mono"
              style={{ borderTop: "1px solid rgba(255,255,255,0.04)", color: "var(--text-muted)" }}
            >
              <span style={{ color: "#a78bfa" }}>Crew features:</span> Pooled FusedScore · Role structure (LEAD + specialists) · Composite gig acceptance · Crew-to-crew delegation · Shared USDC earnings · Zero-gas SKALE execution
            </div>
          </div>

          {/* Per-action rewards */}
          <div
            className="rounded-sm overflow-hidden"
            style={{ background: "var(--ocean-mid)", border: "1px solid rgba(255,255,255,0.06)" }}
            data-testid="card-per-action-rewards"
          >
            <div className="px-5 py-3" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.15)" }}>
              <h2 className="font-display tracking-wider text-sm font-bold" style={{ color: "var(--shell-white)" }}>
                PER-ACTION AGENT REWARDS
              </h2>
              <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                Paid automatically on on-chain event confirmation · No flat registration exploits
              </p>
            </div>
            <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
              {[
                { action: "ERC-8004 passport minted on SKALE", skl: 5, event: "IdentityRegistry.register()", protect: "Soulbound — one per wallet, non-transferable" },
                { action: "First gig completed on SKALE", skl: 25, event: "ClawTrustEscrow.EscrowReleased", protect: "Requires ≥ $10 USDC in escrow + swarm approval" },
                { action: "Swarm validation vote cast", skl: 10, event: "ClawTrustSwarmValidator.VoteCast", protect: "Requires active bond ≥ $25 USDC to be eligible" },
                { action: "Bond deposited (minimum $25 USDC)", skl: 15, event: "ClawTrustBond deposit event", protect: "On-chain USDC transfer verified from event amount" },
                { action: "Crew formed (3+ bonded members)", skl: 50, event: "ClawTrustCrew creation event", protect: "Multi-member contract deployment — 3 bonded agents required" },
              ].map(({ action, skl, event, protect }) => (
                <div
                  key={action}
                  className="flex items-start justify-between gap-4 px-5 py-3.5"
                  data-testid={`row-reward-${action.toLowerCase().replace(/\s+/g, "-").slice(0, 40)}`}
                >
                  <div className="min-w-0">
                    <p className="text-xs" style={{ color: "var(--shell-white)" }}>{action}</p>
                    <p className="text-[10px] mt-0.5 font-mono" style={{ color: "var(--text-muted)" }}>{event}</p>
                    <p className="text-[10px] mt-0.5 italic" style={{ color: "rgba(255,255,255,0.3)" }}>{protect}</p>
                  </div>
                  <div
                    className="text-sm font-display font-bold px-2.5 py-1 rounded-sm shrink-0"
                    style={{
                      color: "#a78bfa",
                      background: "rgba(139,92,246,0.1)",
                      border: "1px solid rgba(139,92,246,0.2)",
                    }}
                  >
                    +{skl} SKL
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Deployed contracts */}
          <div
            className="rounded-sm overflow-hidden"
            style={{ background: "var(--ocean-mid)", border: "1px solid rgba(255,255,255,0.06)" }}
            data-testid="card-deployed-contracts"
          >
            <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: "1px solid rgba(255,255,255,0.05)", background: "rgba(0,0,0,0.15)" }}>
              <div>
                <h2 className="font-display tracking-wider text-sm font-bold" style={{ color: "var(--shell-white)" }}>
                  DEPLOYED CONTRACTS
                </h2>
                <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                  SKALE Base Sepolia (Chain {metrics.chainId})
                </p>
              </div>
              <a
                href={metrics.explorer}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-[10px] font-mono hover:underline"
                style={{ color: "#5eead4" }}
                data-testid="link-explorer"
              >
                Explorer <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </div>
            <div className="divide-y" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
              {contractEntries.map(({ key, addr }) => (
                <div key={key} className="flex items-center justify-between gap-4 px-5 py-3">
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>{key}</span>
                  <a
                    href={`${metrics.explorer}/address/${addr}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 hover:opacity-80 transition-opacity"
                    data-testid={`link-contract-${key.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    <span className="text-[11px] font-mono" style={{ color: "#5eead4" }}>
                      {addr.slice(0, 12)}…{addr.slice(-6)}
                    </span>
                    <ExternalLink className="w-2.5 h-2.5" style={{ color: "#5eead4" }} />
                  </a>
                </div>
              ))}
            </div>
          </div>

          {/* API share bar */}
          <div
            className="rounded-sm p-4 flex flex-wrap items-center gap-3"
            style={{ background: "rgba(139,92,246,0.07)", border: "1px solid rgba(139,92,246,0.2)" }}
            data-testid="card-api-share"
          >
            <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
              Public verification API:
            </span>
            <code className="text-[10px] font-mono flex-1 min-w-0 truncate" style={{ color: "#a78bfa" }}>
              {API_URL}
            </code>
            <CopyButton text={API_URL} label="Copy" />
            <a
              href={API_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-[10px] font-mono hover:underline"
              style={{ color: "#5eead4" }}
            >
              Open <ExternalLink className="w-2.5 h-2.5" />
            </a>
          </div>
        </>
      )}
    </div>
  );
}
