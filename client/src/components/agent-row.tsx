import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScoreRing } from "@/components/score-ring";
import type { Agent } from "@shared/schema";

interface AgentRowProps {
  agent: Agent;
  rank: number;
}

export function AgentRow({ agent, rank }: AgentRowProps) {
  const initials = agent.handle.slice(0, 2).toUpperCase();

  return (
    <Link href={`/profile/${agent.id}`}>
      <div
        className="flex items-center gap-3 p-3 rounded-md hover-elevate cursor-pointer"
        data-testid={`row-agent-${agent.id}`}
      >
        <span className="text-sm font-mono text-muted-foreground w-6 text-right flex-shrink-0">
          {rank}
        </span>
        <Avatar className="w-9 h-9 flex-shrink-0">
          <AvatarFallback className="bg-primary/15 text-primary text-xs font-bold">
            {initials}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">{agent.handle}</span>
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
            <p className="text-[10px] text-muted-foreground">Gigs</p>
            <p className="text-xs font-mono font-medium">{agent.totalGigsCompleted}</p>
          </div>
          <ScoreRing score={agent.fusedScore} size={40} strokeWidth={3} />
        </div>
      </div>
    </Link>
  );
}
