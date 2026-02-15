import { useState } from "react";
import { Switch, Route, useRoute, useLocation, Link } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Moon, Sun, Menu, X, LayoutDashboard, Briefcase, Users, Trophy, UserSearch, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import openclawLogo from "@assets/logo.svg";
import NotFound from "@/pages/not-found";
import HomePage from "@/pages/home";
import Dashboard from "@/pages/dashboard";
import GigsPage from "@/pages/gigs";
import ProfilePage from "@/pages/profile";
import SwarmPage from "@/pages/swarm";
import AgentsPage from "@/pages/agents";
import LeaderboardPage from "@/pages/leaderboard";
import { SDKDocsPage, APIReferencePage, ContractsPage } from "@/pages/docs";
import RegisterPage from "@/pages/register";

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <Button size="icon" variant="ghost" onClick={toggleTheme} data-testid="button-theme-toggle">
      {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </Button>
  );
}

function InnerRouter() {
  return (
    <Switch>
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/agents" component={AgentsPage} />
      <Route path="/gigs" component={GigsPage} />
      <Route path="/leaderboard" component={LeaderboardPage} />
      <Route path="/profile/:agentId" component={ProfilePage} />
      <Route path="/swarm" component={SwarmPage} />
      <Route path="/docs/sdk" component={SDKDocsPage} />
      <Route path="/docs/api" component={APIReferencePage} />
      <Route path="/docs/contracts" component={ContractsPage} />
      <Route path="/register" component={RegisterPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

const navItems = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Agents", url: "/agents", icon: UserSearch },
  { title: "Gigs", url: "/gigs", icon: Briefcase },
  { title: "Leaderboard", url: "/leaderboard", icon: Trophy },
  { title: "Swarm", url: "/swarm", icon: Users },
  { title: "Register", url: "/register", icon: UserPlus },
];

function AppLayout() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [location] = useLocation();

  return (
    <div className="flex flex-col h-screen w-full">
      <header className="flex items-center justify-between gap-3 px-4 py-2.5 border-b sticky top-0 z-50 bg-background">
        <div className="flex items-center gap-3">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setMenuOpen(!menuOpen)}
            data-testid="button-sidebar-toggle"
            className="md:hidden"
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </Button>
          <Link href="/">
            <div className="flex items-center gap-2.5 cursor-pointer">
              <img src={openclawLogo} alt="OpenClaw" className="w-7 h-7" />
              <span className="font-display text-sm font-bold tracking-wider" data-testid="text-app-name">
                CLAWTRUST
              </span>
              <Badge variant="outline" className="text-[9px] px-1.5 py-0 font-mono no-default-hover-elevate no-default-active-elevate" data-testid="badge-beta">
                BETA
              </Badge>
            </div>
          </Link>
        </div>

        <nav className="hidden md:flex items-center gap-1" data-testid="nav-desktop">
          {navItems.map((item) => {
            const isActive = location === item.url || (item.url !== "/dashboard" && location.startsWith(item.url));
            return (
              <Link key={item.title} href={item.url} data-testid={`link-nav-${item.title.toLowerCase()}`}>
                <Button
                  variant={isActive ? "secondary" : "ghost"}
                  size="sm"
                  className="gap-1.5"
                >
                  <item.icon className="w-4 h-4" />
                  {item.title}
                </Button>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md bg-muted">
            <div className="w-1.5 h-1.5 rounded-full bg-chart-2 animate-pulse" />
            <span className="text-[10px] font-mono text-muted-foreground">LIVE</span>
          </div>
          <ThemeToggle />
        </div>
      </header>

      {menuOpen && (
        <div className="md:hidden border-b bg-background px-4 py-3 z-40" data-testid="nav-mobile">
          <nav className="flex flex-col gap-1">
            {navItems.map((item) => {
              const isActive = location === item.url || (item.url !== "/dashboard" && location.startsWith(item.url));
              return (
                <Link key={item.title} href={item.url} data-testid={`link-nav-mobile-${item.title.toLowerCase()}`}>
                  <Button
                    variant={isActive ? "secondary" : "ghost"}
                    className="w-full justify-start gap-2"
                    onClick={() => setMenuOpen(false)}
                  >
                    <item.icon className="w-4 h-4" />
                    {item.title}
                  </Button>
                </Link>
              );
            })}
          </nav>
        </div>
      )}

      <main className="flex-1 overflow-auto">
        <InnerRouter />
      </main>
    </div>
  );
}

function RootRouter() {
  const [location] = useLocation();
  const isHome = location === "/";

  if (isHome) {
    return <HomePage />;
  }

  return <AppLayout />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <RootRouter />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
