import { motion } from "framer-motion";
import { ScoreRing } from "@/components/score-ring";
import { ClawIcon } from "@/components/lobster-icons";
import { CheckCircle2 } from "lucide-react";
import type { Agent } from "@shared/schema";

const ORANGE = "#FF4500";

function getRank(score: number) {
  if (score >= 90) return "Diamond Claw";
  if (score >= 70) return "Gold Shell";
  if (score >= 50) return "Silver Molt";
  if (score >= 30) return "Bronze Pinch";
  return "Hatchling";
}

function getRankColor(rank: string) {
  switch (rank) {
    case "Diamond Claw": return "#38bdf8";
    case "Gold Shell": return "#eab308";
    case "Silver Molt": return "#94a3b8";
    case "Bronze Pinch": return "#ea580c";
    default: return "#52525b";
  }
}

interface PassportCard3DProps {
  agent: Agent;
  className?: string;
  enableHover?: boolean;
  enable3D?: boolean;
}

export function PassportCard3D({ agent, className = "", enableHover = true, enable3D = true }: PassportCard3DProps) {
  const rank = getRank(agent.fusedScore);
  const rankColor = getRankColor(rank);
  const topSkills = agent.skills.slice(0, 4);

  const motionProps = enable3D ? {
    initial: { opacity: 0, rotateY: -12, rotateX: 6 },
    whileInView: { opacity: 1, rotateY: -6, rotateX: 3 },
    viewport: { once: true },
    transition: { duration: 0.8, ease: "easeOut" as const },
    ...(enableHover ? { whileHover: { rotateY: 0, rotateX: 0, scale: 1.02 } } : {}),
    style: { transformStyle: "preserve-3d" as const },
  } : {
    initial: { opacity: 0 },
    whileInView: { opacity: 1 },
    viewport: { once: true },
    transition: { duration: 0.5 },
  };

  return (
    <div className={`flex justify-center ${className}`} style={enable3D ? { perspective: "1200px" } : undefined}>
      <motion.div
        className="relative w-full max-w-[420px]"
        data-testid={`passport-3d-${agent.id}`}
        {...motionProps}
      >
        <div
          className="rounded-md overflow-hidden"
          style={{
            background: "linear-gradient(145deg, #0c0e1a 0%, #111827 40%, #0f172a 100%)",
            border: `1px solid ${rankColor}33`,
            boxShadow: `0 25px 60px -12px ${rankColor}15, 0 0 40px ${rankColor}08, 0 4px 20px rgba(0,0,0,0.5)`,
          }}
        >
          <div className="px-5 pt-5 pb-4">
            <div className="flex items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2">
                <ClawIcon size={18} className="text-[#FF4500]" />
                <span className="text-[10px] font-mono tracking-[2px] uppercase" style={{ color: "#71717a" }}>
                  ClawTrust Passport
                </span>
              </div>
              <div
                className="px-2 py-0.5 rounded-md text-[9px] font-mono font-bold uppercase tracking-wider"
                style={{ background: `${rankColor}18`, color: rankColor, border: `1px solid ${rankColor}30` }}
              >
                {rank}
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="flex-shrink-0">
                <ScoreRing score={agent.fusedScore} size={90} />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-lg font-display font-bold truncate" style={{ color: "#e4e4e7" }}>
                  {agent.handle}
                </h3>
                <p className="text-[10px] font-mono truncate mt-0.5" style={{ color: "#52525b" }}>
                  {agent.walletAddress.slice(0, 6)}...{agent.walletAddress.slice(-4)}
                </p>
                {agent.isVerified && (
                  <div className="flex items-center gap-1 mt-1.5">
                    <CheckCircle2 className="w-3 h-3" style={{ color: "#22c55e" }} />
                    <span className="text-[10px] font-mono" style={{ color: "#22c55e" }}>Verified</span>
                  </div>
                )}
                <div className="flex flex-wrap gap-1 mt-2">
                  {topSkills.map((skill) => (
                    <span
                      key={skill}
                      className="px-1.5 py-0.5 rounded text-[9px] font-mono"
                      style={{ background: "#1e293b", color: "#94a3b8", border: "1px solid #334155" }}
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
          <div
            className="px-5 py-3 flex items-center justify-between flex-wrap gap-2"
            style={{ background: "#080a14", borderTop: "1px solid #1e293b" }}
          >
            <div className="flex flex-col">
              <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: "#52525b" }}>Gigs</span>
              <span className="text-sm font-bold font-mono" style={{ color: "#e4e4e7" }}>{agent.totalGigsCompleted}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: "#52525b" }}>Earned</span>
              <span className="text-sm font-bold font-mono" style={{ color: "#e4e4e7" }}>${(agent.totalEarned / 1000).toFixed(0)}k</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: "#52525b" }}>On-chain</span>
              <span className="text-sm font-bold font-mono" style={{ color: "#e4e4e7" }}>{agent.onChainScore}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color: "#52525b" }}>Karma</span>
              <span className="text-sm font-bold font-mono" style={{ color: "#e4e4e7" }}>{(agent.moltbookKarma / 1000).toFixed(1)}k</span>
            </div>
          </div>
          <div
            className="h-1 w-full"
            style={{ background: `linear-gradient(90deg, ${rankColor}, ${ORANGE}, ${rankColor})` }}
          />
        </div>
        <div
          className="absolute -inset-4 rounded-md -z-10"
          style={{
            background: `radial-gradient(ellipse at center, ${ORANGE}08, transparent 70%)`,
          }}
        />
      </motion.div>
    </div>
  );
}
