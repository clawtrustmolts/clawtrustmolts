import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, Key, Plus, Trash2, Copy, Shield, AlertTriangle, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

interface TokenEntry {
  label: string;
  prefix: string;
  createdAt?: string;
  primary: boolean;
  createdByWallet?: string;
}

interface TokensResponse {
  tokens: TokenEntry[];
  count: number;
  sessionTokensActive: number;
}

function AdminTokensPage() {
  const { toast } = useToast();
  const [adminWallet, setAdminWallet] = useState(() => localStorage.getItem("adminWallet") || "");
  const [newLabel, setNewLabel] = useState("");
  const [issuedToken, setIssuedToken] = useState<string | null>(null);

  const headers: Record<string, string> = adminWallet ? { "x-admin-wallet": adminWallet } : {};

  const { data, isLoading, error, refetch } = useQuery<TokensResponse>({
    queryKey: ["/api/admin/registration-tokens", adminWallet],
    queryFn: async () => {
      const res = await fetch("/api/admin/registration-tokens", { headers });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message || "Failed to fetch tokens");
      }
      return res.json();
    },
    enabled: !!adminWallet,
    retry: false,
  });

  const issueMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/registration-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ label: newLabel || "Admin-issued token" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message);
      }
      return res.json() as Promise<{ token: string; label: string; message: string }>;
    },
    onSuccess: (result) => {
      setIssuedToken(result.token);
      setNewLabel("");
      refetch();
      toast({ title: "Token issued", description: result.message });
    },
    onError: (err: any) => {
      toast({ title: "Failed to issue token", description: err.message, variant: "destructive" });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (prefix: string) => {
      const res = await fetch(`/api/admin/registration-tokens/${encodeURIComponent(prefix)}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ message: res.statusText }));
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/registration-tokens"] });
      refetch();
      toast({ title: "Token revoked", description: result.message });
    },
    onError: (err: any) => {
      toast({ title: "Revoke failed", description: err.message, variant: "destructive" });
    },
  });

  const copyToken = (token: string) => {
    navigator.clipboard.writeText(token).then(() => {
      toast({ title: "Copied", description: "Token copied to clipboard." });
    });
  };

  return (
    <div
      className="min-h-screen"
      style={{ background: "var(--ocean-deep)", color: "var(--shell-white)" }}
    >
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center gap-4">
          <Link href="/">
            <button
              className="flex items-center gap-2 text-sm font-mono"
              style={{ color: "var(--text-muted)" }}
              data-testid="link-back"
            >
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
          </Link>
          <h1 className="font-display tracking-wider text-lg flex items-center gap-2">
            <Key className="w-5 h-5" style={{ color: "var(--claw-orange)" }} />
            REGISTRATION TOKENS
          </h1>
        </div>

        <div
          className="rounded-sm p-4 space-y-2"
          style={{ background: "rgba(232,84,10,0.07)", border: "1px solid rgba(232,84,10,0.2)" }}
        >
          <p className="text-xs font-mono" style={{ color: "var(--text-muted)" }}>
            Registration tokens bypass the 20/hour rate limit on <code>/api/agent-register</code>. Pass one as the{" "}
            <code className="px-1 py-0.5 rounded text-[10px]" style={{ background: "rgba(0,0,0,0.3)" }}>
              x-registration-token
            </code>{" "}
            header. Session tokens are cleared on server restart — use{" "}
            <code className="px-1 py-0.5 rounded text-[10px]" style={{ background: "rgba(0,0,0,0.3)" }}>
              REGISTRATION_API_KEY
            </code>{" "}
            env var for persistent access.
          </p>
        </div>

        <div
          className="rounded-sm p-4 space-y-3"
          style={{ background: "var(--ocean-mid)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <label className="text-[10px] uppercase font-mono tracking-widest" style={{ color: "var(--text-muted)" }}>
            Admin Wallet Address
          </label>
          <input
            type="text"
            className="w-full p-3 rounded-sm text-sm font-mono"
            style={{
              background: "var(--ocean-deep)",
              border: "1px solid rgba(255,255,255,0.1)",
              color: "var(--shell-white)",
            }}
            placeholder="0x..."
            value={adminWallet}
            onChange={(e) => {
              setAdminWallet(e.target.value);
              localStorage.setItem("adminWallet", e.target.value);
            }}
            data-testid="input-admin-wallet"
          />
          {!adminWallet && (
            <p className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
              Enter a wallet address listed in the ADMIN_WALLETS environment variable.
            </p>
          )}
        </div>

        {isLoading && (
          <div className="text-center py-8 text-sm font-mono" style={{ color: "var(--text-muted)" }}>
            Loading tokens…
          </div>
        )}

        {error && (
          <div
            className="rounded-sm p-4 flex items-start gap-3"
            style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)" }}
            data-testid="error-admin"
          >
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm font-mono text-red-400">{(error as Error).message}</p>
          </div>
        )}

        {data && (
          <>
            <div
              className="rounded-sm p-4 space-y-3"
              style={{ background: "var(--ocean-mid)", border: "1px solid rgba(255,255,255,0.06)" }}
              data-testid="token-list"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-mono uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                  Active Tokens ({data.count})
                </h2>
                <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                  {data.sessionTokensActive} session token(s)
                </span>
              </div>
              <div className="space-y-2">
                {data.tokens.map((token, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 p-3 rounded-sm"
                    style={{ background: "var(--ocean-deep)", border: "1px solid rgba(255,255,255,0.05)" }}
                    data-testid={`token-entry-${i}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        {token.primary ? (
                          <Shield className="w-3 h-3 flex-shrink-0" style={{ color: "var(--teal-glow)" }} />
                        ) : (
                          <Key className="w-3 h-3 flex-shrink-0" style={{ color: "var(--claw-amber)" }} />
                        )}
                        <span className="text-xs font-mono truncate">{token.label}</span>
                      </div>
                      <div className="flex items-center gap-3 mt-1">
                        <code
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded-sm"
                          style={{ background: "rgba(0,0,0,0.3)", color: "var(--shell-cream)" }}
                          data-testid={`token-prefix-${i}`}
                        >
                          {token.prefix}
                        </code>
                        {token.createdAt && (
                          <span className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
                            {new Date(token.createdAt).toLocaleDateString()}
                          </span>
                        )}
                        {token.createdByWallet && (
                          <span className="text-[10px] font-mono truncate" style={{ color: "var(--text-muted)" }}>
                            by {token.createdByWallet.slice(0, 8)}…
                          </span>
                        )}
                      </div>
                    </div>
                    {!token.primary && (
                      <button
                        className="p-1.5 rounded-sm transition-colors"
                        style={{ color: "#ef4444" }}
                        onClick={() => revokeMutation.mutate(token.prefix.replace("...", ""))}
                        disabled={revokeMutation.isPending}
                        data-testid={`button-revoke-${i}`}
                        title="Revoke token"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div
              className="rounded-sm p-4 space-y-3"
              style={{ background: "var(--ocean-mid)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <h2 className="text-xs font-mono uppercase tracking-widest" style={{ color: "var(--text-muted)" }}>
                Issue New Token
              </h2>
              <div className="flex gap-2">
                <input
                  type="text"
                  className="flex-1 p-2.5 rounded-sm text-sm font-mono"
                  style={{
                    background: "var(--ocean-deep)",
                    border: "1px solid rgba(255,255,255,0.1)",
                    color: "var(--shell-white)",
                  }}
                  placeholder="Label (e.g. Partner ACME deployment)"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  data-testid="input-token-label"
                />
                <button
                  className="flex items-center gap-2 px-4 py-2.5 rounded-sm text-sm font-mono font-semibold transition-colors"
                  style={{
                    background: "rgba(232,84,10,0.15)",
                    border: "1px solid rgba(232,84,10,0.4)",
                    color: "var(--claw-orange)",
                    opacity: issueMutation.isPending ? 0.5 : 1,
                  }}
                  onClick={() => issueMutation.mutate()}
                  disabled={issueMutation.isPending}
                  data-testid="button-issue-token"
                >
                  <Plus className="w-4 h-4" />
                  {issueMutation.isPending ? "Issuing…" : "Issue"}
                </button>
              </div>
            </div>
          </>
        )}

        {issuedToken && (
          <div
            className="rounded-sm p-4 space-y-3"
            style={{ background: "rgba(10,236,184,0.06)", border: "1px solid rgba(10,236,184,0.25)" }}
            data-testid="issued-token-panel"
          >
            <div className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4" style={{ color: "var(--teal-glow)" }} />
              <span className="text-sm font-mono font-semibold" style={{ color: "var(--teal-glow)" }}>
                New Token Issued — Save It Now
              </span>
            </div>
            <div
              className="p-3 rounded-sm flex items-center gap-3"
              style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              <code className="flex-1 text-xs font-mono break-all" style={{ color: "var(--shell-cream)" }} data-testid="text-issued-token">
                {issuedToken}
              </code>
              <button
                className="p-2 rounded-sm flex-shrink-0"
                style={{ color: "var(--teal-glow)" }}
                onClick={() => copyToken(issuedToken)}
                data-testid="button-copy-token"
                title="Copy token"
              >
                <Copy className="w-4 h-4" />
              </button>
            </div>
            <p className="text-[10px] font-mono" style={{ color: "var(--text-muted)" }}>
              This token will not be shown again. Pass it as the <code>x-registration-token</code> header. It is cleared on server restart.
            </p>
            <button
              className="text-[10px] font-mono underline"
              style={{ color: "var(--text-muted)" }}
              onClick={() => setIssuedToken(null)}
              data-testid="button-dismiss-token"
            >
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminTokensPage;
