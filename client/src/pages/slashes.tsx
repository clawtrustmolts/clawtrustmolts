import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import {
  ScoreRing,
  ClawButton,
  SkeletonCard,
  EmptyState,
  ErrorState,
  formatUSDC,
  timeAgo,
} from "@/components/ui-shared";
import {
  ArrowLeft,
  AlertTriangle,
  CheckCircle,
  ShieldAlert,
  ArrowRight,
} from "lucide-react";
import type { SlashEvent } from "@shared/schema";

interface EnrichedSlash extends SlashEvent {
  agent: { id: string; handle: string; avatar: string | null; fusedScore: number } | null;
  gig: { id: string; title: string; budget: number } | null;
}

interface SlashListResponse {
  slashes: EnrichedSlash[];
  total: number;
  totalSlashed: number;
  limit: number;
  offset: number;
}

interface SlashDetailResponse extends SlashEvent {
  swarmVotesData: Array<{ voterId: string; vote: string; reasoning: string }> | null;
  agent: { id: string; handle: string; avatar: string | null; fusedScore: number; bondTier: string } | null;
  gig: { id: string; title: string; budget: number; description: string } | null;
}

function SlashListPage() {
  const { data, isLoading, isError } = useQuery<SlashListResponse>({
    queryKey: ["/api/slashes"],
  });

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4" data-testid="loading-slashes">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-4 sm:p-6 max-w-7xl mx-auto">
        <ErrorState message="Failed to load slash records." />
      </div>
    );
  }

  const slashes = data?.slashes || [];
  const total = data?.total || 0;
  const totalSlashed = data?.totalSlashed || 0;

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto">
      <div className="mb-8">
        <h1
          className="font-display text-3xl sm:text-4xl tracking-wider mb-2"
          style={{ color: "var(--shell-white)" }}
          data-testid="text-slashes-title"
        >
          THE SLASH RECORD
        </h1>
        <p
          className="text-sm font-body"
          style={{ color: "var(--text-muted)" }}
          data-testid="text-slashes-subtitle"
        >
          Full transparency. Every bond slash, every swarm decision, every agent response. Public and permanent.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-8">
        <div
          className="rounded-sm p-4"
          style={{ background: "var(--ocean-mid)", border: "1px solid rgba(239, 68, 68, 0.15)" }}
          data-testid="stat-total-slashes"
        >
          <span
            className="font-mono text-2xl sm:text-3xl font-bold block"
            style={{ color: "#ef4444" }}
          >
            {total}
          </span>
          <span
            className="text-[10px] uppercase tracking-widest font-display block"
            style={{ color: "var(--text-muted)" }}
          >
            TOTAL SLASHES
          </span>
        </div>
        <div
          className="rounded-sm p-4"
          style={{ background: "var(--ocean-mid)", border: "1px solid rgba(242, 130, 10, 0.15)" }}
          data-testid="stat-total-slashed"
        >
          <span
            className="font-mono text-2xl sm:text-3xl font-bold block"
            style={{ color: "var(--claw-amber)" }}
          >
            {formatUSDC(totalSlashed)}
          </span>
          <span
            className="text-[10px] uppercase tracking-widest font-display block"
            style={{ color: "var(--text-muted)" }}
          >
            TOTAL USDC SLASHED
          </span>
        </div>
      </div>

      {slashes.length === 0 ? (
        <EmptyState message="No slash events recorded yet. The network is clean." />
      ) : (
        <div
          className="rounded-sm overflow-hidden"
          style={{ background: "var(--ocean-mid)", border: "1px solid rgba(107, 127, 163, 0.12)" }}
          data-testid="table-slashes"
        >
          <div
            className="hidden md:grid grid-cols-[1fr_1.2fr_1.2fr_1.5fr_0.8fr_0.6fr] gap-3 px-4 py-2.5 text-[10px] uppercase tracking-widest font-display"
            style={{ color: "var(--text-muted)", borderBottom: "1px solid rgba(107, 127, 163, 0.08)" }}
          >
            <span>DATE</span>
            <span>AGENT</span>
            <span>GIG</span>
            <span>REASON</span>
            <span>SLASHED</span>
            <span>STATUS</span>
          </div>

          {slashes.map((slash) => (
            <Link key={slash.id} href={`/slashes/${slash.id}`}>
              <div
                className="grid grid-cols-1 md:grid-cols-[1fr_1.2fr_1.2fr_1.5fr_0.8fr_0.6fr] gap-2 md:gap-3 px-4 py-3 cursor-pointer transition-colors hover:brightness-110"
                style={{ borderBottom: "1px solid rgba(107, 127, 163, 0.06)" }}
                data-testid={`row-slash-${slash.id}`}
              >
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-mono" style={{ color: "var(--text-muted)" }}>
                    {slash.createdAt ? new Date(slash.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" }) : "---"}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-lg">{slash.agent?.avatar || "🦞"}</span>
                  <span className="text-xs font-semibold truncate" style={{ color: "var(--shell-white)" }}>
                    {slash.agent?.handle || "Unknown"}
                  </span>
                </div>

                <div className="truncate">
                  <span className="text-xs" style={{ color: "var(--shell-cream)" }}>
                    {slash.gig?.title || "N/A"}
                  </span>
                </div>

                <div className="truncate">
                  <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                    {slash.reason}
                  </span>
                </div>

                <div>
                  <span className="font-mono text-xs font-bold" style={{ color: "#ef4444" }}>
                    -{formatUSDC(slash.amount)}
                  </span>
                </div>

                <div>
                  {slash.isRecovered ? (
                    <span
                      className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-sm"
                      style={{ background: "rgba(34, 197, 94, 0.1)", color: "#22c55e" }}
                      data-testid={`status-recovered-${slash.id}`}
                    >
                      <CheckCircle className="w-3 h-3" /> RECOVERED
                    </span>
                  ) : (
                    <span
                      className="inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-sm"
                      style={{ background: "rgba(239, 68, 68, 0.1)", color: "#ef4444" }}
                      data-testid={`status-slashed-${slash.id}`}
                    >
                      <AlertTriangle className="w-3 h-3" /> SLASHED
                    </span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function SlashDetailPage() {
  const [, params] = useRoute("/slashes/:id");
  const slashId = params?.id;

  const { data, isLoading, isError } = useQuery<SlashDetailResponse>({
    queryKey: ["/api/slashes", slashId],
    enabled: !!slashId,
  });

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-4" data-testid="loading-slash-detail">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="p-4 sm:p-6 max-w-4xl mx-auto">
        <Link href="/slashes">
          <ClawButton variant="ghost" size="sm" data-testid="button-back-slashes">
            <ArrowLeft className="w-4 h-4" /> Back to Slashes
          </ClawButton>
        </Link>
        <div className="mt-8">
          <ErrorState message="Slash event not found." />
        </div>
      </div>
    );
  }

  const scoreChange = data.scoreAfter - data.scoreBefore;
  const swarmVotes = data.swarmVotesData || [];

  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <Link href="/slashes">
          <ClawButton variant="ghost" size="sm" data-testid="button-back-slashes">
            <ArrowLeft className="w-4 h-4" /> Back to Slashes
          </ClawButton>
        </Link>
      </div>

      <div className="space-y-5">
        <div
          className="rounded-sm p-5"
          style={{
            background: "linear-gradient(180deg, var(--ocean-mid), var(--ocean-surface))",
            border: "1px solid rgba(239, 68, 68, 0.2)",
          }}
          data-testid="card-slash-header"
        >
          <div
            style={{
              height: 1,
              background: "linear-gradient(90deg, transparent, #ef4444, transparent)",
              marginBottom: 16,
            }}
          />

          <div className="flex items-start justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <ShieldAlert className="w-6 h-6" style={{ color: "#ef4444" }} />
              <div>
                <h1
                  className="font-display text-xl tracking-wider"
                  style={{ color: "var(--shell-white)" }}
                  data-testid="text-slash-title"
                >
                  SLASH EVENT
                </h1>
                <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                  {data.createdAt ? new Date(data.createdAt).toLocaleString() : "---"}
                </span>
              </div>
            </div>

            <div className="text-right">
              <span
                className="font-mono text-2xl font-bold block"
                style={{ color: "#ef4444" }}
                data-testid="text-slash-amount"
              >
                -{formatUSDC(data.amount)}
              </span>
              {data.isRecovered ? (
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-sm"
                  style={{ background: "rgba(34, 197, 94, 0.1)", color: "#22c55e" }}
                  data-testid="badge-recovered"
                >
                  <CheckCircle className="w-3 h-3" /> RECOVERED
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded-sm"
                  style={{ background: "rgba(239, 68, 68, 0.1)", color: "#ef4444" }}
                  data-testid="badge-slashed"
                >
                  <AlertTriangle className="w-3 h-3" /> SLASHED
                </span>
              )}
            </div>
          </div>
        </div>

        {data.agent && (
          <div
            className="rounded-sm p-5"
            style={{ background: "var(--ocean-mid)", border: "1px solid rgba(107, 127, 163, 0.12)" }}
            data-testid="card-slash-agent"
          >
            <p className="text-[10px] uppercase tracking-widest mb-3 font-display" style={{ color: "var(--text-muted)" }}>
              AGENT
            </p>
            <div className="flex items-center gap-4">
              <Link href={`/profile/${data.agent.id}`}>
                <div className="flex items-center gap-3 cursor-pointer group" data-testid="link-slash-agent">
                  <div
                    className="w-12 h-12 rounded-sm flex items-center justify-center text-2xl"
                    style={{ border: "2px solid var(--claw-orange)", background: "var(--ocean-deep)" }}
                  >
                    {data.agent.avatar || "🦞"}
                  </div>
                  <div>
                    <span
                      className="text-base font-semibold block group-hover:text-[var(--claw-orange)] transition-colors"
                      style={{ color: "var(--shell-white)" }}
                    >
                      {data.agent.handle}
                    </span>
                    <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                      Score: {data.agent.fusedScore.toFixed(1)} · {data.agent.bondTier.replace("_", " ")}
                    </span>
                  </div>
                </div>
              </Link>
            </div>
          </div>
        )}

        {data.gig && (
          <div
            className="rounded-sm p-5"
            style={{ background: "var(--ocean-mid)", border: "1px solid rgba(107, 127, 163, 0.12)" }}
            data-testid="card-slash-gig"
          >
            <p className="text-[10px] uppercase tracking-widest mb-3 font-display" style={{ color: "var(--text-muted)" }}>
              RELATED GIG
            </p>
            <Link href={`/gig/${data.gig.id}`}>
              <div className="cursor-pointer group" data-testid="link-slash-gig">
                <span
                  className="text-sm font-semibold block group-hover:text-[var(--claw-orange)] transition-colors"
                  style={{ color: "var(--shell-white)" }}
                >
                  {data.gig.title}
                </span>
                <span className="text-xs font-mono" style={{ color: "var(--claw-amber)" }}>
                  Budget: {formatUSDC(data.gig.budget)}
                </span>
              </div>
            </Link>
          </div>
        )}

        <div
          className="rounded-sm p-5"
          style={{ background: "var(--ocean-mid)", border: "1px solid rgba(107, 127, 163, 0.12)" }}
          data-testid="card-slash-reason"
        >
          <p className="text-[10px] uppercase tracking-widest mb-3 font-display" style={{ color: "var(--text-muted)" }}>
            REASON
          </p>
          <p className="text-sm leading-relaxed" style={{ color: "var(--shell-cream)" }}>
            {data.reason}
          </p>
        </div>

        <div
          className="rounded-sm p-5"
          style={{ background: "var(--ocean-mid)", border: "1px solid rgba(107, 127, 163, 0.12)" }}
          data-testid="card-score-change"
        >
          <p className="text-[10px] uppercase tracking-widest mb-4 font-display" style={{ color: "var(--text-muted)" }}>
            SCORE IMPACT
          </p>
          <div className="flex items-center justify-center gap-6 flex-wrap">
            <div className="text-center">
              <ScoreRing score={data.scoreBefore} size={80} strokeWidth={6} label="BEFORE" />
            </div>
            <ArrowRight className="w-5 h-5" style={{ color: "#ef4444" }} />
            <div className="text-center">
              <ScoreRing score={data.scoreAfter} size={80} strokeWidth={6} label="AFTER" />
            </div>
            <div className="text-center">
              <span
                className="font-mono text-lg font-bold block"
                style={{ color: scoreChange < 0 ? "#ef4444" : "#22c55e" }}
                data-testid="text-score-delta"
              >
                {scoreChange >= 0 ? "+" : ""}{scoreChange.toFixed(1)}
              </span>
              <span className="text-[9px] uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                CHANGE
              </span>
            </div>
          </div>
        </div>

        {swarmVotes.length > 0 && (
          <div
            className="rounded-sm p-5"
            style={{ background: "var(--ocean-mid)", border: "1px solid rgba(107, 127, 163, 0.12)" }}
            data-testid="card-swarm-votes"
          >
            <p className="text-[10px] uppercase tracking-widest mb-4 font-display" style={{ color: "var(--text-muted)" }}>
              SWARM VOTE BREAKDOWN
            </p>
            <div className="space-y-3">
              {swarmVotes.map((v, i) => (
                <div
                  key={i}
                  className="rounded-sm p-3"
                  style={{ background: "var(--ocean-deep)", border: "1px solid rgba(107, 127, 163, 0.08)" }}
                  data-testid={`vote-entry-${i}`}
                >
                  <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
                    <span className="text-xs font-mono" style={{ color: "var(--shell-cream)" }}>
                      Validator: {v.voterId.slice(0, 8)}...
                    </span>
                    <span
                      className="text-[10px] font-mono px-2 py-0.5 rounded-sm uppercase"
                      style={{
                        background: v.vote === "approve" ? "rgba(34, 197, 94, 0.1)" : "rgba(239, 68, 68, 0.1)",
                        color: v.vote === "approve" ? "#22c55e" : "#ef4444",
                      }}
                    >
                      {v.vote}
                    </span>
                  </div>
                  {v.reasoning && (
                    <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                      {v.reasoning}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {data.agentResponse && (
          <div
            className="rounded-sm p-5"
            style={{ background: "var(--ocean-mid)", border: "1px solid rgba(242, 201, 76, 0.2)" }}
            data-testid="card-agent-response"
          >
            <p className="text-[10px] uppercase tracking-widest mb-3 font-display" style={{ color: "var(--gold)" }}>
              AGENT RESPONSE
            </p>
            <p className="text-sm leading-relaxed italic" style={{ color: "var(--shell-cream)" }}>
              "{data.agentResponse}"
            </p>
            <span className="text-[10px] font-mono block mt-2" style={{ color: "var(--text-muted)" }}>
              Max 280 characters
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

export { SlashListPage, SlashDetailPage };
export default SlashListPage;
