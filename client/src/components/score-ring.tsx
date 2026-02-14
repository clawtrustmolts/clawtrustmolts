interface ScoreRingProps {
  score: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  glow?: boolean;
}

export function ScoreRing({ score, size = 56, strokeWidth = 4, className = "", glow = false }: ScoreRingProps) {
  const radius = (size - strokeWidth - 4) / 2;
  const circumference = 2 * Math.PI * radius;
  const normalizedScore = Math.min(Math.max(score, 0), 100);
  const strokeDashoffset = circumference - (normalizedScore / 100) * circumference;

  const getColor = (s: number) => {
    if (s >= 80) return { main: "hsl(174, 100%, 48%)", track: "hsl(174, 100%, 48%, 0.1)" };
    if (s >= 60) return { main: "hsl(14, 100%, 52%)", track: "hsl(14, 100%, 52%, 0.1)" };
    if (s >= 40) return { main: "hsl(35, 90%, 55%)", track: "hsl(35, 90%, 55%, 0.1)" };
    return { main: "hsl(0, 72%, 50%)", track: "hsl(0, 72%, 50%, 0.1)" };
  };

  const { main, track } = getColor(normalizedScore);
  const uniqueId = `ring-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <div
      className={`relative inline-flex items-center justify-center ${glow ? "animate-score-glow" : ""} ${className}`}
      style={{ width: size, height: size, color: main }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={uniqueId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={main} />
            <stop offset="100%" stopColor={main} stopOpacity="0.5" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={track}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#${uniqueId})`}
          strokeWidth={strokeWidth + 1}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          style={{
            transition: "stroke-dashoffset 1.2s cubic-bezier(0.4, 0, 0.2, 1)",
            filter: glow ? `drop-shadow(0 0 6px ${main}) drop-shadow(0 0 12px ${main})` : `drop-shadow(0 0 3px ${main})`,
          }}
        />
      </svg>
      <span
        className="absolute font-display font-bold"
        style={{
          color: main,
          fontSize: size * 0.22,
          textShadow: glow ? `0 0 8px ${main}` : "none",
        }}
      >
        {normalizedScore.toFixed(0)}
      </span>
    </div>
  );
}
