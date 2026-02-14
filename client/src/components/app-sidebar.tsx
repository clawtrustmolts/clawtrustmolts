import { useLocation, Link } from "wouter";
import { LayoutDashboard, Briefcase, Users, Radio } from "lucide-react";
import openclawLogo from "@assets/logo.svg";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";

const navItems = [
  { title: "Dashboard", url: "/", icon: LayoutDashboard },
  { title: "Gigs", url: "/gigs", icon: Briefcase },
  { title: "Swarm", url: "/swarm", icon: Users },
];

export function AppSidebar() {
  const [location] = useLocation();

  return (
    <Sidebar>
      <SidebarHeader className="p-5 pb-6">
        <Link href="/">
          <div className="flex items-center gap-3 cursor-pointer group">
            <div className="w-10 h-10 rounded-md flex items-center justify-center flex-shrink-0 neon-border-red">
              <img src={openclawLogo} alt="OpenClaw" className="w-8 h-8 animate-glow-pulse" />
            </div>
            <div>
              <h1 className="font-display text-sm font-semibold tracking-wider gradient-text" data-testid="text-app-name">
                CLAWTRUST
              </h1>
              <p className="text-[9px] text-muted-foreground font-mono leading-none tracking-[0.15em] mt-0.5">OPENCLAW PROTOCOL</p>
            </div>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = location === item.url || (item.url !== "/" && location.startsWith(item.url));
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      data-active={isActive}
                      className={`data-[active=true]:bg-sidebar-accent ${isActive ? "neon-border-red" : ""}`}
                    >
                      <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase()}`}>
                        <item.icon className="w-4 h-4" />
                        <span className="text-sm">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="p-4">
        <div className="rounded-md p-3 bg-sidebar-accent/50">
          <div className="flex items-center gap-2 mb-2">
            <Radio className="w-3 h-3 text-chart-2" />
            <span className="text-[10px] font-mono text-chart-2 tracking-wider">BASE SEPOLIA</span>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[9px] font-mono text-muted-foreground">ERC-8004</span>
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-chart-2 animate-pulse" />
              <span className="text-[9px] font-mono text-chart-2">synced</span>
            </div>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
