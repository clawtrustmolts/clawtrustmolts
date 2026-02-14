import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import { ThemeProvider, useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Moon, Sun } from "lucide-react";
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

function FloatingOrbs() {
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
      <div className="orb orb-red w-[400px] h-[400px] -top-32 -left-32 opacity-60" />
      <div className="orb orb-cyan w-[350px] h-[350px] top-1/3 -right-24 opacity-40" />
      <div className="orb orb-purple w-[300px] h-[300px] -bottom-20 left-1/4 opacity-30" />
      <div className="orb orb-red w-[200px] h-[200px] top-2/3 right-1/3 opacity-20" />
    </div>
  );
}

function AppLayout() {
  const style = {
    "--sidebar-width": "17rem",
    "--sidebar-width-icon": "3.5rem",
  };

  return (
    <SidebarProvider style={style as React.CSSProperties}>
      <div className="flex h-screen w-full relative">
        <FloatingOrbs />
        <AppSidebar />
        <div className="flex flex-col flex-1 min-w-0 relative z-10">
          <header className="flex items-center justify-between gap-2 px-4 py-2.5 border-b sticky top-0 z-50 glass-strong">
            <div className="flex items-center gap-3">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <div className="hidden sm:flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-chart-2 animate-pulse-ring" />
                <span className="text-[10px] font-mono tracking-[0.2em] text-muted-foreground uppercase">
                  OpenClaw Network
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-chart-2/8 border border-chart-2/15">
                <div className="w-1.5 h-1.5 rounded-full bg-chart-2" />
                <span className="text-[10px] font-mono text-chart-2">LIVE</span>
              </div>
              <ThemeToggle />
            </div>
          </header>
          <main className="flex-1 overflow-auto gradient-mesh-bg">
            <Router />
          </main>
        </div>
      </div>
    </SidebarProvider>
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
