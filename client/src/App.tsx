import { useState } from "react";
import { Switch, Route, useLocation, Link } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Moon, Sun, Menu, X, LayoutDashboard, Briefcase, Users } from "lucide-react";
import openclawLogo from "@assets/logo.svg";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import GigsPage from "@/pages/gigs";
import ProfilePage from "@/pages/profile";
import SwarmPage from "@/pages/swarm";

function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <Button size="icon" variant="ghost" onClick={toggleTheme} data-testid="button-theme-toggle">
      {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
    </Button>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/gigs" component={GigsPage} />
      <Route path="/profile/:agentId" component={ProfilePage} />
      <Route path="/swarm" component={SwarmPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Gigs", url: "/gigs", icon: Briefcase },
  { title: "Swarm", url: "/swarm", icon: Users },
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
            </div>
          </Link>
        </div>

        <nav className="hidden md:flex items-center gap-1" data-testid="nav-desktop">
          {navItems.map((item) => {
            const isActive = location === item.url || (item.url !== "/" && location.startsWith(item.url));
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
              const isActive = location === item.url || (item.url !== "/" && location.startsWith(item.url));
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
        <Router />
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <AppLayout />
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
