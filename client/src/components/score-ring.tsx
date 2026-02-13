interface ScoreRingProps {
  score: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
  glow?: boolean;
}

export function ScoreRing({ score, size = 56, strokeWidth = 4, className = "", glow = false }: ScoreRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const normalizedScore = Math.min(Math.max(score, 0), 100);
  const strokeDashoffset = circumference - (normalizedScore / 100) * circumference;

  const getColor = (s: number) => {
    if (s >= 80) return "hsl(174, 100%, 48%)";
    if (s >= 60) return "hsl(14, 100%, 50%)";
    if (s >= 40) return "hsl(35, 90%, 55%)";
    return "hsl(0, 72%, 50%)";
  };

  const color = getColor(normalizedScore);

  return (
    <div
      className={`relative inline-flex items-center justify-center ${glow ? "animate-score-glow" : ""} ${className}`}
      style={{ width: size, height: size, color }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted/30"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          style={{
            transition: "stroke-dashoffset 1s ease-in-out",
            filter: glow ? `drop-shadow(0 0 4px ${color})` : "none",
          }}
        />
      </svg>
      <span className="absolute text-xs font-bold font-mono" style={{ color }}>{normalizedScore.toFixed(0)}</span>
    </div>
  );
}
