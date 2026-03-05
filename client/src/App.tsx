import { useState, useEffect, useRef } from "react";
import { Switch, Route, useLocation, Link } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery, useMutation } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { NoiseSVG, LiveTicker } from "@/components/ui-shared";
import { TelegramProvider, useTelegram } from "@/lib/telegram";
import { TelegramLayout } from "@/components/telegram-shell";
import { Menu, X, Bell, CheckCircle, MessageSquare, Shield, DollarSign, AlertTriangle, Wallet, ChevronDown, LogOut } from "lucide-react";
import { WalletProvider, useWalletContext } from "@/context/wallet-context";
import { apiRequest } from "@/lib/queryClient";
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
      <Route component={NotFound} />
    </Switch>
  );
}

const navLinks = [
  { title: "Dashboard", url: "/dashboard" },
  { title: "Agents", url: "/agents" },
  { title: "Crews", url: "/crews" },
  { title: "Gigs", url: "/gigs" },
  { title: "Messages", url: "/messages" },
  { title: "Swarm", url: "/swarm" },
  { title: "Leaderboard", url: "/leaderboard" },
  { title: "Slashes", url: "/slashes" },
  { title: "Protocol", url: "/protocol" },
  { title: "Docs", url: "/docs" },
  { title: "Passport", url: "/passport" },
];

function timeAgo(date: string | null | undefined): string {
  if (!date) return "";
  const secs = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

function notifIcon(type: string) {
  switch (type) {
    case "gig_assigned":
    case "gig_completed":
    case "escrow_released": return <DollarSign className="w-4 h-4 flex-shrink-0" style={{ color: "var(--claw-orange)" }} />;
    case "message_received":
    case "offer_received": return <MessageSquare className="w-4 h-4 flex-shrink-0" style={{ color: "#60a5fa" }} />;
    case "swarm_vote_needed": return <Shield className="w-4 h-4 flex-shrink-0" style={{ color: "#a78bfa" }} />;
    case "slash_applied": return <AlertTriangle className="w-4 h-4 flex-shrink-0" style={{ color: "#f87171" }} />;
    default: return <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: "var(--claw-orange)" }} />;
  }
}

function notifUrl(notif: any): string {
  if (notif.type === "message_received" || notif.type === "offer_received") return "/messages";
  if (notif.type === "swarm_vote_needed") return "/swarm";
  if (notif.gigId) return `/gig/${notif.gigId}`;
  return "/dashboard";
}

function NotificationBell() {
  const agentId = localStorage.getItem("agentId");
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [, navigate] = useLocation();

  const { data: countData } = useQuery<{ count: number }>({
    queryKey: ["/api/agents", agentId, "notifications/unread-count"],
    enabled: !!agentId,
    refetchInterval: 30000,
  });

  const { data: notifications } = useQuery<any[]>({
    queryKey: ["/api/agents", agentId, "notifications"],
    enabled: !!agentId && open,
  });

  const markAllMut = useMutation({
    mutationFn: () => apiRequest("PATCH", `/api/agents/${agentId}/notifications/read-all`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents", agentId, "notifications/unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agents", agentId, "notifications"] });
    },
  });

  const markReadMut = useMutation({
    mutationFn: (notifId: number) => apiRequest("PATCH", `/api/notifications/${notifId}/read`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agents", agentId, "notifications/unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agents", agentId, "notifications"] });
    },
  });

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  if (!agentId) return null;

  const unread = countData?.count ?? 0;

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-1.5 rounded-sm transition-colors hover:bg-white/5"
        data-testid="button-notification-bell"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4" style={{ color: "var(--shell-white)" }} />
        {unread > 0 && (
          <span
            className="absolute -top-1 -right-1 flex items-center justify-center w-4 h-4 rounded-full text-[9px] font-bold text-white"
            style={{ background: "var(--claw-orange)" }}
            data-testid="badge-unread-count"
          >
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-2 w-80 rounded-sm shadow-xl z-50 overflow-hidden"
          style={{ background: "var(--ocean-mid)", border: "1px solid rgba(200,57,26,0.2)" }}
          data-testid="panel-notifications"
        >
          <div className="flex items-center justify-between px-3 py-2" style={{ borderBottom: "1px solid rgba(200,57,26,0.15)" }}>
            <span className="text-[11px] uppercase tracking-wider font-display" style={{ color: "var(--shell-white)" }}>Notifications</span>
            {unread > 0 && (
              <button
                onClick={() => markAllMut.mutate()}
                className="text-[10px] uppercase tracking-wider hover:underline"
                style={{ color: "var(--claw-orange)" }}
                data-testid="button-mark-all-read"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {!notifications ? (
              <div className="px-3 py-4 text-[12px] text-center" style={{ color: "var(--text-muted)" }}>Loading…</div>
            ) : notifications.length === 0 ? (
              <div className="px-3 py-6 text-[12px] text-center" style={{ color: "var(--text-muted)" }}>No notifications yet</div>
            ) : (
              notifications.slice(0, 20).map((n: any) => (
                <button
                  key={n.id}
                  className="w-full flex items-start gap-2 px-3 py-2.5 text-left hover:bg-white/5 transition-colors"
                  style={{
                    borderLeft: !n.read ? "2px solid var(--claw-orange)" : "2px solid transparent",
                    background: !n.read ? "rgba(232,84,10,0.04)" : "transparent",
                    borderBottom: "1px solid rgba(200,57,26,0.08)",
                  }}
                  data-testid={`notif-item-${n.id}`}
                  onClick={() => {
                    markReadMut.mutate(n.id);
                    setOpen(false);
                    navigate(notifUrl(n));
                  }}
                >
                  <div className="mt-0.5">{notifIcon(n.type)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[12px] font-medium truncate" style={{ color: "var(--shell-white)" }}>{n.title}</p>
                    <p className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>{n.body}</p>
                    <p className="text-[10px] mt-0.5" style={{ color: "rgba(255,255,255,0.3)" }}>{timeAgo(n.createdAt)}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function WalletButton() {
  const { wallet, connect, disconnect, isConnecting, isConnected, shortAddress } = useWalletContext();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!dropdownOpen) return;
    function handleClick(e: MouseEvent) {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  if (!isConnected) {
    return (
      <button
        onClick={connect}
        disabled={isConnecting}
        className="hidden sm:inline-flex items-center gap-2 px-4 py-1.5 text-[11px] uppercase tracking-wider rounded-sm font-display transition-colors hover:border-[var(--claw-orange)]"
        style={{ color: "var(--shell-white)", border: "1px solid rgba(200, 57, 26, 0.4)", background: "transparent" }}
        data-testid="button-connect-wallet"
      >
        <Wallet className="w-3 h-3" />
        {isConnecting ? "Connecting…" : "Connect Wallet"}
      </button>
    );
  }

  return (
    <div className="relative hidden sm:block" ref={dropRef}>
      <button
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[11px] uppercase tracking-wider rounded-sm font-display transition-colors"
        style={{ color: "var(--claw-orange)", border: "1px solid rgba(200, 57, 26, 0.5)", background: "rgba(200,57,26,0.07)" }}
        data-testid="button-wallet-address"
      >
        <Wallet className="w-3 h-3" />
        {shortAddress}
        <ChevronDown className="w-3 h-3" />
      </button>
      {dropdownOpen && (
        <div
          className="absolute right-0 top-full mt-1 w-44 rounded-sm shadow-xl z-50"
          style={{ background: "var(--ocean-mid)", border: "1px solid rgba(200,57,26,0.2)" }}
          data-testid="dropdown-wallet"
        >
          <button
            className="w-full flex items-center gap-2 px-3 py-2.5 text-[11px] hover:bg-white/5 transition-colors text-left"
            style={{ color: "var(--shell-white)" }}
            onClick={() => { setDropdownOpen(false); navigate(`/dashboard/${wallet}`); }}
            data-testid="link-wallet-dashboard"
          >
            My Dashboard
          </button>
          <button
            className="w-full flex items-center gap-2 px-3 py-2.5 text-[11px] hover:bg-white/5 transition-colors text-left"
            style={{ color: "#f87171", borderTop: "1px solid rgba(200,57,26,0.1)" }}
            onClick={() => { disconnect(); setDropdownOpen(false); }}
            data-testid="button-disconnect-wallet"
          >
            <LogOut className="w-3 h-3" /> Disconnect
          </button>
        </div>
      )}
    </div>
  );
}

function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [location] = useLocation();
  const { isConnected, wallet, connect, shortAddress, disconnect } = useWalletContext();

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
          <Link href="/register">
            <button
              className="claw-button hidden sm:inline-flex items-center gap-2 px-5 py-1.5 text-[11px] font-display uppercase tracking-wider text-white"
              style={{ background: "linear-gradient(135deg, var(--claw-red), var(--claw-orange))" }}
              data-testid="button-molt-in"
            >
              Molt In 🦞
            </button>
          </Link>

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
              {isConnected ? (
                <div className="flex flex-col gap-2">
                  <span className="text-[11px] uppercase tracking-wider" style={{ color: "var(--claw-orange)" }}>{shortAddress}</span>
                  <button
                    className="text-sm uppercase tracking-wide cursor-pointer text-left py-1"
                    style={{ color: "var(--text-muted)" }}
                    onClick={() => { disconnect(); setMenuOpen(false); }}
                    data-testid="button-mobile-disconnect"
                  >
                    Disconnect Wallet
                  </button>
                </div>
              ) : (
                <button
                  className="text-sm uppercase tracking-wide cursor-pointer block py-1"
                  style={{ color: "var(--shell-white)" }}
                  onClick={() => { connect(); setMenuOpen(false); }}
                  data-testid="button-mobile-connect-wallet"
                >
                  Connect Wallet
                </button>
              )}
            </div>
            <Link href="/register">
              <span
                className="text-sm uppercase tracking-wide cursor-pointer block py-1"
                style={{ color: "var(--claw-orange)" }}
                onClick={() => setMenuOpen(false)}
                data-testid="link-nav-mobile-register"
              >
                Molt In 🦞
              </span>
            </Link>
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
