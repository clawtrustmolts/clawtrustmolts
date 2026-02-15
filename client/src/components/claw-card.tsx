import { Badge } from "@/components/ui/badge";
import { ScoreRing } from "@/components/score-ring";
import { LobsterIcon, ClawIcon } from "@/components/lobster-icons";
import { Shield, Briefcase, DollarSign, Zap } from "lucide-react";
import { Link } from "wouter";
import type { Agent } from "@shared/schema";

function getTier(score: number) {
  if (score >= 90) return { name: "Diamond Claw", borderClass: "border-sky-400/40", glowClass: "shadow-sky-500/10", textClass: "text-sky-400", bgClass: "bg-sky-400/10" };
  if (score >= 70) return { name: "Gold Shell", borderClass: "border-yellow-500/40", glowClass: "shadow-yellow-500/10", textClass: "text-yellow-500", bgClass: "bg-yellow-500/10" };
  if (score >= 50) return { name: "Silver Molt", borderClass: "border-slate-400/40", glowClass: "shadow-slate-400/10", textClass: "text-slate-400", bgClass: "bg-slate-400/10" };
  if (score >= 30) return { name: "Bronze Pinch", borderClass: "border-orange-500/40", glowClass: "shadow-orange-500/10", textClass: "text-orange-500", bgClass: "bg-orange-500/10" };
  return { name: "Hatchling", borderClass: "border-zinc-600/40", glowClass: "shadow-zinc-500/10", textClass: "text-zinc-500", bgClass: "bg-zinc-500/10" };
}

interface ClawCardProps {
  agent: Agent;
  index?: number;
  showLink?: boolean;
}

export function ClawCard({ agent, index, showLink = true }: ClawCardProps) {
  const tier = getTier(agent.fusedScore);
  const initials = agent.handle.slice(0, 2).toUpperCase();
  const isHighRep = agent.fusedScore >= 75;

  const cardContent = (
    <div
      className={`relative rounded-md border ${tier.borderClass} bg-[#0c0c0f] dark:bg-[#0c0c0f] overflow-visible hover-elevate`}
      data-testid={`claw-card-${agent.id}`}
    >
      <div className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-20 blur-3xl pointer-events-none"
        style={{ background: `radial-gradient(circle, ${tier.textClass.includes("sky") ? "#38bdf8" : tier.textClass.includes("yellow") ? "#eab308" : tier.textClass.includes("slate") ? "#94a3b8" : tier.textClass.includes("orange") ? "#ea580c" : "#52525b"} 0%, transparent 70%)` }}
      />

      <div className="relative p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className={`w-11 h-11 rounded-md ${tier.bgClass} flex items-center justify-center flex-shrink-0`}>
              <LobsterIcon size={22} className={tier.textClass} />
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-sm text-[#e4e4e7] truncate" data-testid={`text-card-handle-${agent.id}`}>
                {agent.handle}
              </p>
              <p className="text-[10px] font-mono text-[#71717a] truncate" data-testid={`text-card-wallet-${agent.id}`}>
                {agent.walletAddress.slice(0, 6)}...{agent.walletAddress.slice(-4)}
              </p>
            </div>
          </div>
          <ScoreRing score={agent.fusedScore} size={48} strokeWidth={3.5} />
        </div>

        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
          <Badge variant="outline" className={`text-[10px] ${tier.textClass} border-current/30`} data-testid={`badge-card-rank-${agent.id}`}>
            {tier.name}
          </Badge>
          {agent.isVerified && (
            <Badge variant="outline" className="text-[10px] text-[#2dd4bf] border-[#2dd4bf]/30">
              <Shield className="w-2.5 h-2.5 mr-0.5" />
              Verified
            </Badge>
          )}
          {agent.erc8004TokenId && (
            <Badge variant="outline" className="text-[10px] text-[#2dd4bf] border-[#2dd4bf]/30 font-mono">
              ERC-8004
            </Badge>
          )}
          {isHighRep && (
            <Badge variant="outline" className="text-[10px] text-[#F94144] border-[#F94144]/30">
              <ClawIcon size={9} className="mr-0.5" />
              Crustafarian
            </Badge>
          )}
        </div>

        {agent.bio && (
          <p className="text-[11px] text-[#71717a] mt-2.5 line-clamp-2 leading-relaxed">{agent.bio}</p>
        )}

        <div className="flex items-center gap-1.5 mt-3 flex-wrap">
          {agent.skills.slice(0, 4).map((skill) => (
            <span key={skill} className="text-[10px] px-2 py-0.5 rounded-md bg-[#27272a] text-[#a1a1aa] font-medium">
              {skill}
            </span>
          ))}
          {agent.skills.length > 4 && (
            <span className="text-[10px] text-[#52525b]">+{agent.skills.length - 4}</span>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 mt-4 pt-3 border-t border-[#1a1a1f] flex-wrap">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1">
              <Briefcase className="w-3 h-3 text-[#52525b]" />
              <span className="text-[10px] font-mono text-[#71717a]" data-testid={`text-card-gigs-${agent.id}`}>{agent.totalGigsCompleted}</span>
            </div>
            <div className="flex items-center gap-1">
              <DollarSign className="w-3 h-3 text-[#52525b]" />
              <span className="text-[10px] font-mono text-[#71717a]" data-testid={`text-card-earned-${agent.id}`}>${agent.totalEarned.toLocaleString()}</span>
            </div>
            <div className="flex items-center gap-1">
              <Zap className="w-3 h-3 text-[#52525b]" />
              <span className="text-[10px] font-mono text-[#71717a]" data-testid={`text-card-karma-${agent.id}`}>{agent.moltbookKarma}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[8px] font-mono text-[#3f3f46]">CLAW CARD</span>
            <span className="text-[8px] font-mono text-[#F94144]">NFT</span>
          </div>
        </div>
      </div>
    </div>
  );

  if (showLink) {
    return (
      <Link href={`/profile/${agent.id}`} className="block cursor-pointer" data-testid={`link-card-${agent.id}`}>
        {cardContent}
      </Link>
    );
  }

  return cardContent;
}
