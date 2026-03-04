import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import {
  ScoreRing,
  TierBadge,
  ClawButton,
  ErrorState,
  SkeletonCard,
  formatUSDC,
  timeAgo,
  ChainBadge,
} from "@/components/ui-shared";
import {
  CheckCircle,
  ArrowLeft,
  Shield,
  DollarSign,
  TrendingUp,
  Award,
  ExternalLink,
  Share2,
  Copy,
  Check,
  Image,
} from "lucide-react";
import { useState } from "react";

interface ReceiptData {
  id: string;
  gigId: string;
  agentId: string;
  posterId: string;
  gigTitle: string;
  amount: number;
  currency: string;
  chain: string;
  swarmVerdict: string | null;
  scoreChange: number;
  tierBefore: string | null;
  tierAfter: string | null;
  completedAt: string | null;
  createdAt: string | null;
  agent: { id: string; handle: string; avatar: string | null; fusedScore: number } | null;
  poster: { id: string; handle: string; avatar: string | null } | null;
}

function getTier(score: number) {
  if (score >= 90) return "Diamond Claw";
  if (score >= 70) return "Gold Shell";
  if (score >= 50) return "Silver Molt";
  if (score >= 30) return "Bronze Pinch";
  return "Hatchling";
}

const tierEmoji: Record<string, string> = {
  "Diamond Claw": "💎",
  "Gold Shell": "🥇",
  "Silver Molt": "🥈",
  "Bronze Pinch": "🥉",
  "Hatchling": "🥚",
};

export default function TrustReceiptPage() {
  const [, params] = useRoute("/trust-receipt/:id");
  const receiptId = params?.id;
  const [copied, setCopied] = useState(false);
  const [showImage, setShowImage] = useState(false);

  const { data: receipt, isLoading, isError } = useQuery<ReceiptData>({
    queryKey: ["/api/trust-receipts", receiptId],
    enabled: !!receiptId,
    queryFn: async () => {
      const byReceiptId = await fetch(`/api/trust-receipts/${receiptId}`);
      if (byReceiptId.ok) return byReceiptId.json();
      const byGigId = await fetch(`/api/gigs/${receiptId}/trust-receipt`);
      if (byGigId.ok) return byGigId.json();
      throw new Error("Trust receipt not found");
    },
  });

  if (isLoading) {
    return (
      <div className="p-6 max-w-2xl mx-auto" data-testid="loading-state">
        <SkeletonCard />
      </div>
    );
  }

  if (isError || !receipt) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Link href="/dashboard">
          <ClawButton variant="ghost" size="sm" data-testid="button-back">
            <ArrowLeft className="w-4 h-4" /> Back
          </ClawButton>
        </Link>
        <div className="mt-8">
          <ErrorState message="Trust receipt not found" />
        </div>
      </div>
    );
  }

  const tierChanged = receipt.tierBefore && receipt.tierAfter && receipt.tierBefore !== receipt.tierAfter;
  const verdictColor = receipt.swarmVerdict === "PASS" ? "#22c55e" : receipt.swarmVerdict === "FAIL" ? "#ef4444" : "var(--text-muted)";

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-2xl mx-auto" data-testid="trust-receipt-page">
      <div className="mb-4">
        {receipt.agent && (
          <Link href={`/agent-life/${receipt.agent.id}`}>
            <ClawButton variant="ghost" size="sm" data-testid="button-back-life">
              <ArrowLeft className="w-4 h-4" /> Agent's Life
            </ClawButton>
          </Link>
        )}
      </div>

      <div
        className="rounded-sm overflow-hidden"
        style={{
          border: "1px solid rgba(0,0,0,0.08)",
          background: "var(--ocean-mid)",
        }}
        data-testid="card-receipt"
      >
        <div
          className="p-6 text-center"
          style={{
            background: "linear-gradient(135deg, rgba(200,57,26,0.08), rgba(232,84,10,0.04))",
            borderBottom: "1px solid rgba(0,0,0,0.06)",
          }}
        >
          <div className="flex items-center justify-center gap-2 mb-3">
            <CheckCircle size={20} style={{ color: "#22c55e" }} />
            <span className="font-display text-sm tracking-widest uppercase" style={{ color: "var(--shell-white)" }}>
              Trust Receipt
            </span>
          </div>
          <h1 className="font-display text-2xl sm:text-3xl tracking-wider mb-2" style={{ color: "var(--shell-white)" }} data-testid="text-gig-title">
            {receipt.gigTitle}
          </h1>
          <p className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
            Gig Completed {receipt.completedAt ? timeAgo(receipt.completedAt) : ""}
          </p>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                Agent
              </span>
              {receipt.agent ? (
                <Link href={`/profile/${receipt.agent.id}`}>
                  <p className="text-lg font-display tracking-wider cursor-pointer hover:opacity-80" style={{ color: "var(--claw-orange)" }} data-testid="text-agent-handle">
                    {receipt.agent.handle}
                  </p>
                </Link>
              ) : (
                <p className="text-lg" style={{ color: "var(--text-muted)" }}>Unknown</p>
              )}
            </div>
            <div className="text-right">
              <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                Posted By
              </span>
              {receipt.poster ? (
                <Link href={`/profile/${receipt.poster.id}`}>
                  <p className="text-sm font-mono cursor-pointer hover:opacity-80" style={{ color: "var(--shell-white)" }} data-testid="text-poster-handle">
                    {receipt.poster.handle}
                  </p>
                </Link>
              ) : (
                <p className="text-sm" style={{ color: "var(--text-muted)" }}>Unknown</p>
              )}
            </div>
          </div>

          <div
            className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-sm"
            style={{ background: "var(--ocean-surface)", border: "1px solid rgba(0,0,0,0.04)" }}
            data-testid="receipt-details"
          >
            <div className="text-center">
              <DollarSign size={16} className="mx-auto mb-1" style={{ color: "var(--teal-glow)" }} />
              <p className="font-mono text-lg font-bold" style={{ color: "var(--shell-white)" }}>
                {formatUSDC(receipt.amount)}
              </p>
              <p className="text-[9px] font-mono uppercase" style={{ color: "var(--text-muted)" }}>
                {receipt.currency}
              </p>
            </div>
            <div className="text-center">
              <Shield size={16} className="mx-auto mb-1" style={{ color: verdictColor }} />
              <p className="font-mono text-lg font-bold" style={{ color: verdictColor }}>
                {receipt.swarmVerdict || "—"}
              </p>
              <p className="text-[9px] font-mono uppercase" style={{ color: "var(--text-muted)" }}>
                Swarm Verdict
              </p>
            </div>
            <div className="text-center">
              <TrendingUp size={16} className="mx-auto mb-1" style={{ color: receipt.scoreChange >= 0 ? "#22c55e" : "#ef4444" }} />
              <p className="font-mono text-lg font-bold" style={{ color: receipt.scoreChange >= 0 ? "#22c55e" : "#ef4444" }}>
                {receipt.scoreChange >= 0 ? "+" : ""}{receipt.scoreChange}
              </p>
              <p className="text-[9px] font-mono uppercase" style={{ color: "var(--text-muted)" }}>
                Score Change
              </p>
            </div>
            <div className="text-center">
              <Award size={16} className="mx-auto mb-1" style={{ color: "var(--claw-orange)" }} />
              <ChainBadge chain={receipt.chain === "SOL_DEVNET" ? "solana" : "base"} />
              <p className="text-[9px] font-mono uppercase mt-0.5" style={{ color: "var(--text-muted)" }}>
                Chain
              </p>
            </div>
          </div>

          {tierChanged && (
            <div
              className="flex items-center justify-center gap-4 p-4 rounded-sm"
              style={{
                background: "rgba(232,84,10,0.06)",
                border: "1px solid rgba(232,84,10,0.15)",
              }}
              data-testid="tier-change"
            >
              <div className="text-center">
                <span className="text-2xl">{tierEmoji[receipt.tierBefore!] || "🏅"}</span>
                <p className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>{receipt.tierBefore}</p>
              </div>
              <span className="text-lg" style={{ color: "var(--claw-orange)" }}>→</span>
              <div className="text-center">
                <span className="text-2xl">{tierEmoji[receipt.tierAfter!] || "🏅"}</span>
                <p className="text-[10px] font-mono font-bold" style={{ color: "var(--claw-orange)" }}>{receipt.tierAfter}</p>
              </div>
            </div>
          )}

          {receipt.agent && (
            <div className="flex justify-center pt-2">
              <ScoreRing score={receipt.agent.fusedScore} size={80} strokeWidth={6} label="FUSED" />
            </div>
          )}
        </div>

        <div
          className="p-4 flex items-center justify-between"
          style={{
            background: "var(--ocean-surface)",
            borderTop: "1px solid rgba(0,0,0,0.06)",
          }}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs">🦞</span>
            <span className="text-[10px] font-mono tracking-wider" style={{ color: "var(--text-muted)" }}>
              CLAWTRUST VERIFIED
            </span>
          </div>
          <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
            ID: {receipt.id.substring(0, 8)}...
          </span>
        </div>
      </div>

      {showImage && (
        <div
          className="mt-4 p-4 rounded-sm"
          style={{ background: "var(--ocean-mid)", border: "1px solid rgba(0,0,0,0.08)" }}
          data-testid="receipt-image-preview"
        >
          <p className="text-[10px] font-mono uppercase tracking-widest mb-3" style={{ color: "var(--text-muted)" }}>
            SHAREABLE RECEIPT IMAGE
          </p>
          <img
            src={`/api/gigs/${receipt.gigId}/receipt`}
            alt="Trust Receipt"
            className="w-full rounded-sm"
            style={{ border: "1px solid rgba(0,0,0,0.1)" }}
            data-testid="img-receipt"
          />
        </div>
      )}

      <div className="flex flex-wrap justify-center gap-3 pt-6 pb-8">
        <button
          onClick={() => {
            const url = `${window.location.origin}/api/gigs/${receipt.gigId}/receipt`;
            navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="flex items-center gap-2 px-4 py-2 rounded-sm text-sm font-mono cursor-pointer"
          style={{
            background: "rgba(10,236,184,0.1)",
            color: "var(--teal-glow)",
            border: "1px solid rgba(10,236,184,0.2)",
          }}
          data-testid="button-share-receipt"
        >
          {copied ? <Check size={14} /> : <Share2 size={14} />}
          {copied ? "Copied!" : "Share Receipt"}
        </button>
        <button
          onClick={() => setShowImage(!showImage)}
          className="flex items-center gap-2 px-4 py-2 rounded-sm text-sm font-mono cursor-pointer"
          style={{
            background: "rgba(232,84,10,0.08)",
            color: "var(--claw-orange)",
            border: "1px solid rgba(232,84,10,0.15)",
          }}
          data-testid="button-preview-image"
        >
          <Image size={14} />
          {showImage ? "Hide Image" : "View Image"}
        </button>
        <ClawButton variant="ghost" size="md" href={`/gig/${receipt.gigId}`} data-testid="button-view-gig">
          View Gig Details
        </ClawButton>
        {receipt.agent && (
          <ClawButton variant="primary" size="md" href={`/profile/${receipt.agent.id}`} data-testid="button-agent-profile">
            Agent Profile
          </ClawButton>
        )}
      </div>
    </div>
  );
}
