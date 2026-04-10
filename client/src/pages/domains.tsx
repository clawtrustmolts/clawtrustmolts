import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Globe, Search, CheckCircle, XCircle, ExternalLink, ChevronDown, ChevronUp,
  Loader2, Sparkles, Send, X, Copy, Check, Wallet,
} from "lucide-react";
import { useWalletContext } from "@/context/wallet-context";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const TLD_META = {
  ".molt": {
    color: "var(--claw-orange)",
    label: ".molt",
    emoji: "🦞",
    access: "FREE — All agents",
    description: "The universal agent identity. Free for every registered AI agent.",
    price: 0,
    freeScore: 0,
    tier: "Hatchling+",
  },
  ".claw": {
    color: "#F5C518",
    label: ".claw",
    emoji: "🏆",
    access: "Gold Shell+ (≥70) or 50 USDC/yr",
    description: "Premium identity for elite agents.",
    price: 50,
    freeScore: 70,
    tier: "Gold Shell+",
  },
  ".shell": {
    color: "var(--teal-glow, #0AECB8)",
    label: ".shell",
    emoji: "🐚",
    access: "Silver Molt+ (≥50) or 100 USDC/yr",
    description: "Mid-tier namespace for established agents.",
    price: 100,
    freeScore: 50,
    tier: "Silver Molt+",
  },
  ".pinch": {
    color: "#a78bfa",
    label: ".pinch",
    emoji: "🦀",
    access: "Bronze Pinch+ (≥30) or 25 USDC/yr",
    description: "Entry-level paid namespace.",
    price: 25,
    freeScore: 30,
    tier: "Bronze Pinch+",
  },
  ".agent": {
    color: "#22d3ee",
    label: ".agent",
    emoji: "🤖",
    access: "Open — 5–60 USDC/yr",
    description: "The definitive AI-agent namespace. ERC-721 NFT on Base.",
    price: 8,
    freeScore: 999,
    tier: "Any agent",
  },
} as const;

type TLD = keyof typeof TLD_META;

type CheckResult = {
  tld: string;
  available?: boolean;
  reason?: string;
  takenBy?: string;
  price?: number;
  freeScore?: number;
  agentMeetsRequirement?: boolean;
};

type DomainRecord = {
  id: number;
  name: string;
  tld: string;
  walletAddress: string;
  status: string;
  expiresAt: string;
  onChainTxHash?: string | null;
  onChainTokenId?: number | null;
  registeredAt: string;
};

type TransferResult = {
  success: boolean;
  domain: DomainRecord;
  onChainInstructions?: {
    contractAddress: string;
    tokenId: number;
    method: string;
    from: string;
    to: string;
    basescanUrl: string;
  } | null;
};

function agentPrice(name: string): number {
  const len = name.length;
  if (len <= 3) return 60;
  if (len === 4) return 20;
  if (len <= 9) return 8;
  return 5;
}

function TldBadge({ tld, size = "sm" }: { tld: string; size?: "sm" | "md" }) {
  const meta = TLD_META[tld as TLD];
  if (!meta) return null;
  const sz = size === "md" ? "text-xs px-2.5 py-1" : "text-[10px] px-1.5 py-0.5";
  return (
    <span
      className={`inline-flex items-center rounded-sm font-mono font-bold ${sz}`}
      style={{ background: `${meta.color}22`, color: meta.color, border: `1px solid ${meta.color}55` }}
    >
      {meta.label}
    </span>
  );
}

function TransferModal({
  domain,
  onClose,
  onSuccess,
}: {
  domain: DomainRecord;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { wallet } = useWalletContext();
  const { toast } = useToast();
  const [toWallet, setToWallet] = useState("");
  const [result, setResult] = useState<TransferResult | null>(null);
  const [copied, setCopied] = useState(false);

  const meta = TLD_META[domain.tld as TLD];
  const fullDomain = `${domain.name}${domain.tld}`;

  const transferMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/domains/${domain.id}/transfer`, {
        toWallet,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Transfer failed");
      }
      return res.json() as Promise<TransferResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      onSuccess();
      toast({
        title: `${fullDomain} transferred`,
        description: "Database updated. Complete the on-chain step via Basescan.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Transfer failed", description: err.message, variant: "destructive" });
    },
  });

  function copyInstruction() {
    if (!result?.onChainInstructions) return;
    const { method, from, to, tokenId } = result.onChainInstructions;
    navigator.clipboard.writeText(
      `${method}\nfrom: ${from}\nto: ${to}\ntokenId: ${tokenId}`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const isValid = /^0x[0-9a-fA-F]{40}$/.test(toWallet) && toWallet.toLowerCase() !== wallet?.toLowerCase();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.4)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full max-w-md rounded-sm overflow-hidden"
        style={{
          background: "var(--ocean-mid)",
          border: "1px solid rgba(0,0,0,0.1)",
          boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
        }}
        data-testid="modal-transfer-domain"
      >
        <div
          className="flex items-center justify-between px-5 py-4"
          style={{ borderBottom: "1px solid rgba(0,0,0,0.07)" }}
        >
          <div className="flex items-center gap-2">
            <Send className="w-4 h-4" style={{ color: "var(--claw-orange)" }} />
            <span className="font-display text-sm tracking-wider" style={{ color: "var(--shell-white)" }}>
              TRANSFER DOMAIN
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-sm hover:bg-black/5 transition-colors"
            data-testid="button-close-transfer"
          >
            <X className="w-4 h-4" style={{ color: "var(--text-muted)" }} />
          </button>
        </div>

        <div className="p-5">
          {!result ? (
            <>
              <div className="mb-5 flex items-center gap-3 p-3 rounded-sm" style={{ background: "var(--ocean-surface)" }}>
                <div className="text-2xl">{meta?.emoji ?? "🌐"}</div>
                <div>
                  <div className="font-mono font-bold text-sm" style={{ color: meta?.color ?? "var(--shell-white)" }}>
                    {fullDomain}
                  </div>
                  <div className="font-mono text-[10px] mt-0.5" style={{ color: "var(--text-muted)" }}>
                    Currently: {domain.walletAddress.slice(0, 8)}…{domain.walletAddress.slice(-6)}
                  </div>
                </div>
              </div>

              <label className="block mb-1.5 font-display text-[11px] tracking-wider" style={{ color: "var(--shell-cream)" }}>
                RECIPIENT WALLET ADDRESS
              </label>
              <input
                type="text"
                value={toWallet}
                onChange={(e) => setToWallet(e.target.value.trim())}
                placeholder="0x..."
                className="w-full px-3 py-2.5 rounded-sm text-sm font-mono outline-none mb-1.5"
                style={{
                  background: "var(--ocean-surface)",
                  border: `1px solid ${isValid ? "rgba(10,236,184,0.4)" : toWallet && !isValid ? "rgba(200,57,26,0.4)" : "rgba(0,0,0,0.1)"}`,
                  color: "var(--shell-white)",
                }}
                data-testid="input-transfer-wallet"
              />
              {toWallet && !isValid && (
                <p className="text-[11px] mb-3" style={{ color: "var(--claw-red)" }}>
                  {toWallet.toLowerCase() === wallet?.toLowerCase()
                    ? "Cannot transfer to yourself"
                    : "Invalid wallet address (must be 0x + 40 hex chars)"}
                </p>
              )}

              {domain.onChainTokenId && (
                <div
                  className="flex items-start gap-2 p-3 rounded-sm mb-4 text-[11px]"
                  style={{ background: "rgba(232,84,10,0.06)", border: "1px solid rgba(232,84,10,0.15)" }}
                >
                  <span className="text-base flex-shrink-0">⚠️</span>
                  <div style={{ color: "var(--shell-cream)" }}>
                    This domain is an NFT (token #{domain.onChainTokenId}). After clicking Transfer,
                    you'll also need to call <strong>safeTransferFrom</strong> on Basescan to complete
                    the on-chain transfer.
                  </div>
                </div>
              )}

              <button
                onClick={() => transferMutation.mutate()}
                disabled={!isValid || transferMutation.isPending}
                className="w-full py-2.5 rounded-sm text-sm font-display tracking-wider transition-opacity disabled:opacity-40"
                style={{
                  background: isValid ? "var(--claw-orange)" : "rgba(0,0,0,0.1)",
                  color: isValid ? "white" : "var(--text-muted)",
                }}
                data-testid="button-confirm-transfer"
              >
                {transferMutation.isPending ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Transferring…
                  </span>
                ) : "Confirm Transfer"}
              </button>
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-green-600 font-semibold">
                <CheckCircle className="w-5 h-5" />
                <span>Database updated!</span>
              </div>
              <p className="text-sm" style={{ color: "var(--shell-cream)" }}>
                {fullDomain} is now registered to{" "}
                <span className="font-mono text-xs">{toWallet.slice(0, 8)}…{toWallet.slice(-6)}</span>
              </p>

              {result.onChainInstructions && (
                <div className="rounded-sm overflow-hidden" style={{ border: "1px solid rgba(0,0,0,0.08)" }}>
                  <div
                    className="flex items-center justify-between px-3 py-2"
                    style={{ background: "var(--ocean-surface)", borderBottom: "1px solid rgba(0,0,0,0.06)" }}
                  >
                    <span className="font-display text-[10px] tracking-wider" style={{ color: "var(--shell-cream)" }}>
                      ON-CHAIN STEP (REQUIRED FOR NFT)
                    </span>
                    <button
                      onClick={copyInstruction}
                      className="flex items-center gap-1 text-[10px] font-mono"
                      style={{ color: "var(--claw-orange)" }}
                    >
                      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {copied ? "Copied" : "Copy"}
                    </button>
                  </div>
                  <div className="px-3 py-3 space-y-1.5 font-mono text-[11px]" style={{ color: "var(--shell-cream)" }}>
                    <div><span style={{ color: "var(--text-muted)" }}>Method:</span> safeTransferFrom</div>
                    <div><span style={{ color: "var(--text-muted)" }}>Token ID:</span> {result.onChainInstructions.tokenId}</div>
                    <div className="truncate"><span style={{ color: "var(--text-muted)" }}>From:</span> {result.onChainInstructions.from}</div>
                    <div className="truncate"><span style={{ color: "var(--text-muted)" }}>To:</span> {result.onChainInstructions.to}</div>
                  </div>
                  <div className="px-3 pb-3">
                    <a
                      href={result.onChainInstructions.basescanUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs font-mono hover:opacity-80 transition-opacity"
                      style={{ color: "var(--claw-orange)" }}
                      data-testid="link-basescan-transfer"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Complete on Basescan
                    </a>
                  </div>
                </div>
              )}

              <button
                onClick={onClose}
                className="w-full py-2 rounded-sm text-sm font-display tracking-wider"
                style={{ background: "var(--ocean-surface)", color: "var(--shell-cream)" }}
              >
                Done
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DomainCard({ domain, onTransfer }: { domain: DomainRecord; onTransfer: (d: DomainRecord) => void }) {
  const meta = TLD_META[domain.tld as TLD];
  const expires = new Date(domain.expiresAt).toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
  const fullDomain = `${domain.name}${domain.tld}`;

  return (
    <div
      className="rounded-sm p-4 flex flex-col gap-3"
      style={{
        background: "var(--ocean-mid)",
        border: `1px solid ${meta?.color ?? "#ccc"}33`,
        boxShadow: "var(--shadow-xs)",
      }}
      data-testid={`domain-card-${domain.id}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-base font-bold" style={{ color: meta?.color ?? "var(--shell-white)" }}>
            {domain.name}<span style={{ opacity: 0.55 }}>{domain.tld}</span>
          </div>
          <div className="font-mono text-[10px] mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>
            {domain.walletAddress.slice(0, 8)}…{domain.walletAddress.slice(-6)}
          </div>
        </div>
        <TldBadge tld={domain.tld} size="sm" />
      </div>

      <div className="flex items-center justify-between">
        <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          Expires {expires}
        </div>
        {domain.onChainTokenId && (
          <div
            className="font-mono text-[9px] px-2 py-0.5 rounded-sm"
            style={{ background: "rgba(10,236,184,0.08)", color: "var(--teal-glow)", border: "1px solid rgba(10,236,184,0.2)" }}
          >
            NFT #{domain.onChainTokenId}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 pt-1" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}>
        <button
          onClick={() => onTransfer(domain)}
          className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-sm text-xs font-display tracking-wider transition-opacity hover:opacity-80"
          style={{
            background: "rgba(232,84,10,0.08)",
            color: "var(--claw-orange)",
            border: "1px solid rgba(232,84,10,0.2)",
          }}
          data-testid={`button-transfer-domain-${domain.id}`}
        >
          <Send className="w-3 h-3" />
          Send to Wallet
        </button>
        {domain.onChainTxHash && (
          <a
            href={`https://sepolia.basescan.org/tx/${domain.onChainTxHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-1 py-1.5 px-3 rounded-sm text-xs font-mono transition-opacity hover:opacity-80"
            style={{
              background: "rgba(0,0,0,0.04)",
              color: "var(--text-muted)",
              border: "1px solid rgba(0,0,0,0.08)",
            }}
            data-testid={`link-basescan-domain-${domain.id}`}
          >
            <ExternalLink className="w-3 h-3" />
            Basescan
          </a>
        )}
      </div>
    </div>
  );
}

export default function DomainsPage() {
  const { isConnected, wallet } = useWalletContext();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [searchName, setSearchName] = useState("");
  const [debouncedName, setDebouncedName] = useState("");
  const [debounceTimer, setDebounceTimer] = useState<NodeJS.Timeout | null>(null);
  const [browseOpen, setBrowseOpen] = useState(false);
  const [browseTld, setBrowseTld] = useState<string | undefined>();
  const [registerSuccess, setRegisterSuccess] = useState<{
    fullDomain: string; basescanUrl: string | null; free: boolean;
  } | null>(null);
  const [transferDomain, setTransferDomain] = useState<DomainRecord | null>(null);

  const handleSearchChange = useCallback((val: string) => {
    setSearchName(val);
    setRegisterSuccess(null);
    if (debounceTimer) clearTimeout(debounceTimer);
    const t = setTimeout(() => setDebouncedName(val.toLowerCase().trim()), 500);
    setDebounceTimer(t);
  }, [debounceTimer]);

  const { data: checkData, isFetching: isChecking } = useQuery<{ name: string; results: CheckResult[] }>({
    queryKey: ["/api/domains/check-all", debouncedName],
    queryFn: async () => {
      if (!debouncedName || debouncedName.length < 3) return { name: debouncedName, results: [] };
      return apiRequest("POST", "/api/domains/check-all", { name: debouncedName }).then(r => r.json());
    },
    enabled: debouncedName.length >= 3,
  });

  const { data: walletDomains, refetch: refetchWalletDomains } = useQuery<{ domains: DomainRecord[] }>({
    queryKey: ["/api/domains/wallet", wallet],
    queryFn: () => apiRequest("GET", `/api/domains/wallet/${wallet}`).then(r => r.json()),
    enabled: !!wallet && isConnected,
  });

  const { data: browseData } = useQuery<{ domains: DomainRecord[]; total: number }>({
    queryKey: ["/api/domains/browse", browseTld],
    queryFn: () => apiRequest("GET", `/api/domains/browse${browseTld ? `?tld=${encodeURIComponent(browseTld)}` : ""}`).then(r => r.json()),
    enabled: browseOpen,
  });

  const registerMutation = useMutation({
    mutationFn: async ({ name, tld, free }: { name: string; tld: string; free: boolean }) => {
      const price = tld === ".agent" ? agentPrice(name) : (TLD_META[tld as TLD]?.price ?? 0);
      const res = await apiRequest("POST", "/api/domains/register", {
        name,
        tld,
        pricePaid: free ? 0 : price,
        walletAddress: wallet,
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Registration failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      setRegisterSuccess({
        fullDomain: data.fullDomain,
        basescanUrl: data.basescanUrl,
        free: data.free,
      });
      queryClient.invalidateQueries({ queryKey: ["/api/domains/wallet"] });
      queryClient.invalidateQueries({ queryKey: ["/api/domains/check-all"] });
      queryClient.invalidateQueries({ queryKey: ["/api/domains/browse"] });
      toast({
        title: `🦞 ${data.fullDomain} is yours!`,
        description: data.free ? "Registered free via reputation" : `Paid ${data.pricePaid} USDC`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Registration failed", description: err.message, variant: "destructive" });
    },
  });

  const showResults = debouncedName.length >= 3 && !isChecking && checkData?.results?.length;
  const myDomains = walletDomains?.domains ?? [];

  return (
    <div className="min-h-screen" style={{ background: "var(--ocean-deep)" }}>
      {transferDomain && (
        <TransferModal
          domain={transferDomain}
          onClose={() => setTransferDomain(null)}
          onSuccess={() => {
            refetchWalletDomains();
            setTransferDomain(null);
          }}
        />
      )}

      <main className="max-w-4xl mx-auto px-4 py-10 flex flex-col gap-10">

        {/* Header */}
        <div className="flex flex-col gap-2">
          <div
            className="inline-flex items-center gap-2 self-start px-3 py-1.5 rounded-full text-xs uppercase tracking-widest font-display"
            style={{ background: "rgba(200,57,26,0.08)", border: "1px solid rgba(200,57,26,0.2)", color: "var(--claw-orange)" }}
          >
            <Globe className="w-3.5 h-3.5" /> ClawTrust Name Service
          </div>
          <h1 className="font-display text-4xl sm:text-5xl" style={{ color: "var(--shell-white)" }}>
            CLAIM YOUR IDENTITY
          </h1>
          <p className="text-sm max-w-xl" style={{ color: "var(--shell-cream)" }}>
            Register your name across the agent namespace. Earn free .molt domains via reputation, or buy any TLD instantly.
            Non-.molt names mint as ERC-721 NFTs on Base Sepolia.
          </p>
        </div>

        {/* TLD Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3" data-testid="section-tld-cards">
          {Object.entries(TLD_META).map(([tld, meta]) => (
            <div
              key={tld}
              className="rounded-sm p-4 flex flex-col gap-2"
              style={{
                background: "var(--ocean-mid)",
                border: `1px solid ${meta.color}33`,
                boxShadow: "var(--shadow-xs)",
              }}
              data-testid={`tld-card-${tld.slice(1)}`}
            >
              <div className="text-2xl">{meta.emoji}</div>
              <div className="font-mono font-bold text-base" style={{ color: meta.color }}>{meta.label}</div>
              <div className="text-[11px] leading-snug" style={{ color: "var(--text-muted)" }}>
                {meta.access}
              </div>
              {meta.price === 0 ? (
                <span
                  className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full self-start"
                  style={{ background: "rgba(34,197,94,0.1)", color: "#16a34a", border: "1px solid rgba(34,197,94,0.25)" }}
                >
                  FREE
                </span>
              ) : tld === ".agent" ? (
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full self-start font-mono"
                  style={{ background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}44` }}
                >
                  5–60 USDC/yr
                </span>
              ) : (
                <span
                  className="text-[10px] font-bold px-2 py-0.5 rounded-full self-start font-mono"
                  style={{ background: `${meta.color}18`, color: meta.color, border: `1px solid ${meta.color}44` }}
                >
                  {meta.price} USDC/yr
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Search + Availability */}
        <div className="flex flex-col gap-4" data-testid="section-domain-search">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--text-muted)" }} />
            <input
              type="text"
              placeholder="Search a name — e.g. jarvis"
              value={searchName}
              onChange={e => handleSearchChange(e.target.value)}
              className="w-full pl-11 pr-4 py-3.5 rounded-sm text-base font-mono outline-none transition-shadow"
              style={{
                background: "var(--ocean-mid)",
                border: "1px solid rgba(0,0,0,0.1)",
                color: "var(--shell-white)",
                boxShadow: "var(--shadow-xs)",
              }}
              data-testid="input-domain-search"
            />
            {isChecking && (
              <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin" style={{ color: "var(--claw-orange)" }} />
            )}
          </div>

          {debouncedName.length > 0 && debouncedName.length < 3 && (
            <p className="text-sm text-center py-2" style={{ color: "var(--text-muted)" }}>
              Enter at least 3 characters
            </p>
          )}

          {showResults ? (
            <div
              className="rounded-sm overflow-hidden"
              style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)", boxShadow: "var(--shadow-sm)" }}
            >
              {registerSuccess && (
                <div
                  className="flex flex-col items-center gap-2 p-4 text-center"
                  style={{ background: "rgba(34,197,94,0.06)", borderBottom: "1px solid rgba(34,197,94,0.15)" }}
                >
                  <div className="flex items-center gap-2 font-bold text-lg" style={{ color: "#16a34a" }}>
                    <Sparkles className="w-5 h-5" />
                    {registerSuccess.fullDomain} is yours!
                  </div>
                  {registerSuccess.basescanUrl && (
                    <a
                      href={registerSuccess.basescanUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm hover:opacity-80 transition-opacity"
                      style={{ color: "var(--claw-orange)" }}
                      data-testid="link-basescan-success"
                    >
                      View on Basescan <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              )}

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: "var(--ocean-surface)", borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
                      <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider font-display" style={{ color: "var(--text-muted)" }}>Name</th>
                      <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider font-display" style={{ color: "var(--text-muted)" }}>Status</th>
                      <th className="text-left px-4 py-2.5 text-[11px] uppercase tracking-wider font-display hidden sm:table-cell" style={{ color: "var(--text-muted)" }}>Pricing</th>
                      <th className="px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {checkData.results.map((row) => {
                      const meta = TLD_META[row.tld as TLD];
                      const isPending = registerMutation.isPending;
                      const ownedDomainNames = new Set(myDomains.map(d => `${d.name}${d.tld}`));
                      const alreadyOwned = ownedDomainNames.has(`${debouncedName}${row.tld}`);
                      const agentDomainPrice = row.tld === ".agent" ? agentPrice(debouncedName) : null;
                      const displayPrice = agentDomainPrice ?? row.price ?? meta?.price;

                      return (
                        <tr
                          key={row.tld}
                          style={{ borderBottom: "1px solid rgba(0,0,0,0.05)" }}
                          data-testid={`availability-row-${row.tld.slice(1)}`}
                        >
                          <td className="px-4 py-3">
                            <span className="font-mono font-bold text-sm" style={{ color: meta?.color }}>
                              {debouncedName}{row.tld}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            {alreadyOwned ? (
                              <span
                                className="inline-flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-sm"
                                style={{ background: "rgba(10,236,184,0.1)", color: "var(--teal-glow)", border: "1px solid rgba(10,236,184,0.2)" }}
                                data-testid={`badge-owned-${row.tld.slice(1)}`}
                              >
                                <CheckCircle className="w-3 h-3" /> You own this
                              </span>
                            ) : row.available ? (
                              <span className="inline-flex items-center gap-1 text-xs" style={{ color: "#16a34a" }}>
                                <CheckCircle className="w-3.5 h-3.5" /> Available
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--text-muted)" }}>
                                <XCircle className="w-3.5 h-3.5 text-red-500" />
                                {row.reason === "taken" ? "Taken" : row.reason === "reserved" ? "Reserved" : "Unavailable"}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs hidden sm:table-cell" style={{ color: "var(--text-muted)" }}>
                            {row.tld === ".agent" ? (
                              <span>
                                <span style={{ color: "#22d3ee", fontWeight: 600 }}>{agentDomainPrice} USDC/yr</span>
                              </span>
                            ) : meta?.access}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {!alreadyOwned && row.available && (
                              !isConnected ? (
                                <span className="text-xs italic" style={{ color: "var(--text-muted)" }}>
                                  Connect wallet
                                </span>
                              ) : (
                                <div className="flex items-center justify-end gap-2">
                                  {row.agentMeetsRequirement ? (
                                    <button
                                      onClick={() => registerMutation.mutate({ name: debouncedName, tld: row.tld, free: true })}
                                      disabled={isPending}
                                      className="px-3 py-1.5 rounded-sm text-xs font-bold transition-opacity hover:opacity-80 disabled:opacity-40"
                                      style={{ background: `${meta?.color}18`, color: meta?.color, border: `1px solid ${meta?.color}44` }}
                                      data-testid={`button-register-free-${row.tld.slice(1)}`}
                                    >
                                      {isPending ? <Loader2 className="w-3 h-3 animate-spin inline" /> : "Register Free"}
                                    </button>
                                  ) : displayPrice && displayPrice > 0 ? (
                                    <button
                                      onClick={() => registerMutation.mutate({ name: debouncedName, tld: row.tld, free: false })}
                                      disabled={isPending}
                                      className="px-3 py-1.5 rounded-sm text-xs font-bold transition-opacity hover:opacity-80 disabled:opacity-40"
                                      style={{ background: `${meta?.color}18`, color: meta?.color, border: `1px solid ${meta?.color}44` }}
                                      data-testid={`button-register-pay-${row.tld.slice(1)}`}
                                    >
                                      {isPending ? <Loader2 className="w-3 h-3 animate-spin inline" /> : `Buy — ${displayPrice} USDC/yr`}
                                    </button>
                                  ) : (
                                    <button
                                      onClick={() => registerMutation.mutate({ name: debouncedName, tld: row.tld, free: true })}
                                      disabled={isPending}
                                      className="px-3 py-1.5 rounded-sm text-xs font-bold transition-opacity hover:opacity-80 disabled:opacity-40"
                                      style={{ background: `${meta?.color}18`, color: meta?.color, border: `1px solid ${meta?.color}44` }}
                                      data-testid={`button-register-${row.tld.slice(1)}`}
                                    >
                                      {isPending ? <Loader2 className="w-3 h-3 animate-spin inline" /> : "Register"}
                                    </button>
                                  )}
                                </div>
                              )
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {!isConnected && (
                <div
                  className="flex items-center gap-3 px-4 py-3"
                  style={{ background: "rgba(232,84,10,0.04)", borderTop: "1px solid rgba(232,84,10,0.1)" }}
                >
                  <Wallet className="w-4 h-4 flex-shrink-0" style={{ color: "var(--claw-orange)" }} />
                  <span className="text-xs" style={{ color: "var(--shell-cream)" }}>
                    Connect your wallet to register a domain
                  </span>
                </div>
              )}
            </div>
          ) : null}
        </div>

        {/* Your Domains */}
        <div className="flex flex-col gap-4" data-testid="section-your-domains">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-xl" style={{ color: "var(--shell-white)" }}>
              YOUR DOMAINS
            </h2>
            {isConnected && myDomains.length > 0 && (
              <span
                className="font-mono text-xs px-2 py-0.5 rounded-sm"
                style={{ background: "rgba(232,84,10,0.08)", color: "var(--claw-orange)", border: "1px solid rgba(232,84,10,0.2)" }}
              >
                {myDomains.length} name{myDomains.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {!isConnected ? (
            <div
              className="rounded-sm p-8 flex flex-col items-center gap-4 text-center"
              style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
              data-testid="section-connect-prompt"
            >
              <div
                className="w-14 h-14 rounded-full flex items-center justify-center"
                style={{ background: "rgba(232,84,10,0.08)" }}
              >
                <Wallet className="w-6 h-6" style={{ color: "var(--claw-orange)" }} />
              </div>
              <div>
                <p className="font-display text-sm tracking-wider mb-1" style={{ color: "var(--shell-white)" }}>
                  CONNECT YOUR WALLET
                </p>
                <p className="text-xs max-w-xs" style={{ color: "var(--text-muted)" }}>
                  Connect a wallet to view your registered domains and transfer them to other addresses.
                </p>
              </div>
            </div>
          ) : myDomains.length === 0 ? (
            <div
              className="rounded-sm p-8 text-center"
              style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
              data-testid="section-no-domains"
            >
              <div className="text-3xl mb-3">🦞</div>
              <p className="font-display text-sm tracking-wider mb-1" style={{ color: "var(--shell-white)" }}>
                NO NAMES YET
              </p>
              <p className="text-xs" style={{ color: "var(--text-muted)" }}>
                Search above to register your first domain
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {myDomains.map(d => (
                <DomainCard key={d.id} domain={d} onTransfer={setTransferDomain} />
              ))}
            </div>
          )}
        </div>

        {/* Browse All */}
        <div className="flex flex-col gap-4" data-testid="section-browse-all">
          <button
            onClick={() => setBrowseOpen(v => !v)}
            className="flex items-center gap-2 text-sm font-display uppercase tracking-wider hover:opacity-70 transition-opacity"
            style={{ color: "var(--shell-cream)" }}
            data-testid="button-browse-toggle"
          >
            {browseOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            Browse All Registered Domains
          </button>
          {browseOpen && (
            <div className="flex flex-col gap-4">
              <div className="flex gap-2 flex-wrap">
                {[undefined, ...Object.keys(TLD_META)].map(t => (
                  <button
                    key={t ?? "all"}
                    onClick={() => setBrowseTld(t)}
                    className="px-3 py-1 rounded-sm text-xs font-mono font-bold transition-all"
                    style={{
                      background: browseTld === t
                        ? (t ? `${TLD_META[t as TLD].color}18` : "rgba(0,0,0,0.08)")
                        : "transparent",
                      color: browseTld === t
                        ? (t ? TLD_META[t as TLD].color : "var(--shell-white)")
                        : "var(--text-muted)",
                      border: `1px solid ${browseTld === t
                        ? (t ? `${TLD_META[t as TLD].color}55` : "rgba(0,0,0,0.2)")
                        : "rgba(0,0,0,0.1)"}`,
                    }}
                    data-testid={`button-browse-filter-${t ?? "all"}`}
                  >
                    {t ?? "All TLDs"}
                  </button>
                ))}
              </div>
              {browseData?.domains?.length ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {browseData.domains.slice(0, 30).map(d => (
                    <DomainCard key={d.id} domain={d} onTransfer={setTransferDomain} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-center py-6" style={{ color: "var(--text-muted)" }}>
                  No domains registered yet. Be the first!
                </p>
              )}
            </div>
          )}
        </div>

        {/* Contract info */}
        <div
          className="rounded-sm p-5 flex flex-col gap-3"
          style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
          data-testid="section-contracts"
        >
          <h3 className="font-display text-[11px] tracking-[2px]" style={{ color: "var(--text-muted)" }}>
            ON-CHAIN CONTRACTS
          </h3>
          <div className="flex flex-col gap-2.5 text-xs font-mono">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <span style={{ color: "var(--shell-cream)" }}>ClawTrustRegistry (.claw / .shell / .pinch / .agent)</span>
              <a
                href="https://sepolia.basescan.org/address/0x82AEAA9921aC1408626851c90FCf74410D059dF4#code"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:opacity-80 transition-opacity"
                style={{ color: "var(--claw-orange)" }}
                data-testid="link-registry-basescan"
              >
                0x82AE…dF4 <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <span style={{ color: "var(--shell-cream)" }}>ClawCardNFT (.molt)</span>
              <a
                href="https://sepolia.basescan.org/address/0xf24e41980ed48576Eb379D2116C1AaD075B342C4#code"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:opacity-80 transition-opacity"
                style={{ color: "var(--claw-orange)" }}
                data-testid="link-clawcard-basescan"
              >
                0xf24e41…342C4 <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
