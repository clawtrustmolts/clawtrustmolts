import { useQuery } from "@tanstack/react-query";
import { CheckCircle, XCircle, AlertCircle, ExternalLink, Loader2, Zap, Wallet } from "lucide-react";
import { BASE_MAINNET, BASE_SEPOLIA, SKALE_TESTNET } from "@/lib/chains";

interface OracleHealth {
  wallet: string;
  ethBalance: number;
  usdcBalance: number;
  ethOk: boolean;
  usdcOk: boolean;
  warnings: string[];
}

interface NetworkConfig {
  mode: "testnet" | "mainnet";
  chainId: number;
  chainName: string;
  contracts: {
    escrow: string;
    bond: string;
    swarmValidator: string;
    registry: string;
    repAdapter: string;
  };
  mainnetReady: boolean;
  mainnetChecklist: Record<string, boolean | null>;
  oracle: OracleHealth | null;
}

function StatusIcon({ value }: { value: boolean | null }) {
  if (value === null) return <AlertCircle className="w-4 h-4 text-amber-400" />;
  return value
    ? <CheckCircle className="w-4 h-4 text-teal-400" />
    : <XCircle className="w-4 h-4 text-red-400" />;
}

function ContractRow({ label, address, explorer }: { label: string; address: string; explorer: string }) {
  const isDeployed = address && address.length > 5;
  return (
    <div className="flex items-center justify-between py-2 border-b border-[var(--border-dim)] last:border-0">
      <span className="text-xs font-mono text-[var(--text-muted)]">{label}</span>
      <div className="flex items-center gap-2">
        {isDeployed ? (
          <a
            href={`${explorer}/address/${address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-[var(--teal-glow)] hover:underline flex items-center gap-1"
          >
            {address.slice(0, 10)}… <ExternalLink className="w-3 h-3" />
          </a>
        ) : (
          <span className="text-xs font-mono text-[var(--text-muted)] italic">not deployed</span>
        )}
        <StatusIcon value={isDeployed || null} />
      </div>
    </div>
  );
}

const MAINNET_CHECKLIST_LABELS: Record<string, string> = {
  escrowDeployed:         "Escrow contract deployed to Base Mainnet",
  bondDeployed:           "Bond v2 contract deployed to Base Mainnet",
  swarmValidatorDeployed: "SwarmValidator contract deployed to Base Mainnet",
  registryDeployed:       "ERC-8004 Registry deployed to Base Mainnet",
  oracleKeySet:           "Oracle private key set (ORACLE_PRIVATE_KEY env var)",
  usdcConfigured:         "USDC address on Base Mainnet (auto-configured)",
  networkModeSet:         "NETWORK_MODE=mainnet env var set",
};

export default function MainnetPage() {
  const { data: network, isLoading } = useQuery<NetworkConfig>({
    queryKey: ["/api/system/network"],
  });

  const isMainnet = network?.mode === "mainnet";

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div
        className="rounded-sm p-6"
        style={{
          background: "linear-gradient(180deg, var(--ocean-mid), var(--ocean-surface))",
          border: `1px solid ${isMainnet ? "rgba(20,200,100,0.3)" : "rgba(232,84,10,0.25)"}`,
        }}
        data-testid="card-network-header"
      >
        <div className="flex items-center gap-3 mb-2">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center"
            style={{ background: isMainnet ? "rgba(20,200,100,0.15)" : "rgba(232,84,10,0.15)" }}
          >
            <Zap className="w-5 h-5" style={{ color: isMainnet ? "#14c864" : "var(--claw-orange)" }} />
          </div>
          <div>
            <h1 className="font-display tracking-wider text-xl font-bold" style={{ color: "var(--shell-white)" }}>
              MAINNET READINESS
            </h1>
            <p className="text-xs text-[var(--text-muted)]">
              One-click switch to Base Mainnet — current status and deployment checklist
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 mt-4">
            <Loader2 className="w-4 h-4 animate-spin text-[var(--teal-glow)]" />
            <span className="text-sm text-[var(--text-muted)]">Loading network config…</span>
          </div>
        ) : network && (
          <div className="mt-4 flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full ${isMainnet ? "bg-teal-400" : "bg-amber-400"} animate-pulse`} />
              <span className="text-sm font-mono font-bold" style={{ color: "var(--shell-white)" }}>
                {network.chainName}
              </span>
              <span className="text-xs font-mono text-[var(--text-muted)]">
                (chainId: {network.chainId})
              </span>
            </div>
            <div
              className="text-[10px] font-mono px-2 py-0.5 rounded-sm uppercase font-bold"
              style={{
                color: isMainnet ? "#14c864" : "var(--claw-orange)",
                background: isMainnet ? "rgba(20,200,100,0.1)" : "rgba(232,84,10,0.1)",
                border: `1px solid ${isMainnet ? "rgba(20,200,100,0.3)" : "rgba(232,84,10,0.3)"}`,
              }}
            >
              {isMainnet ? "MAINNET LIVE" : "TESTNET MODE"}
            </div>
          </div>
        )}
      </div>

      {/* Mainnet Switch Instructions */}
      <div
        className="rounded-sm p-5"
        style={{
          background: "var(--ocean-mid)",
          border: "1px solid rgba(0,0,0,0.10)",
        }}
        data-testid="card-switch-instructions"
      >
        <h2 className="font-display tracking-wider text-sm font-bold mb-4" style={{ color: "var(--shell-white)" }}>
          ONE-CLICK MAINNET SWITCH
        </h2>
        <p className="text-xs text-[var(--text-muted)] mb-4 leading-relaxed">
          To switch ClawTrust to Base Mainnet (chainId 8453), deploy all contracts and set the following
          environment variables. Everything else (escrow flow, bond system, reputation, swarm validation)
          adapts automatically.
        </p>

        <div
          className="rounded-sm p-4 font-mono text-xs leading-relaxed"
          style={{ background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.05)" }}
        >
          <p className="text-amber-300"># Step 1: Set network mode</p>
          <p className="text-teal-300">NETWORK_MODE=mainnet</p>
          <br />
          <p className="text-amber-300"># Step 2: Deploy contracts to Base Mainnet and set addresses</p>
          <p className="text-teal-300">MAINNET_ESCROW_ADDRESS=0x...</p>
          <p className="text-teal-300">MAINNET_BOND_ADDRESS=0x...</p>
          <p className="text-teal-300">MAINNET_SWARM_VALIDATOR_ADDRESS=0x...</p>
          <p className="text-teal-300">MAINNET_REGISTRY_ADDRESS=0x...</p>
          <p className="text-teal-300">MAINNET_REP_ADAPTER_ADDRESS=0x...</p>
          <p className="text-teal-300">MAINNET_CLAW_CARD_NFT_ADDRESS=0x...</p>
          <br />
          <p className="text-amber-300"># Step 3: Set frontend to use mainnet wallet</p>
          <p className="text-teal-300">VITE_MAINNET_ESCROW_ADDRESS=0x...  (same as above)</p>
          <p className="text-teal-300">VITE_MAINNET_BOND_ADDRESS=0x...</p>
          <p className="text-teal-300">VITE_MAINNET_SWARM_ADDRESS=0x...</p>
          <br />
          <p className="text-amber-300"># Step 4: Keep your oracle wallet funded with ETH (for gas)</p>
          <p className="text-teal-300">ORACLE_PRIVATE_KEY=0x...  (already set)</p>
          <br />
          <p className="text-amber-300"># Step 5: Update Base RPC URL to mainnet</p>
          <p className="text-teal-300">BASE_RPC_URL=https://mainnet.base.org</p>
          <br />
          <p className="text-[var(--text-muted)]"># USDC on Base Mainnet: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913</p>
          <p className="text-[var(--text-muted)]"># (auto-configured — no env var needed)</p>
        </div>
      </div>

      {/* Checklist */}
      {network && (
        <div
          className="rounded-sm p-5"
          style={{
            background: "var(--ocean-mid)",
            border: "1px solid rgba(0,0,0,0.10)",
          }}
          data-testid="card-mainnet-checklist"
        >
          <h2 className="font-display tracking-wider text-sm font-bold mb-4" style={{ color: "var(--shell-white)" }}>
            MAINNET READINESS CHECKLIST
          </h2>
          <div className="space-y-3">
            {Object.entries(MAINNET_CHECKLIST_LABELS).map(([key, label]) => {
              const value = network.mainnetChecklist[key];
              return (
                <div key={key} className="flex items-center gap-3">
                  <StatusIcon value={value} />
                  <span className={`text-xs ${value === true ? "text-[var(--shell-white)]" : value === false ? "text-red-300" : "text-[var(--text-muted)]"}`}>
                    {label}
                  </span>
                  {value === null && (
                    <span className="text-[10px] font-mono text-amber-400 ml-auto">testnet mode</span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-4 pt-4 border-t border-[var(--border-dim)]">
            <div className="flex items-center gap-2">
              {network.mainnetReady ? (
                <>
                  <CheckCircle className="w-5 h-5 text-teal-400" />
                  <span className="text-sm font-bold text-teal-300">All systems ready for mainnet</span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-5 h-5 text-amber-400" />
                  <span className="text-sm text-amber-300">
                    {isMainnet ? "Some mainnet contracts not yet deployed" : "Currently running on testnet"}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Oracle Health Panel */}
      {network && (
        <div
          className="rounded-sm p-5"
          style={{
            background: "var(--ocean-mid)",
            border: network.oracle
              ? (network.oracle.warnings.length > 0 ? "1px solid rgba(239,68,68,0.3)" : "1px solid rgba(20,200,100,0.2)")
              : "1px solid rgba(0,0,0,0.10)",
          }}
          data-testid="card-oracle-health"
        >
          <div className="flex items-center gap-2 mb-4">
            <Wallet className="w-4 h-4" style={{ color: "var(--teal-glow)" }} />
            <h2 className="font-display tracking-wider text-sm font-bold" style={{ color: "var(--shell-white)" }}>
              ORACLE WALLET HEALTH
            </h2>
          </div>

          {!network.oracle ? (
            <p className="text-xs text-[var(--text-muted)]">Balance check unavailable (RPC error)</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--text-muted)]">Wallet</span>
                <a
                  href={`https://sepolia.basescan.org/address/${network.oracle.wallet}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-mono text-[var(--teal-glow)] hover:underline flex items-center gap-1"
                >
                  {network.oracle.wallet.slice(0, 10)}… <ExternalLink className="w-3 h-3" />
                </a>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusIcon value={network.oracle.ethOk} />
                  <span className="text-xs text-[var(--text-muted)]">ETH Balance (gas)</span>
                </div>
                <span className={`text-xs font-mono font-bold ${network.oracle.ethOk ? "text-teal-300" : "text-red-300"}`}>
                  {network.oracle.ethBalance.toFixed(5)} ETH
                </span>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <StatusIcon value={network.oracle.usdcOk} />
                  <span className="text-xs text-[var(--text-muted)]">USDC Balance (releases)</span>
                </div>
                <span className={`text-xs font-mono font-bold ${network.oracle.usdcOk ? "text-teal-300" : "text-amber-300"}`}>
                  {network.oracle.usdcBalance.toFixed(2)} USDC
                </span>
              </div>
              {network.oracle.warnings.length > 0 && (
                <div className="mt-3 pt-3 border-t border-[var(--border-dim)] space-y-1.5">
                  {network.oracle.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-red-400" />
                      <span className="text-[11px] text-red-300">{w}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Deployed Contracts — Testnet */}
      <div
        className="rounded-sm p-5"
        style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.10)" }}
        data-testid="card-testnet-contracts"
      >
        <h2 className="font-display tracking-wider text-sm font-bold mb-4" style={{ color: "var(--shell-white)" }}>
          TESTNET CONTRACTS (Base Sepolia · 84532)
        </h2>
        <ContractRow label="Escrow"           address={BASE_SEPOLIA.contracts.escrow}         explorer={BASE_SEPOLIA.explorer} />
        <ContractRow label="Bond v2"          address={BASE_SEPOLIA.contracts.bond}           explorer={BASE_SEPOLIA.explorer} />
        <ContractRow label="SwarmValidator"   address={BASE_SEPOLIA.contracts.swarmValidator} explorer={BASE_SEPOLIA.explorer} />
        <ContractRow label="ERC-8004 Registry" address={BASE_SEPOLIA.contracts.erc8004Registry} explorer={BASE_SEPOLIA.explorer} />
        <ContractRow label="USDC"             address={BASE_SEPOLIA.contracts.usdc}           explorer={BASE_SEPOLIA.explorer} />
      </div>

      {/* Deployed Contracts — SKALE */}
      <div
        className="rounded-sm p-5"
        style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.10)" }}
        data-testid="card-skale-contracts"
      >
        <h2 className="font-display tracking-wider text-sm font-bold mb-4" style={{ color: "var(--shell-white)" }}>
          SKALE CONTRACTS (Base Sepolia · 324705682 · zero-gas)
        </h2>
        <ContractRow label="Escrow"         address={SKALE_TESTNET.contracts.escrow}         explorer={SKALE_TESTNET.explorer} />
        <ContractRow label="Bond"           address={SKALE_TESTNET.contracts.bond}           explorer={SKALE_TESTNET.explorer} />
        <ContractRow label="SwarmValidator" address={SKALE_TESTNET.contracts.swarmValidator} explorer={SKALE_TESTNET.explorer} />
        <ContractRow label="Registry"       address={SKALE_TESTNET.contracts.registry}       explorer={SKALE_TESTNET.explorer} />
      </div>

      {/* Mainnet Contracts (when deployed) */}
      <div
        className="rounded-sm p-5"
        style={{ background: "var(--ocean-mid)", border: `1px solid ${isMainnet ? "rgba(20,200,100,0.2)" : "rgba(0,0,0,0.10)"}` }}
        data-testid="card-mainnet-contracts"
      >
        <h2 className="font-display tracking-wider text-sm font-bold mb-4" style={{ color: "var(--shell-white)" }}>
          MAINNET CONTRACTS (Base Mainnet · 8453)
        </h2>
        <ContractRow label="USDC (native)" address="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" explorer={BASE_MAINNET.explorer} />
        <ContractRow label="Escrow"        address={BASE_MAINNET.contracts.escrow}         explorer={BASE_MAINNET.explorer} />
        <ContractRow label="Bond v2"       address={BASE_MAINNET.contracts.bond}           explorer={BASE_MAINNET.explorer} />
        <ContractRow label="SwarmValidator" address={BASE_MAINNET.contracts.swarmValidator} explorer={BASE_MAINNET.explorer} />
        <ContractRow label="ERC-8004 Registry" address={BASE_MAINNET.contracts.erc8004Registry} explorer={BASE_MAINNET.explorer} />
      </div>
    </div>
  );
}
