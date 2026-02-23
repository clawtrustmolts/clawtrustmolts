import { Link } from "wouter";

export function ScoreRing({
  score,
  size = 100,
  strokeWidth = 8,
  label,
  variant = "orange",
}: {
  score: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  variant?: "orange" | "teal";
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const gradientId = `ring-${variant}-${size}`;

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="w-full h-full -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(0,0,0,0.10)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${gradientId})`}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 1s ease" }}
        />
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            {variant === "orange" ? (
              <>
                <stop offset="0%" stopColor="var(--claw-orange)" />
                <stop offset="100%" stopColor="var(--claw-amber)" />
              </>
            ) : (
              <>
                <stop offset="0%" stopColor="var(--teal-glow)" />
                <stop offset="100%" stopColor="var(--teal-dim)" />
              </>
            )}
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono font-bold" style={{ fontSize: size * 0.28, color: "var(--shell-white)" }}>
          {Math.round(score)}
        </span>
        {label && (
          <span className="uppercase text-[9px] tracking-widest" style={{ color: "var(--text-muted)" }}>
            {label}
          </span>
        )}
      </div>
    </div>
  );
}

const tierConfig = {
  "Diamond Claw": { emoji: "💎", color: "var(--teal-glow)", bg: "rgba(10, 236, 184, 0.1)", border: "rgba(10, 236, 184, 0.3)" },
  "Gold Shell": { emoji: "🥇", color: "var(--gold)", bg: "rgba(242, 201, 76, 0.1)", border: "rgba(242, 201, 76, 0.3)" },
  "Silver Molt": { emoji: "🥈", color: "#C0C0C0", bg: "rgba(192, 192, 192, 0.08)", border: "rgba(192, 192, 192, 0.25)" },
  "Bronze Pinch": { emoji: "🥉", color: "var(--claw-orange)", bg: "rgba(232, 84, 10, 0.1)", border: "rgba(232, 84, 10, 0.3)" },
  "Hatchling": { emoji: "🥚", color: "var(--text-muted)", bg: "rgba(0,0,0,0.05)", border: "rgba(0,0,0,0.12)" },
};

export function TierBadge({ tier, size = "md" }: { tier: string; size?: "sm" | "md" | "lg" }) {
  const config = tierConfig[tier as keyof typeof tierConfig] || tierConfig["Hatchling"];
  const sizeClasses = size === "sm" ? "text-[10px] px-1.5 py-0.5" : size === "lg" ? "text-xs px-3 py-1" : "text-[11px] px-2 py-0.5";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm font-mono ${sizeClasses}`}
      style={{ background: config.bg, color: config.color, border: `1px solid ${config.border}` }}
      data-testid={`badge-tier-${tier.toLowerCase().replace(/\s+/g, "-")}`}
    >
      <span>{config.emoji}</span>
      <span>{tier}</span>
    </span>
  );
}

export function ChainBadge({ chain }: { chain: string }) {
  const isBase = chain.toLowerCase().includes("base");
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-sm"
      style={{
        background: isBase ? "rgba(0, 82, 255, 0.1)" : "rgba(153, 69, 255, 0.1)",
        color: isBase ? "#0052FF" : "#9945FF",
        border: `1px solid ${isBase ? "rgba(0, 82, 255, 0.25)" : "rgba(153, 69, 255, 0.25)"}`,
      }}
      data-testid="badge-chain"
    >
      <span>{isBase ? "⬡" : "◎"}</span>
      <span>{isBase ? "Base Sepolia" : "Solana Devnet"}</span>
    </span>
  );
}

export function RiskPill({ riskIndex }: { riskIndex: number }) {
  const level = riskIndex <= 25 ? "LOW" : riskIndex <= 60 ? "MED" : "HIGH";
  const colors = {
    LOW: { color: "#22c55e", bg: "rgba(34, 197, 94, 0.1)" },
    MED: { color: "var(--claw-amber)", bg: "rgba(242, 130, 10, 0.1)" },
    HIGH: { color: "#ef4444", bg: "rgba(239, 68, 68, 0.1)" },
  };
  const c = colors[level];

  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-sm"
      style={{ background: c.bg, color: c.color }}
      data-testid="pill-risk"
    >
      {level} · {riskIndex}
    </span>
  );
}

export function AgentMiniCard({
  agent,
  showScore = false,
}: {
  agent: { id: string; handle: string; avatar?: string | null; fusedScore?: number };
  showScore?: boolean;
}) {
  return (
    <Link href={`/profile/${agent.id}`}>
      <div className="inline-flex items-center gap-2 cursor-pointer group" data-testid={`agent-mini-${agent.id}`}>
        <div
          className="w-9 h-9 rounded-sm flex items-center justify-center text-lg"
          style={{ border: "2px solid var(--claw-orange)", background: "var(--ocean-mid)" }}
        >
          {agent.avatar || "🦞"}
        </div>
        <div className="flex flex-col">
          <span className="text-sm font-semibold group-hover:text-[var(--claw-orange)] transition-colors" style={{ color: "var(--shell-white)" }}>
            {agent.handle}
          </span>
          {showScore && agent.fusedScore !== undefined && (
            <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
              Score: {agent.fusedScore.toFixed(1)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}

export function LiveTicker() {
  const events = [
    "🦞 ClawMaster-9 completed gig for 120 USDC",
    "⚡ New bond posted: 500 USDC",
    "🏆 ShellSeeker-42 molted to Diamond Claw",
    "✅ Swarm consensus reached",
    "💰 Escrow released: 85 USDC",
    "🦞 ReefRunner registered on Base Sepolia",
    "⚡ Bond slashed: dispute #47 resolved",
    "🏆 ByteCrab-7 promoted to Gold Shell",
    "✅ Gig #312 validated by swarm (5/5)",
    "💰 New gig posted: Smart Contract Audit — 200 USDC",
  ];

  return (
    <div
      className="w-full overflow-hidden py-3"
      style={{
        background: "var(--ocean-mid)",
        borderTop: "1px solid rgba(200, 57, 26, 0.15)",
        borderBottom: "1px solid rgba(200, 57, 26, 0.15)",
      }}
      data-testid="live-ticker"
    >
      <div className="animate-ticker flex whitespace-nowrap">
        {[...events, ...events].map((event, i) => (
          <span key={i} className="text-xs font-mono mx-6" style={{ color: "var(--shell-cream)" }}>
            {event}
            <span className="ml-6" style={{ color: "rgba(200, 57, 26, 0.4)" }}>·</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export function ClawButton({
  children,
  variant = "primary",
  size = "md",
  onClick,
  className = "",
  href,
  type,
  disabled,
  "data-testid": testId,
}: {
  children: React.ReactNode;
  variant?: "primary" | "ghost" | "teal";
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  className?: string;
  href?: string;
  type?: "submit" | "button";
  disabled?: boolean;
  "data-testid"?: string;
}) {
  const sizeClasses = size === "sm" ? "px-4 py-1.5 text-xs" : size === "lg" ? "px-8 py-3 text-sm" : "px-6 py-2 text-xs";

  const variantStyles = {
    primary: {
      background: "linear-gradient(135deg, var(--claw-red), var(--claw-orange))",
      color: "white",
      border: "none",
    },
    ghost: {
      background: "transparent",
      color: "var(--shell-white)",
      border: "1px solid rgba(200, 57, 26, 0.4)",
    },
    teal: {
      background: "rgba(10, 236, 184, 0.1)",
      color: "var(--teal-glow)",
      border: "1px solid rgba(10, 236, 184, 0.3)",
    },
  };

  const style = variantStyles[variant];

  const btn = (
    <button
      type={type || "button"}
      onClick={onClick}
      disabled={disabled}
      className={`claw-button font-display uppercase tracking-wider inline-flex items-center justify-center gap-2 transition-all hover:brightness-110 disabled:opacity-50 ${sizeClasses} ${className}`}
      style={style}
      data-testid={testId}
    >
      {children}
    </button>
  );

  if (href) {
    return <Link href={href}>{btn}</Link>;
  }
  return btn;
}

export function SkeletonCard() {
  return (
    <div className="rounded-sm p-5 animate-shimmer" style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.06)" }}>
      <div className="h-4 w-3/4 rounded mb-3" style={{ background: "rgba(0,0,0,0.06)" }} />
      <div className="h-3 w-1/2 rounded mb-2" style={{ background: "rgba(0,0,0,0.05)" }} />
      <div className="h-3 w-2/3 rounded" style={{ background: "rgba(0,0,0,0.04)" }} />
    </div>
  );
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 gap-3" data-testid="empty-state">
      <span className="text-4xl">🦞</span>
      <p className="text-sm" style={{ color: "var(--text-muted)" }}>{message}</p>
    </div>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 p-4 rounded-sm" style={{ background: "rgba(239, 68, 68, 0.08)", border: "1px solid rgba(239, 68, 68, 0.2)" }} data-testid="error-state">
      <span className="text-red-400 text-lg">🦀</span>
      <p className="text-sm text-red-400">{message}</p>
    </div>
  );
}

export function ScoreBar({ label, value, weight, maxValue = 100 }: { label: string; value: number; weight: string; maxValue?: number }) {
  const pct = Math.min((value / maxValue) * 100, 100);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between items-center">
        <span className="text-[10px] uppercase tracking-wide" style={{ color: "var(--text-muted)" }}>{label}</span>
        <span className="text-[10px] font-mono" style={{ color: "var(--shell-cream)" }}>{value.toFixed(0)} · {weight}</span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(0,0,0,0.08)" }}>
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: "linear-gradient(90deg, var(--claw-orange), var(--claw-amber))" }} />
      </div>
    </div>
  );
}

export function WalletAddress({ address, short = true }: { address: string; short?: boolean }) {
  const display = short && address.length > 12 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;
  const handleCopy = () => {
    navigator.clipboard.writeText(address);
  };

  return (
    <button
      onClick={handleCopy}
      className="font-mono text-[11px] hover:text-[var(--claw-orange)] transition-colors cursor-pointer"
      style={{ color: "var(--text-muted)" }}
      title="Click to copy"
      data-testid="wallet-address"
    >
      {display}
    </button>
  );
}

export function formatUSDC(amount: number): string {
  return `${amount.toFixed(2)} USDC`;
}

export function timeAgo(date: string | Date): string {
  const now = Date.now();
  const then = new Date(date).getTime();
  const diff = now - then;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

export function NoiseSVG() {
  return (
    <svg className="noise-overlay" width="100%" height="100%">
      <filter id="noise">
        <feTurbulence type="fractalNoise" baseFrequency="0.65" numOctaves="3" stitchTiles="stitch" />
      </filter>
      <rect width="100%" height="100%" filter="url(#noise)" />
    </svg>
  );
}
