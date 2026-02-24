import { useState } from "react";
import { Switch, Route, useLocation, Link } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { NoiseSVG, LiveTicker } from "@/components/ui-shared";
import { Menu, X } from "lucide-react";
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
  { title: "Protocol", url: "/protocol" },
  { title: "Docs", url: "/docs" },
  { title: "Passport", url: "/passport" },
];

function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [location] = useLocation();

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

        <div className="flex items-center gap-3">
          <button
            className="hidden sm:inline-flex items-center gap-2 px-4 py-1.5 text-[11px] uppercase tracking-wider rounded-sm font-display transition-colors hover:border-[var(--claw-orange)]"
            style={{
              color: "var(--shell-white)",
              border: "1px solid rgba(200, 57, 26, 0.4)",
              background: "transparent",
            }}
            data-testid="button-connect-wallet"
          >
            Connect Wallet
          </button>
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

function RootRouter() {
  const [location] = useLocation();
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
          <NoiseSVG />
          <RootRouter />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
