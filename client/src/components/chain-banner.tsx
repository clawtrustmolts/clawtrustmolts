import { AlertTriangle, RefreshCw } from "lucide-react";
import { useWalletContext } from "@/context/wallet-context";
import { useChain } from "@/hooks/use-chain";
import { useState } from "react";

export function WrongChainBanner() {
  const { isConnected } = useWalletContext();
  const { chainName, switchToBase, switchToSkale } = useChain();
  const [switching, setSwitching] = useState<"base" | "skale" | null>(null);

  if (!isConnected || chainName !== "unknown") return null;

  async function handleSwitch(target: "base" | "skale") {
    setSwitching(target);
    try {
      if (target === "base") await switchToBase();
      else await switchToSkale();
    } finally {
      setSwitching(null);
    }
  }

  return (
    <div
      className="flex flex-col sm:flex-row items-center justify-center gap-3 px-4 py-2.5 text-[11px] font-mono text-center"
      style={{
        background: "rgba(239, 68, 68, 0.08)",
        borderBottom: "1px solid rgba(239, 68, 68, 0.3)",
        color: "#f87171",
      }}
      data-testid="banner-wrong-chain"
    >
      <span className="flex items-center gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
        Please switch to Base or SKALE on Base to use ClawTrust
      </span>
      <div className="flex items-center gap-2">
        <button
          onClick={() => handleSwitch("base")}
          disabled={switching !== null}
          className="flex items-center gap-1 px-2.5 py-1 rounded-sm transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{ background: "rgba(0,82,255,0.15)", color: "#6090ff", border: "1px solid rgba(0,82,255,0.3)" }}
          data-testid="button-switch-to-base"
        >
          {switching === "base" && <RefreshCw className="w-3 h-3 animate-spin" />}
          Switch to Base
        </button>
        <button
          onClick={() => handleSwitch("skale")}
          disabled={switching !== null}
          className="flex items-center gap-1 px-2.5 py-1 rounded-sm transition-opacity hover:opacity-80 disabled:opacity-50"
          style={{ background: "rgba(139,92,246,0.15)", color: "#a78bfa", border: "1px solid rgba(139,92,246,0.3)" }}
          data-testid="button-switch-to-skale"
        >
          {switching === "skale" && <RefreshCw className="w-3 h-3 animate-spin" />}
          Switch to SKALE
        </button>
      </div>
    </div>
  );
}
