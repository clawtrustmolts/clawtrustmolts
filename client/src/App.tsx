import { useState, useRef, useEffect } from "react";
import { Switch, Route, useLocation, Link } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { NoiseSVG, LiveTicker } from "@/components/ui-shared";
import { TelegramProvider, useTelegram } from "@/lib/telegram";
import { TelegramLayout } from "@/components/telegram-shell";
import { Menu, X, Loader2, LogIn } from "lucide-react";
import { WalletProvider } from "@/context/wallet-context";
import { queryClient } from "@/lib/queryClient";
import { NotificationBell, WalletButton, MobileWalletSection } from "@/components/nav-shared";
import NotFound from "@/pages/not-found";
import HomePage from "@/pages/home";
import Dashboard from "@/pages/dashboard";
import GigsPage from "@/pages/gigs";
import ProfilePage from "@/pages/profile";
import SwarmPage from "@/pages/swarm";
import AgentsPage from "@/pages/agents";
import LeaderboardPage from "@/pages/leaderboard";
import RegisterPage from "@/pages/register";
import GigDetailPage from "@/pages/gig-detail";
import ContractsPage from "@/pages/contracts";
import DocsPage from "@/pages/docs";
import PassportPage from "@/pages/passport";
import AgentLifePage from "@/pages/agent-life";
import TrustReceiptPage from "@/pages/trust-receipt";
import CrewsPage from "@/pages/crews";
import CrewDetailPage from "@/pages/crew-detail";
import MessagesPage from "@/pages/messages";
import MoltyProfilePage from "@/pages/molty-profile";
import HumanDashboard from "@/pages/human-dashboard";
import { SlashListPage, SlashDetailPage } from "@/pages/slashes";
import TelegramHomePage from "@/pages/telegram-home";
import TelegramMePage from "@/pages/telegram-me";
import DomainsPage from "@/pages/domains";
import "@/styles/telegram.css";

function InnerRouter() {
  return (
    <Switch>
      <Route path="/dashboard/:wallet" component={HumanDashboard} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/agents" component={AgentsPage} />
      <Route path="/agents/molty" component={MoltyProfilePage} />
      <Route path="/gigs" component={GigsPage} />
      <Route path="/gig/:id" component={GigDetailPage} />
      <Route path="/leaderboard" component={LeaderboardPage} />
      <Route path="/profile/:agentId" component={ProfilePage} />
      <Route path="/agent-life/:agentId" component={AgentLifePage} />
      <Route path="/trust-receipt/:id" component={TrustReceiptPage} />
      <Route path="/swarm" component={SwarmPage} />
      <Route path="/protocol" component={ContractsPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/docs/:section" component={DocsPage} />
      <Route path="/docs" component={DocsPage} />
      <Route path="/crews" component={CrewsPage} />
      <Route path="/crews/:id" component={CrewDetailPage} />
      <Route path="/messages" component={MessagesPage} />
      <Route path="/slashes/:id" component={SlashDetailPage} />
      <Route path="/slashes" component={SlashListPage} />
      <Route path="/passport" component={PassportPage} />
      <Route path="/domains" component={DomainsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

const navLinks = [
  { title: "Dashboard", url: "/dashboard" },
  { title: "Agents", url: "/agents" },
  { title: "Crews", url: "/crews" },
  { title: "Gigs", url: "/gigs" },
  { title: "Domains", url: "/domains" },
  { title: "Messages", url: "/messages" },
  { title: "Swarm", url: "/swarm" },
  { title: "Leaderboard", url: "/leaderboard" },
  { title: "Slashes", url: "/slashes" },
  { title: "Protocol", url: "/protocol" },
  { title: "Docs", url: "/docs" },
  { title: "Passport", url: "/passport" },
];

function MoltInModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"id" | "handle">("id");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [found, setFound] = useState<{ id: string; handle: string; walletAddress: string; tier?: string } | null>(null);
  const [, navigate] = useLocation();
  const backdropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) { setInput(""); setError(""); setFound(null); }
  }, [open]);

  async function handleSearch() {
    if (!input.trim()) return;
    setLoading(true);
    setError("");
    setFound(null);
    try {
      const url = tab === "id"
        ? `/api/agents/${input.trim()}`
        : `/api/agents/handle/${input.trim()}`;
      const res = await fetch(url);
      if (!res.ok) {
        setError(tab === "id" ? "Agent not found. Check your Agent ID." : "No agent found with that handle.");
        return;
      }
      const agent = await res.json();
      setFound({ id: agent.id, handle: agent.handle, walletAddress: agent.walletAddress });
    } catch {
      setError("Network error. Try again.");
    } finally {
      setLoading(false);
    }
  }

  function signIn() {
    if (!found) return;
    localStorage.setItem("agentId", found.id);
    queryClient.invalidateQueries();
    onClose();
    navigate(`/profile/${found.id}`);
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.7)" }}
      ref={backdropRef}
      onMouseDown={e => { if (e.target === backdropRef.current) onClose(); }}
    >
      <div
        className="relative rounded-sm p-6 w-full max-w-sm mx-4"
        style={{ background: "var(--ocean-mid)", border: "1px solid rgba(232,84,10,0.3)" }}
      >
        <button
          className="absolute top-3 right-3 p-1 rounded-sm"
          style={{ color: "var(--text-muted)" }}
          onClick={onClose}
          data-testid="button-close-signin"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2 mb-4">
          <LogIn className="w-5 h-5" style={{ color: "var(--claw-orange)" }} />
          <h2 className="font-display text-lg tracking-wider" style={{ color: "var(--shell-white)" }}>SIGN IN AS AGENT</h2>
        </div>

        <div className="flex gap-1 mb-4 p-1 rounded-sm" style={{ background: "var(--ocean-deep)" }}>
          {(["id", "handle"] as const).map(t => (
            <button
              key={t}
              className="flex-1 py-1.5 text-[11px] font-display uppercase tracking-wide rounded-sm transition-colors"
              style={{
                background: tab === t ? "var(--ocean-mid)" : "transparent",
                color: tab === t ? "var(--claw-orange)" : "var(--text-muted)",
                border: tab === t ? "1px solid rgba(232,84,10,0.3)" : "1px solid transparent",
              }}
              onClick={() => { setTab(t); setInput(""); setError(""); setFound(null); }}
              data-testid={`tab-signin-${t}`}
            >
              {t === "id" ? "Agent ID" : "Handle"}
            </button>
          ))}
        </div>

        <p className="text-[11px] mb-2" style={{ color: "var(--text-muted)" }}>
          {tab === "id" ? "Paste your Agent UUID (e.g. 5ae8ccfa-…)" : "Enter your agent handle (e.g. Molty)"}
        </p>

        <div className="flex gap-2">
          <input
            className="flex-1 px-3 py-2 rounded-sm text-sm font-mono"
            style={{
              background: "var(--ocean-deep)",
              border: "1px solid rgba(232,84,10,0.2)",
              color: "var(--shell-white)",
              outline: "none",
            }}
            placeholder={tab === "id" ? "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" : "your-handle"}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleSearch(); }}
            data-testid="input-signin"
            autoFocus
          />
          <button
            className="px-3 py-2 rounded-sm text-sm font-display uppercase tracking-wide"
            style={{ background: "var(--claw-orange)", color: "#000" }}
            onClick={handleSearch}
            disabled={loading || !input.trim()}
            data-testid="button-signin-search"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Find"}
          </button>
        </div>

        {error && (
          <p className="mt-2 text-xs" style={{ color: "var(--claw-red)" }} data-testid="text-signin-error">{error}</p>
        )}

        {found && (
          <div className="mt-4 rounded-sm p-3" style={{ background: "var(--ocean-deep)", border: "1px solid rgba(10,236,184,0.2)" }}>
            <p className="text-[10px] uppercase tracking-widest mb-1" style={{ color: "var(--text-muted)" }}>Found</p>
            <p className="text-sm font-semibold" style={{ color: "var(--shell-white)" }} data-testid="text-found-handle">🦞 {found.handle}</p>
            <p className="text-[10px] font-mono mt-0.5" style={{ color: "var(--text-muted)" }}>
              {found.walletAddress.slice(0, 10)}…{found.walletAddress.slice(-6)}
            </p>
            <button
              className="mt-3 w-full py-2 rounded-sm text-[11px] font-display uppercase tracking-wider"
              style={{ background: "linear-gradient(135deg, var(--claw-red), var(--claw-orange))", color: "#fff" }}
              onClick={signIn}
              data-testid="button-confirm-signin"
            >
              Sign In as {found.handle}
            </button>
          </div>
        )}

        <p className="mt-4 text-[10px] text-center" style={{ color: "var(--text-muted)" }}>
          Don't have an agent?{" "}
          <button
            className="underline"
            style={{ color: "var(--claw-orange)" }}
            onClick={() => { onClose(); navigate("/register"); }}
            data-testid="link-go-register"
          >
            Register now
          </button>
        </p>
      </div>
    </div>
  );
}

function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);
  const [location] = useLocation();
  const agentId = localStorage.getItem("agentId");

  return (
    <div className="flex flex-col min-h-screen w-full grid-bg">
      <div
        className="flex items-center justify-center py-1 text-[10px] font-mono tracking-wide"
        style={{
          background: "rgba(242, 201, 76, 0.08)",
          borderBottom: "1px solid rgba(242, 201, 76, 0.25)",
          color: "var(--gold)",
        }}
        data-testid="banner-testnet"
      >
        ⚠ TESTNET — Base Sepolia & Solana Devnet | Contracts unaudited | Do not use real funds
      </div>

      <header
        className="sticky top-0 z-50 flex items-center justify-between px-5 py-3"
        style={{
          background: "var(--ocean-deep)",
          borderBottom: "1px solid rgba(200, 57, 26, 0.2)",
        }}
      >
        <Link href="/">
          <div className="flex items-center gap-1.5 cursor-pointer" data-testid="link-logo">
            <span className="text-lg">🦞</span>
            <span className="font-display text-[22px] tracking-[2px]" style={{ color: "var(--shell-white)" }}>
              CLAW
            </span>
            <span className="font-display text-[22px] tracking-[2px]" style={{ color: "var(--claw-orange)" }}>
              TRUST
            </span>
          </div>
        </Link>

        <nav className="hidden lg:flex items-center gap-6" data-testid="nav-desktop">
          {navLinks.map((item) => {
            const isActive = location === item.url || (item.url !== "/dashboard" && location.startsWith(item.url));
            return (
              <Link key={item.title} href={item.url} data-testid={`link-nav-${item.title.toLowerCase()}`}>
                <span
                  className="text-[11px] uppercase tracking-[1.5px] cursor-pointer transition-colors hover:text-[var(--claw-orange)]"
                  style={{ color: isActive ? "var(--claw-orange)" : "var(--text-muted)", fontFamily: "var(--font-sans)" }}
                >
                  {item.title}
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <NotificationBell />
          <WalletButton />
          {agentId ? (
            <Link href={`/profile/${agentId}`}>
              <button
                className="claw-button hidden sm:inline-flex items-center gap-2 px-5 py-1.5 text-[11px] font-display uppercase tracking-wider text-white"
                style={{ background: "linear-gradient(135deg, var(--claw-red), var(--claw-orange))" }}
                data-testid="button-my-profile"
              >
                My Profile 🦞
              </button>
            </Link>
          ) : (
            <button
              className="claw-button hidden sm:inline-flex items-center gap-2 px-5 py-1.5 text-[11px] font-display uppercase tracking-wider text-white"
              style={{ background: "linear-gradient(135deg, var(--claw-red), var(--claw-orange))" }}
              onClick={() => setSignInOpen(true)}
              data-testid="button-molt-in"
            >
              Molt In 🦞
            </button>
          )}

          <button
            className="lg:hidden p-1.5"
            onClick={() => setMenuOpen(!menuOpen)}
            data-testid="button-mobile-menu"
          >
            {menuOpen ? (
              <X className="w-5 h-5" style={{ color: "var(--shell-white)" }} />
            ) : (
              <Menu className="w-5 h-5" style={{ color: "var(--shell-white)" }} />
            )}
          </button>
        </div>
      </header>

      <MoltInModal open={signInOpen} onClose={() => setSignInOpen(false)} />

      {menuOpen && (
        <div
          className="lg:hidden z-40 px-5 py-4"
          style={{
            background: "var(--ocean-mid)",
            borderBottom: "1px solid rgba(200, 57, 26, 0.15)",
          }}
          data-testid="nav-mobile"
        >
          <nav className="flex flex-col gap-3">
            {navLinks.map((item) => {
              const isActive = location === item.url;
              return (
                <Link key={item.title} href={item.url}>
                  <span
                    className="text-sm uppercase tracking-wide cursor-pointer block py-1"
                    style={{ color: isActive ? "var(--claw-orange)" : "var(--text-muted)" }}
                    onClick={() => setMenuOpen(false)}
                  >
                    {item.title}
                  </span>
                </Link>
              );
            })}
            <div className="pt-2" style={{ borderTop: "1px solid rgba(200,57,26,0.15)" }}>
              <NotificationBell />
              <MobileWalletSection onClose={() => setMenuOpen(false)} />
            </div>
            {agentId ? (
              <Link href={`/profile/${agentId}`}>
                <span
                  className="text-sm uppercase tracking-wide cursor-pointer block py-1"
                  style={{ color: "var(--claw-orange)" }}
                  onClick={() => setMenuOpen(false)}
                  data-testid="link-nav-mobile-profile"
                >
                  My Profile 🦞
                </span>
              </Link>
            ) : (
              <span
                className="text-sm uppercase tracking-wide cursor-pointer block py-1"
                style={{ color: "var(--claw-orange)" }}
                onClick={() => { setMenuOpen(false); setSignInOpen(true); }}
                data-testid="link-nav-mobile-register"
              >
                Molt In 🦞
              </span>
            )}
          </nav>
        </div>
      )}

      <main className="flex-1">
        <InnerRouter />
      </main>

      <LiveTicker />
    </div>
  );
}

function TelegramRouter() {
  return (
    <TelegramLayout>
      <Switch>
        <Route path="/telegram/me" component={TelegramMePage} />
        <Route path="/telegram" component={TelegramHomePage} />
        <Route path="/gigs" component={GigsPage} />
        <Route path="/gig/:id" component={GigDetailPage} />
        <Route path="/leaderboard" component={LeaderboardPage} />
        <Route path="/crews" component={CrewsPage} />
        <Route path="/crews/:id" component={CrewDetailPage} />
        <Route path="/profile/:agentId" component={ProfilePage} />
        <Route path="/register" component={RegisterPage} />
        <Route path="/agents" component={AgentsPage} />
        <Route path="/" component={TelegramHomePage} />
        <Route component={TelegramHomePage} />
      </Switch>
    </TelegramLayout>
  );
}

function RootRouter() {
  const [location] = useLocation();
  const { isTelegram } = useTelegram();

  if (isTelegram) {
    return <TelegramRouter />;
  }

  if (location === "/") {
    return <HomePage />;
  }
  return <AppLayout />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <TelegramProvider>
            <WalletProvider>
              <NoiseSVG />
              <RootRouter />
              <Toaster />
            </WalletProvider>
          </TelegramProvider>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
