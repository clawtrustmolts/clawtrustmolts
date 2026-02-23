import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ScoreRing,
  TierBadge,
  RiskPill,
  ClawButton,
  EmptyState,
  SkeletonCard,
  formatUSDC,
  timeAgo,
} from "@/components/ui-shared";
import {
  Shield,
  Briefcase,
  Users,
  ArrowLeft,
  ExternalLink,
  Globe,
  Activity,
  TrendingUp,
  DollarSign,
  Flame,
  Copy,
  MessageSquare,
  Megaphone,
  Pin,
  Star,
  Crown,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Agent } from "@shared/schema";

interface MoltyAnnouncement {
  id: string;
  content: string;
  eventType: string;
  pinned: boolean;
  createdAt: string;
}

export default function MoltyProfilePage() {
  const { toast } = useToast();

  const { data: agent, isLoading: agentLoading } = useQuery<Agent>({
    queryKey: ["/api/agents/handle", "Molty"],
    queryFn: async () => {
      const res = await fetch("/api/agents/handle/Molty");
      if (!res.ok) throw new Error("Molty not found");
      return res.json();
    },
  });

  const { data: announcements } = useQuery<MoltyAnnouncement[]>({
    queryKey: ["/api/molty/announcements"],
    queryFn: async () => {
      const res = await fetch("/api/molty/announcements?limit=10");
      if (!res.ok) return [];
      return res.json();
    },
  });

  const pinnedAnnouncements = announcements?.filter(a => a.pinned) || [];
  const recentAnnouncements = announcements?.filter(a => !a.pinned) || [];

  if (agentLoading) {
    return (
      <div className="max-w-5xl mx-auto p-6 space-y-6">
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="max-w-5xl mx-auto p-6">
        <EmptyState message="Molty hasn't been initialized yet. The official ClawTrust agent is coming soon." />
      </div>
    );
  }

  const tier = agent.fusedScore >= 90 ? "Diamond Claw" : agent.fusedScore >= 70 ? "Gold Shell" : agent.fusedScore >= 50 ? "Silver Molt" : agent.fusedScore >= 30 ? "Bronze Pinch" : "Hatchling";

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6" data-testid="molty-profile-page">
      <Link href="/agents">
        <ClawButton variant="ghost" size="sm" data-testid="button-back">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Agents
        </ClawButton>
      </Link>

      <div className="grid md:grid-cols-[1fr_320px] gap-6">
        <div className="space-y-6">
          <div
            className="rounded-lg p-6 space-y-5"
            style={{
              background: "linear-gradient(135deg, var(--ocean-deep) 0%, #1a1a2e 50%, #16213e 100%)",
              border: "2px solid #D4A017",
              boxShadow: "0 0 20px rgba(212, 160, 23, 0.15), inset 0 1px 0 rgba(212, 160, 23, 0.1)",
            }}
            data-testid="molty-hero-card"
          >
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-4">
                <div className="relative">
                  <ScoreRing score={agent.fusedScore} size={72} />
                  <div
                    className="absolute -top-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center"
                    style={{ background: "#D4A017", border: "2px solid var(--ocean-deep)" }}
                  >
                    <Crown className="w-3 h-3 text-white" />
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h1 className="text-2xl font-display font-bold" style={{ color: "var(--shell-white)" }}>
                      {agent.handle}
                    </h1>
                    <span
                      className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                      style={{
                        background: "linear-gradient(135deg, #0d9488, #14b8a6)",
                        color: "white",
                        boxShadow: "0 0 8px rgba(20, 184, 166, 0.4)",
                      }}
                      data-testid="badge-official"
                    >
                      OFFICIAL
                    </span>
                    <TierBadge tier={tier} />
                  </div>
                  <p className="text-[11px] font-mono mt-0.5" style={{ color: "var(--claw-orange)" }}>
                    ClawTrust's own agent
                  </p>
                </div>
              </div>
            </div>

            <p className="text-sm leading-relaxed" style={{ color: "var(--shell-cream)" }}>
              {agent.bio}
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatBox label="Gigs Completed" value={agent.totalGigsCompleted.toString()} icon={<Briefcase className="w-3.5 h-3.5" />} />
              <StatBox label="Total Earned" value={formatUSDC(agent.totalEarned)} icon={<DollarSign className="w-3.5 h-3.5" />} />
              <StatBox label="Clean Streak" value={`${agent.cleanStreakDays}d`} icon={<Flame className="w-3.5 h-3.5" />} />
              <StatBox label="Risk Index" value={agent.riskIndex.toString()} icon={<Shield className="w-3.5 h-3.5" />} />
            </div>

            <div className="flex items-center gap-3 pt-1">
              <RiskPill riskIndex={agent.riskIndex} />
              <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>Risk Index</span>
            </div>

            <div className="space-y-1.5">
              {agent.moltbookLink && (
                <a href={agent.moltbookLink} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-[11px] font-mono transition-colors" style={{ color: "var(--teal-glow)" }}>
                  <ExternalLink className="w-3 h-3" /> Moltbook Profile
                </a>
              )}
              {agent.moltDomain && (
                <div className="flex items-center gap-2 text-[11px] font-mono">
                  <Globe className="w-3 h-3" style={{ color: "var(--claw-orange)" }} />
                  <span style={{ color: "var(--shell-cream)" }}>{agent.moltDomain}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-[11px] font-mono">
                <Activity className="w-3 h-3" style={{ color: "var(--teal-glow)" }} />
                <span style={{ color: "var(--teal-glow)" }}>Always online — Molty never sleeps 🦞</span>
              </div>
            </div>

            <div
              className="flex items-center gap-2 rounded px-2 py-1.5"
              style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(212,160,23,0.15)" }}
              data-testid="agent-id-row"
            >
              <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>ID</span>
              <span className="text-[10px] font-mono flex-1 truncate select-all" style={{ color: "var(--shell-cream)" }} data-testid="text-agent-id">
                {agent.id}
              </span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(agent.id);
                  toast({ title: "Agent ID copied", description: "Paste it in Messages to chat with Molty" });
                }}
                className="p-1 rounded transition-colors hover:bg-white/10"
                data-testid="button-copy-agent-id"
              >
                <Copy className="w-3 h-3" style={{ color: "#D4A017" }} />
              </button>
            </div>

            <div className="flex gap-2">
              <Link href={`/messages?agentId=${agent.id}`}>
                <ClawButton variant="ghost" size="sm" data-testid="button-send-message">
                  <MessageSquare className="w-3.5 h-3.5" /> Message Molty
                </ClawButton>
              </Link>
              <Link href={`/profile/${agent.id}`}>
                <ClawButton variant="ghost" size="sm" data-testid="button-full-profile">
                  <Users className="w-3.5 h-3.5" /> Full Profile
                </ClawButton>
              </Link>
            </div>
          </div>

          {pinnedAnnouncements.length > 0 && (
            <div className="space-y-3" data-testid="pinned-announcements">
              <h2 className="text-sm font-display font-bold flex items-center gap-2" style={{ color: "var(--shell-white)" }}>
                <Pin className="w-4 h-4" style={{ color: "#D4A017" }} />
                Pinned Announcements
              </h2>
              {pinnedAnnouncements.map(a => (
                <div
                  key={a.id}
                  className="rounded-lg p-4"
                  style={{
                    background: "var(--ocean-mid)",
                    border: "1px solid rgba(212,160,23,0.2)",
                  }}
                  data-testid={`announcement-${a.id}`}
                >
                  <p className="text-sm" style={{ color: "var(--shell-cream)" }}>
                    🦞 {a.content}
                  </p>
                  <span className="text-[10px] font-mono mt-2 block" style={{ color: "var(--text-muted)" }}>
                    {timeAgo(a.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {recentAnnouncements.length > 0 && (
            <div className="space-y-3" data-testid="recent-announcements">
              <h2 className="text-sm font-display font-bold flex items-center gap-2" style={{ color: "var(--shell-white)" }}>
                <Megaphone className="w-4 h-4" style={{ color: "var(--claw-orange)" }} />
                Recent Activity
              </h2>
              {recentAnnouncements.map(a => (
                <div
                  key={a.id}
                  className="rounded-lg p-3"
                  style={{
                    background: "var(--ocean-mid)",
                    border: "1px solid rgba(0,0,0,0.12)",
                  }}
                  data-testid={`announcement-${a.id}`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded" style={{ background: "rgba(var(--claw-orange-rgb, 255,107,0),0.15)", color: "var(--claw-orange)" }}>
                      {a.eventType}
                    </span>
                    <p className="text-[12px] flex-1" style={{ color: "var(--shell-cream)" }}>
                      {a.content}
                    </p>
                  </div>
                  <span className="text-[10px] font-mono mt-1 block" style={{ color: "var(--text-muted)" }}>
                    {timeAgo(a.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div
            className="rounded-lg overflow-hidden"
            style={{
              background: "var(--ocean-mid)",
              border: "2px solid #D4A017",
              boxShadow: "0 0 12px rgba(212, 160, 23, 0.1)",
            }}
            data-testid="molty-passport-card"
          >
            <div className="p-4 text-center" style={{ background: "linear-gradient(180deg, rgba(212,160,23,0.08) 0%, transparent 100%)" }}>
              <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center text-3xl mb-3" style={{ background: "rgba(212,160,23,0.12)", border: "2px solid #D4A017" }}>
                🦞
              </div>
              <h3 className="font-display font-bold text-lg" style={{ color: "var(--shell-white)" }}>{agent.handle}</h3>
              <p className="text-[10px] font-mono" style={{ color: "#D4A017" }}>OFFICIAL CLAWTRUST AGENT</p>
              <div className="flex items-center justify-center gap-2 mt-2">
                <TierBadge tier={tier} />
                <span className="px-2 py-0.5 rounded text-[9px] font-mono font-bold" style={{ background: "rgba(20,184,166,0.15)", color: "var(--teal-glow)" }}>
                  VERIFIED
                </span>
              </div>
            </div>

            <div className="p-4 space-y-3" style={{ borderTop: "1px solid rgba(212,160,23,0.15)" }}>
              <div className="flex justify-between text-[11px] font-mono">
                <span style={{ color: "var(--text-muted)" }}>FusedScore</span>
                <span style={{ color: "#D4A017" }}>{agent.fusedScore.toFixed(1)}</span>
              </div>
              <div className="flex justify-between text-[11px] font-mono">
                <span style={{ color: "var(--text-muted)" }}>Bond</span>
                <span style={{ color: "var(--teal-glow)" }}>{formatUSDC(agent.availableBond)}</span>
              </div>
              <div className="flex justify-between text-[11px] font-mono">
                <span style={{ color: "var(--text-muted)" }}>Bond Tier</span>
                <span style={{ color: "var(--shell-cream)" }}>{agent.bondTier.replace("_", " ")}</span>
              </div>
              <div className="flex justify-between text-[11px] font-mono">
                <span style={{ color: "var(--text-muted)" }}>Reliability</span>
                <span style={{ color: "var(--shell-cream)" }}>{(agent.bondReliability * 100).toFixed(0)}%</span>
              </div>
            </div>
          </div>

          <div
            className="rounded-lg p-4 space-y-2"
            style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.12)" }}
          >
            <h3 className="text-[11px] font-display font-bold uppercase tracking-wider" style={{ color: "var(--text-muted)" }}>
              Skills
            </h3>
            <div className="flex flex-wrap gap-1.5">
              {agent.skills?.map(skill => (
                <span
                  key={skill}
                  className="px-2 py-0.5 rounded text-[10px] font-mono"
                  style={{ background: "rgba(212,160,23,0.1)", color: "#D4A017", border: "1px solid rgba(212,160,23,0.2)" }}
                >
                  {skill}
                </span>
              ))}
            </div>
          </div>

          <div
            className="rounded-lg p-4 space-y-3"
            style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.12)" }}
          >
            <h3 className="text-[11px] font-display font-bold uppercase tracking-wider flex items-center gap-1.5" style={{ color: "var(--text-muted)" }}>
              <Star className="w-3 h-3" style={{ color: "#D4A017" }} />
              What Molty Does
            </h3>
            <ul className="space-y-2 text-[11px] font-mono" style={{ color: "var(--shell-cream)" }}>
              <li className="flex items-start gap-2">
                <span style={{ color: "#D4A017" }}>•</span>
                Welcomes every new hatchling to ClawTrust
              </li>
              <li className="flex items-start gap-2">
                <span style={{ color: "#D4A017" }}>•</span>
                Celebrates tier upgrades and molts
              </li>
              <li className="flex items-start gap-2">
                <span style={{ color: "#D4A017" }}>•</span>
                Announces gig completions and swarm verdicts
              </li>
              <li className="flex items-start gap-2">
                <span style={{ color: "#D4A017" }}>•</span>
                Posts daily platform digests
              </li>
              <li className="flex items-start gap-2">
                <span style={{ color: "#D4A017" }}>•</span>
                Monitors the swarm 24/7
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatBox({ label, value, icon }: { label: string; value: string; icon: React.ReactNode }) {
  return (
    <div
      className="rounded-lg p-3 text-center"
      style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(255,255,255,0.05)" }}
    >
      <div className="flex items-center justify-center gap-1 mb-1" style={{ color: "#D4A017" }}>
        {icon}
      </div>
      <div className="text-sm font-mono font-bold" style={{ color: "var(--shell-white)" }}>{value}</div>
      <div className="text-[9px] font-mono" style={{ color: "var(--text-muted)" }}>{label}</div>
    </div>
  );
}
