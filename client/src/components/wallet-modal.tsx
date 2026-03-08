import { useEffect, useRef } from "react";
import { X, ExternalLink, Loader2, ShieldCheck } from "lucide-react";

type WalletModalState = "connecting" | "signing" | "not-found" | "error";

interface WalletConnectModalProps {
  state: WalletModalState;
  errorMessage?: string;
  onClose: () => void;
  onRetry?: () => void;
}

export function WalletConnectModal({ state, errorMessage, onClose, onRetry }: WalletConnectModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function handleBackdropClick(e: React.MouseEvent) {
    if (e.target === backdropRef.current) onClose();
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
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-sm transition-opacity opacity-50 hover:opacity-100"
          style={{ color: "var(--text-muted)" }}
          data-testid="button-close-wallet-modal"
        >
          <X className="w-4 h-4" />
        </button>

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
              Base Sepolia · ERC-8004
            </p>
          </div>
        </div>

        {state === "connecting" && (
          <div className="text-center space-y-4" data-testid="modal-state-connecting">
            <Loader2 className="w-8 h-8 mx-auto animate-spin" style={{ color: "var(--claw-orange)" }} />
            <div>
              <p className="text-sm font-display" style={{ color: "var(--shell-white)" }}>
                Connecting to MetaMask…
              </p>
              <p className="text-[11px] font-mono mt-1" style={{ color: "var(--text-muted)" }}>
                Approve the connection in your wallet
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
                {`Welcome to ClawTrust 🦞\n\nSigning this message verifies your wallet\nownership. No gas required.\n\nChain: Base Sepolia (84532)`}
              </p>
            </div>
          </div>
        )}

        {state === "not-found" && (
          <div className="space-y-4" data-testid="modal-state-not-found">
            <div>
              <p className="text-sm font-display" style={{ color: "var(--shell-white)" }}>
                MetaMask not detected
              </p>
              <p className="text-[11px] font-mono mt-1 leading-relaxed" style={{ color: "var(--text-muted)" }}>
                ClawTrust uses MetaMask to connect your agent wallet and sign on-chain actions.
              </p>
            </div>
            <a
              href="https://metamask.io/download/"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-sm text-sm font-display uppercase tracking-wider transition-opacity hover:opacity-80"
              style={{ background: "var(--claw-orange)", color: "white" }}
              data-testid="link-install-metamask"
            >
              Install MetaMask <ExternalLink className="w-3.5 h-3.5" />
            </a>
            {onRetry && (
              <button
                onClick={onRetry}
                className="w-full py-2 rounded-sm text-sm font-mono transition-opacity hover:opacity-80"
                style={{ background: "rgba(107,127,163,0.1)", color: "var(--text-muted)", border: "1px solid rgba(107,127,163,0.2)" }}
                data-testid="button-retry-connect"
              >
                Try again
              </button>
            )}
            <p className="text-[10px] font-mono text-center" style={{ color: "var(--text-muted)" }}>
              After installing, refresh this page and connect again.
            </p>
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
