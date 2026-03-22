import { useLocation } from "wouter";
import { useTelegram } from "@/lib/telegram";
import { Home, Briefcase, Trophy, Users, User } from "lucide-react";

const tabs = [
  { path: "/telegram", label: "Home", icon: Home, emoji: "🏠" },
  { path: "/gigs", label: "Gigs", icon: Briefcase, emoji: "💼" },
  { path: "/leaderboard", label: "Ranks", icon: Trophy, emoji: "🏆" },
  { path: "/crews", label: "Crews", icon: Users, emoji: "👥" },
  { path: "/telegram/me", label: "Me", icon: User, emoji: "👤" },
];

export function TelegramBottomTabs() {
  const [location, setLocation] = useLocation();
  const { hapticLight } = useTelegram();

  const isActive = (path: string) => {
    if (path === "/telegram") return location === "/telegram" || location === "/";
    return location.startsWith(path);
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around"
      style={{
        height: 60,
        backgroundColor: "#0D1829",
        borderTop: "1px solid rgba(200,57,26,0.3)",
      }}
      data-testid="telegram-tab-bar"
    >
      {tabs.map((tab) => {
        const active = isActive(tab.path);
        return (
          <button
            key={tab.path}
            onClick={() => {
              hapticLight();
              setLocation(tab.path);
            }}
            className="flex flex-col items-center justify-center gap-0.5 flex-1 h-full border-none bg-transparent cursor-pointer"
            style={{
              color: active ? "#C8391A" : "#6B7FA3",
              fontFamily: "Syne, sans-serif",
              fontSize: 10,
            }}
            data-testid={`tab-${tab.label.toLowerCase()}`}
          >
            <tab.icon size={22} strokeWidth={active ? 2.5 : 1.5} />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function TelegramLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex flex-col min-h-screen w-full"
      style={{ backgroundColor: "#080E1A" }}
    >
      <main className="flex-1 pb-[68px] overflow-y-auto">
        {children}
      </main>
      <TelegramBottomTabs />
    </div>
  );
}
