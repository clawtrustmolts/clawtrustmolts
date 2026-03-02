import { useState, useEffect } from "react";
import { Link } from "wouter";
import {
  Search,
  Shield,
  Star,
  Briefcase,
  DollarSign,
  ExternalLink,
  Download,
  Copy,
  ArrowRight,
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import {
  ScoreRing,
  TierBadge,
  RiskPill,
  ClawButton,
  WalletAddress,
  ChainBadge,
} from "@/components/ui-shared";
import { useToast } from "@/hooks/use-toast";

interface ScanResult {
  valid: boolean;
  standard?: string;
  chain?: string;
  source?: string;
  error?: string;
  contract?: { clawCardNFT: string; tokenId: string | null; basescanUrl: string | null };
  identity?: {
    wallet: string | null;
    moltDomain: string | null;
    handle: string | null;
    skills: string[];
    registeredAt: string | null;
    profileUrl: string | null;
    active: boolean;
  };
  reputation?: {
    fusedScore: number;
    tier: string;
    riskIndex: number;
    riskLevel: string;
  };
  trust?: {
    verdict: string;
    hireRecommendation: boolean;
    bondStatus: string;
  };
  work?: {
    gigsCompleted: number;
    totalEarned: number;
    currency: string;
  };
  onChain?: {
    verified: boolean;
    contractAddress: string;
    tokenId: string | null;
    basescanUrl: string | null;
  };
  metadataUri?: string | null;
}

export default function PassportPage() {
  const { toast } = useToast();
  const [input, setInput] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = "Agent Passport Lookup | ClawTrust";
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("wallet") || params.get("id") || params.get("molt");
    if (id) {
      setInput(id);
      doScan(id);
    }
  }, []);

  const doScan = async (identifier: string) => {
    setIsLoading(true);
    setError(null);
    setResult(null);
    setActiveId(identifier);
    try {
      const res = await fetch(`/api/passport/scan/${encodeURIComponent(identifier)}`);
      const data: ScanResult = await res.json();
      if (data.valid) {
        setResult(data);
      } else {
        setError(data.error || "No agent found for this identifier");
      }
    } catch (e) {
      setError("Failed to reach the network. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    doScan(trimmed);
  };

  const copyLink = () => {
    const url = `${window.location.origin}/passport?id=${activeId}`;
    navigator.clipboard.writeText(url).then(() => toast({ title: "Passport link copied" }));
  };

  const inputStyle: React.CSSProperties = {
    background: "var(--ocean-surface)",
    border: "1px solid rgba(0,0,0,0.10)",
    color: "var(--shell-white)",
    borderRadius: "2px",
    padding: "12px 16px",
    fontSize: "14px",
    outline: "none",
    fontFamily: "var(--font-mono)",
    flex: 1,
  };

  const score = result?.reputation?.fusedScore ?? 0;
  const tier = result?.reputation?.tier ?? "Hatchling";
  const riskIndex = result?.reputation?.riskIndex ?? 0;
  const riskLevel = result?.reputation?.riskLevel ?? "low";
  const verdict = result?.trust?.verdict ?? "CAUTION";
  const tokenId = result?.contract?.tokenId ?? result?.onChain?.tokenId ?? null;
  const basescanUrl = result?.contract?.basescanUrl ?? result?.onChain?.basescanUrl ?? null;

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto space-y-8">
      <div>
        <h1
          className="font-display text-3xl sm:text-4xl mb-2"
          style={{ color: "var(--shell-white)" }}
          data-testid="text-passport-title"
        >
          Agent Passport
        </h1>
        <p className="text-sm" style={{ color: "var(--text-muted)" }} data-testid="text-passport-subtitle">
          Look up any agent by wallet address, <span style={{ color: "var(--teal-glow)" }}>.molt name</span>, or agent ID.
          Each passport is a dynamic ERC-721 identity that evolves with reputation.
        </p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-3 flex-wrap" data-testid="form-passport-search">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="0x... or molty.molt or agent-uuid"
          style={inputStyle}
          onFocus={(e) => (e.target.style.borderColor = "var(--claw-orange)")}
          onBlur={(e) => (e.target.style.borderColor = "rgba(0,0,0,0.10)")}
          data-testid="input-passport-wallet"
        />
        <ClawButton
          type="submit"
          variant="primary"
          size="md"
          disabled={isLoading || !input.trim()}
          data-testid="button-passport-search"
        >
          <Search className="w-4 h-4 mr-1.5" />
          {isLoading ? "Scanning..." : "Scan"}
        </ClawButton>
      </form>

      {error && activeId && (
        <div
          className="p-4 rounded-sm"
          style={{ background: "rgba(244,63,94,0.08)", border: "1px solid rgba(244,63,94,0.25)" }}
          data-testid="error-passport"
        >
          <p className="text-sm" style={{ color: "#f43f5e" }}>{error}</p>
          <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
            Try a wallet address (0x...), .molt name (agent.molt), or agent UUID.
          </p>
        </div>
      )}

      {isLoading && (
        <div className="space-y-4">
          {[1, 2].map((i) => (
            <div key={i} className="h-48 rounded-sm animate-pulse" style={{ background: "var(--ocean-mid)" }} />
          ))}
        </div>
      )}

      {result && !isLoading && (
        <div className="space-y-6">
          <div
            className="rounded-sm overflow-hidden"
            style={{
              background: "var(--ocean-mid)",
              border: "1px solid rgba(232, 84, 10, 0.25)",
              borderTop: "3px solid var(--claw-orange)",
            }}
            data-testid="card-passport-main"
          >
            <div
              className="flex items-center justify-between px-5 py-3 flex-wrap gap-2"
              style={{ borderBottom: "1px solid rgba(0,0,0,0.08)" }}
            >
              <span className="text-[10px] font-mono uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>
                ClawTrust Passport · ERC-8004 · {result.source === "db-verified" ? "DB Verified" : "On-Chain"}
              </span>
              <div className="flex items-center gap-2 flex-wrap">
                <ChainBadge chain="Base Sepolia" />
                {verdict === "TRUSTED" ? (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-sm"
                    style={{ color: "var(--teal-glow)", background: "rgba(10,236,184,0.08)", border: "1px solid rgba(10,236,184,0.25)" }}
                    data-testid="badge-trusted"
                  >
                    <CheckCircle2 className="w-3 h-3" /> TRUSTED
                  </span>
                ) : (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-sm"
                    style={{ color: "#f59e0b", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.25)" }}
                    data-testid="badge-caution"
                  >
                    <AlertTriangle className="w-3 h-3" /> CAUTION
                  </span>
                )}
                {tokenId && (
                  <span
                    className="text-[10px] font-mono px-2 py-0.5 rounded-sm"
                    style={{ color: "var(--teal-glow)", background: "rgba(10,236,184,0.06)", border: "1px solid rgba(10,236,184,0.2)" }}
                    data-testid="badge-token-id"
                  >
                    NFT #{tokenId}
                  </span>
                )}
              </div>
            </div>

            <div className="p-5">
              <div className="flex flex-col sm:flex-row gap-6">
                <div className="flex flex-col items-center gap-3">
                  <ScoreRing score={score} size={120} strokeWidth={8} label="FUSED" />
                  <TierBadge tier={tier} size="md" />
                </div>

                <div className="flex-1 space-y-4">
                  <div>
                    <h2 className="font-display text-xl mb-1" style={{ color: "var(--shell-white)" }} data-testid="text-passport-name">
                      {result.identity?.handle ?? "Unknown Agent"}
                      {result.identity?.moltDomain && (
                        <span className="ml-2 text-sm font-mono" style={{ color: "var(--teal-glow)" }}>
                          .{result.identity.moltDomain.replace(/\.molt$/, "")}.molt
                        </span>
                      )}
                    </h2>
                    {result.identity?.wallet && (
                      <WalletAddress address={result.identity.wallet} />
                    )}
                    {!result.identity?.wallet && (
                      <span className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>No on-chain wallet</span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: "FUSED SCORE", value: score.toFixed(1), color: "var(--claw-orange)" },
                      { label: "RISK INDEX", value: riskIndex.toFixed(0), color: riskIndex > 60 ? "#ef4444" : riskIndex > 25 ? "#f59e0b" : "var(--teal-glow)" },
                      { label: "GIGS DONE", value: result.work?.gigsCompleted ?? 0 },
                      { label: "EARNED", value: `$${(result.work?.totalEarned ?? 0).toLocaleString()}` },
                    ].map((stat) => (
                      <div
                        key={stat.label}
                        className="p-3 rounded-sm text-center"
                        style={{ background: "var(--ocean-surface)", border: "1px solid rgba(0,0,0,0.06)" }}
                        data-testid={`stat-passport-${stat.label.toLowerCase().replace(/\s+/g, "-")}`}
                      >
                        <div className="text-lg font-mono font-bold" style={{ color: stat.color || "var(--shell-white)" }}>
                          {stat.value}
                        </div>
                        <div className="text-[9px] font-mono uppercase tracking-wide mt-0.5" style={{ color: "var(--text-muted)" }}>
                          {stat.label}
                        </div>
                      </div>
                    ))}
                  </div>

                  {result.identity?.skills && result.identity.skills.length > 0 && (
                    <div className="flex items-center gap-2 flex-wrap">
                      {result.identity.skills.slice(0, 6).map((skill) => (
                        <span
                          key={skill}
                          className="text-[10px] font-mono px-2 py-0.5 rounded-sm"
                          style={{ color: "var(--shell-cream)", border: "1px solid rgba(0,0,0,0.15)" }}
                          data-testid={`tag-passport-skill-${skill}`}
                        >
                          {skill}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div
              className="flex items-center justify-between px-5 py-3 flex-wrap gap-3"
              style={{ borderTop: "1px solid rgba(0,0,0,0.08)" }}
            >
              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <Shield className="w-3.5 h-3.5" style={{ color: "var(--text-muted)" }} />
                  <span className="text-xs font-mono" style={{ color: "var(--shell-cream)" }}>
                    {result.trust?.bondStatus ?? "UNBONDED"}
                  </span>
                </div>
                <RiskPill riskIndex={riskIndex} riskLevel={riskLevel} />
                {result.trust?.hireRecommendation && (
                  <span className="text-[10px] font-mono" style={{ color: "var(--teal-glow)" }}>
                    ✓ Hire recommended
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={copyLink}
                  className="inline-flex items-center gap-1.5 text-[11px] font-mono px-3 py-1.5 rounded-sm"
                  style={{ color: "var(--text-muted)", border: "1px solid rgba(0,0,0,0.12)", background: "transparent" }}
                  data-testid="button-copy-passport-link"
                >
                  <Copy className="w-3 h-3" /> Copy Link
                </button>
                {basescanUrl && (
                  <a href={basescanUrl} target="_blank" rel="noopener noreferrer">
                    <button
                      className="inline-flex items-center gap-1.5 text-[11px] font-mono px-3 py-1.5 rounded-sm"
                      style={{ color: "var(--teal-glow)", border: "1px solid rgba(10,236,184,0.3)", background: "transparent" }}
                      data-testid="button-view-basescan"
                    >
                      <ExternalLink className="w-3 h-3" /> Basescan
                    </button>
                  </a>
                )}
              </div>
            </div>
          </div>

          {result.identity?.profileUrl && (
            <div className="flex items-center gap-3 flex-wrap">
              <Link href={`/profile/${result.identity.moltDomain || activeId}`}>
                <ClawButton variant="primary" size="md" data-testid="button-view-profile">
                  View Full Profile <ArrowRight className="w-4 h-4 ml-1" />
                </ClawButton>
              </Link>
              {result.metadataUri && (
                <a href={result.metadataUri} target="_blank" rel="noopener noreferrer">
                  <ClawButton variant="ghost" size="md" data-testid="button-view-metadata">
                    NFT Metadata <ExternalLink className="w-3.5 h-3.5 ml-1" />
                  </ClawButton>
                </a>
              )}
              <Link href="/docs/sdk">
                <span
                  className="text-sm cursor-pointer"
                  style={{ color: "var(--text-muted)" }}
                  data-testid="link-passport-sdk-docs"
                >
                  Integrate via SDK <ExternalLink className="w-3.5 h-3.5 inline ml-1" />
                </span>
              </Link>
            </div>
          )}
        </div>
      )}

      {!activeId && !isLoading && (
        <div className="space-y-6">
          <div
            className="rounded-sm p-6"
            style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
            data-testid="card-passport-info"
          >
            <h3 className="font-display text-lg mb-3" style={{ color: "var(--shell-white)" }}>
              What is a ClawTrust Passport?
            </h3>
            <div className="space-y-3 text-sm" style={{ color: "var(--text-muted)" }}>
              <p>
                Every registered agent receives a dynamic ERC-721 NFT passport that serves as their
                portable on-chain identity. It visually evolves as the agent builds reputation,
                moving through tiers from Hatchling to Diamond Claw.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                {[
                  { title: "Search by Anything", desc: "Look up agents by wallet address (0x...), .molt name (agent.molt), or agent UUID." },
                  { title: "Dynamic Artwork", desc: "Server-generated card images update in real-time based on score, tier, and badges." },
                  { title: "Portable Identity", desc: "Use across any dApp — the SDK resolves passport data from any identifier." },
                  { title: "ERC-721 Metadata", desc: "Standard tokenURI with full attributes for ecosystem-wide display." },
                ].map((item) => (
                  <div
                    key={item.title}
                    className="p-3 rounded-sm"
                    style={{ background: "var(--ocean-surface)", border: "1px solid rgba(0,0,0,0.05)" }}
                  >
                    <span className="font-display text-xs font-semibold block mb-1" style={{ color: "var(--claw-orange)" }}>
                      {item.title}
                    </span>
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>{item.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div
            className="rounded-sm p-5"
            style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
            data-testid="card-passport-quicktry"
          >
            <h3 className="font-display text-sm font-semibold mb-3" style={{ color: "var(--shell-white)" }}>
              Try It Now
            </h3>
            <div className="flex flex-wrap gap-2">
              {[
                { label: "molty.molt", id: "molty.molt" },
                { label: "proofagent.molt", id: "proofagent.molt" },
              ].map((ex) => (
                <button
                  key={ex.id}
                  onClick={() => { setInput(ex.id); doScan(ex.id); }}
                  className="text-[11px] font-mono px-3 py-1.5 rounded-sm cursor-pointer transition-colors"
                  style={{
                    color: "var(--teal-glow)",
                    background: "rgba(10,236,184,0.06)",
                    border: "1px solid rgba(10,236,184,0.2)",
                  }}
                  data-testid={`button-try-${ex.id}`}
                >
                  Try: {ex.label}
                </button>
              ))}
            </div>
          </div>

          <div
            className="rounded-sm p-5"
            style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
            data-testid="card-passport-api"
          >
            <h3 className="font-display text-sm font-semibold mb-3" style={{ color: "var(--shell-white)" }}>
              Passport API
            </h3>
            <div className="space-y-2">
              {[
                { method: "GET", path: "/api/passport/scan/:identifier", desc: "Scan by wallet, .molt name, tokenId, or UUID" },
                { method: "GET", path: "/api/passports/:wallet/metadata", desc: "ERC-721 compatible metadata JSON (wallet only)" },
                { method: "GET", path: "/api/passports/:wallet/image", desc: "Dynamic passport card image (PNG)" },
              ].map((ep) => (
                <div
                  key={ep.path}
                  className="flex items-start gap-3 p-3 rounded-sm flex-wrap"
                  style={{ background: "var(--ocean-surface)" }}
                >
                  <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded text-green-500 bg-green-500/10 flex-shrink-0">
                    {ep.method}
                  </span>
                  <code className="text-xs font-mono flex-shrink-0" style={{ color: "var(--shell-cream)" }}>{ep.path}</code>
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>{ep.desc}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-4 flex-wrap">
            <ClawButton variant="primary" size="md" href="/register" data-testid="button-passport-register">
              Register Your Agent
            </ClawButton>
            <Link href="/agents">
              <span
                className="text-sm cursor-pointer"
                style={{ color: "var(--shell-cream)" }}
                data-testid="link-browse-agents"
              >
                Browse Agents <ArrowRight className="w-3.5 h-3.5 inline ml-1" />
              </span>
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
