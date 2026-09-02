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
import { lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { IoMdSettings } from "react-icons/io";

import { PersistentPlayerShell } from "@/features/playback/components/player/persistent-player-shell";
import { RecordingOutcomeBridge } from "@/features/media-library/components/recording/recording-completion-notice";
import { RecoveryBoundary } from "@/features/shell/components/recovery/RecoveryBoundary";
import { useNetworkStatus } from "@/features/settings/data/useNetworkStatus";
import { StreamRecordingProvider } from "@/features/media-library/data/use-stream-recording-state";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import { usePipStore } from "@/store/pip-store";

import { TopNavBar } from "../TopNavBar";

import { NetworkStatusBanner } from "./NetworkStatusBanner";
import { SidebarFollows } from "./SidebarFollows";
import { TitleBar } from "./TitleBar";

const MiniPlayer = lazy(() =>
  import("@/features/playback/components/player/mini-player").then((module) => ({
    default: module.MiniPlayer,
  }))
);

interface AppLayoutProps {
  children: React.ReactNode;
}

const navItems = [
  { path: "/", translationKey: "home", icon: LuHouse },
  {
    path: "/following",
    translationKey: "following",
    icon: LuHeart,
  },
  {
    path: "/categories",
    translationKey: "categories",
    icon: LuGrid3X3,
  },
  {
    path: "/multistream",
    translationKey: "multiview",
    icon: LuLayoutDashboard,
  },
  { path: "/history", translationKey: "history", icon: LuHistory },
  {
    path: "/downloads",
    translationKey: "downloads",
    icon: LuDownload,
  },
  {
    path: "/settings",
    translationKey: "settings",
    icon: IoMdSettings,
  },
] as const;

export function AppLayout({ children }: AppLayoutProps) {
  const { t } = useTranslation();
  // Use individual selectors to prevent re-renders when unrelated state changes
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const _setSidebarCollapsed = useAppStore((state) => state.setSidebarCollapsed);
  const isTheaterModeActive = useAppStore((state) => state.isTheaterModeActive);
  const currentPipStream = usePipStore((state) => state.currentStream);
  const { isOnline, isChecking, retryInSeconds } = useNetworkStatus();
  const location = useLocation();
  const shouldRenderPersistentPlayer = Boolean(currentPipStream);

  return (
    <StreamRecordingProvider>
      <PersistentPlayerShell>
        <div className="h-full flex flex-col bg-[var(--color-background)] relative">
          {/* Custom Title Bar (window controls) */}
          <TitleBar />

          {/* Top Navigation Bar (search, user info) */}
          {!isTheaterModeActive && <TopNavBar showPlatformHealth={isOnline} />}

          {/* Main Layout */}
          <div className="flex-1 flex overflow-hidden">
            {/* Sidebar */}
            <aside
              className={cn(
                "flex flex-col overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-background-secondary)] transition-[width] duration-300 ease-out",
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
                          preload="intent"
                          className={cn(
                            "flex items-center gap-3 px-3 py-2 rounded-md transition-colors",
                            isActive
                              ? "bg-zinc-700 text-white"
                              : "text-white hover:bg-[var(--color-background-tertiary)] hover:text-white",
                            sidebarCollapsed && "justify-center px-2"
                          )}
                        >
                          <Icon size={20} />
                          {!sidebarCollapsed && (
                            <span>{t(`navigation.${item.translationKey}`)}</span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </nav>

              <div className="mx-3 my-1 h-px bg-[var(--color-border)] opacity-50" />

              {/* Followed Channels */}
              <RecoveryBoundary name="Following sidebar" resetKey={location.pathname}>
                <SidebarFollows collapsed={sidebarCollapsed} />
              </RecoveryBoundary>
            </aside>

            {/* Main Content */}
            <main id="main-content-scroll-area" className="flex-1 overflow-auto">
              {children}
            </main>
          </div>

          {/* Persistent player moves between the stream-page dock and mini mode. */}
          {shouldRenderPersistentPlayer && (
            <RecoveryBoundary name="Mini player" resetKey={currentPipStream?.channelName}>
              <Suspense fallback={null}>
                <MiniPlayer />
              </Suspense>
            </RecoveryBoundary>
          )}
          <NetworkStatusBanner
            isOnline={isOnline}
            isChecking={isChecking}
            retryInSeconds={retryInSeconds}
            isTheaterModeActive={isTheaterModeActive}
          />
          <RecordingOutcomeBridge />
        </div>
      </PersistentPlayerShell>
    </StreamRecordingProvider>
  );
}
