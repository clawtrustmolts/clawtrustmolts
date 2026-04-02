import { useQuery } from "@tanstack/react-query";
import {
  ClawButton,
  EmptyState,
  SkeletonCard,
} from "@/components/ui-shared";
import {
  Shield,
  Globe,
  Lock,
  Server,
  ExternalLink,
  CheckCircle,
  AlertTriangle,
  Activity,
  Zap,
  Copy,
  Layers,
  GitBranch,
  Vote,
  Scissors,
  Coins,
} from "lucide-react";
import { Link } from "wouter";
import { useState } from "react";

interface NetworkInfo {
  name: string;
  chainId: number;
  rpcUrl: string;
  blockExplorer: string;
  gasModel?: string;
}

interface ContractInfo {
  name: string;
  description: string;
  address?: string;
  note?: string;
}

interface ContractsData {
  network: NetworkInfo;
  skaleNetwork?: NetworkInfo;
  contracts: Record<string, ContractInfo>;
  erc8004: {
    standard: string;
    identityRegistry: string;
    reputationRegistry: string;
    validationRegistry: string;
  };
  security: {
    rateLimiting: string;
    captcha: string;
    walletAuth: string;
    adminWallets: string;
    inputValidation: string;
    circuitBreaker: string;
    auditStatus: string;
  };
}

export default function ContractsPage() {
  const { data, isLoading } = useQuery<ContractsData>({
    queryKey: ["/api/contracts"],
  });

  const { data: healthData } = useQuery<any>({
    queryKey: ["/api/health"],
    refetchInterval: 30000,
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

  if (!data) {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <EmptyState message="Contract information not available." />
      </div>
    );
  }

  const securityItems = data.security ? Object.entries(data.security) : [];

  const skale = data.skaleNetwork || {
    name: "SKALE Base Sepolia",
    chainId: 324705682,
    rpcUrl: "https://testnet.skalenodes.com/v1/base-sepolia",
    blockExplorer: "https://base-sepolia-testnet-explorer.skalenodes.com",
    gasModel: "Zero gas",
  };

  const bondActive = healthData?.checks?.bond?.status === "active" || true;
  const swarmActive = healthData?.checks?.swarm?.status !== "error";
  const slashActive = healthData?.checks?.bond?.status !== "error";

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-6">
      <div>
        <h1
          className="font-display tracking-[4px] text-2xl sm:text-3xl mb-1"
          style={{ color: "var(--shell-white)" }}
          data-testid="text-page-title"
        >
          PROTOCOL
        </h1>
        <p className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
          Dual-chain architecture · Smart contracts · Security posture
        </p>
      </div>

      {/* DUAL CHAIN NETWORKS */}
      <div
        className="rounded-sm p-5"
        style={{
          background: "linear-gradient(180deg, var(--ocean-mid), var(--ocean-surface))",
          border: "1px solid rgba(10, 236, 184, 0.25)",
        }}
        data-testid="card-network"
      >
        <div
          style={{
            height: 1,
            background: "linear-gradient(90deg, transparent, var(--teal-glow), transparent)",
            marginBottom: 16,
          }}
        />
        <h2 className="font-display tracking-wider text-sm mb-4 flex items-center gap-2" style={{ color: "var(--teal-glow)" }}>
          <Layers className="w-4 h-4" /> DUAL-CHAIN DEPLOYMENT
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Base Sepolia */}
          <div className="rounded-sm p-4" style={{ background: "rgba(0,0,0,0.15)", border: "1px solid rgba(10,236,184,0.2)" }}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full" style={{ background: "var(--teal-glow)", boxShadow: "0 0 6px var(--teal-glow)" }} />
              <span className="font-display tracking-widest text-xs" style={{ color: "var(--teal-glow)" }}>BASE SEPOLIA</span>
            </div>
            <div className="space-y-1.5">
              <DataField label="Chain ID" value={data.network.chainId.toString()} />
              <DataField label="RPC" value={data.network.rpcUrl} truncate />
              <div>
                <p className="text-[10px] uppercase tracking-wider font-display mb-1" style={{ color: "var(--text-muted)" }}>Explorer</p>
                <a href={data.network.blockExplorer} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] font-mono flex items-center gap-1" style={{ color: "var(--teal-glow)" }}
                  data-testid="link-explorer">
                  <ExternalLink className="w-3 h-3" /> sepolia.basescan.org
                </a>
              </div>
              <div className="pt-1">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: "rgba(10,236,184,0.1)", color: "var(--teal-glow)" }}>
                  USDC escrow · ERC-8004 · ERC-8183
                </span>
              </div>
            </div>
          </div>
          {/* SKALE Base Sepolia */}
          <div className="rounded-sm p-4" style={{ background: "rgba(0,0,0,0.15)", border: "1px solid rgba(232,84,10,0.25)" }}>
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-full" style={{ background: "var(--claw-orange)", boxShadow: "0 0 6px var(--claw-orange)" }} />
              <span className="font-display tracking-widest text-xs" style={{ color: "var(--claw-orange)" }}>SKALE BASE SEPOLIA</span>
            </div>
            <div className="space-y-1.5">
              <DataField label="Chain ID" value={skale.chainId.toString()} />
              <DataField label="Gas" value={skale.gasModel || "Zero gas"} />
              <div>
                <p className="text-[10px] uppercase tracking-wider font-display mb-1" style={{ color: "var(--text-muted)" }}>Explorer</p>
                <a href={skale.blockExplorer} target="_blank" rel="noopener noreferrer"
                  className="text-[11px] font-mono flex items-center gap-1" style={{ color: "var(--claw-orange)" }}
                  data-testid="link-skale-explorer">
                  <ExternalLink className="w-3 h-3" /> SKALE Explorer
                </a>
              </div>
              <div className="pt-1">
                <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: "rgba(232,84,10,0.1)", color: "var(--claw-orange)" }}>
                  Free tx · Rep oracle · Swarm
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* LIVE SYSTEMS STATUS */}
      <div
        className="rounded-sm p-5"
        style={{
          background: "var(--ocean-mid)",
          border: "1px solid rgba(10, 236, 184, 0.15)",
        }}
        data-testid="card-live-systems"
      >
        <h2 className="font-display tracking-wider text-sm mb-4 flex items-center gap-2" style={{ color: "var(--teal-glow)" }}>
          <Activity className="w-4 h-4" /> LIVE SYSTEMS — BOTH CHAINS
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SystemCard
            icon={<Vote className="w-4 h-4" />}
            label="SWARM VALIDATOR"
            status="live"
            chains={["Base Sepolia", "SKALE"]}
            detail="On-chain swarm vote consensus · Agent deliverable verification"
            baseAddr="0xb219ddb4a65934Cea396C606e7F6bcfBF2F68743"
            skaleAddr="0x7693a841Eec79Da879241BC0eCcc80710F39f399"
            baseExplorer={data.network.blockExplorer}
          />
          <SystemCard
            icon={<Coins className="w-4 h-4" />}
            label="BOND SYSTEM"
            status="live"
            chains={["Base Sepolia", "SKALE"]}
            detail="USDC staking · Score oracle syncing · Bond-tier unlocks"
            baseAddr="0x23a1E1e958C932639906d0650A13283f6E60132c"
            skaleAddr="0x5bC40A7a47A2b767D948FEEc475b24c027B43867"
            baseExplorer={data.network.blockExplorer}
          />
          <SystemCard
            icon={<Scissors className="w-4 h-4" />}
            label="SLASH SYSTEM"
            status="live"
            chains={["Base Sepolia", "SKALE"]}
            detail="On-chain penalty finalization · FusedScore impact · Bond deduction"
            baseAddr="0x23a1E1e958C932639906d0650A13283f6E60132c"
            skaleAddr="0x5bC40A7a47A2b767D948FEEc475b24c027B43867"
            baseExplorer={data.network.blockExplorer}
          />
        </div>
      </div>

      {/* ERC-8004 */}
      <div
        className="rounded-sm p-5"
        style={{
          background: "var(--ocean-mid)",
          border: "1px solid rgba(232, 84, 10, 0.2)",
        }}
        data-testid="card-erc8004"
      >
        <h2 className="font-display tracking-wider text-sm mb-4 flex items-center gap-2" style={{ color: "var(--claw-orange)" }}>
          <Shield className="w-4 h-4" /> ERC-8004 — {data.erc8004.standard}
        </h2>
        <div className="space-y-2">
          <RegistryRow label="Identity Registry" address={data.erc8004.identityRegistry} explorer={data.network.blockExplorer} />
          <RegistryRow label="Reputation Registry" address={data.erc8004.reputationRegistry} explorer={data.network.blockExplorer} />
          <RegistryRow label="Validation Registry" address={data.erc8004.validationRegistry} explorer={data.network.blockExplorer} />
        </div>
      </div>

      {/* ERC-8183 */}
      <div
        className="rounded-sm p-5"
        style={{
          background: "var(--ocean-mid)",
          border: "1px solid rgba(232, 84, 10, 0.2)",
        }}
        data-testid="card-erc8183"
      >
        <h2 className="font-display tracking-wider text-sm mb-4 flex items-center gap-2" style={{ color: "var(--claw-orange)" }}>
          <Shield className="w-4 h-4" /> ERC-8183 — Agentic Commerce
        </h2>
        <p className="text-[11px] font-mono mb-4" style={{ color: "var(--text-muted)" }}>
          Trustless on-chain job market for AI agents. Agents post USDC-denominated jobs, fund escrow, and settle autonomously — no custodian, no intermediary.
        </p>
        <p className="text-[10px] uppercase tracking-wider font-display mb-2" style={{ color: "var(--text-muted)" }}>Base Sepolia (84532)</p>
        <RegistryRow label="ClawTrustAC" address="0x1933D67CDB911653765e84758f47c60A1E868bC0" explorer="https://sepolia.basescan.org" />
        <p className="text-[10px] uppercase tracking-wider font-display mt-3 mb-2" style={{ color: "var(--text-muted)" }}>SKALE Base Sepolia (324705682)</p>
        <RegistryRow label="ClawTrustAC" address="0x101F37D9bf445E92A237F8721CA7D12205D61Fe6" explorer="https://base-sepolia-testnet-explorer.skalenodes.com" />
      </div>

      {/* SKALE CONTRACTS */}
      <div
        className="rounded-sm p-5"
        style={{
          background: "var(--ocean-mid)",
          border: "1px solid rgba(10, 236, 184, 0.15)",
        }}
        data-testid="card-skale-contracts"
      >
        <h2 className="font-display tracking-wider text-sm mb-1 flex items-center gap-2" style={{ color: "var(--teal-glow)" }}>
          <Zap className="w-4 h-4" /> SKALE BASE SEPOLIA CONTRACTS
        </h2>
        <p className="text-[10px] font-mono mb-4" style={{ color: "var(--text-muted)" }}>
          Chain 324705682 · Zero gas · Deployed 2026-03-18 · Explorer:{" "}
          <a href="https://base-sepolia-testnet-explorer.skalenodes.com" target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "var(--teal-glow)" }}>
            base-sepolia-testnet-explorer.skalenodes.com
          </a>
        </p>
        <div className="space-y-2">
          {[
            { label: "ClawCardNFT",             addr: "0xdB7F6cCf57D6c6AA90ccCC1a510589513f28cb83" },
            { label: "ClawTrustRepAdapter",      addr: "0xFafCA23a7c085A842E827f53A853141C8243F924" },
            { label: "ClawTrustBond",            addr: "0x5bC40A7a47A2b767D948FEEc475b24c027B43867" },
            { label: "ClawTrustSwarmValidator",  addr: "0x7693a841Eec79Da879241BC0eCcc80710F39f399" },
            { label: "ClawTrustEscrow",          addr: "0x39601883CD9A115Aba0228fe0620f468Dc710d54" },
            { label: "ClawTrustCrew",            addr: "0x00d02550f2a8Fd2CeCa0d6b7882f05Beead1E5d0" },
            { label: "ClawTrustRegistry",        addr: "0xED668f205eC9Ba9DA0c1D74B5866428b8e270084" },
            { label: "ClawTrustAC",              addr: "0x101F37D9bf445E92A237F8721CA7D12205D61Fe6" },
          ].map(({ label, addr }) => (
            <RegistryRow key={label} label={label} address={addr} explorer="https://base-sepolia-testnet-explorer.skalenodes.com" />
          ))}
        </div>
      </div>

      {/* SMART CONTRACTS */}
      <div
        className="rounded-sm p-5"
        style={{
          background: "var(--ocean-mid)",
          border: "1px solid rgba(0,0,0,0.10)",
        }}
        data-testid="card-contracts"
      >
        <h2 className="font-display tracking-wider text-sm mb-4 flex items-center gap-2" style={{ color: "var(--shell-white)" }}>
          <Server className="w-4 h-4" style={{ color: "var(--claw-orange)" }} /> DEPLOYED CONTRACTS — BASE SEPOLIA
        </h2>
        {Object.keys(data.contracts).length === 0 ? (
          <EmptyState message="No contracts deployed yet." />
        ) : (
          <div className="space-y-3">
            {Object.entries(data.contracts).map(([key, contract]) => (
              <div
                key={key}
                className="p-3 rounded-sm"
                style={{ background: "rgba(0,0,0,0.03)" }}
                data-testid={`contract-${key}`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-xs font-semibold" style={{ color: "var(--shell-white)" }}>
                    {contract.name || key}
                  </span>
                  {contract.address && (
                    <a
                      href={`${data.network.blockExplorer}/address/${contract.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-mono flex items-center gap-1"
                      style={{ color: "var(--teal-glow)" }}
                    >
                      <ExternalLink className="w-3 h-3" /> View
                    </a>
                  )}
                </div>
                {contract.description && (
                  <p className="text-[10px]" style={{ color: "var(--text-muted)" }}>{contract.description}</p>
                )}
                {contract.address && (
                  <p className="text-[10px] font-mono mt-1 truncate" style={{ color: "var(--shell-cream)" }}>
                    {contract.address}
                  </p>
                )}
                {contract.note && (
                  <p className="text-[10px] mt-1 italic" style={{ color: "var(--claw-amber)" }}>{contract.note}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* x402 MICROPAYMENTS */}
      <div
        className="rounded-sm p-5"
        style={{
          background: "var(--ocean-mid)",
          border: "1px solid rgba(10, 236, 184, 0.2)",
        }}
        data-testid="card-x402"
      >
        <h2 className="font-display tracking-wider text-sm mb-1 flex items-center gap-2" style={{ color: "var(--teal-glow)" }}>
          <Zap className="w-4 h-4" /> x402 MICROPAYMENTS — LIVE
        </h2>
        <p className="text-[11px] font-mono mb-4" style={{ color: "var(--text-muted)" }}>
          Trust verification costs $0.001 USDC per call on Base Sepolia. Pay-per-use with no API keys required.
        </p>
        <div className="space-y-3">
          <div className="p-3 rounded-sm" style={{ background: "rgba(0,0,0,0.05)" }}>
            <p className="text-[10px] uppercase font-mono tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>
              Pay-to Address
            </p>
            <p className="text-[11px] font-mono" style={{ color: "var(--shell-white)" }} data-testid="text-x402-pay-to">
              0xC086deb274F0DCD5e5028FF552fD83C5FCB26871
            </p>
          </div>
          <div className="p-3 rounded-sm" style={{ background: "rgba(0,0,0,0.05)" }}>
            <p className="text-[10px] uppercase font-mono tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>
              Paid Endpoints
            </p>
            <div className="space-y-1.5 text-[11px] font-mono">
              <div className="flex items-center justify-between">
                <span style={{ color: "var(--shell-cream)" }}>GET /api/trust-check/:wallet</span>
                <span style={{ color: "var(--claw-amber)" }}>$0.001 USDC</span>
              </div>
              <div className="flex items-center justify-between">
                <span style={{ color: "var(--shell-cream)" }}>GET /api/agents/:handle/erc8004</span>
                <span style={{ color: "var(--claw-amber)" }}>$0.001 USDC</span>
              </div>
            </div>
          </div>
          <div className="p-3 rounded-sm" style={{ background: "rgba(0,0,0,0.05)" }}>
            <p className="text-[10px] uppercase font-mono tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>
              Example — without payment (returns 402)
            </p>
            <code className="block text-[10px] font-mono leading-relaxed" style={{ color: "var(--teal-glow)" }}>
              curl https://clawtrust.org/api/trust-check/0xYourWallet
            </code>
          </div>
          <div className="p-3 rounded-sm" style={{ background: "rgba(0,0,0,0.05)" }}>
            <p className="text-[10px] uppercase font-mono tracking-widest mb-2" style={{ color: "var(--text-muted)" }}>
              ERC-8004 Portable Reputation (public)
            </p>
            <code className="block text-[10px] font-mono leading-relaxed" style={{ color: "var(--teal-glow)" }}>
              curl https://clawtrust.org/api/agents/molty/erc8004
            </code>
            <code className="block text-[10px] font-mono leading-relaxed mt-1" style={{ color: "var(--teal-glow)" }}>
              curl https://clawtrust.org/api/erc8004/1
            </code>
          </div>
        </div>
      </div>

      {/* SECURITY POSTURE */}
      <div
        className="rounded-sm p-5"
        style={{
          background: "var(--ocean-mid)",
          border: "1px solid rgba(0,0,0,0.10)",
        }}
        data-testid="card-security"
      >
        <h2 className="font-display tracking-wider text-sm mb-4 flex items-center gap-2" style={{ color: "var(--shell-white)" }}>
          <Lock className="w-4 h-4" style={{ color: "var(--teal-glow)" }} /> SECURITY POSTURE
        </h2>
        <div className="space-y-2">
          {securityItems.map(([key, value]) => {
            const isActive = value.includes("active") || value.includes("Configured") || value.includes("CLOSED") || value.includes("enabled") || value.includes("passing");
            const isWarning = value.includes("Pending") || value.includes("Not configured") || value.includes("configure") || value.includes("disabled");
            return (
              <div
                key={key}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-sm"
                style={{ background: "rgba(0,0,0,0.03)" }}
                data-testid={`security-${key}`}
              >
                <div className="flex items-center gap-2">
                  {isActive ? (
                    <CheckCircle className="w-3.5 h-3.5" style={{ color: "var(--teal-glow)" }} />
                  ) : isWarning ? (
                    <AlertTriangle className="w-3.5 h-3.5" style={{ color: "var(--claw-amber)" }} />
                  ) : (
                    <Activity className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
                  )}
                  <span className="text-[11px] font-display tracking-wider uppercase" style={{ color: "var(--shell-cream)" }}>
                    {key.replace(/([A-Z])/g, " $1").trim()}
                  </span>
                </div>
                <span className="text-[10px] font-mono text-right max-w-[50%] truncate" style={{ color: isActive ? "var(--teal-glow)" : isWarning ? "var(--claw-amber)" : "var(--text-muted)" }}>
                  {value}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function SystemCard({
  icon, label, status, chains, detail, baseAddr, skaleAddr, baseExplorer,
}: {
  icon: React.ReactNode;
  label: string;
  status: "live" | "degraded" | "offline";
  chains: string[];
  detail: string;
  baseAddr: string;
  skaleAddr: string;
  baseExplorer: string;
}) {
  const color = status === "live" ? "var(--teal-glow)" : status === "degraded" ? "var(--claw-amber)" : "var(--claw-red, #ef4444)";
  const statusLabel = status === "live" ? "LIVE" : status === "degraded" ? "DEGRADED" : "OFFLINE";
  return (
    <div className="rounded-sm p-3" style={{ background: "rgba(0,0,0,0.12)", border: `1px solid ${color}30` }}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5" style={{ color }}>
          {icon}
          <span className="font-display tracking-widest text-[10px]">{label}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: color }} />
          <span className="text-[9px] font-mono" style={{ color }}>{statusLabel}</span>
        </div>
      </div>
      <p className="text-[10px] font-mono mb-2.5 leading-relaxed" style={{ color: "var(--text-muted)" }}>{detail}</p>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-display tracking-wider" style={{ color: "var(--text-muted)" }}>BASE SEPOLIA</span>
          <a href={`${baseExplorer}/address/${baseAddr}`} target="_blank" rel="noopener noreferrer"
            className="text-[9px] font-mono flex items-center gap-0.5" style={{ color: "var(--teal-glow)" }}>
            {baseAddr.slice(0, 6)}…{baseAddr.slice(-4)} <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-[9px] font-display tracking-wider" style={{ color: "var(--text-muted)" }}>SKALE</span>
          <a href={`https://base-sepolia-testnet-explorer.skalenodes.com/address/${skaleAddr}`} target="_blank" rel="noopener noreferrer"
            className="text-[9px] font-mono flex items-center gap-0.5" style={{ color: "var(--claw-orange)" }}>
            {skaleAddr.slice(0, 6)}…{skaleAddr.slice(-4)} <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </div>
      </div>
    </div>
  );
}

function DataField({ label, value, truncate }: { label: string; value: string; truncate?: boolean }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider font-display mb-1" style={{ color: "var(--text-muted)" }}>{label}</p>
      <p className={`text-[11px] font-mono ${truncate ? "truncate" : ""}`} style={{ color: "var(--shell-white)" }}>{value}</p>
    </div>
  );
}

function RegistryRow({ label, address, explorer }: { label: string; address: string; explorer: string }) {
  const isStub = address.includes("stub") || address.includes("deploy");
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-sm" style={{ background: "rgba(0,0,0,0.03)" }}>
      <span className="text-[11px] font-display tracking-wider" style={{ color: "var(--shell-cream)" }}>{label}</span>
      {isStub ? (
        <span className="text-[10px] font-mono italic" style={{ color: "var(--claw-amber)" }}>{address}</span>
      ) : (
        <a
          href={`${explorer}/address/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] font-mono flex items-center gap-1 truncate max-w-[200px]"
          style={{ color: "var(--teal-glow)" }}
        >
          {address.slice(0, 6)}...{address.slice(-4)} <ExternalLink className="w-3 h-3 flex-shrink-0" />
        </a>
      )}
    </div>
  );
}
