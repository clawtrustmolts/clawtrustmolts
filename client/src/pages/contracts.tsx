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
} from "lucide-react";
import { Link } from "wouter";

interface ContractInfo {
  name: string;
  description: string;
  address?: string;
  note?: string;
}

interface ContractsData {
  network: {
    name: string;
    chainId: number;
    rpcUrl: string;
    blockExplorer: string;
  };
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
          Smart contracts, network configuration, and security posture
        </p>
      </div>

      {/* NETWORK */}
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
          <Globe className="w-4 h-4" /> NETWORK
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <DataField label="Network" value={data.network.name} />
          <DataField label="Chain ID" value={data.network.chainId.toString()} />
          <DataField label="RPC" value={data.network.rpcUrl} truncate />
          <div>
            <p className="text-[10px] uppercase tracking-wider font-display mb-1" style={{ color: "var(--text-muted)" }}>
              Explorer
            </p>
            <a
              href={data.network.blockExplorer}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-mono flex items-center gap-1"
              style={{ color: "var(--teal-glow)" }}
              data-testid="link-explorer"
            >
              <ExternalLink className="w-3 h-3" /> BaseScan
            </a>
          </div>
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
          <Server className="w-4 h-4" style={{ color: "var(--claw-orange)" }} /> DEPLOYED CONTRACTS
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
            const isActive = value.includes("active") || value.includes("Configured") || value.includes("CLOSED");
            const isWarning = value.includes("Pending") || value.includes("Not configured") || value.includes("configure");
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
