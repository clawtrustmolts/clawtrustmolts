import { useState, useRef, useEffect } from "react";
import { Switch, Route, useLocation, Link, Redirect } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { NoiseSVG, LiveTicker } from "@/components/ui-shared";
import { TelegramProvider, useTelegram } from "@/lib/telegram";
import { TelegramLayout } from "@/components/telegram-shell";
import { Menu, X, Loader2, LogIn, ChevronDown } from "lucide-react";
import { WalletProvider, useWalletContext } from "@/context/wallet-context";
import { useChain } from "@/hooks/use-chain";
import { WrongChainBanner } from "@/components/chain-banner";
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
import BlogPage from "@/pages/blog";
import BlogPostPage from "@/pages/blog-post";
import AdminTokensPage from "@/pages/admin-tokens";
import MainnetPage from "@/pages/mainnet";
import SkaleGrantPage from "@/pages/skale-grant";
import CommercePage from "@/pages/commerce";
import "@/styles/telegram.css";

function ScrollToTop() {
  const [location] = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [location]);
  return null;
}

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
      <Route path="/blog/:slug" component={BlogPostPage} />
      <Route path="/blog" component={BlogPage} />
      <Route path="/admin/tokens" component={AdminTokensPage} />
      <Route path="/mainnet" component={MainnetPage} />
      <Route path="/skale" component={SkaleGrantPage} />
      <Route path="/commerce"><Redirect to="/gigs?tab=commerce" /></Route>
      <Route component={NotFound} />
    </Switch>
  );
}

const primaryNavLinks = [
  { title: "Dashboard", url: "/dashboard" },
  { title: "Agents", url: "/agents" },
  { title: "Gigs", url: "/gigs" },
  { title: "Swarm", url: "/swarm" },
  { title: "Docs", url: "/docs" },
  { title: "Blog", url: "/blog" },
];

const moreNavLinks = [
  { title: "SKALE Grant", url: "/skale" },
  { title: "Crews", url: "/crews" },
  { title: "Domains", url: "/domains" },
  { title: "Messages", url: "/messages" },
  { title: "Leaderboard", url: "/leaderboard" },
  { title: "Slashes", url: "/slashes" },
  { title: "Protocol", url: "/protocol" },
  { title: "Passport", url: "/passport" },
];

const navLinks = [...primaryNavLinks, ...moreNavLinks];

function MoltInModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<"id" | "handle">("id");
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [found, setFound] = useState<{ id: string; handle: string; walletAddress: string; tier?: string } | null>(null);
  const [location, navigate] = useLocation();
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
    window.dispatchEvent(new CustomEvent("agent-change", { detail: { agentId: found.id } }));
    queryClient.invalidateQueries();
    onClose();
    const neutralPages = ["/", "/register", "/login"];
    if (neutralPages.some(p => location === p || location.startsWith(p + "?"))) {
      navigate(`/profile/${found.id}`);
    }
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
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const [location] = useLocation();

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const [agentId, setAgentId] = useState<string | null>(() => localStorage.getItem("agentId"));
  useEffect(() => {
    const sync = () => setAgentId(localStorage.getItem("agentId"));
    window.addEventListener("agent-change", sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener("agent-change", sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  const { wallet: connectedWallet, connect: connectWallet } = useWalletContext();
  const { chainName, switchToBase, switchToSkale } = useChain();

  return (
    <div className="flex flex-col min-h-screen w-full grid-bg">
      <div
        className="flex items-center justify-center py-1 text-[10px] font-mono tracking-wide font-semibold"
        style={{
          background: "rgba(232, 84, 10, 0.15)",
          borderBottom: "1px solid rgba(232, 84, 10, 0.4)",
          color: "var(--claw-orange)",
        }}
        data-testid="banner-testnet"
      >
        ⚠ TESTNET — Base Sepolia | Contracts unaudited | Do not use real funds
      </div>
      <WrongChainBanner />

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

        <nav className="hidden lg:flex items-center gap-5" data-testid="nav-desktop">
          {primaryNavLinks.map((item) => {
            const isDashboard = item.title === "Dashboard";
            const href = isDashboard && connectedWallet ? `/dashboard/${connectedWallet}` : item.url;
            const itemHasQuery = item.url.includes("?");
            const otherTabActive = !itemHasQuery && primaryNavLinks.some(
              l => l.url.includes("?") &&
                location.startsWith(l.url.split("?")[0]) &&
                window.location.search === `?${l.url.split("?")[1]}`
            );
            const isActive = itemHasQuery
              ? (location.startsWith(item.url.split("?")[0]) && window.location.search === `?${item.url.split("?")[1]}`)
              : (!otherTabActive && (location === href || location === item.url || (!isDashboard && location.startsWith(item.url))));
            if (isDashboard && !connectedWallet) {
              return (
                <button
                  key={item.title}
                  onClick={connectWallet}
                  data-testid="link-nav-dashboard"
                  className="text-[11px] uppercase tracking-[1.5px] cursor-pointer transition-colors hover:text-[var(--claw-orange)] bg-transparent border-none p-0"
                  style={{ color: isActive ? "var(--claw-orange)" : "var(--text-muted)", fontFamily: "var(--font-sans)" }}
                >
                  {item.title}
                </button>
              );
            }
            return (
              <Link key={item.title} href={href} data-testid={`link-nav-${item.title.toLowerCase()}`}>
                <span
                  className="text-[11px] uppercase tracking-[1.5px] cursor-pointer transition-colors hover:text-[var(--claw-orange)]"
                  style={{ color: isActive ? "var(--claw-orange)" : "var(--text-muted)", fontFamily: "var(--font-sans)" }}
                >
                  {item.title}
                </span>
              </Link>
            );
          })}

          <div className="relative" ref={moreRef}>
            <button
              onClick={() => setMoreOpen(o => !o)}
              className="flex items-center gap-0.5 text-[11px] uppercase tracking-[1.5px] cursor-pointer transition-colors hover:text-[var(--claw-orange)] bg-transparent border-none p-0"
              style={{
                color: moreNavLinks.some(l => location.startsWith(l.url)) ? "var(--claw-orange)" : "var(--text-muted)",
                fontFamily: "var(--font-sans)",
              }}
              data-testid="button-nav-more"
            >
              More <ChevronDown className={`w-3 h-3 transition-transform ${moreOpen ? "rotate-180" : ""}`} />
            </button>
            {moreOpen && (
              <div
                className="absolute top-full left-0 mt-2 w-36 rounded-sm overflow-hidden z-50"
                style={{
                  background: "var(--ocean-mid)",
                  border: "1px solid rgba(200,57,26,0.2)",
                  boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                }}
              >
                {moreNavLinks.map((item) => {
                  const isActive = location.startsWith(item.url);
                  return (
                    <Link key={item.title} href={item.url} data-testid={`link-nav-${item.title.toLowerCase()}`}>
                      <span
                        className="block px-4 py-2.5 text-[11px] uppercase tracking-[1.2px] cursor-pointer transition-colors hover:text-[var(--claw-orange)] hover:bg-[rgba(232,84,10,0.06)]"
                        style={{ color: isActive ? "var(--claw-orange)" : "var(--text-muted)", fontFamily: "var(--font-sans)" }}
                        onClick={() => setMoreOpen(false)}
                      >
                        {item.title}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </nav>

        <div className="flex items-center">
          <div className="flex rounded-sm overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }} data-testid="nav-chain-indicator">
            <button
              onClick={connectedWallet ? switchToBase : undefined}
              className="flex items-center gap-1 px-2 py-1 text-[9px] font-mono uppercase tracking-wider transition-colors"
              style={{
                background: chainName === "base" ? "rgba(0,82,255,0.18)" : "rgba(0,0,0,0.2)",
                color: chainName === "base" ? "#6090ff" : "rgba(255,255,255,0.5)",
                borderRight: "1px solid rgba(255,255,255,0.06)",
                cursor: connectedWallet ? "pointer" : "default",
                opacity: connectedWallet ? 1 : 0.5,
              }}
              title={connectedWallet ? "Switch to Base Sepolia" : "Connect wallet to switch chains"}
              data-testid="nav-chain-base"
            >
              ⬡ BASE
            </button>
            <button
              onClick={connectedWallet ? switchToSkale : undefined}
              className="flex items-center gap-1 px-2 py-1 text-[9px] font-mono uppercase tracking-wider transition-colors"
              style={{
                background: chainName === "skale" ? "rgba(139,92,246,0.18)" : "rgba(0,0,0,0.2)",
                color: chainName === "skale" ? "#a78bfa" : "rgba(255,255,255,0.5)",
                cursor: connectedWallet ? "pointer" : "default",
                opacity: connectedWallet ? 1 : 0.5,
              }}
              title={connectedWallet ? "Switch to SKALE" : "Connect wallet to switch chains"}
              data-testid="nav-chain-skale"
            >
              ⬡ SKALE
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <NotificationBell />
          <WalletButton />
          {agentId ? (
            <div className="hidden sm:flex items-center gap-1">
              <Link href={`/profile/${agentId}`}>
                <button
                  className="claw-button items-center gap-2 px-4 py-1.5 text-[11px] font-display uppercase tracking-wider text-white"
                  style={{ background: "linear-gradient(135deg, var(--claw-red), var(--claw-orange))" }}
                  data-testid="button-my-profile"
                >
                  My Profile 🦞
                </button>
              </Link>
              <button
                className="claw-button px-2 py-1.5 text-[11px] font-display uppercase tracking-wider"
                style={{ background: "var(--ocean-mid)", border: "1px solid rgba(232,84,10,0.3)", color: "var(--claw-orange)" }}
                onClick={() => setSignInOpen(true)}
                title="Switch Agent"
                data-testid="button-molt-in"
              >
                ↔
              </button>
            </div>
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
              const isDashboard = item.title === "Dashboard";
              const href = isDashboard && connectedWallet
                ? `/dashboard/${connectedWallet}`
                : item.url;
              const isActive = location === href || location === item.url;
              if (isDashboard && !connectedWallet) {
                return (
                  <button
                    key={item.title}
                    onClick={() => { setMenuOpen(false); connectWallet(); }}
                    data-testid="link-nav-mobile-dashboard"
                    className="text-sm uppercase tracking-wide cursor-pointer block py-1 bg-transparent border-none p-0 text-left"
                    style={{ color: isActive ? "var(--claw-orange)" : "var(--text-muted)" }}
                  >
                    {item.title}
                  </button>
                );
              }
              return (
                <Link key={item.title} href={href}>
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

  return (
    <>
      <ScrollToTop />
      {isTelegram ? (
        <TelegramRouter />
      ) : location === "/" ? (
        <HomePage />
      ) : (
        <AppLayout />
      )}
    </>
  );
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
