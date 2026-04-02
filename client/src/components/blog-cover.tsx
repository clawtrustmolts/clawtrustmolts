interface BlogCoverProps {
  tags: string[];
  slug: string;
  height?: number;
  className?: string;
  fade?: boolean;
}

function getAccent(tags: string[]) {
  if (tags.some(t => ["erc-8004", "identity", "standards", "solidity"].includes(t)))
    return { primary: "#0AECB8", secondary: "#0a3020", glow: "rgba(10,236,184,0.3)" };
  if (tags.some(t => ["swarm", "governance", "consensus", "dispute-resolution"].includes(t)))
    return { primary: "#a78bfa", secondary: "#1e0a40", glow: "rgba(167,139,250,0.28)" };
  if (tags.some(t => ["skale", "infrastructure", "scaling", "gas"].includes(t)))
    return { primary: "#60a5fa", secondary: "#060d2a", glow: "rgba(96,165,250,0.28)" };
  if (tags.some(t => ["reputation", "tiers", "scoring", "agent-economy"].includes(t)))
    return { primary: "#fbbf24", secondary: "#1a0c00", glow: "rgba(251,191,36,0.28)" };
  return { primary: "#E8540A", secondary: "#1a0800", glow: "rgba(232,84,10,0.3)" };
}

export function BlogCoverArt({ tags, slug, height = 240, className = "", fade = true }: BlogCoverProps) {
  const a = getAccent(tags);
  const seed = slug.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);

  const cx = 160 + (seed % 80);
  const cy = 90 + (seed % 40);
  const rings = [90, 60, 35, 16];
  const dots = 6;
  const dotR = 90;

  const hexPoints = Array.from({ length: 6 }, (_, i) => {
    const angle = (i * 60 - 30) * (Math.PI / 180);
    return [cx + dotR * Math.cos(angle), cy + dotR * Math.sin(angle)] as [number, number];
  });

  const smallDots = Array.from({ length: 12 }, (_, i) => {
    const angle = (i * 30 + (seed % 30)) * (Math.PI / 180);
    const r = 130 + (i % 3) * 18;
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)] as [number, number];
  });

  const lines = hexPoints.map(([x, y]) => ({ x1: cx, y1: cy, x2: x, y2: y }));
  const hexPath = hexPoints.map(([x, y], i) => `${i === 0 ? "M" : "L"} ${x} ${y}`).join(" ") + " Z";

  return (
    <div
      className={className}
      style={{ position: "relative", overflow: "hidden", height, background: "#050d15" }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 400 220"
        preserveAspectRatio="xMidYMid slice"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <radialGradient id={`rg1-${slug}`} cx="50%" cy="50%" r="70%">
            <stop offset="0%" stopColor={a.primary} stopOpacity="0.22" />
            <stop offset="100%" stopColor={a.primary} stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`rg2-${slug}`} cx={`${(seed % 40) + 20}%`} cy="80%" r="60%">
            <stop offset="0%" stopColor={a.secondary} stopOpacity="0.5" />
            <stop offset="100%" stopColor={a.secondary} stopOpacity="0" />
          </radialGradient>
          <pattern id={`pg-${slug}`} x="0" y="0" width="28" height="28" patternUnits="userSpaceOnUse">
            <path d="M 28 0 L 0 0 0 28" fill="none" stroke="rgba(255,255,255,0.035)" strokeWidth="0.5" />
          </pattern>
          {fade && (
            <linearGradient id={`fd-${slug}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="40%" stopColor="#050d15" stopOpacity="0" />
              <stop offset="100%" stopColor="#050d15" stopOpacity="1" />
            </linearGradient>
          )}
        </defs>

        <rect width="400" height="220" fill={`url(#pg-${slug})`} />
        <rect width="400" height="220" fill={`url(#rg1-${slug})`} />
        <rect width="400" height="220" fill={`url(#rg2-${slug})`} />

        {lines.map((l, i) => (
          <line key={i} {...l} stroke={a.primary} strokeWidth="0.6" strokeOpacity="0.18" />
        ))}

        {rings.map((r, i) => (
          <circle key={i} cx={cx} cy={cy} r={r}
            fill={i === rings.length - 1 ? a.primary : "none"}
            fillOpacity={i === rings.length - 1 ? 0.12 : 0}
            stroke={a.primary}
            strokeWidth={i === rings.length - 1 ? 0 : 0.6}
            strokeOpacity={0.35 - i * 0.06}
          />
        ))}

        <path d={hexPath} fill="none" stroke={a.primary} strokeWidth="0.8" strokeOpacity="0.35" />

        {hexPoints.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="3.5" fill={a.primary} fillOpacity="0.55" />
        ))}

        {smallDots.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r={i % 3 === 0 ? 1.5 : 1} fill={a.primary} fillOpacity={i % 3 === 0 ? 0.25 : 0.12} />
        ))}

        <circle cx={cx} cy={cy} r="8" fill={a.primary} fillOpacity="0.7" />
        <circle cx={cx} cy={cy} r="4" fill={a.primary} fillOpacity="1" />

        {fade && <rect width="400" height="220" fill={`url(#fd-${slug})`} />}
      </svg>

      <div
        style={{
          position: "absolute",
          bottom: fade ? "14px" : undefined,
          top: !fade ? "12px" : undefined,
          right: "16px",
          fontSize: "26px",
          opacity: 0.22,
          lineHeight: 1,
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        🦞
      </div>
    </div>
  );
}
