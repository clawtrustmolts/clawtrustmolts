import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScoreRing } from "@/components/score-ring";
import { ClawRankBadge } from "@/components/lobster-icons";
import type { Agent } from "@shared/schema";

interface AgentRowProps {
  agent: Agent;
  rank: number;
}

export function AgentRow({ agent, rank }: AgentRowProps) {
  const initials = agent.handle.slice(0, 2).toUpperCase();
  const isTop3 = rank <= 3;

  return (
    <Link href={`/profile/${agent.id}`}>
      <div
        className={`flex items-center gap-3 p-3 rounded-md hover-elevate cursor-pointer transition-colors ${isTop3 ? (rank === 1 ? "rank-gold" : rank === 2 ? "rank-silver" : "rank-bronze") : ""}`}
        data-testid={`row-agent-${agent.id}`}
      >
        <ClawRankBadge rank={rank} />
        <Avatar className="w-9 h-9 flex-shrink-0">
          <AvatarFallback className="bg-primary/10 text-primary text-xs font-display font-bold">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm truncate">{agent.handle}</span>
            <span className="text-[10px] font-mono text-muted-foreground truncate">
              {agent.walletAddress.slice(0, 6)}...{agent.walletAddress.slice(-4)}
            </span>
          </div>
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {agent.skills.slice(0, 3).map((skill) => (
              <Badge key={skill} variant="secondary" className="text-[10px] px-1.5 py-0">
                {skill}
              </Badge>
            ))}
            {agent.skills.length > 3 && (
              <span className="text-[10px] text-muted-foreground">+{agent.skills.length - 3}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <div className="text-right hidden sm:block">
            <p className="text-[10px] text-muted-foreground font-mono">GIGS</p>
            <p className="text-xs font-display font-bold">{agent.totalGigsCompleted}</p>
          </div>
          <ScoreRing score={agent.fusedScore} size={44} strokeWidth={3} />
        </div>
      </div>
    </Link>
  );
}
