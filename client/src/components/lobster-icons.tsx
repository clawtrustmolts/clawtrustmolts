interface IconProps {
  className?: string;
  size?: number;
}

export function LobsterIcon({ className = "", size = 24 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M32 8C27 3 18 5 15 12C12 19 16 25 21 24C17 29 20 36 25 34L30 42H34L39 34C44 36 47 29 43 24C48 25 52 19 49 12C46 5 37 3 32 8Z"
        fill="currentColor"
        opacity="0.9"
      />
      <path
        d="M15 12C10 10 4 14 6 20C8 26 14 26 16 23"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M49 12C54 10 60 14 58 20C56 26 50 26 48 23"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M4 18L2 14M6 20L3 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M60 18L62 14M58 20L61 22" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="27" cy="14" r="2.5" fill="hsl(170, 100%, 40%)" opacity="0.8" />
      <circle cx="37" cy="14" r="2.5" fill="hsl(170, 100%, 40%)" opacity="0.8" />
      <circle cx="27" cy="14" r="1" fill="white" opacity="0.7" />
      <circle cx="37" cy="14" r="1" fill="white" opacity="0.7" />
      <path
        d="M26 42L22 52M30 42L28 55M34 42L36 55M38 42L42 52"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.7"
      />
      <path
        d="M30 44L27 48M34 44L37 48"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.5"
      />
    </svg>
  );
}

export function ClawIcon({ className = "", size = 24 }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <path
        d="M16 28C12 28 8 24 6 18C4 12 6 6 10 4C14 2 16 6 16 10"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M16 28C20 28 24 24 26 18C28 12 26 6 22 4C18 2 16 6 16 10"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M10 4L7 1M22 4L25 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="16" cy="18" r="3" fill="currentColor" opacity="0.3" />
    </svg>
  );
}

export function SpinningClaw({ className = "", size = 32 }: IconProps) {
  return (
    <div className={`inline-flex items-center justify-center ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="animate-claw-spin"
      >
        <path
          d="M16 4C12 4 8 8 8 12C8 16 12 18 16 16C20 18 24 16 24 12C24 8 20 4 16 4Z"
          fill="currentColor"
          opacity="0.8"
        />
        <path d="M8 12L4 8M24 12L28 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path
          d="M14 18L12 26M18 18L20 26"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          opacity="0.6"
        />
      </svg>
    </div>
  );
}

export function ClawRankBadge({ rank, className = "" }: { rank: number; className?: string }) {
  const getClawRank = (r: number) => {
    if (r === 1) return { label: "GOLD", color: "text-amber-500 dark:text-amber-400" };
    if (r === 2) return { label: "SILVER", color: "text-slate-400 dark:text-slate-300" };
    if (r === 3) return { label: "BRONZE", color: "text-orange-500 dark:text-orange-400" };
    return { label: `#${r}`, color: "text-muted-foreground" };
  };

  const { label, color } = getClawRank(rank);

  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-display font-bold px-2 py-0.5 rounded-md ${color} ${className}`}>
      <ClawIcon size={10} className={color} />
      {label}
    </span>
  );
}
