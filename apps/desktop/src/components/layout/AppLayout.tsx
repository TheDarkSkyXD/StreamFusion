import { Link, useLocation } from "@tanstack/react-router";
import {
  Download as LuDownload,
  Grid3x3 as LuGrid3X3,
  Heart as LuHeart,
  History as LuHistory,
  House as LuHouse,
  LayoutDashboard as LuLayoutDashboard,
} from "lucide-react";
import type React from "react";
import { IoMdSettings } from "react-icons/io";

import { MiniPlayer } from "@/components/player/mini-player";
import { useAuthInitialize } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";

import { TopNavBar } from "../TopNavBar";

import { SidebarFollows } from "./SidebarFollows";
import { TitleBar } from "./TitleBar";

interface AppLayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { path: "/", label: "Home", icon: LuHouse },
  { path: "/following", label: "Following", icon: LuHeart },
  { path: "/categories", label: "Categories", icon: LuGrid3X3 },
  { path: "/multistream", label: "MultiView", icon: LuLayoutDashboard },
  { path: "/history", label: "History", icon: LuHistory },
  { path: "/downloads", label: "Downloads", icon: LuDownload },
  { path: "/settings", label: "Settings", icon: IoMdSettings },
] as const;

export function AppLayout({ children }: AppLayoutProps) {
  // Use individual selectors to prevent re-renders when unrelated state changes
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const _setSidebarCollapsed = useAppStore((state) => state.setSidebarCollapsed);
  const isTheaterModeActive = useAppStore((state) => state.isTheaterModeActive);
  const location = useLocation();

  // Initialize auth state once at the app root
  useAuthInitialize();

  return (
    <div className="h-full flex flex-col bg-[var(--color-background)] relative">
      {/* Custom Title Bar (window controls) */}
      <TitleBar />

      {/* Top Navigation Bar (search, user info) */}
      {!isTheaterModeActive && <TopNavBar />}

      {/* Main Layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <aside
          className={cn(
            "flex flex-col border-r border-[var(--color-border)] bg-[var(--color-background-secondary)] transition-[width] duration-300 ease-out",
            sidebarCollapsed ? "w-16" : "w-56",
            isTheaterModeActive && "hidden"
          )}
        >
          {/* Navigation */}
          <nav className="shrink-0 py-4">
            <ul className="space-y-1 px-2">
              {navItems.map((item) => {
                const isActive = location.pathname === item.path;
                const Icon = item.icon;

                return (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-md transition-colors",
                        isActive
                          ? "bg-zinc-700 text-white"
                          : "text-white hover:bg-[var(--color-background-tertiary)] hover:text-white",
                        sidebarCollapsed && "justify-center px-2"
                      )}
                    >
                      <Icon size={20} />
                      {!sidebarCollapsed && <span>{item.label}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="mx-3 my-1 h-px bg-[var(--color-border)] opacity-50" />

          {/* Followed Channels */}
          <SidebarFollows collapsed={sidebarCollapsed} />
        </aside>

        {/* Main Content */}
        <main id="main-content-scroll-area" className="flex-1 overflow-auto">
          {children}
        </main>
      </div>

      {/* Picture-in-Picture Mini Player - persists across route changes */}
      <MiniPlayer />
    </div>
  );
}
