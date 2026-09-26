import { Link, useLocation } from "@tanstack/react-router";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  LuDownload,
  LuGrid3X3,
  LuHeart,
  LuHistory,
  LuHouse,
  LuLayoutDashboard,
} from "react-icons/lu";
import type React from "react";
import { lazy, Suspense, useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { IoMdSettings } from "react-icons/io";
import { LuX } from "react-icons/lu";

import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from "@/components/ui/dialog";
import { PersistentPlayerShell } from "@/features/playback/components/player/persistent-player-shell";
import { RecordingOutcomeBridge } from "@/features/media-library/components/recording/recording-completion-notice";
import { RecoveryBoundary } from "@/features/shell/components/recovery/RecoveryBoundary";
import { useNetworkStatus } from "@/features/settings/components/hooks/useNetworkStatus";
import { StreamRecordingProvider } from "@/features/media-library/components/hooks/use-stream-recording-state";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/features/shell/components/state/app-store";
import { usePipStore } from "@/features/playback/components/state/pip-store";

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

function subscribeToViewport(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function isCompactViewport() {
  return window.innerWidth < 1024;
}

function NavigationLinks({ collapsed, pathname }: { collapsed: boolean; pathname: string }) {
  const { t } = useTranslation();

  return (
    <nav className="shrink-0 py-4" aria-label="StreamFusion">
      <ul className="space-y-1 px-2">
        {navItems.map((item) => {
          const isActive = pathname === item.path;
          const Icon = item.icon;

          return (
            <li key={item.path}>
              <Link
                to={item.path}
                preload="intent"
                aria-current={isActive ? "page" : undefined}
                aria-label={collapsed ? t(`navigation.${item.translationKey}`) : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-md px-3 py-2 text-white transition-colors max-lg:min-h-11",
                  isActive ? "bg-zinc-700" : "hover:bg-[var(--color-background-tertiary)]",
                  collapsed && "justify-center px-2"
                )}
              >
                <Icon size={20} />
                {!collapsed && <span>{t(`navigation.${item.translationKey}`)}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function AppLayout({ children }: AppLayoutProps) {
  const { t } = useTranslation();
  // Use individual selectors to prevent re-renders when unrelated state changes
  const sidebarCollapsed = useAppStore((state) => state.sidebarCollapsed);
  const isTheaterModeActive = useAppStore((state) => state.isTheaterModeActive);
  const currentPipStream = usePipStore((state) => state.currentStream);
  const { isOnline, isChecking, retryInSeconds } = useNetworkStatus();
  const location = useLocation();
  const isModWorkspace = /^\/mod\/(twitch|kick)\/[^/]+\/?$/.test(location.pathname);
  const shouldRenderPersistentPlayer = Boolean(currentPipStream);
  const isBrowserDevClient =
    typeof window !== "undefined" && window.__STREAMFUSION_BROWSER_DEV_CLIENT__;
  const isCompact = useSyncExternalStore(subscribeToViewport, isCompactViewport, () => false);
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false);

  useEffect(() => {
    if (!isCompact) setMobileNavigationOpen(false);
  }, [isCompact]);

  useEffect(() => {
    setMobileNavigationOpen(false);
  }, [location.pathname]);

  return (
    <StreamRecordingProvider>
      <PersistentPlayerShell>
        <div className="h-full flex flex-col bg-[var(--color-background)] relative">
          {/* Custom Title Bar (window controls) */}
          {!isBrowserDevClient && <TitleBar />}

          {/* Top Navigation Bar (search, user info) */}
          {!isTheaterModeActive && !isModWorkspace && (
            <Dialog open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen}>
              <TopNavBar showPlatformHealth={isOnline} mobileMenu={isCompact} />
              {isCompact && (
                <DialogPortal>
                  <DialogOverlay data-testid="mobile-navigation-backdrop" className="bg-black/70" />
                  <DialogPrimitive.Content
                    aria-describedby={undefined}
                    onClick={(event) => {
                      if (event.target instanceof Element && event.target.closest("a")) {
                        setMobileNavigationOpen(false);
                      }
                    }}
                    className="fixed inset-y-0 left-0 z-50 flex w-[min(18rem,calc(100vw-2rem))] flex-col overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-background-secondary)] text-white shadow-[0_8px_32px_rgba(0,0,0,0.5)] focus:outline-none"
                  >
                    <div className="flex min-h-14 items-center justify-between border-b border-[var(--color-border)] px-4">
                      <DialogTitle>StreamFusion</DialogTitle>
                      <DialogPrimitive.Close
                        type="button"
                        aria-label={t("shell.titleBar.close")}
                        className="flex size-11 items-center justify-center rounded-md hover:bg-[var(--color-background-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                      >
                        <LuX size={20} />
                      </DialogPrimitive.Close>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto">
                      <NavigationLinks collapsed={false} pathname={location.pathname} />
                      <div className="mx-3 my-1 h-px bg-[var(--color-border)] opacity-50" />
                      <RecoveryBoundary name="Following sidebar" resetKey={location.pathname}>
                        <SidebarFollows collapsed={false} />
                      </RecoveryBoundary>
                    </div>
                  </DialogPrimitive.Content>
                </DialogPortal>
              )}
            </Dialog>
          )}

          {/* Main Layout */}
          <div className="flex-1 flex overflow-hidden">
            {/* Sidebar */}
            {!isModWorkspace && !isCompact && (
              <aside
                className={cn(
                  "flex flex-col overflow-hidden border-r border-[var(--color-border)] bg-[var(--color-background-secondary)] transition-[width] duration-300 ease-out",
                  sidebarCollapsed ? "w-16" : "w-56",
                  isTheaterModeActive && "hidden"
                )}
              >
                <NavigationLinks collapsed={sidebarCollapsed} pathname={location.pathname} />

                <div className="mx-3 my-1 h-px bg-[var(--color-border)] opacity-50" />

                {/* Followed Channels */}
                <RecoveryBoundary name="Following sidebar" resetKey={location.pathname}>
                  <SidebarFollows collapsed={sidebarCollapsed} />
                </RecoveryBoundary>
              </aside>
            )}

            {/* Main Content */}
            <main id="main-content-scroll-area" className="min-w-0 flex-1 overflow-auto">
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
