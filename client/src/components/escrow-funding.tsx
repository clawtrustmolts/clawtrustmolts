import { useState, useCallback } from "react";
import { CheckCircle, Loader2, AlertCircle, ExternalLink, Wallet, ArrowRight, RefreshCw } from "lucide-react";
import { ClawButton } from "@/components/ui-shared";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  fundEscrowOnChain,
  getUSDCBalance,
  getWalletChainId,
  switchToChain,
  chainKeyFromBackend,
  txExplorerUrl,
  CHAIN_IDS,
  CHAIN_CONTRACTS,
  type TxProgress,
  type ChainKey,
} from "@/lib/onchain";

interface EscrowFundingProps {
  gigId: string;
  payeeWallet: string;
  amountUsdc: number;
  chain?: string | null;
  onSuccess?: (lockTxHash: string) => void;
}

const STEP_LABELS: Record<TxProgress["step"], string> = {
  idle:      "Fund Escrow",
  approving: "Approving USDC…",
  approved:  "Approved — locking…",
  locking:   "Locking USDC…",
  done:      "Funded",
  error:     "Failed",
};

function StepDot({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border transition-all ${
          done  ? "bg-teal-500 border-teal-500 text-black"         :
          active ? "border-[var(--teal-glow)] text-[var(--teal-glow)] animate-pulse" :
                   "border-[var(--border-dim)] text-[var(--text-muted)]"
        }`}
      >
        {done ? <CheckCircle className="w-3.5 h-3.5" /> : active ? <Loader2 className="w-3 h-3 animate-spin" /> : "·"}
      </div>
      <span className={`text-xs ${done ? "text-teal-400" : active ? "text-[var(--shell-white)]" : "text-[var(--text-muted)]"}`}>
        {label}
      </span>
    </div>
  );
}

export function EscrowFundingFlow({ gigId, payeeWallet, amountUsdc, chain, onSuccess }: EscrowFundingProps) {
  const { toast } = useToast();
  const [progress, setProgress] = useState<TxProgress>({ step: "idle" });
  const [usdcBalance, setUsdcBalance] = useState<number | null>(null);
  const [walletAccount, setWalletAccount] = useState<string>("");
  const [checking, setChecking] = useState(false);
  const [wrongChain, setWrongChain] = useState(false);

  const chainKey = chainKeyFromBackend(chain);
  const contracts = CHAIN_CONTRACTS[chainKey];
  const targetChainId = CHAIN_IDS[chainKey];

  const checkWalletState = useCallback(async () => {
    if (!window.ethereum) {
      toast({ title: "MetaMask not found", description: "Install MetaMask to fund escrow on-chain.", variant: "destructive" });
      return;
    }
    setChecking(true);
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
      const account = accounts[0];
      setWalletAccount(account);

      const currentChainId = await getWalletChainId();
      if (currentChainId !== targetChainId) {
        setWrongChain(true);
        setChecking(false);
        return;
      }
      setWrongChain(false);

      const bal = await getUSDCBalance(account, chainKey);
      setUsdcBalance(bal);
    } catch (err: any) {
      toast({ title: "Wallet error", description: err.message || "Could not connect wallet.", variant: "destructive" });
    } finally {
      setChecking(false);
    }
  }, [chainKey, targetChainId, toast]);

  const handleSwitchChain = async () => {
    const switched = await switchToChain(chainKey);
    if (switched) {
      setWrongChain(false);
      await checkWalletState();
    } else {
      toast({ title: "Chain switch failed", description: `Please manually switch to ${contracts.name} in your wallet.`, variant: "destructive" });
    }
  };

  const handleFund = useCallback(async () => {
    if (progress.step !== "idle" && progress.step !== "error") return;

    try {
      const { lockTxHash } = await fundEscrowOnChain(
        { gigId, payeeWallet, amountUsdc, chainKey },
        (p) => setProgress(p),
      );

      // Notify backend to record the on-chain tx hash and update escrow status
      try {
        await apiRequest("POST", "/api/escrow/confirm-onchain", {
          gigId,
          lockTxHash,
          chain: chainKey,
        });
      } catch {
        // Non-fatal — on-chain tx is confirmed, backend can reconcile later
      }

      toast({
        title: "Escrow funded on-chain",
        description: `USDC locked in escrow. TX: ${lockTxHash.slice(0, 10)}…`,
      });

      onSuccess?.(lockTxHash);
    } catch (err: any) {
      const msg = err?.message || "Transaction failed";
      setProgress({ step: "error", error: msg });
      toast({ title: "Transaction failed", description: msg, variant: "destructive" });
    }
  }, [gigId, payeeWallet, amountUsdc, chainKey, progress.step, toast, onSuccess]);

  const isInProgress = progress.step === "approving" || progress.step === "approved" || progress.step === "locking";
  const isDone       = progress.step === "done";
  const isError      = progress.step === "error";

  if (isDone) {
    return (
      <div className="rounded-xl p-4 border border-teal-500/30 bg-teal-500/5">
        <div className="flex items-center gap-3">
          <CheckCircle className="w-5 h-5 text-teal-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-teal-300">Escrow funded on-chain</p>
            <p className="text-xs text-[var(--text-muted)] truncate">{amountUsdc} USDC locked in {contracts.name}</p>
          </div>
          {progress.lockTxHash && (
            <a
              href={txExplorerUrl(progress.lockTxHash, chainKey)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-teal-400 hover:underline flex items-center gap-1 shrink-0"
            >
              View TX <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-[var(--border-dim)] bg-[var(--panel-bg)] p-4 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-[var(--teal-glow)]/10 border border-[var(--teal-glow)]/30 flex items-center justify-center shrink-0">
          <Wallet className="w-4 h-4 text-[var(--teal-glow)]" />
        </div>
        <div>
          <p className="text-sm font-semibold text-[var(--shell-white)]">Fund Escrow On-Chain</p>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Send <span className="text-[var(--teal-glow)] font-mono">{amountUsdc} USDC</span> to the {contracts.name} escrow contract.
            Your wallet must have enough USDC.
          </p>
        </div>
      </div>

      {usdcBalance !== null && !wrongChain && (
        <div className="text-xs text-[var(--text-muted)] font-mono bg-[var(--bg-dim)] rounded-lg px-3 py-2">
          Wallet USDC balance: <span className={usdcBalance >= amountUsdc ? "text-teal-400" : "text-red-400"}>
            {usdcBalance.toFixed(2)} USDC
          </span>
          {usdcBalance < amountUsdc && (
            <span className="text-red-400 ml-2">⚠ Insufficient balance</span>
          )}
        </div>
      )}

      {wrongChain && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-xs text-amber-300">
            Wrong network. Switch to <strong>{contracts.name}</strong> to continue.
          </span>
          <ClawButton size="sm" variant="ghost" className="ml-auto text-xs" onClick={handleSwitchChain}>
            Switch
          </ClawButton>
        </div>
      )}

      {isInProgress && (
        <div className="space-y-2 rounded-lg bg-[var(--bg-dim)] p-3">
          <StepDot label="Approve USDC"     active={progress.step === "approving"} done={progress.step !== "approving" && progress.step !== "idle"} />
          <StepDot label="Lock in Escrow"   active={progress.step === "locking" || progress.step === "approved"} done={progress.step === "done"} />
          {progress.approveTxHash && (
            <a
              href={txExplorerUrl(progress.approveTxHash, chainKey)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-[var(--text-muted)] hover:text-[var(--teal-glow)] flex items-center gap-1 ml-8"
            >
              Approve TX <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
          {progress.lockTxHash && (
            <a
              href={txExplorerUrl(progress.lockTxHash, chainKey)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-[var(--text-muted)] hover:text-[var(--teal-glow)] flex items-center gap-1 ml-8"
            >
              Lock TX <ExternalLink className="w-2.5 h-2.5" />
            </a>
          )}
        </div>
      )}

      {isError && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-3 py-2.5 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <span className="text-xs text-red-300 break-all">{progress.error}</span>
        </div>
      )}

      <div className="flex gap-2">
        {!walletAccount && !isInProgress && (
          <ClawButton
            size="sm"
            variant="ghost"
            onClick={checkWalletState}
            disabled={checking}
            data-testid="button-check-wallet"
            className="flex items-center gap-2"
          >
            {checking ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wallet className="w-3 h-3" />}
            Connect & Check Balance
          </ClawButton>
        )}

        {walletAccount && !wrongChain && !isInProgress && (
          <ClawButton
            size="sm"
            onClick={handleFund}
            disabled={usdcBalance !== null && usdcBalance < amountUsdc}
            data-testid="button-fund-escrow"
            className="flex items-center gap-2"
          >
            {isError ? <RefreshCw className="w-3 h-3" /> : <ArrowRight className="w-3 h-3" />}
            {isError ? "Retry" : `Fund ${amountUsdc} USDC`}
          </ClawButton>
        )}

        {isInProgress && (
          <ClawButton size="sm" disabled data-testid="button-funding-in-progress">
            <Loader2 className="w-3 h-3 animate-spin mr-2" />
            {STEP_LABELS[progress.step]}
          </ClawButton>
        )}
      </div>

      <p className="text-[10px] text-[var(--text-muted)]">
        Escrow: <span className="font-mono">{contracts.escrow.slice(0, 10)}…</span>
        {" · "}USDC: <span className="font-mono">{contracts.usdc.slice(0, 10)}…</span>
      </p>
    </div>
  );
}
