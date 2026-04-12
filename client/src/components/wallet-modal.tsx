import { useEffect, useRef, useState } from "react";
import { X, ExternalLink, Loader2, ShieldCheck, RefreshCw, CheckCircle } from "lucide-react";

type WalletModalState = "connecting" | "signing" | "choose-network" | "not-found" | "not-found-mobile" | "error";

interface WalletConnectModalProps {
  state: WalletModalState;
  errorMessage?: string;
  onClose: () => void;
  onRetry?: () => void;
  onSwitchToBase?: () => Promise<void>;
  onSwitchToSkale?: () => Promise<void>;
}

export function WalletConnectModal({ state, errorMessage, onClose, onRetry, onSwitchToBase, onSwitchToSkale }: WalletConnectModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);
  const [switching, setSwitching] = useState<"base" | "skale" | null>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && state !== "choose-network") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose, state]);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current && state !== "choose-network") onClose();
  }

  async function handleSwitchBase() {
    if (!onSwitchToBase) { onClose(); return; }
    setSwitching("base");
    try {
      await onSwitchToBase();
    } finally {
      setSwitching(null);
      onClose();
    }
  }

  async function handleSwitchSkale() {
    if (!onSwitchToSkale) { onClose(); return; }
    setSwitching("skale");
    try {
      await onSwitchToSkale();
    } finally {
      setSwitching(null);
      onClose();
    }
  }

  return (
    <div
      ref={backdropRef}
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(4px)" }}
      onClick={handleBackdropClick}
      data-testid="modal-wallet-connect"
    >
      <div
        className="relative w-full max-w-sm mx-4 rounded-sm p-6"
        style={{
          background: "var(--ocean-deep)",
          border: "1px solid rgba(232, 84, 10, 0.35)",
          boxShadow: "0 0 40px rgba(232, 84, 10, 0.08)",
        }}
      >
        {state !== "choose-network" && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1 rounded-sm transition-opacity opacity-50 hover:opacity-100"
            style={{ color: "var(--text-muted)" }}
            data-testid="button-close-wallet-modal"
          >
            <X className="w-4 h-4" />
          </button>
        )}

        <div className="flex items-center gap-3 mb-6">
          <div
            className="w-10 h-10 rounded-sm flex items-center justify-center text-lg flex-shrink-0"
            style={{ background: "rgba(232, 84, 10, 0.12)", border: "1px solid rgba(232, 84, 10, 0.25)" }}
          >
            🦞
          </div>
          <div>
            <p className="font-display text-sm font-semibold" style={{ color: "var(--shell-white)" }}>
              ClawTrust
            </p>
            <p className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
              {state === "choose-network" ? "Wallet Connected · Choose Network" : "Base Sepolia · SKALE · ERC-8004"}
            </p>
          </div>
        </div>

        {state === "connecting" && (
          <div className="text-center space-y-4" data-testid="modal-state-connecting">
            <Loader2 className="w-8 h-8 mx-auto animate-spin" style={{ color: "var(--claw-orange)" }} />
            <div>
              <p className="text-sm font-display" style={{ color: "var(--shell-white)" }}>
                Detecting wallet…
              </p>
              <p className="text-[11px] font-mono mt-1" style={{ color: "var(--text-muted)" }}>
                Waiting for wallet extension to respond
              </p>
            </div>
          </div>
        )}

        {state === "signing" && (
          <div className="text-center space-y-4" data-testid="modal-state-signing">
            <div
              className="w-12 h-12 rounded-sm mx-auto flex items-center justify-center"
              style={{ background: "rgba(232, 84, 10, 0.1)", border: "1px solid rgba(232, 84, 10, 0.2)" }}
            >
              <ShieldCheck className="w-6 h-6" style={{ color: "var(--claw-orange)" }} />
            </div>
            <div>
              <p className="text-sm font-display" style={{ color: "var(--shell-white)" }}>
                Sign to verify ownership
              </p>
              <p className="text-[11px] font-mono mt-1 leading-relaxed" style={{ color: "var(--text-muted)" }}>
                A signature request has been sent to your wallet.
                No gas required — no transaction is sent.
              </p>
            </div>
            <div
              className="rounded-sm p-3 text-left"
              style={{ background: "rgba(0,0,0,0.2)", border: "1px solid rgba(107,127,163,0.15)" }}
            >
              <p className="text-[10px] font-mono" style={{ color: "var(--text-muted)", whiteSpace: "pre-line" }}>
                {`Welcome to ClawTrust 🦞\n\nSigning this message verifies your\nwallet ownership. No gas required.`}
              </p>
            </div>
          </div>
        )}

        {state === "choose-network" && (
          <div className="space-y-4" data-testid="modal-state-choose-network">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: "#22c55e" }} />
              <p className="text-sm font-display" style={{ color: "var(--shell-white)" }}>
                Wallet connected!
              </p>
            </div>
            <p className="text-[11px] font-mono leading-relaxed" style={{ color: "var(--text-muted)" }}>
              Choose which network to use. You can switch anytime using the chain buttons in the top navigation.
            </p>

            <div className="flex flex-col gap-3">
              <button
                onClick={handleSwitchBase}
                disabled={switching !== null}
                className="w-full flex items-center gap-4 px-4 py-4 rounded-sm transition-all text-left hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                style={{ background: "rgba(0,82,255,0.10)", border: "1px solid rgba(0,82,255,0.3)" }}
                data-testid="button-choose-network-base"
              >
                <div
                  className="w-9 h-9 rounded-sm flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgba(0,82,255,0.15)" }}
                >
                  {switching === "base" ? (
                    <RefreshCw className="w-4 h-4 animate-spin" style={{ color: "#6090ff" }} />
                  ) : (
                    <span className="text-sm font-bold" style={{ color: "#6090ff" }}>B</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-display font-semibold" style={{ color: "var(--shell-white)" }}>
                    Base Sepolia
                  </p>
                  <p className="text-[10px] font-mono mt-0.5" style={{ color: "var(--text-muted)" }}>
                    Chain ID 84532 · Gas paid in ETH
                  </p>
                </div>
              </button>

              <button
                onClick={handleSwitchSkale}
                disabled={switching !== null}
                className="w-full flex items-center gap-4 px-4 py-4 rounded-sm transition-all text-left hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
                style={{ background: "rgba(139,92,246,0.10)", border: "1px solid rgba(139,92,246,0.3)" }}
                data-testid="button-choose-network-skale"
              >
                <div
                  className="w-9 h-9 rounded-sm flex items-center justify-center flex-shrink-0"
                  style={{ background: "rgba(139,92,246,0.15)" }}
                >
                  {switching === "skale" ? (
                    <RefreshCw className="w-4 h-4 animate-spin" style={{ color: "#a78bfa" }} />
                  ) : (
                    <span className="text-sm font-bold" style={{ color: "#a78bfa" }}>S</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-display font-semibold" style={{ color: "var(--shell-white)" }}>
                    SKALE Base Sepolia
                  </p>
                  <p className="text-[10px] font-mono mt-0.5" style={{ color: "var(--text-muted)" }}>
                    Chain ID 324705682 · <span style={{ color: "#22c55e" }}>Zero gas fees</span>
                  </p>
                </div>
              </button>
            </div>

            <button
              onClick={onClose}
              disabled={switching !== null}
              className="w-full py-2 rounded-sm text-[11px] font-mono transition-opacity hover:opacity-70 disabled:opacity-30"
              style={{ color: "var(--text-muted)" }}
              data-testid="button-skip-network-choice"
            >
              Skip — stay on current network
            </button>
          </div>
        )}

        {state === "not-found-mobile" && (
          <div className="space-y-4" data-testid="modal-state-not-found-mobile">
            <div>
              <p className="text-sm font-display" style={{ color: "var(--shell-white)" }}>
                Open in MetaMask
              </p>
              <p className="text-[11px] font-mono mt-1 leading-relaxed" style={{ color: "var(--text-muted)" }}>
                To connect your wallet on mobile, open ClawTrust inside the MetaMask app browser.
              </p>
            </div>
            <a
              href="https://metamask.app.link/dapp/clawtrust.org"
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-sm text-sm font-display uppercase tracking-wider transition-opacity hover:opacity-80"
              style={{ background: "var(--claw-orange)", color: "white" }}
              data-testid="link-open-metamask-mobile"
            >
              Open in MetaMask <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <a
              href="https://metamask.io/download/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-2 rounded-sm text-sm font-mono transition-opacity hover:opacity-80"
              style={{ background: "rgba(107,127,163,0.1)", color: "var(--text-muted)", border: "1px solid rgba(107,127,163,0.2)" }}
              data-testid="link-install-metamask-mobile"
            >
              Don't have MetaMask? Install it
            </a>
          </div>
        )}

        {state === "not-found" && (
          <div className="space-y-4" data-testid="modal-state-not-found">
            <div>
              <p className="text-sm font-display" style={{ color: "var(--shell-white)" }}>
                Wallet not responding
              </p>
              <p className="text-[11px] font-mono mt-1 leading-relaxed" style={{ color: "var(--text-muted)" }}>
                MetaMask is installed but didn't respond in time. This is usually fixed by refreshing the page — it wakes the wallet extension up.
              </p>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-sm text-sm font-display uppercase tracking-wider transition-opacity hover:opacity-80"
              style={{ background: "var(--claw-orange)", color: "white" }}
              data-testid="button-refresh-page"
            >
              Refresh page
            </button>
            {onRetry && (
              <button
                onClick={onRetry}
                className="flex items-center justify-center gap-2 w-full py-2 rounded-sm text-sm font-mono transition-opacity hover:opacity-80"
                style={{ background: "rgba(107,127,163,0.1)", color: "var(--text-muted)", border: "1px solid rgba(107,127,163,0.2)" }}
                data-testid="button-retry-connect"
              >
                Try again without refresh
              </button>
            )}
            <a
              href="https://metamask.io/download/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-2 rounded-sm text-[10px] font-mono transition-opacity hover:opacity-60"
              style={{ color: "var(--text-muted)" }}
              data-testid="link-install-metamask"
            >
              Don't have MetaMask? Install it <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}

        {state === "error" && (
          <div className="space-y-4" data-testid="modal-state-error">
            <div>
              <p className="text-sm font-display" style={{ color: "var(--shell-white)" }}>
                Connection failed
              </p>
              <p className="text-[11px] font-mono mt-1" style={{ color: "var(--text-muted)" }}>
                {errorMessage || "An error occurred while connecting to your wallet."}
              </p>
            </div>
            {onRetry && (
              <button
                onClick={onRetry}
                className="w-full py-2.5 rounded-sm text-sm font-display uppercase tracking-wider transition-opacity hover:opacity-80"
                style={{ background: "var(--claw-orange)", color: "white" }}
                data-testid="button-retry-connect"
              >
                Try again
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
