import { useState, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Shield, ArrowUpCircle, ArrowDownCircle, Lock, Unlock, AlertTriangle, Wallet, TrendingUp, Activity, CheckCircle, Loader2, ExternalLink } from "lucide-react";
import type { BondEvent } from "@shared/schema";
import {
  depositBondOnChain,
  getUSDCBalance,
  getWalletChainId,
  switchToChain,
  txExplorerUrl,
  CHAIN_IDS,
  type TxProgress,
  type ChainKey,
} from "@/lib/onchain";

const TIER_CONFIG: Record<string, { label: string; className: string }> = {
  UNBONDED: { label: "Unbonded", className: "bg-muted text-muted-foreground" },
  BONDED: { label: "Bonded", className: "bg-chart-2/15 text-chart-2" },
  HIGH_BOND: { label: "High Bond", className: "bg-primary/15 text-primary" },
};

const EVENT_ICONS: Record<string, typeof ArrowUpCircle> = {
  DEPOSIT: ArrowUpCircle,
  WITHDRAW: ArrowDownCircle,
  LOCK: Lock,
  UNLOCK: Unlock,
  SLASH: AlertTriangle,
};

const EVENT_COLORS: Record<string, string> = {
  DEPOSIT: "text-chart-2",
  WITHDRAW: "text-muted-foreground",
  LOCK: "text-chart-3",
  UNLOCK: "text-chart-2",
  SLASH: "text-destructive",
};

interface BondPanelProps {
  agentId: string;
  isOwnProfile: boolean;
}

export function BondPanel({ agentId, isOwnProfile }: BondPanelProps) {
  const { toast } = useToast();
  const [depositAmount, setDepositAmount] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [onChainAmount, setOnChainAmount] = useState("");
  const [onChainProgress, setOnChainProgress] = useState<TxProgress>({ step: "idle" });
  const [walletAccount, setWalletAccount] = useState("");
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [wrongChain, setWrongChain] = useState(false);
  const chainKey: ChainKey = "BASE_SEPOLIA";

  const checkWallet = useCallback(async () => {
    if (!window.ethereum) {
      toast({ title: "No wallet found", description: "Install MetaMask to deposit on-chain.", variant: "destructive" });
      return;
    }
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
      const account = accounts[0];
      setWalletAccount(account);
      const chainId = await getWalletChainId();
      if (chainId !== CHAIN_IDS[chainKey]) {
        setWrongChain(true);
        return;
      }
      setWrongChain(false);
      const bal = await getUSDCBalance(account, chainKey);
      setUsdcBalance(bal);
    } catch (err: any) {
      toast({ title: "Wallet error", description: err.message, variant: "destructive" });
    }
  }, [chainKey, toast]);

  const handleOnChainDeposit = useCallback(async () => {
    const amount = parseFloat(onChainAmount);
    if (!amount || amount < 10) return;
    const account = walletAccount;
    if (!account) { await checkWallet(); return; }
    try {
      const { depositTxHash } = await depositBondOnChain(
        { agentWallet: account, amountUsdc: amount, chainKey },
        setOnChainProgress,
      );
      toast({ title: "Bond deposited on-chain", description: `TX: ${depositTxHash.slice(0, 18)}…` });
      queryClient.invalidateQueries({ queryKey: ["/api/bond", agentId, "status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bond", agentId, "history"] });
      setOnChainAmount("");
      setOnChainProgress({ step: "idle" });
    } catch (err: any) {
      setOnChainProgress({ step: "error", error: err.message });
      toast({ title: "On-chain deposit failed", description: err.message, variant: "destructive" });
    }
  }, [agentId, walletAccount, onChainAmount, chainKey, checkWallet, toast]);

  const { data: bondStatus, isLoading: statusLoading } = useQuery<{
    totalBonded: number;
    availableBond: number;
    lockedBond: number;
    bondTier: string;
    bondReliability: number;
    bondWalletId: string | null;
    bondWalletAddress: string | null;
    lastSlashAt: string | null;
    circleConfigured: boolean;
  }>({
    queryKey: ["/api/bond", agentId, "status"],
  });

  const { data: bondHistory } = useQuery<{ events: BondEvent[]; total: number }>({
    queryKey: ["/api/bond", agentId, "history"],
  });

  const { data: perfData } = useQuery<{
    performanceScore: number;
    storedScore: number;
    components: { fusedScore: number; bondReliability: number; gigsCompleted: number };
    threshold: number;
    aboveThreshold: boolean;
  }>({
    queryKey: ["/api/bond", agentId, "performance"],
  });

  const depositMutation = useMutation({
    mutationFn: async (amount: number) => {
      const res = await fetch(`/api/bond/${agentId}/deposit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agent-id": agentId },
        body: JSON.stringify({ amount }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(data.message || res.statusText);
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bond", agentId, "status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bond", agentId, "history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agents", agentId] });
      toast({ title: "Bond deposited", description: data.message });
      setDepositAmount("");
    },
    onError: (err: Error) => {
      toast({ title: "Deposit failed", description: err.message, variant: "destructive" });
    },
  });

  const withdrawMutation = useMutation({
    mutationFn: async (amount: number) => {
      const res = await fetch(`/api/bond/${agentId}/withdraw`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agent-id": agentId },
        body: JSON.stringify({ amount }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(data.message || res.statusText);
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/bond", agentId, "status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bond", agentId, "history"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agents", agentId] });
      toast({ title: "Bond withdrawn", description: data.message });
      setWithdrawAmount("");
    },
    onError: (err: Error) => {
      toast({ title: "Withdrawal failed", description: err.message, variant: "destructive" });
    },
  });

  if (statusLoading) {
    return (
      <Card data-testid="card-bond-panel-loading">
        <CardContent className="p-5 space-y-3">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-20 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!bondStatus) return null;

  const tierConfig = TIER_CONFIG[bondStatus.bondTier] || TIER_CONFIG.UNBONDED;
  const events = bondHistory?.events || [];

  return (
    <div className="space-y-3" data-testid="bond-panel">
      <Card data-testid="card-bond-status">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-display tracking-wider flex items-center gap-2">
            <Shield className="w-4 h-4 text-chart-2" />
            USDC BOND
            <Badge variant="secondary" className={`text-[10px] ml-auto ${tierConfig.className}`} data-testid="badge-bond-tier">
              {tierConfig.label}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-5 pt-0">
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <p className="text-lg font-display font-bold" data-testid="text-total-bonded">
                {bondStatus.totalBonded.toFixed(2)}
              </p>
              <p className="text-[10px] text-muted-foreground font-mono">TOTAL BONDED</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-display font-bold text-chart-2" data-testid="text-available-bond">
                {bondStatus.availableBond.toFixed(2)}
              </p>
              <p className="text-[10px] text-muted-foreground font-mono">AVAILABLE</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-display font-bold text-chart-3" data-testid="text-locked-bond">
                {bondStatus.lockedBond.toFixed(2)}
              </p>
              <p className="text-[10px] text-muted-foreground font-mono">LOCKED</p>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2 mt-4 pt-3 border-t">
            <div className="flex items-center gap-1.5">
              <TrendingUp className="w-3 h-3 text-muted-foreground" />
              <span className="text-[10px] font-mono text-muted-foreground">RELIABILITY</span>
            </div>
            <span className="text-xs font-display font-bold" data-testid="text-bond-reliability">
              {bondStatus.bondReliability.toFixed(1)}%
            </span>
          </div>

          {perfData && (
            <div className="mt-3 pt-3 border-t space-y-2" data-testid="performance-score-section">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Activity className="w-3 h-3 text-muted-foreground" />
                  <span className="text-[10px] font-mono text-muted-foreground">PERFORMANCE SCORE</span>
                </div>
                <span className={`text-xs font-display font-bold ${perfData.aboveThreshold ? "text-chart-2" : "text-destructive"}`} data-testid="text-performance-score">
                  {perfData.performanceScore}/100
                </span>
              </div>
              <div className="w-full h-1.5 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${perfData.aboveThreshold ? "bg-chart-2" : "bg-destructive"}`}
                  style={{ width: `${perfData.performanceScore}%` }}
                  data-testid="bar-performance-score"
                />
              </div>
              <div className="grid grid-cols-3 gap-1">
                <div className="text-center">
                  <p className="text-[10px] font-mono font-bold">{perfData.components.fusedScore.toFixed(0)}</p>
                  <p className="text-[8px] text-muted-foreground">FUSED (50%)</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] font-mono font-bold">{perfData.components.bondReliability.toFixed(0)}</p>
                  <p className="text-[8px] text-muted-foreground">RELIABLE (30%)</p>
                </div>
                <div className="text-center">
                  <p className="text-[10px] font-mono font-bold">{perfData.components.gigsCompleted}</p>
                  <p className="text-[8px] text-muted-foreground">GIGS (20%)</p>
                </div>
              </div>
              {!perfData.aboveThreshold && (
                <p className="text-[10px] text-destructive font-mono" data-testid="text-perf-warning">
                  Below threshold ({perfData.threshold}). Bond-required gigs may auto-slash.
                </p>
              )}
            </div>
          )}

          {bondStatus.bondWalletAddress && (
            <div className="mt-3 pt-3 border-t space-y-1">
              <div className="flex items-center gap-1.5">
                <Wallet className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                <span className="text-[10px] font-mono text-muted-foreground">CIRCLE BOND WALLET</span>
              </div>
              <span className="text-[10px] font-mono break-all block" style={{ color: "hsl(var(--foreground) / 0.7)" }} data-testid="text-bond-wallet">
                {bondStatus.bondWalletAddress}
              </span>
              <p className="text-[9px] font-mono text-muted-foreground leading-tight">
                Deposit USDC to this Circle wallet address on Base Sepolia to fund your bond.
              </p>
            </div>
          )}

          {!bondStatus.bondWalletAddress && !bondStatus.circleConfigured && (
            <div className="mt-3 pt-3 border-t">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-3 h-3 text-chart-3 flex-shrink-0 mt-0.5" />
                <p className="text-[10px] font-mono text-muted-foreground leading-tight">
                  Bond deposits go via the platform oracle wallet. Contact the operator to fund or bond directly via the Bond contract.
                </p>
              </div>
            </div>
          )}

          {bondStatus.lastSlashAt && (
            <div className="flex items-center gap-1.5 mt-2">
              <AlertTriangle className="w-3 h-3 text-destructive" />
              <span className="text-[10px] font-mono text-destructive" data-testid="text-last-slash">
                Last slashed: {new Date(bondStatus.lastSlashAt).toLocaleDateString()}
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      {isOwnProfile && (
        <Card data-testid="card-bond-actions">
          <CardContent className="p-5 space-y-4">

            {/* On-chain deposit via MetaMask */}
            <div className="space-y-2 rounded-lg border border-dashed border-chart-2/40 p-3 bg-chart-2/5">
              <label className="text-xs font-mono font-semibold flex items-center gap-1.5 text-chart-2">
                <Wallet className="w-3.5 h-3.5" /> DEPOSIT ON-CHAIN (MetaMask)
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="10"
                  step="1"
                  placeholder="Amount (min 10 USDC)"
                  value={onChainAmount}
                  onChange={(e) => setOnChainAmount(e.target.value)}
                  data-testid="input-onchain-deposit-amount"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!onChainAmount || parseFloat(onChainAmount) < 10 || onChainProgress.step === "approving" || onChainProgress.step === "locking"}
                  onClick={walletAccount ? handleOnChainDeposit : checkWallet}
                  data-testid="button-onchain-deposit-bond"
                >
                  {onChainProgress.step === "approving" || onChainProgress.step === "locking"
                    ? <Loader2 className="w-3 h-3 animate-spin" />
                    : walletAccount
                      ? `Fund ${onChainAmount || "?"} USDC`
                      : "Connect Wallet"
                  }
                </Button>
              </div>
              {walletAccount && !wrongChain && (
                <p className="text-[10px] font-mono text-muted-foreground">
                  Wallet: {walletAccount.slice(0,6)}…{walletAccount.slice(-4)}
                  {usdcBalance !== null && <> · Balance: <span className={usdcBalance >= (parseFloat(onChainAmount) || 0) ? "text-chart-2" : "text-destructive"}>{usdcBalance.toFixed(2)} USDC</span></>}
                </p>
              )}
              {wrongChain && (
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-3 h-3 text-chart-3 shrink-0" />
                  <span className="text-[10px] text-chart-3">Switch to Base Sepolia</span>
                  <Button size="sm" variant="ghost" className="h-5 text-[10px] px-2" onClick={() => switchToChain(chainKey).then(() => checkWallet())}>
                    Switch
                  </Button>
                </div>
              )}
              {onChainProgress.step === "done" && onChainProgress.lockTxHash && (
                <a
                  href={txExplorerUrl(onChainProgress.lockTxHash, chainKey)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-[10px] text-chart-2 hover:underline"
                >
                  <CheckCircle className="w-3 h-3" /> Deposited · View TX <ExternalLink className="w-2.5 h-2.5" />
                </a>
              )}
              {onChainProgress.step === "error" && (
                <p className="text-[10px] text-destructive">{onChainProgress.error}</p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-xs font-mono font-semibold flex items-center gap-1.5 text-muted-foreground">
                <ArrowUpCircle className="w-3.5 h-3.5 text-chart-2" /> DEPOSIT VIA ORACLE
              </label>
              <div className="rounded-md bg-muted/40 p-2.5 space-y-1 mb-2" data-testid="oracle-deposit-steps">
                <p className="text-[10px] font-mono font-semibold text-muted-foreground mb-1">HOW THIS WORKS:</p>
                {[
                  "Enter your USDC amount (minimum 10 USDC).",
                  "Click Deposit — the platform oracle wallet submits a depositFor() transaction to the Bond contract on your behalf.",
                  "The oracle calls depositFor(yourWallet, amount) on the ClawTrust Bond contract (Base Sepolia: 0x23a1…132c).",
                  "Wait ~15–30 seconds for on-chain confirmation.",
                  "Your bond balance and tier update automatically.",
                ].map((step, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="flex-shrink-0 w-4 h-4 rounded-full bg-muted flex items-center justify-center text-[9px] font-bold text-muted-foreground mt-0.5">{i + 1}</span>
                    <p className="text-[10px] font-mono leading-snug text-muted-foreground">{step}</p>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="10"
                  step="1"
                  placeholder="Amount (min 10 USDC)"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  data-testid="input-deposit-amount"
                />
                <Button
                  size="sm"
                  disabled={!depositAmount || parseFloat(depositAmount) < 10 || depositMutation.isPending}
                  onClick={() => depositMutation.mutate(parseFloat(depositAmount))}
                  data-testid="button-deposit-bond"
                >
                  {depositMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "Deposit"}
                </Button>
              </div>
              {depositMutation.isError && (
                <p className="text-[10px] text-destructive font-mono" data-testid="text-oracle-deposit-error">
                  {(depositMutation.error as Error)?.message ?? "Deposit failed. The oracle may be unavailable — try on-chain deposit above."}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-xs font-mono font-semibold flex items-center gap-1.5">
                <ArrowDownCircle className="w-3.5 h-3.5" /> WITHDRAW BOND
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min="1"
                  step="1"
                  placeholder={`Available: ${bondStatus.availableBond.toFixed(2)} USDC`}
                  value={withdrawAmount}
                  onChange={(e) => setWithdrawAmount(e.target.value)}
                  data-testid="input-withdraw-amount"
                />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!withdrawAmount || parseFloat(withdrawAmount) <= 0 || parseFloat(withdrawAmount) > bondStatus.availableBond || withdrawMutation.isPending}
                  onClick={() => withdrawMutation.mutate(parseFloat(withdrawAmount))}
                  data-testid="button-withdraw-bond"
                >
                  {withdrawMutation.isPending ? "..." : "Withdraw"}
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {events.length > 0 && (
        <Card data-testid="card-bond-history">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-display tracking-wider">BOND HISTORY</CardTitle>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            <div className="space-y-2">
              {events.slice(0, 10).map((event) => {
                const IconComponent = EVENT_ICONS[event.eventType] || Shield;
                const colorClass = EVENT_COLORS[event.eventType] || "text-muted-foreground";
                return (
                  <div key={event.id} className="flex items-center gap-3 p-2 rounded-md" data-testid={`bond-event-${event.id}`}>
                    <div className={`w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 bg-muted`}>
                      <IconComponent className={`w-4 h-4 ${colorClass}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-[10px] font-mono">{event.eventType}</Badge>
                        <span className={`text-xs font-display font-bold ${event.eventType === "SLASH" ? "text-destructive" : ""}`}>
                          {event.eventType === "WITHDRAW" || event.eventType === "SLASH" ? "-" : "+"}{event.amount.toFixed(2)} USDC
                        </span>
                      </div>
                      {event.reason && (
                        <p className="text-[10px] text-muted-foreground truncate mt-0.5">{event.reason}</p>
                      )}
                    </div>
                    <span className="text-[10px] text-muted-foreground font-mono flex-shrink-0">
                      {event.createdAt ? new Date(event.createdAt).toLocaleDateString() : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
