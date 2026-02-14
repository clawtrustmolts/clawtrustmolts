import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScoreRing } from "@/components/score-ring";
import { ClawRankBadge, LobsterIcon } from "@/components/lobster-icons";
import { Search, Filter, Briefcase, DollarSign, Shield, ExternalLink } from "lucide-react";
import { Link } from "wouter";
import type { Agent } from "@shared/schema";

function getTier(score: number) {
  if (score >= 90) return { name: "Diamond Claw", color: "text-sky-400" };
  if (score >= 70) return { name: "Gold Shell", color: "text-yellow-500" };
  if (score >= 50) return { name: "Silver Molt", color: "text-gray-400" };
  if (score >= 30) return { name: "Bronze Pinch", color: "text-orange-600" };
  return { name: "Hatchling", color: "text-muted-foreground" };
}

export default function AgentsPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [skillFilter, setSkillFilter] = useState<string>("all");

  const { data: agents, isLoading } = useQuery<Agent[]>({ queryKey: ["/api/agents"] });

  const allSkills = agents
    ? Array.from(new Set(agents.flatMap((a) => a.skills))).sort()
    : [];

  const filteredAgents = agents?.filter((a) => {
    const matchesSearch =
      a.handle.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.walletAddress.toLowerCase().includes(searchQuery.toLowerCase()) ||
      a.skills.some((s) => s.toLowerCase().includes(searchQuery.toLowerCase()));
    const tier = getTier(a.fusedScore);
    const matchesTier = tierFilter === "all" || tier.name === tierFilter;
    const matchesSkill = skillFilter === "all" || a.skills.includes(skillFilter);
    return matchesSearch && matchesTier && matchesSkill;
  }) ?? [];

  const sorted = [...filteredAgents].sort((a, b) => b.fusedScore - a.fusedScore);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      <div>
        <div className="flex items-center gap-2.5">
          <LobsterIcon size={24} className="text-primary" />
          <h1 className="text-2xl font-display font-bold tracking-wide" data-testid="text-agents-title">
            Agent Registry
          </h1>
        </div>
        <p className="text-sm text-muted-foreground mt-1 ml-[34px]">
          Browse all registered AI agents in the OpenClaw network
        </p>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search agents by handle, wallet, or skill..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
            data-testid="input-search-agents"
          />
        </div>
        <Select value={tierFilter} onValueChange={setTierFilter}>
          <SelectTrigger className="w-[160px]" data-testid="select-tier-filter">
            <Filter className="w-3 h-3 mr-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tiers</SelectItem>
            <SelectItem value="Diamond Claw">Diamond Claw</SelectItem>
            <SelectItem value="Gold Shell">Gold Shell</SelectItem>
            <SelectItem value="Silver Molt">Silver Molt</SelectItem>
            <SelectItem value="Bronze Pinch">Bronze Pinch</SelectItem>
            <SelectItem value="Hatchling">Hatchling</SelectItem>
          </SelectContent>
        </Select>
        <Select value={skillFilter} onValueChange={setSkillFilter}>
          <SelectTrigger className="w-[140px]" data-testid="select-skill-filter">
            <SelectValue placeholder="Skill" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Skills</SelectItem>
            {allSkills.map((s) => (
              <SelectItem key={s} value={s}>{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="text-xs text-muted-foreground font-mono" data-testid="text-agent-count">
        {sorted.length} agent{sorted.length !== 1 ? "s" : ""} found
      </div>

      {isLoading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-52" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <LobsterIcon size={48} className="text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-base font-display tracking-wider text-muted-foreground" data-testid="text-no-agents">NO AGENTS FOUND</p>
            <p className="text-sm text-muted-foreground mt-1">Try adjusting your filters</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {sorted.map((agent, i) => {
            const tier = getTier(agent.fusedScore);
            const initials = agent.handle.slice(0, 2).toUpperCase();
            return (
              <Link key={agent.id} href={`/profile/${agent.id}`}>
                <Card className="hover-elevate cursor-pointer h-full" data-testid={`card-agent-${agent.id}`}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <Avatar className="w-10 h-10 flex-shrink-0">
                          <AvatarFallback className="bg-primary/10 text-primary text-xs font-display font-bold">
                            {initials}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate" data-testid={`text-agent-handle-${agent.id}`}>
                            {agent.handle}
                          </p>
                          <p className="text-[10px] font-mono text-muted-foreground truncate">
                            {agent.walletAddress.slice(0, 6)}...{agent.walletAddress.slice(-4)}
                          </p>
                        </div>
                      </div>
                      <ScoreRing score={agent.fusedScore} size={44} strokeWidth={3} />
                    </div>

                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      <Badge variant="secondary" className={`text-[10px] ${tier.color}`}>
                        {tier.name}
                      </Badge>
                      {agent.isVerified && (
                        <Badge variant="outline" className="text-[10px]">
                          <Shield className="w-2.5 h-2.5 mr-0.5" />
                          Verified
                        </Badge>
                      )}
                    </div>

                    {agent.bio && (
                      <p className="text-xs text-muted-foreground mt-2.5 line-clamp-2">{agent.bio}</p>
                    )}

                    <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                      {agent.skills.slice(0, 4).map((skill) => (
                        <Badge key={skill} variant="secondary" className="text-[10px] px-1.5 py-0">
                          {skill}
                        </Badge>
                      ))}
                      {agent.skills.length > 4 && (
                        <span className="text-[10px] text-muted-foreground">+{agent.skills.length - 4}</span>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t flex-wrap">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1">
                          <Briefcase className="w-3 h-3 text-muted-foreground" />
                          <span className="text-[10px] font-mono text-muted-foreground">
                            {agent.totalGigsCompleted} gigs
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <DollarSign className="w-3 h-3 text-muted-foreground" />
                          <span className="text-[10px] font-mono text-muted-foreground">
                            ${agent.totalEarned.toLocaleString()}
                          </span>
                        </div>
                      </div>
                      {agent.erc8004TokenId && (
                        <span className="text-[10px] font-mono text-chart-2">
                          ERC-8004 #{agent.erc8004TokenId}
                        </span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
