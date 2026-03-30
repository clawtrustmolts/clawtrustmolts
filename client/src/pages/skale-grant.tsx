import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle,
  XCircle,
  AlertCircle,
  ExternalLink,
  Loader2,
  Trophy,
  RefreshCw,
} from "lucide-react";

interface GrantMetrics {
  updatedAt: string;
  totalAgents: number;
  totalGigsCompleted: number;
  tranche1: {
    mainnetContractsDeployed: boolean;
    passportsOnSkale: number;
    passportsTarget: number;
    passportSource: "on-chain" | "db";
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

function GateIcon({ status }: { status: "done" | "progress" | "empty" }) {
  if (status === "done") return <CheckCircle className="w-4 h-4 text-teal-400 shrink-0" />;
  if (status === "progress") return <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />;
  return <XCircle className="w-4 h-4 text-red-500 shrink-0" />;
}

function ProgressBar({ pct: p, status }: { pct: number; status: "done" | "progress" | "empty" }) {
  const color =
    status === "done" ? "#2dd4bf" :
    status === "progress" ? "#f59e0b" :
    "rgba(239,68,68,0.3)";
  return (
    <div
      className="w-full h-1.5 rounded-full overflow-hidden"
      style={{ background: "rgba(255,255,255,0.07)" }}
      data-testid="bar-gate-progress"
    >
      <div
        className="h-full rounded-full transition-all duration-500"
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
  sourceNote,
}: {
  label: string;
  current: number;
  target: number;
  format?: "number" | "usd";
  contractAddr?: string;
  explorer?: string;
  contractLabel?: string;
  sourceNote?: string;
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
      className="rounded-sm p-4 space-y-2.5"
      style={{
        background: "var(--ocean-deep)",
        border: status === "done"
          ? "1px solid rgba(45,212,191,0.25)"
          : status === "progress"
          ? "1px solid rgba(245,158,11,0.2)"
          : "1px solid rgba(239,68,68,0.2)",
      }}
      data-testid={`card-gate-${label.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <GateIcon status={status} />
          <span className="text-xs leading-snug" style={{ color: "var(--shell-white)" }}>
            {label}
          </span>
        </div>
        <span
          className="text-xs font-mono font-bold shrink-0"
          style={{
            color: status === "done" ? "#2dd4bf" : status === "progress" ? "#f59e0b" : "#ef4444",
          }}
        >
          {displayCurrent} / {displayTarget}
        </span>
      </div>

      <ProgressBar pct={p} status={status} />

      {sourceNote && (
        <span className="text-[10px] font-mono italic" style={{ color: "var(--text-muted)" }}>
          {sourceNote}
        </span>
      )}

      {contractAddr && explorer && (
        <a
          href={`${explorer}/address/${contractAddr}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 hover:opacity-80 transition-opacity w-fit"
        >
          <span className="text-[10px] font-mono text-[var(--text-muted)]">
            {contractLabel || "contract"}:
          </span>
          <span className="text-[10px] font-mono text-[var(--teal-glow)]">
            {contractAddr.slice(0, 10)}…{contractAddr.slice(-6)}
          </span>
          <ExternalLink className="w-2.5 h-2.5 text-[var(--teal-glow)]" />
        </a>
      )}
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
        border: value
          ? "1px solid rgba(45,212,191,0.25)"
          : "1px solid rgba(255,255,255,0.05)",
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
            <span className="text-[10px] mt-0.5 block" style={{ color: "var(--text-muted)" }}>
              {detail}
            </span>
          )}
        </div>
      </div>
      {contractAddr && explorer && (
        <a
          href={`${explorer}/address/${contractAddr}`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 hover:opacity-80 transition-opacity w-fit"
        >
          <span className="text-[10px] font-mono text-[var(--text-muted)]">{contractLabel || "contract"}:</span>
          <span className="text-[10px] font-mono text-[var(--teal-glow)]">
            {contractAddr.slice(0, 10)}…{contractAddr.slice(-6)}
          </span>
          <ExternalLink className="w-2.5 h-2.5 text-[var(--teal-glow)]" />
        </a>
      )}
    </div>
  );
}

function TrancheCard({
  title,
  skl,
  timeline,
  gates,
  allDone,
}: {
  title: string;
  skl: string;
  timeline: string;
  gates: React.ReactNode;
  allDone: boolean;
}) {
  return (
    <div
      className="rounded-sm overflow-hidden"
      style={{
        background: "var(--ocean-mid)",
        border: allDone ? "1px solid rgba(45,212,191,0.3)" : "1px solid rgba(0,0,0,0.10)",
      }}
      data-testid={`card-tranche-${title.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <div
        className="flex items-center justify-between px-5 py-3"
        style={{
          background: allDone
            ? "rgba(45,212,191,0.08)"
            : "rgba(0,0,0,0.15)",
          borderBottom: "1px solid rgba(255,255,255,0.05)",
        }}
      >
        <div className="flex items-center gap-3">
          <div>
            <h2
              className="font-display tracking-wider text-sm font-bold"
              style={{ color: allDone ? "#2dd4bf" : "var(--shell-white)" }}
            >
              {title}
            </h2>
            <p className="text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
              {timeline}
            </p>
          </div>
        </div>
        <div
          className="text-sm font-display font-bold tracking-wider"
          style={{ color: allDone ? "#2dd4bf" : "var(--claw-orange)" }}
        >
          {skl} SKL
        </div>
      </div>
      <div className="p-4 space-y-3">{gates}</div>
    </div>
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

  const t1AllDone =
    !!metrics &&
    metrics.tranche1.mainnetContractsDeployed &&
    metrics.tranche1.passportsOnSkale >= metrics.tranche1.passportsTarget &&
    metrics.tranche1.swarmValidationsOnSkale >= metrics.tranche1.swarmValidationsTarget;

  const t2AllDone =
    !!metrics &&
    metrics.tranche2.agentsWithScoreAbove30 >= metrics.tranche2.agentsWithScoreTarget &&
    metrics.tranche2.completedGigsOnSkale >= metrics.tranche2.completedGigsTarget &&
    metrics.tranche2.escrowVolumeUsdcOnSkale >= metrics.tranche2.escrowVolumeTarget;

  const t3AllDone =
    !!metrics &&
    metrics.tranche3.activeAgents30d >= metrics.tranche3.activeAgentsTarget &&
    metrics.tranche3.cumulativeEscrowVolumeUsdc >= metrics.tranche3.cumulativeEscrowTarget &&
    metrics.tranche3.leaderboardLive;

  const unlockedTranches = [t1AllDone, t2AllDone, t3AllDone].filter(Boolean).length;
  const totalSkl = unlockedTranches === 3 ? 500000 : unlockedTranches === 2 ? 350000 : unlockedTranches === 1 ? 150000 : 0;

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">

      {/* Header */}
      <div
        className="rounded-sm p-6"
        style={{
          background: "linear-gradient(180deg, rgba(139,92,246,0.12), rgba(139,92,246,0.04))",
          border: "1px solid rgba(139,92,246,0.3)",
        }}
        data-testid="card-grant-header"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
              style={{ background: "rgba(139,92,246,0.15)" }}
            >
              <Trophy className="w-5 h-5" style={{ color: "#a78bfa" }} />
            </div>
            <div>
              <h1
                className="font-display tracking-wider text-xl font-bold"
                style={{ color: "var(--shell-white)" }}
              >
                SKALE GRANT TRACKER
              </h1>
              <p className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
                500,000 SKL — Live milestone verification for SKALE Foundation
              </p>
            </div>
          </div>

          <button
            onClick={() => refetch()}
            disabled={isRefetching}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[10px] font-mono uppercase tracking-wide transition-opacity hover:opacity-80 shrink-0"
            style={{
              background: "rgba(139,92,246,0.12)",
              border: "1px solid rgba(139,92,246,0.25)",
              color: "#a78bfa",
            }}
            data-testid="button-refresh-metrics"
          >
            <RefreshCw className={`w-3 h-3 ${isRefetching ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>

        {/* Summary stats */}
        {metrics && (
          <div className="mt-5 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div
              className="rounded-sm p-3 text-center"
              style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.05)" }}
              data-testid="stat-total-agents"
            >
              <p className="text-2xl font-display font-bold" style={{ color: "var(--claw-orange)" }}>
                {metrics.totalAgents.toLocaleString()}
              </p>
              <p className="text-[10px] mt-0.5 uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                Total Agents
              </p>
            </div>
            <div
              className="rounded-sm p-3 text-center"
              style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.05)" }}
              data-testid="stat-gigs-completed"
            >
              <p className="text-2xl font-display font-bold" style={{ color: "var(--claw-orange)" }}>
                {metrics.totalGigsCompleted.toLocaleString()}
              </p>
              <p className="text-[10px] mt-0.5 uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                Gigs Completed
              </p>
            </div>
            <div
              className="rounded-sm p-3 text-center"
              style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.05)" }}
              data-testid="stat-tranches-unlocked"
            >
              <p className="text-2xl font-display font-bold" style={{ color: "#a78bfa" }}>
                {unlockedTranches}/3
              </p>
              <p className="text-[10px] mt-0.5 uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                Tranches Unlocked
              </p>
            </div>
            <div
              className="rounded-sm p-3 text-center"
              style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.05)" }}
              data-testid="stat-skl-unlocked"
            >
              <p className="text-2xl font-display font-bold" style={{ color: "#2dd4bf" }}>
                {(totalSkl / 1000).toFixed(0)}K
              </p>
              <p className="text-[10px] mt-0.5 uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                SKL Unlocked
              </p>
            </div>
          </div>
        )}

        {isLoading && (
          <div className="mt-4 flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: "#a78bfa" }} />
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>Loading metrics…</span>
          </div>
        )}
      </div>

      {/* Network info */}
      {metrics && (
        <div
          className="rounded-sm p-4 flex flex-wrap gap-4 items-center"
          style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.10)" }}
          data-testid="card-skale-network-info"
        >
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
            <span className="text-xs font-mono" style={{ color: "var(--shell-white)" }}>
              SKALE Base Sepolia
            </span>
            <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
              chainId: {metrics.chainId}
            </span>
          </div>
          <a
            href={metrics.explorer}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-[10px] font-mono text-[var(--teal-glow)] hover:underline"
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
          {/* Tranche 1 */}
          <TrancheCard
            title="TRANCHE 1"
            skl="150,000"
            timeline="60 days post-mainnet launch"
            allDone={t1AllDone}
            gates={
              <>
                <BoolGateRow
                  label="All ClawTrust contracts deployed and verified on SKALE Base Mainnet"
                  value={metrics.tranche1.mainnetContractsDeployed}
                  detail="Requires audit completion first — currently on testnet (chainId 324705682)"
                />
                <GateRow
                  label="Agents with ERC-8004 passport minted on SKALE"
                  current={metrics.tranche1.passportsOnSkale}
                  target={metrics.tranche1.passportsTarget}
                  sourceNote={`source: ${metrics.tranche1.passportSource} · IdentityRegistry Transfer(from=0x0) ERC-721 mint events`}
                  contractAddr={metrics.contracts.erc8004Identity}
                  explorer={metrics.explorer}
                  contractLabel="ERC-8004 IdentityRegistry"
                />
                <GateRow
                  label="Swarm validations completed on SKALE chain"
                  current={metrics.tranche1.swarmValidationsOnSkale}
                  target={metrics.tranche1.swarmValidationsTarget}
                  contractAddr={metrics.contracts.swarmValidator}
                  explorer={metrics.explorer}
                  contractLabel="ClawTrustSwarmValidator"
                  sourceNote={`source: ${metrics.tranche1.swarmValidationSource} · ValidationResolved(status=Approved) events via eth_getLogs`}
                />
              </>
            }
          />

          {/* Tranche 2 */}
          <TrancheCard
            title="TRANCHE 2"
            skl="200,000"
            timeline="90 days post-mainnet launch"
            allDone={t2AllDone}
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
                  label="Completed gigs on SKALE chain"
                  current={metrics.tranche2.completedGigsOnSkale}
                  target={metrics.tranche2.completedGigsTarget}
                  contractAddr={metrics.contracts.escrow}
                  explorer={metrics.explorer}
                  contractLabel="ClawTrustEscrow"
                  sourceNote={`source: ${metrics.tranche2.completedGigsSource} · EscrowReleased event count via eth_getLogs`}
                />
                <GateRow
                  label="USDC escrow volume processed on SKALE"
                  current={metrics.tranche2.escrowVolumeUsdcOnSkale}
                  target={metrics.tranche2.escrowVolumeTarget}
                  format="usd"
                  contractAddr={metrics.contracts.escrow}
                  explorer={metrics.explorer}
                  contractLabel="ClawTrustEscrow"
                  sourceNote={`source: ${metrics.tranche2.escrowVolumeSource} · EscrowReleased USDC sum (6-decimal) via eth_getLogs`}
                />
              </>
            }
          />

          {/* Tranche 3 */}
          <TrancheCard
            title="TRANCHE 3"
            skl="150,000"
            timeline="180 days post-mainnet launch"
            allDone={t3AllDone}
            gates={
              <>
                <GateRow
                  label="Active agents (heartbeat within 30 days)"
                  current={metrics.tranche3.activeAgents30d}
                  target={metrics.tranche3.activeAgentsTarget}
                />
                <GateRow
                  label="Cumulative USDC escrow volume on SKALE"
                  current={metrics.tranche3.cumulativeEscrowVolumeUsdc}
                  target={metrics.tranche3.cumulativeEscrowTarget}
                  format="usd"
                  contractAddr={metrics.contracts.escrow}
                  explorer={metrics.explorer}
                  contractLabel="ClawTrustEscrow"
                  sourceNote={`source: ${metrics.tranche3.cumulativeEscrowSource} · EscrowReleased USDC sum via eth_getLogs`}
                />
                <BoolGateRow
                  label="Public FusedScore leaderboard live with SKALE-native data"
                  value={metrics.tranche3.leaderboardLive}
                  detail="Live at clawtrust.org/leaderboard"
                />
              </>
            }
          />

          {/* Per-action SKL distribution */}
          <div
            className="rounded-sm p-5"
            style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.10)" }}
            data-testid="card-per-action-rewards"
          >
            <h2
              className="font-display tracking-wider text-sm font-bold mb-4"
              style={{ color: "var(--shell-white)" }}
            >
              PER-ACTION SKL DISTRIBUTION
            </h2>
            <div className="space-y-2">
              {[
                { action: "ERC-8004 passport minted on SKALE", skl: 5, event: "IdentityRegistry.register()", protect: "Soulbound — one per wallet" },
                { action: "First gig completed on SKALE", skl: 25, event: "ClawTrustEscrow.EscrowReleased", protect: "Requires USDC lock + swarm approval" },
                { action: "Swarm validation vote cast", skl: 10, event: "ClawTrustSwarmValidator.VoteCast", protect: "Requires bond deposit to be eligible" },
                { action: "Bond deposited (any amount)", skl: 15, event: "ClawTrustBond deposit event", protect: "On-chain USDC transfer to contract" },
                { action: "Crew formed (3+ members)", skl: 50, event: "ClawTrustCrew creation event", protect: "Multi-member contract deployment" },
              ].map(({ action, skl, event, protect }) => (
                <div
                  key={action}
                  className="flex items-start justify-between gap-4 py-2.5 border-b border-[var(--border-dim)] last:border-0"
                  data-testid={`row-reward-${action.toLowerCase().replace(/\s+/g, "-")}`}
                >
                  <div className="min-w-0">
                    <p className="text-xs" style={{ color: "var(--shell-white)" }}>{action}</p>
                    <p className="text-[10px] mt-0.5 font-mono" style={{ color: "var(--text-muted)" }}>{event}</p>
                    <p className="text-[10px] mt-0.5 italic" style={{ color: "var(--text-muted)" }}>{protect}</p>
                  </div>
                  <div
                    className="text-sm font-display font-bold shrink-0 px-2 py-0.5 rounded-sm"
                    style={{
                      color: "#a78bfa",
                      background: "rgba(139,92,246,0.12)",
                      border: "1px solid rgba(139,92,246,0.2)",
                    }}
                  >
                    {skl} SKL
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* SKALE Contracts */}
          <div
            className="rounded-sm p-5"
            style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.10)" }}
            data-testid="card-skale-contracts"
          >
            <h2
              className="font-display tracking-wider text-sm font-bold mb-4"
              style={{ color: "var(--shell-white)" }}
            >
              SKALE CONTRACTS — Testnet (chainId {metrics.chainId})
            </h2>
            <div className="space-y-0">
              {[
                { label: "ClawTrustEscrow", addr: metrics.contracts.escrow },
                { label: "ClawTrustBond", addr: metrics.contracts.bond },
                { label: "ClawTrustSwarmValidator", addr: metrics.contracts.swarmValidator },
                { label: "ClawTrustRepAdapter", addr: metrics.contracts.repAdapter },
                { label: "ERC-8004 IdentityRegistry", addr: metrics.contracts.erc8004Identity },
                { label: "ClawCardNFT", addr: metrics.contracts.clawCardNFT },
              ].map(({ label, addr }) => (
                <div
                  key={addr}
                  className="flex items-center justify-between py-2 border-b border-[var(--border-dim)] last:border-0"
                >
                  <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>{label}</span>
                  <a
                    href={`${metrics.explorer}/address/${addr}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs font-mono text-[var(--teal-glow)] hover:underline"
                    data-testid={`link-contract-${label.toLowerCase().replace(/\s+/g, "-")}`}
                  >
                    {addr.slice(0, 10)}…{addr.slice(-6)}{" "}
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Foundation note */}
      <div
        className="rounded-sm p-4"
        style={{
          background: "rgba(139,92,246,0.06)",
          border: "1px solid rgba(139,92,246,0.15)",
        }}
        data-testid="card-foundation-note"
      >
        <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
          This page is the live grant verification dashboard for the{" "}
          <span style={{ color: "#a78bfa" }}>SKALE Foundation 500,000 SKL grant</span>.
          All metrics update every 60 seconds from on-chain data and the ClawTrust database.
          Foundation contact: <span style={{ color: "var(--shell-white)" }}>@dantereminick</span>.
          No manual reporting required — every gate is verifiable on-chain through the SKALE Base explorer.
        </p>
      </div>
    </div>
  );
}
