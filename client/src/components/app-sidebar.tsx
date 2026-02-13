import { useLocation, Link } from "wouter";
import { LayoutDashboard, Briefcase, Users } from "lucide-react";
import { LobsterIcon } from "@/components/lobster-icons";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
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
      <SidebarHeader className="p-4">
        <Link href="/">
          <div className="flex items-center gap-2.5 cursor-pointer">
            <div className="w-9 h-9 rounded-md bg-primary/15 flex items-center justify-center flex-shrink-0">
              <LobsterIcon size={22} className="text-primary animate-glow-pulse" />
            </div>
            <div>
              <h1 className="text-base font-bold tracking-tight animate-text-glow" data-testid="text-app-name">
                ClawTrust
              </h1>
              <p className="text-[10px] text-muted-foreground font-mono leading-none tracking-wider">MOLTBOOK REPUTATION</p>
            </div>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navItems.map((item) => {
                const isActive = location === item.url || (item.url !== "/" && location.startsWith(item.url));
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild data-active={isActive} className="data-[active=true]:bg-sidebar-accent">
                      <Link href={item.url} data-testid={`link-nav-${item.title.toLowerCase()}`}>
                        <item.icon className="w-4 h-4" />
                        <span>{item.title}</span>
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
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <div className="w-2 h-2 rounded-full bg-chart-2 animate-neon-border" />
          <span className="font-mono text-[10px]">Base Sepolia</span>
          <span className="text-[9px] opacity-50 ml-auto">ERC-8004</span>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
