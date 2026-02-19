import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, Shield, TrendingDown, TrendingUp, Minus, Flame, Clock, Zap } from "lucide-react";

interface RiskBreakdown {
  slashComponent: number;
  failedGigComponent: number;
  disputeComponent: number;
  inactivityComponent: number;
  bondDepletionComponent: number;
  cleanStreakBonus: number;
  rawScore: number;
  finalScore: number;
}

interface RiskEvent {
  id: string;
  factor: string;
  delta: number;
  details: string | null;
  createdAt: string;
}

interface RiskProfile {
  agentId: string;
  handle: string;
  riskIndex: number;
  riskLevel: string;
  breakdown: RiskBreakdown;
  trend: "improving" | "stable" | "worsening";
  cleanStreakDays: number;
  feeMultiplier: number;
  lastUpdated: string | null;
  recentEvents: RiskEvent[];
}

const RISK_LEVEL_CONFIG: Record<string, { label: string; className: string; icon: typeof Shield }> = {
  low: { label: "Low Risk", className: "bg-chart-2/15 text-chart-2", icon: Shield },
  medium: { label: "Medium Risk", className: "bg-chart-3/15 text-chart-3", icon: AlertTriangle },
  high: { label: "High Risk", className: "bg-destructive/15 text-destructive", icon: Flame },
};

const TREND_CONFIG: Record<string, { label: string; icon: typeof TrendingUp; className: string }> = {
  improving: { label: "Improving", icon: TrendingDown, className: "text-chart-2" },
  stable: { label: "Stable", icon: Minus, className: "text-muted-foreground" },
  worsening: { label: "Worsening", icon: TrendingUp, className: "text-destructive" },
};

const FACTOR_CONFIG: Record<string, { label: string; className: string }> = {
  SLASH: { label: "Slash", className: "text-destructive" },
  FAILED_GIG: { label: "Failed Gig", className: "text-destructive" },
  DISPUTE_OPENED: { label: "Dispute Opened", className: "text-chart-3" },
  DISPUTE_RESOLVED: { label: "Dispute Resolved", className: "text-chart-2" },
  INACTIVITY: { label: "Inactivity", className: "text-muted-foreground" },
  BOND_DEPLETION: { label: "Bond Depletion", className: "text-chart-3" },
};

interface RiskPanelProps {
  agentId: string;
}

function RiskMeter({ value, max = 100 }: { value: number; max?: number }) {
  const pct = Math.min((value / max) * 100, 100);
  let barColor = "bg-chart-2";
  if (value > 25) barColor = "bg-chart-3";
  if (value > 60) barColor = "bg-destructive";

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground font-mono">0</span>
        <span className="text-xs font-display tracking-wider text-muted-foreground">RISK INDEX</span>
        <span className="text-xs text-muted-foreground font-mono">100</span>
      </div>
      <div className="w-full h-3 bg-muted rounded-md overflow-hidden" data-testid="bar-risk-index">
        <div
          className={`h-full ${barColor} rounded-md transition-all duration-500`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function BreakdownRow({ label, value, max, icon: Icon }: { label: string; value: number; max: number; icon: typeof AlertTriangle }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <Icon className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
      <span className="text-xs text-muted-foreground w-28 flex-shrink-0">{label}</span>
      <div className="flex-1 h-1.5 bg-muted rounded-md overflow-hidden">
        <div
          className="h-full bg-foreground/30 rounded-md transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-mono w-8 text-right">{value.toFixed(1)}</span>
    </div>
  );
}

export function RiskPanel({ agentId }: RiskPanelProps) {
  const { data: risk, isLoading } = useQuery<RiskProfile>({
    queryKey: ["/api/risk", agentId],
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="p-5 space-y-4">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-3 w-full" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!risk) {
    return (
      <Card>
        <CardContent className="p-5 text-center py-10">
          <Shield className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Risk data unavailable</p>
        </CardContent>
      </Card>
    );
  }

  const levelConfig = RISK_LEVEL_CONFIG[risk.riskLevel] || RISK_LEVEL_CONFIG.low;
  const trendConfig = TREND_CONFIG[risk.trend] || TREND_CONFIG.stable;
  const LevelIcon = levelConfig.icon;
  const TrendIcon = trendConfig.icon;

  return (
    <div className="space-y-3" data-testid="risk-panel">
      <Card data-testid="card-risk-status">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-display tracking-wider flex items-center gap-2 flex-wrap">
            <LevelIcon className="w-4 h-4" />
            RISK ENGINE
            <Badge className={levelConfig.className} data-testid="badge-risk-level">
              {levelConfig.label}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <span className="text-3xl font-display font-bold" data-testid="text-risk-index">{risk.riskIndex}</span>
              <span className="text-sm text-muted-foreground">/100</span>
            </div>
            <div className="flex items-center gap-1.5">
              <TrendIcon className={`w-4 h-4 ${trendConfig.className}`} />
              <span className={`text-xs font-mono ${trendConfig.className}`} data-testid="text-risk-trend">{trendConfig.label}</span>
            </div>
          </div>

          <RiskMeter value={risk.riskIndex} />

          <div className="grid grid-cols-2 gap-3 pt-1">
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 mb-0.5">
                <Clock className="w-3 h-3 text-chart-2" />
                <span className="text-xs text-muted-foreground">Clean Streak</span>
              </div>
              <span className="text-lg font-display font-bold" data-testid="text-clean-streak">{risk.cleanStreakDays}</span>
              <span className="text-xs text-muted-foreground ml-1">days</span>
              {risk.cleanStreakDays >= 30 && (
                <Badge variant="secondary" className="text-[9px] ml-1.5">-10% RISK</Badge>
              )}
            </div>
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 mb-0.5">
                <Zap className="w-3 h-3 text-chart-3" />
                <span className="text-xs text-muted-foreground">Fee Rate</span>
              </div>
              <span className="text-lg font-display font-bold" data-testid="text-fee-multiplier">{(risk.feeMultiplier * 100).toFixed(0)}%</span>
              {risk.feeMultiplier < 1 && (
                <Badge variant="secondary" className="text-[9px] ml-1.5">DISCOUNT</Badge>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-risk-breakdown">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-display tracking-wider">RISK BREAKDOWN</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2.5">
          <BreakdownRow label="Slashes" value={risk.breakdown.slashComponent} max={45} icon={AlertTriangle} />
          <BreakdownRow label="Failed Gigs" value={risk.breakdown.failedGigComponent} max={25} icon={AlertTriangle} />
          <BreakdownRow label="Disputes" value={risk.breakdown.disputeComponent} max={40} icon={AlertTriangle} />
          <BreakdownRow label="Inactivity" value={risk.breakdown.inactivityComponent} max={10} icon={Clock} />
          <BreakdownRow label="Bond Depletion" value={risk.breakdown.bondDepletionComponent} max={20} icon={TrendingDown} />

          {risk.breakdown.cleanStreakBonus > 0 && (
            <div className="flex items-center gap-3 pt-1 border-t">
              <Shield className="w-3.5 h-3.5 text-chart-2 flex-shrink-0" />
              <span className="text-xs text-chart-2 w-28 flex-shrink-0">Streak Bonus</span>
              <div className="flex-1" />
              <span className="text-xs font-mono text-chart-2 w-8 text-right">-{risk.breakdown.cleanStreakBonus.toFixed(1)}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {risk.recentEvents.length > 0 && (
        <Card data-testid="card-risk-events">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-display tracking-wider">RECENT RISK EVENTS</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {risk.recentEvents.map((event) => {
              const factorConf = FACTOR_CONFIG[event.factor] || { label: event.factor, className: "text-muted-foreground" };
              return (
                <div key={event.id} className="flex items-center gap-3 p-2 rounded-md hover-elevate" data-testid={`risk-event-${event.id}`}>
                  <div className={`text-xs font-mono ${event.delta >= 0 ? "text-destructive" : "text-chart-2"} w-10 text-right flex-shrink-0`}>
                    {event.delta >= 0 ? "+" : ""}{event.delta.toFixed(1)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <Badge variant="secondary" className={`text-[9px] ${factorConf.className}`}>{factorConf.label}</Badge>
                    {event.details && (
                      <p className="text-[10px] text-muted-foreground truncate mt-0.5">{event.details}</p>
                    )}
                  </div>
                  <span className="text-[10px] text-muted-foreground flex-shrink-0">
                    {new Date(event.createdAt).toLocaleDateString()}
                  </span>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export function RiskBadge({ agentId }: { agentId: string }) {
  const { data: risk } = useQuery<RiskProfile>({
    queryKey: ["/api/risk", agentId],
  });

  if (!risk) return null;

  const levelConfig = RISK_LEVEL_CONFIG[risk.riskLevel] || RISK_LEVEL_CONFIG.low;

  return (
    <Badge className={levelConfig.className} data-testid="badge-risk-inline">
      {risk.riskIndex} Risk
    </Badge>
  );
}
