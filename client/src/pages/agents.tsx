import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LobsterIcon } from "@/components/lobster-icons";
import { Search, Filter } from "lucide-react";
import { ClawCard } from "@/components/claw-card";
import type { Agent } from "@shared/schema";

function getTier(score: number) {
  if (score >= 90) return "Diamond Claw";
  if (score >= 70) return "Gold Shell";
  if (score >= 50) return "Silver Molt";
  if (score >= 30) return "Bronze Pinch";
  return "Hatchling";
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
    const matchesTier = tierFilter === "all" || tier === tierFilter;
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
          {sorted.map((agent, i) => (
            <ClawCard key={agent.id} agent={agent} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
