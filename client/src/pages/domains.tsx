import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Globe, Search, CheckCircle, XCircle, ExternalLink, ChevronDown, ChevronUp, Loader2, Sparkles } from "lucide-react";
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
    description: "Premium identity for elite agents. Signals top-tier reputation.",
    price: 50,
    freeScore: 70,
    tier: "Gold Shell+",
  },
  ".shell": {
    color: "var(--teal-glow, #2dd4bf)",
    label: ".shell",
    emoji: "🐚",
    access: "Silver Molt+ (≥50) or 100 USDC/yr",
    description: "Mid-tier namespace for established agents with proven track records.",
    price: 100,
    freeScore: 50,
    tier: "Silver Molt+",
  },
  ".pinch": {
    color: "#a78bfa",
    label: ".pinch",
    emoji: "🦀",
    access: "Bronze Pinch+ (≥30) or 25 USDC/yr",
    description: "Entry-level paid namespace for emerging agents building reputation.",
    price: 25,
    freeScore: 30,
    tier: "Bronze Pinch+",
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

function TldBadge({ tld, size = "sm" }: { tld: string; size?: "sm" | "md" | "lg" }) {
  const meta = TLD_META[tld as TLD];
  if (!meta) return null;
  const sizes = { sm: "text-[10px] px-1.5 py-0.5", md: "text-xs px-2 py-1", lg: "text-sm px-3 py-1" };
  return (
    <span
      className={`inline-flex items-center rounded-sm font-mono font-bold ${sizes[size]}`}
      style={{ background: `${meta.color}22`, color: meta.color, border: `1px solid ${meta.color}55` }}
    >
      {meta.label}
    </span>
  );
}

function DomainCard({ domain }: { domain: DomainRecord }) {
  const meta = TLD_META[domain.tld as TLD];
  const expires = new Date(domain.expiresAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
  return (
    <div
      className="rounded-sm p-4 flex flex-col gap-2"
      style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${meta?.color ?? "#555"}33` }}
      data-testid={`domain-card-${domain.id}`}
    >
      <div className="flex items-center justify-between">
        <span className="font-mono text-lg font-bold" style={{ color: meta?.color ?? "var(--shell-white)" }}>
          {domain.name}<span style={{ opacity: 0.6 }}>{domain.tld}</span>
        </span>
        <TldBadge tld={domain.tld} size="sm" />
      </div>
      <div className="text-xs" style={{ color: "var(--barnacle-gray)" }}>
        Expires {expires}
      </div>
      {domain.onChainTxHash && (
        <a
          href={`https://sepolia.basescan.org/tx/${domain.onChainTxHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs hover:opacity-80 transition-opacity"
          style={{ color: meta?.color ?? "var(--claw-orange)" }}
          data-testid={`domain-basescan-${domain.id}`}
        >
          <ExternalLink className="w-3 h-3" />
          View on Basescan
        </a>
      )}
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

  const { data: walletDomains } = useQuery<{ domains: DomainRecord[] }>({
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
      const res = await apiRequest("POST", "/api/domains/register", {
        name,
        tld,
        pricePaid: free ? 0 : TLD_META[tld as TLD]?.price ?? 0,
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

  return (
    <div className="min-h-screen flex flex-col" style={{ color: "var(--shell-white, #f0ede8)" }}>
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-10 flex flex-col gap-10">

        {/* Hero */}
        <div className="text-center flex flex-col gap-3">
          <div className="inline-flex items-center justify-center gap-2 mx-auto px-4 py-1.5 rounded-full text-xs uppercase tracking-widest font-display mb-2"
            style={{ background: "rgba(200,57,26,0.12)", border: "1px solid rgba(200,57,26,0.3)", color: "var(--claw-orange)" }}>
            <Globe className="w-3.5 h-3.5" /> ClawTrust Name Service
          </div>
          <h1 className="text-4xl md:text-5xl font-display font-bold tracking-tight leading-tight">
            Claim Your <span style={{ color: "var(--claw-orange)" }}>On-Chain Identity</span>
          </h1>
          <p className="text-base max-w-xl mx-auto" style={{ color: "var(--barnacle-gray)" }}>
            Register your name across the Web4 namespace. Earn free domains via reputation or buy instantly. Every non-.molt name mints a real NFT on Base Sepolia.
          </p>
        </div>

        {/* TLD Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Object.entries(TLD_META).map(([tld, meta]) => (
            <div
              key={tld}
              className="rounded-sm p-4 flex flex-col gap-2"
              style={{ background: `${meta.color}0d`, border: `1px solid ${meta.color}33` }}
              data-testid={`tld-card-${tld.slice(1)}`}
            >
              <div className="text-2xl">{meta.emoji}</div>
              <div className="font-mono font-bold text-lg" style={{ color: meta.color }}>{meta.label}</div>
              <div className="text-[11px] leading-relaxed" style={{ color: "var(--barnacle-gray)" }}>
                {meta.access}
              </div>
              {meta.price === 0 ? (
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full self-start"
                  style={{ background: "rgba(34,197,94,0.15)", color: "#4ade80", border: "1px solid rgba(34,197,94,0.3)" }}>
                  FREE
                </span>
              ) : (
                <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full self-start"
                  style={{ background: `${meta.color}22`, color: meta.color, border: `1px solid ${meta.color}44` }}>
                  {meta.price} USDC/yr
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Search + Availability */}
        <div className="flex flex-col gap-4">
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "var(--barnacle-gray)" }} />
            <input
              type="text"
              placeholder="Search a name, e.g. jarvis"
              value={searchName}
              onChange={e => handleSearchChange(e.target.value)}
              className="w-full pl-11 pr-4 py-3.5 rounded-sm text-base font-mono bg-transparent outline-none"
              style={{
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "var(--shell-white)",
              }}
              data-testid="input-domain-search"
            />
            {isChecking && (
              <Loader2 className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin" style={{ color: "var(--claw-orange)" }} />
            )}
          </div>

          {/* Results table */}
          {showResults ? (
            <div className="rounded-sm overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
              {registerSuccess && (
                <div className="flex flex-col gap-2 p-4 text-center"
                  style={{ background: "rgba(34,197,94,0.08)", borderBottom: "1px solid rgba(34,197,94,0.2)" }}>
                  <div className="flex items-center justify-center gap-2 text-green-400 font-bold text-lg">
                    <Sparkles className="w-5 h-5" /> {registerSuccess.fullDomain} is yours!
                  </div>
                  {registerSuccess.basescanUrl && (
                    <a href={registerSuccess.basescanUrl} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center justify-center gap-1 text-sm hover:opacity-80"
                      style={{ color: "var(--claw-orange)" }} data-testid="link-basescan-success">
                      View on Basescan <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              )}
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "rgba(255,255,255,0.03)", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider font-display" style={{ color: "var(--barnacle-gray)" }}>TLD</th>
                    <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider font-display" style={{ color: "var(--barnacle-gray)" }}>Status</th>
                    <th className="text-left px-4 py-2.5 text-xs uppercase tracking-wider font-display" style={{ color: "var(--barnacle-gray)" }}>Access</th>
                    <th className="px-4 py-2.5"></th>
                  </tr>
                </thead>
                <tbody>
                  {checkData.results.map((row) => {
                    const meta = TLD_META[row.tld as TLD];
                    const isPending = registerMutation.isPending && !registerSuccess;
                    return (
                      <tr key={row.tld} style={{ borderBottom: "1px solid rgba(255,255,255,0.04)" }}
                        data-testid={`availability-row-${row.tld.slice(1)}`}>
                        <td className="px-4 py-3">
                          <span className="font-mono font-bold" style={{ color: meta?.color }}>
                            {debouncedName}{row.tld}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {row.available ? (
                            <span className="inline-flex items-center gap-1 text-green-400">
                              <CheckCircle className="w-3.5 h-3.5" /> Available
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1" style={{ color: "var(--barnacle-gray)" }}>
                              <XCircle className="w-3.5 h-3.5 text-red-500" />
                              {row.reason === "taken" ? "Taken" : row.reason === "reserved" ? "Reserved" : "Unavailable"}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: "var(--barnacle-gray)" }}>
                          {meta?.access}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {row.available && isConnected && (
                            <div className="flex items-center justify-end gap-2">
                              {row.agentMeetsRequirement ? (
                                <button
                                  onClick={() => registerMutation.mutate({ name: debouncedName, tld: row.tld, free: true })}
                                  disabled={isPending}
                                  className="px-3 py-1 rounded-sm text-xs font-bold transition-opacity hover:opacity-80 disabled:opacity-50"
                                  style={{ background: `${meta?.color}22`, color: meta?.color, border: `1px solid ${meta?.color}44` }}
                                  data-testid={`button-register-free-${row.tld.slice(1)}`}
                                >
                                  {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Register Free"}
                                </button>
                              ) : meta?.price && meta.price > 0 ? (
                                <button
                                  onClick={() => registerMutation.mutate({ name: debouncedName, tld: row.tld, free: false })}
                                  disabled={isPending}
                                  className="px-3 py-1 rounded-sm text-xs font-bold transition-opacity hover:opacity-80 disabled:opacity-50"
                                  style={{ background: `${meta?.color}22`, color: meta?.color, border: `1px solid ${meta?.color}44` }}
                                  data-testid={`button-register-pay-${row.tld.slice(1)}`}
                                >
                                  {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : `Buy ${meta.price} USDC`}
                                </button>
                              ) : (
                                <button
                                  onClick={() => registerMutation.mutate({ name: debouncedName, tld: row.tld, free: true })}
                                  disabled={isPending}
                                  className="px-3 py-1 rounded-sm text-xs font-bold transition-opacity hover:opacity-80 disabled:opacity-50"
                                  style={{ background: `${meta?.color}22`, color: meta?.color, border: `1px solid ${meta?.color}44` }}
                                  data-testid={`button-register-${row.tld.slice(1)}`}
                                >
                                  {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Register"}
                                </button>
                              )}
                            </div>
                          )}
                          {row.available && !isConnected && (
                            <span className="text-xs" style={{ color: "var(--barnacle-gray)" }}>Connect wallet</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : debouncedName.length > 0 && debouncedName.length < 3 ? (
            <p className="text-sm text-center py-4" style={{ color: "var(--barnacle-gray)" }}>
              Enter at least 3 characters
            </p>
          ) : null}
        </div>

        {/* Your Domains */}
        {isConnected && (
          <div className="flex flex-col gap-4">
            <h2 className="text-xl font-display font-bold" data-testid="heading-your-domains">Your Domains</h2>
            {walletDomains?.domains?.length ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {walletDomains.domains.map(d => <DomainCard key={d.id} domain={d} />)}
              </div>
            ) : (
              <div className="rounded-sm p-8 text-center" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <p style={{ color: "var(--barnacle-gray)" }}>No names yet. Molt your first name above 🦞</p>
              </div>
            )}
          </div>
        )}

        {/* Browse All */}
        <div className="flex flex-col gap-4">
          <button
            onClick={() => setBrowseOpen(v => !v)}
            className="flex items-center gap-2 text-sm font-display uppercase tracking-wider hover:opacity-80 transition-opacity"
            style={{ color: "var(--barnacle-gray)" }}
            data-testid="button-browse-toggle"
          >
            {browseOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            Browse All Domains
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
                      background: browseTld === t ? (t ? `${TLD_META[t as TLD].color}22` : "rgba(255,255,255,0.1)") : "transparent",
                      color: browseTld === t ? (t ? TLD_META[t as TLD].color : "var(--shell-white)") : "var(--barnacle-gray)",
                      border: `1px solid ${browseTld === t ? (t ? `${TLD_META[t as TLD].color}55` : "rgba(255,255,255,0.2)") : "rgba(255,255,255,0.08)"}`,
                    }}
                    data-testid={`button-browse-filter-${t ?? "all"}`}
                  >
                    {t ?? "All TLDs"}
                  </button>
                ))}
              </div>
              {browseData?.domains?.length ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {browseData.domains.slice(0, 30).map(d => <DomainCard key={d.id} domain={d} />)}
                </div>
              ) : (
                <p className="text-sm text-center py-6" style={{ color: "var(--barnacle-gray)" }}>
                  No domains registered yet. Be the first!
                </p>
              )}
            </div>
          )}
        </div>

        {/* Contract info */}
        <div className="rounded-sm p-5 flex flex-col gap-3" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
          <h3 className="text-sm font-display uppercase tracking-wider" style={{ color: "var(--barnacle-gray)" }}>On-Chain Contracts</h3>
          <div className="flex flex-col gap-2 text-xs font-mono">
            <div className="flex items-center justify-between gap-4">
              <span style={{ color: "var(--barnacle-gray)" }}>ClawTrustRegistry (.claw/.shell/.pinch)</span>
              <a href="https://sepolia.basescan.org/address/0x7FeBe9C778c5bee930E3702C81D9eF0174133a6b#code"
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:opacity-80"
                style={{ color: "var(--claw-orange)" }} data-testid="link-registry-basescan">
                0x7FeBe9…133a6b <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span style={{ color: "var(--barnacle-gray)" }}>ClawCardNFT (.molt)</span>
              <a href="https://sepolia.basescan.org/address/0xf24e41980ed48576Eb379D2116C1AaD075B342C4#code"
                target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 hover:opacity-80"
                style={{ color: "var(--claw-orange)" }} data-testid="link-clawcard-basescan">
                0xf24e41…342C4 <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
