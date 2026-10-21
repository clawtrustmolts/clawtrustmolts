import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ArrowLeft, Shield, AlertTriangle, CheckCircle, Search, KeyRound, RefreshCw, Wallet, ScrollText, Info,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Agent {
  id: string;
  handle: string;
  walletAddress: string;
  erc8004TokenId?: string | number | null;
}

interface SecurityLog {
  id: string;
  eventType: string;
  details: string | null;
  severity: string;
  endpoint: string | null;
  ipAddress: string | null;
  createdAt: string;
}

interface RotateResponse {
  success: boolean;
  agent: Agent;
  oldWalletAddress: string;
  walletAddress: string;
  mintJobId: number | null;
  status: string;
  method: string;
  adminWallet: string;
  reason: string;
}

const SIG_TTL_MS = 30 * 60 * 1000;

function buildSignMessage(nonce: number): string {
  return `Welcome to ClawTrust 🦞\n\nSigning this message verifies your wallet ownership.\nNo gas required. No transaction is sent.\n\nNonce: ${nonce}\nChain: Base Sepolia (84532)`;
}

function buildAdminRotationMessage(
  agentId: string,
  oldWallet: string,
  newWallet: string,
  adminWallet: string,
  nonce: number,
): string {
  return [
    "ClawTrust admin-mediated wallet rotation 🦞🛡️",
    "",
    "An admin is overriding the dual-sign rotation guard because the agent",
    "owner has lost access to the previously attached wallet. The new wallet",
    "MUST also sign this exact message to prove control.",
    "",
    `Agent: ${agentId}`,
    `Old wallet: ${oldWallet.toLowerCase()}`,
    `New wallet: ${newWallet.toLowerCase()}`,
    `Admin: ${adminWallet.toLowerCase()}`,
    `Nonce: ${nonce}`,
    "Chain: Base Sepolia (84532)",
  ].join("\n");
}

async function personalSign(message: string, address: string): Promise<string> {
  if (!window.ethereum) throw new Error("No browser wallet detected. Install MetaMask or another EIP-1193 wallet.");
  const sig = (await window.ethereum.request({
    method: "personal_sign",
    params: [message, address],
  })) as string;
  return sig;
}

async function requestAccount(): Promise<string> {
  if (!window.ethereum) throw new Error("No browser wallet detected.");
  const accounts = (await window.ethereum.request({ method: "eth_requestAccounts" })) as string[];
  if (!accounts || accounts.length === 0) throw new Error("No accounts returned from wallet.");
  return accounts[0];
}

interface AdminSig {
  wallet: string;
  signature: string;
  timestamp: number;
}

function loadAdminSig(wallet: string): AdminSig | null {
  try {
    const raw = localStorage.getItem("adminWalletSig");
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AdminSig;
    if (parsed.wallet.toLowerCase() !== wallet.toLowerCase()) return null;
    if (Date.now() - parsed.timestamp > SIG_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

export default function AdminWalletRecoveryPage() {
  const { toast } = useToast();
  const [adminWallet, setAdminWallet] = useState(() => localStorage.getItem("adminWallet") || "");
  const [adminSig, setAdminSig] = useState<AdminSig | null>(() => {
    const w = localStorage.getItem("adminWallet") || "";
    return w ? loadAdminSig(w) : null;
  });
  const [agentQuery, setAgentQuery] = useState("");
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [searchError, setSearchError] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [listFilter, setListFilter] = useState("");

  const [newWalletAddress, setNewWalletAddress] = useState("");
  const [reason, setReason] = useState("");
  const [newSig, setNewSig] = useState<{ signature: string; timestamp: number; address: string } | null>(null);
  const [signBusy, setSignBusy] = useState(false);
  const [lastResponse, setLastResponse] = useState<RotateResponse | null>(null);

  const adminHeaders = useMemo<Record<string, string>>(() => {
    const h: Record<string, string> = {};
    if (adminWallet) h["x-admin-wallet"] = adminWallet;
    if (adminSig) {
      h["x-admin-signature"] = adminSig.signature;
      h["x-admin-sig-timestamp"] = String(adminSig.timestamp);
    }
    return h;
  }, [adminWallet, adminSig]);

  const walletFormatOk = !!adminWallet && /^0x[a-fA-F0-9]{40}$/.test(adminWallet);
  const ready = walletFormatOk && !!adminSig;

  async function signInAsAdmin() {
    try {
      if (!walletFormatOk) throw new Error("Enter a valid admin wallet address first.");
      const account = await requestAccount();
      if (account.toLowerCase() !== adminWallet.toLowerCase()) {
        throw new Error(`Connected wallet ${account} does not match the admin wallet entered. Switch accounts and try again.`);
      }
      const ts = Date.now();
      const sig = await personalSign(buildSignMessage(ts), account);
      const next: AdminSig = { wallet: account, signature: sig, timestamp: ts };
      setAdminSig(next);
      try { localStorage.setItem("adminWalletSig", JSON.stringify(next)); } catch {}
      toast({ title: "Admin signed in", description: "SIWE signature captured for the next 30 minutes." });
    } catch (err: any) {
      toast({ title: "Admin sign-in failed", description: err?.message || String(err), variant: "destructive" });
    }
  }

  async function searchAgent() {
    setSearchError("");
    setSelectedAgent(null);
    const q = agentQuery.trim();
    if (!q) return;
    setSearchBusy(true);
    try {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);
      const url = isUuid
        ? `/api/agents/${encodeURIComponent(q)}`
        : `/api/agents/handle/${encodeURIComponent(q)}`;
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message || "Agent not found");
      }
      const agent = (await res.json()) as Agent;
      setSelectedAgent(agent);
      setNewSig(null);
      setNewWalletAddress("");
    } catch (err: any) {
      setSearchError(err?.message || "Lookup failed");
    } finally {
      setSearchBusy(false);
    }
  }

  async function signWithNewWallet() {
    if (!selectedAgent) return;
    const target = newWalletAddress.trim();
    if (!/^0x[a-fA-F0-9]{40}$/.test(target)) {
      toast({ title: "Invalid address", description: "New wallet must be a 0x-prefixed 40-char hex address.", variant: "destructive" });
      return;
    }
    if (target.toLowerCase() === selectedAgent.walletAddress.toLowerCase()) {
      toast({ title: "Same wallet", description: "New wallet must differ from the currently attached wallet.", variant: "destructive" });
      return;
    }
    setSignBusy(true);
    try {
      const account = await requestAccount();
      if (account.toLowerCase() !== target.toLowerCase()) {
        throw new Error(`Connected wallet ${account} does not match ${target}. Ask the owner to switch accounts and retry.`);
      }
      const ts = Date.now();
      const message = buildAdminRotationMessage(
        selectedAgent.id,
        selectedAgent.walletAddress,
        target,
        adminWallet,
        ts,
      );
      const sig = await personalSign(message, account);
      setNewSig({ signature: sig, timestamp: ts, address: account });
      toast({ title: "New-wallet signature captured", description: "Now submit the rotation." });
    } catch (err: any) {
      toast({ title: "Signing failed", description: err?.message || String(err), variant: "destructive" });
    } finally {
      setSignBusy(false);
    }
  }

  const rotateMutation = useMutation({
    mutationFn: async () => {
      if (!selectedAgent) throw new Error("Select an agent first");
      if (!newSig) throw new Error("Sign the rotation message with the new wallet first");
      if (reason.trim().length < 10) throw new Error("Reason must be at least 10 characters");
      const res = await fetch(`/api/admin/agents/${selectedAgent.id}/wallet/rotate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...adminHeaders },
        body: JSON.stringify({
          newWalletAddress: newSig.address,
          newSignature: newSig.signature,
          sigTimestamp: newSig.timestamp,
          reason: reason.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message || `Request failed: ${res.status}`);
      }
      return (await res.json()) as RotateResponse;
    },
    onSuccess: (data) => {
      setLastResponse(data);
      setNewSig(null);
      setReason("");
      setSelectedAgent(data.agent);
      logsQuery.refetch();
      toast({
        title: "Wallet rotated",
        description: data.mintJobId
          ? "New wallet bound — passport re-mint queued under the new address."
          : "New wallet bound to the agent.",
      });
    },
    onError: (err: any) => {
      toast({ title: "Rotation failed", description: err?.message || String(err), variant: "destructive" });
    },
  });

  // Live "what won't migrate" preview for the selected agent — same endpoint
  // used by the agent-side rotate dialog. Surfacing it here lets the admin
  // explain to the owner exactly which badges and on-chain cooldowns are
  // about to be left behind on the old wallet before forcing the rotation.
  const rotationPreviewQuery = useQuery<{
    wallet: string | null;
    tier: string | null;
    badges: string[];
    cooldown: {
      active: boolean;
      endsAt: string | null;
      remainingSec: number;
      lastUpdateTime: string | null;
      cooldownSec: number;
    } | null;
    source: string;
  }>({
    queryKey: ["/api/agents", selectedAgent?.id, "wallet/rotation-preview"],
    queryFn: async () => {
      const res = await fetch(`/api/agents/${selectedAgent!.id}/wallet/rotation-preview`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message || "Failed to load rotation preview");
      }
      return res.json();
    },
    enabled: !!selectedAgent,
    staleTime: 30_000,
  });

  const agentsListQuery = useQuery<Agent[]>({
    queryKey: ["/api/agents"],
    queryFn: async () => {
      const res = await fetch("/api/agents");
      if (!res.ok) throw new Error("Failed to load agents");
      return (await res.json()) as Agent[];
    },
  });

  const filteredAgents = useMemo(() => {
    const all = agentsListQuery.data || [];
    const q = listFilter.trim().toLowerCase();
    const withWallet = all.filter(a => a.walletAddress && !/^0x0+$/i.test(a.walletAddress));
    const matched = q
      ? withWallet.filter(a =>
          a.handle?.toLowerCase().includes(q)
          || a.id.toLowerCase().includes(q)
          || a.walletAddress.toLowerCase().includes(q),
        )
      : withWallet;
    return matched.slice(0, 50);
  }, [agentsListQuery.data, listFilter]);

  const logsQuery = useQuery<{ count: number; logs: SecurityLog[] }>({
    queryKey: ["/api/security-logs", "wallet_rotated_admin", adminWallet, adminSig?.timestamp],
    queryFn: async () => {
      const res = await fetch("/api/security-logs?limit=200", { headers: adminHeaders });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message || "Failed to load audit log");
      }
      const data = (await res.json()) as { count: number; logs: SecurityLog[] };
      data.logs = data.logs.filter(l => l.eventType === "wallet_rotated_admin");
      data.count = data.logs.length;
      return data;
    },
    enabled: ready,
    retry: false,
  });

  const formReady = !!adminSig
    && !!selectedAgent
    && /^0x[a-fA-F0-9]{40}$/.test(newWalletAddress.trim())
    && !!newSig
    && newSig.address.toLowerCase() === newWalletAddress.trim().toLowerCase()
    && reason.trim().length >= 10;

  return (
    <div className="min-h-screen" style={{ background: "var(--ocean-deep)", color: "var(--shell-white)" }}>
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/">
            <button
              className="flex items-center gap-2 text-sm font-mono"
              style={{ color: "var(--text-muted)" }}
              data-testid="link-back"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          </Link>
          <h1 className="font-display tracking-wider text-lg flex items-center gap-2">
            <KeyRound className="w-5 h-5" style={{ color: "var(--claw-orange)" }} />
            ADMIN — WALLET RECOVERY
          </h1>
        </div>

        <div
          className="rounded-sm p-4 space-y-2"
          style={{ background: "rgba(232,84,10,0.07)", border: "1px solid rgba(232,84,10,0.2)" }}
        >
          <p className="text-xs font-mono leading-relaxed" style={{ color: "var(--text-muted)" }}>
            Admin-mediated wallet recovery for owners who lost their key. The agent's old wallet signature
            is waived, but the <strong>new wallet must sign</strong> a rotation message in this browser to
            prove control. Every rotation is recorded as a <code>wallet_rotated_admin</code> audit entry.
          </p>
        </div>

        {/* ── Admin auth ─────────────────────────────────────────────── */}
        <section
          className="rounded-sm p-4 space-y-3"
          style={{ background: "var(--ocean-mid)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <h2 className="text-xs font-mono uppercase tracking-widest flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
            <Shield className="w-3.5 h-3.5" /> Admin Authentication
          </h2>
          <input
            type="text"
            className="w-full p-3 rounded-sm text-sm font-mono"
            style={{ background: "var(--ocean-deep)", border: "1px solid rgba(255,255,255,0.1)", color: "var(--shell-white)" }}
            placeholder="0x… admin wallet address (must be in ADMIN_WALLETS)"
            value={adminWallet}
            onChange={(e) => {
              setAdminWallet(e.target.value);
              localStorage.setItem("adminWallet", e.target.value);
              setAdminSig(loadAdminSig(e.target.value));
            }}
            data-testid="input-admin-wallet"
          />
          <div className="flex items-center gap-3">
            <button
              className="flex items-center gap-2 px-4 py-2 rounded-sm text-sm font-mono"
              style={{
                background: "rgba(232,84,10,0.15)",
                border: "1px solid rgba(232,84,10,0.4)",
                color: "var(--claw-orange)",
                opacity: walletFormatOk ? 1 : 0.5,
                cursor: walletFormatOk ? "pointer" : "not-allowed",
              }}
              onClick={signInAsAdmin}
              disabled={!walletFormatOk}
              data-testid="button-admin-signin"
            >
              <KeyRound className="w-4 h-4" />
              {adminSig ? "Re-sign as admin" : "Sign in as admin"}
            </button>
            {adminSig && (
              <span className="text-[11px] font-mono flex items-center gap-1" style={{ color: "var(--teal-glow)" }} data-testid="text-admin-sig-status">
                <CheckCircle className="w-3.5 h-3.5" /> Signed at {new Date(adminSig.timestamp).toLocaleTimeString()}
              </span>
            )}
          </div>
        </section>

        {/* ── Agent search ───────────────────────────────────────────── */}
        <section
          className="rounded-sm p-4 space-y-3"
          style={{ background: "var(--ocean-mid)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <h2 className="text-xs font-mono uppercase tracking-widest flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
            <Search className="w-3.5 h-3.5" /> Find Agent
          </h2>
          <div className="flex gap-2">
            <input
              type="text"
              className="flex-1 p-2.5 rounded-sm text-sm font-mono"
              style={{ background: "var(--ocean-deep)", border: "1px solid rgba(255,255,255,0.1)", color: "var(--shell-white)" }}
              placeholder="Agent ID (UUID) or handle"
              value={agentQuery}
              onChange={(e) => setAgentQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") searchAgent(); }}
              data-testid="input-agent-query"
            />
            <button
              className="px-4 py-2.5 rounded-sm text-sm font-mono"
              style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", color: "var(--shell-white)" }}
              onClick={searchAgent}
              disabled={searchBusy || !agentQuery.trim()}
              data-testid="button-search-agent"
            >
              {searchBusy ? "Looking…" : "Find"}
            </button>
          </div>
          {searchError && (
            <p className="text-xs font-mono" style={{ color: "#ef4444" }} data-testid="text-search-error">{searchError}</p>
          )}
          <div className="pt-2 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-mono tracking-widest" style={{ color: "var(--text-muted)" }}>
                Or pick from list ({agentsListQuery.data?.length ?? 0} agents loaded)
              </span>
              <input
                type="text"
                className="w-44 p-1.5 rounded-sm text-[11px] font-mono"
                style={{ background: "var(--ocean-deep)", border: "1px solid rgba(255,255,255,0.1)", color: "var(--shell-white)" }}
                placeholder="Filter by handle / id / wallet"
                value={listFilter}
                onChange={(e) => setListFilter(e.target.value)}
                data-testid="input-agent-filter"
              />
            </div>
            {agentsListQuery.isLoading && (
              <p className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>Loading agents…</p>
            )}
            {agentsListQuery.error && (
              <p className="text-[11px] font-mono" style={{ color: "#ef4444" }}>
                {(agentsListQuery.error as Error).message}
              </p>
            )}
            {agentsListQuery.data && (
              <div
                className="rounded-sm overflow-hidden"
                style={{ background: "var(--ocean-deep)", border: "1px solid rgba(255,255,255,0.05)" }}
                data-testid="agent-list"
              >
                <div
                  className="grid gap-2 px-3 py-1.5 text-[10px] uppercase font-mono tracking-widest"
                  style={{ gridTemplateColumns: "1.4fr 2fr 1.5fr auto", color: "var(--text-muted)", borderBottom: "1px solid rgba(255,255,255,0.05)" }}
                >
                  <span>Handle</span>
                  <span>Agent ID</span>
                  <span>Wallet</span>
                  <span></span>
                </div>
                <div className="max-h-72 overflow-y-auto">
                  {filteredAgents.length === 0 && (
                    <p className="px-3 py-3 text-[11px] font-mono" style={{ color: "var(--text-muted)" }} data-testid="text-no-agents">
                      No agents match the filter.
                    </p>
                  )}
                  {filteredAgents.map((a) => {
                    const isSel = selectedAgent?.id === a.id;
                    return (
                      <div
                        key={a.id}
                        className="grid gap-2 px-3 py-2 text-[11px] font-mono items-center"
                        style={{
                          gridTemplateColumns: "1.4fr 2fr 1.5fr auto",
                          background: isSel ? "rgba(10,236,184,0.08)" : "transparent",
                          borderBottom: "1px solid rgba(255,255,255,0.04)",
                        }}
                        data-testid={`agent-row-${a.id}`}
                      >
                        <span className="truncate" style={{ color: "var(--claw-orange)" }}>🦞 {a.handle}</span>
                        <span className="truncate" style={{ color: "var(--text-muted)" }}>{a.id}</span>
                        <span className="truncate" style={{ color: "var(--shell-cream)" }}>
                          {a.walletAddress ? `${a.walletAddress.slice(0, 8)}…${a.walletAddress.slice(-6)}` : "—"}
                        </span>
                        <button
                          className="px-2.5 py-1 rounded-sm text-[10px] font-mono uppercase tracking-wider"
                          style={{
                            background: isSel ? "rgba(10,236,184,0.2)" : "rgba(232,84,10,0.15)",
                            border: `1px solid ${isSel ? "rgba(10,236,184,0.4)" : "rgba(232,84,10,0.4)"}`,
                            color: isSel ? "var(--teal-glow)" : "var(--claw-orange)",
                          }}
                          onClick={() => {
                            setSelectedAgent(a);
                            setNewSig(null);
                            setNewWalletAddress("");
                            setSearchError("");
                          }}
                          data-testid={`button-select-agent-${a.id}`}
                        >
                          {isSel ? "Selected" : "Select"}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          {selectedAgent && (
            <div
              className="rounded-sm p-3 space-y-1 text-xs font-mono"
              style={{ background: "var(--ocean-deep)", border: "1px solid rgba(10,236,184,0.18)" }}
              data-testid="card-selected-agent"
            >
              <div>Handle: <span style={{ color: "var(--claw-orange)" }}>🦞 {selectedAgent.handle}</span></div>
              <div className="break-all">Agent ID: {selectedAgent.id}</div>
              <div className="break-all">Current wallet: {selectedAgent.walletAddress}</div>
              {selectedAgent.erc8004TokenId && (
                <div>ERC-8004 token: #{String(selectedAgent.erc8004TokenId)}</div>
              )}
            </div>
          )}
        </section>

        {/* ── Rotation form ──────────────────────────────────────────── */}
        {selectedAgent && (
          <section
            className="rounded-sm p-4 space-y-3"
            style={{ background: "var(--ocean-mid)", border: "1px solid rgba(255,255,255,0.06)" }}
          >
            <h2 className="text-xs font-mono uppercase tracking-widest flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
              <RefreshCw className="w-3.5 h-3.5" /> Rotation
            </h2>

            {/* ── Migration impact preview ───────────────────────────── */}
            {/* Mirrors the live preview agents see in their own rotate dialog */}
            {/* so admins can confirm with the owner exactly what the OLD */}
            {/* wallet keeps before forcing the rotation. */}
            <div
              className="rounded-sm p-3 space-y-2"
              style={{ background: "rgba(232,84,10,0.06)", border: "1px solid rgba(232,84,10,0.3)" }}
              data-testid="panel-rotation-preview"
            >
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest" style={{ color: "var(--claw-orange)" }}>
                <Info className="w-3.5 h-3.5" /> Migration impact — what the OLD wallet keeps
              </div>
              <div className="text-[11px] font-mono break-all" style={{ color: "var(--text-muted)" }} data-testid="text-rotation-preview-wallet">
                Tied to wallet:{" "}
                <span className="font-mono" style={{ color: "var(--shell-cream)" }}>
                  {rotationPreviewQuery.data?.wallet || selectedAgent.walletAddress || "—"}
                </span>
              </div>

              {rotationPreviewQuery.isError && (
                <p className="text-[11px] font-mono" style={{ color: "#ef4444" }} data-testid="text-rotation-preview-error">
                  Failed to load preview: {(rotationPreviewQuery.error as Error).message}
                </p>
              )}

              <div className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                <div className="mb-1" style={{ color: "var(--shell-white)" }}>Badges</div>
                {rotationPreviewQuery.isLoading ? (
                  <span data-testid="text-rotation-preview-badges-loading">Checking current badges…</span>
                ) : (rotationPreviewQuery.data?.badges?.length ?? 0) > 0 ? (
                  <div data-testid="text-rotation-preview-badges-list">
                    Won't migrate ({rotationPreviewQuery.data!.badges.length}):{" "}
                    {rotationPreviewQuery.data!.badges.map((b, i) => (
                      <span key={b} data-testid={`badge-rotation-preview-${b.toLowerCase().replace(/\s+/g, "-")}`}>
                        <span className="font-mono" style={{ color: "var(--shell-white)" }}>{b}</span>
                        {i < rotationPreviewQuery.data!.badges.length - 1 ? ", " : ""}
                      </span>
                    ))}
                  </div>
                ) : (
                  <span data-testid="text-rotation-preview-badges-empty">No badges to lose on this wallet yet.</span>
                )}
              </div>

              <div className="text-[11px] leading-relaxed" style={{ color: "var(--text-muted)" }}>
                <div className="mb-1" style={{ color: "var(--shell-white)" }}>On-chain reputation cooldown</div>
                {rotationPreviewQuery.isLoading ? (
                  <span data-testid="text-rotation-preview-cooldown-loading">Checking on-chain cooldown…</span>
                ) : rotationPreviewQuery.data?.cooldown?.active ? (
                  <span data-testid="text-rotation-preview-cooldown-active">
                    Active until{" "}
                    <span className="font-mono" style={{ color: "var(--shell-white)" }}>
                      {rotationPreviewQuery.data.cooldown.endsAt
                        ? new Date(rotationPreviewQuery.data.cooldown.endsAt).toLocaleString()
                        : "—"}
                    </span>{" "}
                    ({Math.ceil((rotationPreviewQuery.data.cooldown.remainingSec || 0) / 60)}m left) — stays tied to the old address
                  </span>
                ) : (
                  <span data-testid="text-rotation-preview-cooldown-clear">No active reputation cooldown on the old wallet.</span>
                )}
              </div>

              <div className="text-[10px]" style={{ color: "var(--claw-orange)" }} data-testid="text-rotation-preview-warning">
                A fresh passport will be re-minted under the new wallet (new token id, no prior badges).
              </div>
            </div>

            <label className="text-[10px] uppercase font-mono tracking-widest block" style={{ color: "var(--text-muted)" }}>
              New wallet address
            </label>
            <input
              type="text"
              className="w-full p-2.5 rounded-sm text-sm font-mono"
              style={{ background: "var(--ocean-deep)", border: "1px solid rgba(255,255,255,0.1)", color: "var(--shell-white)" }}
              placeholder="0x… address that the owner now controls"
              value={newWalletAddress}
              onChange={(e) => { setNewWalletAddress(e.target.value); setNewSig(null); }}
              data-testid="input-new-wallet"
            />

            <label className="text-[10px] uppercase font-mono tracking-widest block" style={{ color: "var(--text-muted)" }}>
              Reason (audited, ≥ 10 chars)
            </label>
            <textarea
              className="w-full p-2.5 rounded-sm text-sm font-mono min-h-[80px]"
              style={{ background: "var(--ocean-deep)", border: "1px solid rgba(255,255,255,0.1)", color: "var(--shell-white)" }}
              placeholder="e.g. Owner verified via support ticket #1234, lost original device key on 2025-04-12."
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              data-testid="input-reason"
            />

            <div className="flex flex-wrap items-center gap-3">
              <button
                className="flex items-center gap-2 px-4 py-2 rounded-sm text-sm font-mono"
                style={{
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.15)",
                  color: "var(--shell-white)",
                  opacity: signBusy || !newWalletAddress ? 0.5 : 1,
                }}
                onClick={signWithNewWallet}
                disabled={signBusy || !newWalletAddress}
                data-testid="button-sign-new-wallet"
              >
                <Wallet className="w-4 h-4" />
                {signBusy ? "Waiting for wallet…" : newSig ? "Re-sign with new wallet" : "Sign with new wallet"}
              </button>
              {newSig && newSig.address.toLowerCase() === newWalletAddress.trim().toLowerCase() && (
                <span className="text-[11px] font-mono flex items-center gap-1" style={{ color: "var(--teal-glow)" }} data-testid="text-newsig-status">
                  <CheckCircle className="w-3.5 h-3.5" /> Captured at {new Date(newSig.timestamp).toLocaleTimeString()}
                </span>
              )}
            </div>

            <button
              className="w-full mt-2 py-3 rounded-sm text-sm font-display uppercase tracking-wider"
              style={{
                background: formReady ? "linear-gradient(135deg, var(--claw-red), var(--claw-orange))" : "rgba(255,255,255,0.06)",
                color: formReady ? "#fff" : "var(--text-muted)",
                cursor: formReady && !rotateMutation.isPending ? "pointer" : "not-allowed",
                opacity: rotateMutation.isPending ? 0.6 : 1,
              }}
              onClick={() => rotateMutation.mutate()}
              disabled={!formReady || rotateMutation.isPending}
              data-testid="button-submit-rotation"
            >
              {rotateMutation.isPending ? "Rotating…" : "Rotate wallet"}
            </button>
          </section>
        )}

        {/* ── Last response ──────────────────────────────────────────── */}
        {lastResponse && (
          <section
            className="rounded-sm p-4 space-y-2"
            style={{ background: "rgba(10,236,184,0.06)", border: "1px solid rgba(10,236,184,0.25)" }}
            data-testid="panel-last-response"
          >
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4" style={{ color: "var(--teal-glow)" }} />
              <span className="text-sm font-mono font-semibold" style={{ color: "var(--teal-glow)" }}>
                Rotation complete
              </span>
            </div>
            <div className="text-xs font-mono space-y-1" style={{ color: "var(--shell-cream)" }}>
              <div>Agent: {lastResponse.agent.handle} ({lastResponse.agent.id})</div>
              <div className="break-all">Old wallet: {lastResponse.oldWalletAddress}</div>
              <div className="break-all">New wallet: {lastResponse.walletAddress}</div>
              <div>Status: {lastResponse.status}{lastResponse.mintJobId ? ` — mint job #${lastResponse.mintJobId}` : ""}</div>
              <div>Reason logged: "{lastResponse.reason}"</div>
            </div>
          </section>
        )}

        {/* ── Audit log ──────────────────────────────────────────────── */}
        <section
          className="rounded-sm p-4 space-y-3"
          style={{ background: "var(--ocean-mid)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-mono uppercase tracking-widest flex items-center gap-2" style={{ color: "var(--text-muted)" }}>
              <ScrollText className="w-3.5 h-3.5" /> Recent admin rotations
            </h2>
            <button
              className="text-[10px] font-mono underline"
              style={{ color: "var(--text-muted)" }}
              onClick={() => logsQuery.refetch()}
              disabled={!ready}
              data-testid="button-refresh-logs"
            >
              Refresh
            </button>
          </div>
          {!ready && (
            <p className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>
              Sign in as admin above to load audit entries.
            </p>
          )}
          {logsQuery.isLoading && (
            <p className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>Loading audit log…</p>
          )}
          {logsQuery.error && (
            <div
              className="rounded-sm p-3 flex items-start gap-2"
              style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)" }}
              data-testid="error-logs"
            >
              <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
              <p className="text-xs font-mono text-red-400">{(logsQuery.error as Error).message}</p>
            </div>
          )}
          {logsQuery.data && logsQuery.data.logs.length === 0 && (
            <p className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }} data-testid="text-no-logs">
              No <code>wallet_rotated_admin</code> events recorded yet.
            </p>
          )}
          {logsQuery.data && logsQuery.data.logs.length > 0 && (
            <div className="space-y-2">
              {logsQuery.data.logs.map((log) => (
                <div
                  key={log.id}
                  className="rounded-sm p-3 text-[11px] font-mono space-y-1"
                  style={{ background: "var(--ocean-deep)", border: "1px solid rgba(255,255,255,0.05)" }}
                  data-testid={`log-entry-${log.id}`}
                >
                  <div className="flex items-center justify-between">
                    <span style={{ color: "var(--claw-orange)" }}>{log.eventType}</span>
                    <span style={{ color: "var(--text-muted)" }}>
                      {new Date(log.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="break-words" style={{ color: "var(--shell-cream)" }}>{log.details}</div>
                  <div style={{ color: "var(--text-muted)" }}>
                    severity: {log.severity}{log.ipAddress ? ` · ip: ${log.ipAddress}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
