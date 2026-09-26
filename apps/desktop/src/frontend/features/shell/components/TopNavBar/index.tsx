import { Link } from "@tanstack/react-router";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { LuMenu } from "react-icons/lu";

import streamFusionLogo from "@/assets/brand/streamfusion-logo.png";
import { ProfileDropdown } from "@/features/auth/components/auth/ProfileDropdown";
import { DialogTrigger } from "@/components/ui/dialog";
import { PlatformHealthIndicator } from "@/features/shell/components/layout/PlatformHealthIndicator";
import { RecordingGlobalIndicator } from "@/features/media-library/components/recording/recording-global-indicator";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/features/shell/components/state/app-store";

import { NotificationsDropdown } from "./NotificationsDropdown";
import { SearchBar } from "./SearchBar";

interface TopNavBarProps {
  className?: string;
  showPlatformHealth?: boolean;
  mobileMenu?: boolean;
}

export const TopNavBar = memo(function TopNavBar({
  className,
  showPlatformHealth = true,
  mobileMenu = false,
}: TopNavBarProps) {
  // Use individual selectors so this component re-renders only when these
  // two values change — destructuring the full store subscribed to every
  // mutation (theater toggle, etc.) and caused 30s viewer-count polls to
  // re-render the nav chrome unnecessarily.
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "grid h-[104px] grid-cols-[minmax(0,1fr)_max-content] grid-rows-[56px_48px] items-center border-b border-[var(--color-border)] bg-[var(--color-background)] px-3 lg:h-14 lg:grid-cols-[250px_minmax(0,1fr)_max-content] lg:grid-rows-1 lg:px-4",
        className
      )}
    >
      {/* Left side - Brand + Sidebar Toggle */}
      <div className="col-start-1 row-start-1 flex min-w-0 items-center gap-2 lg:gap-3">
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed, true)}
          className="-ml-2 hidden rounded-md p-2 text-white transition-colors hover:bg-[var(--color-background-secondary)] lg:block"
          title={
            sidebarCollapsed ? t("shell.topNav.expandSidebar") : t("shell.topNav.collapseSidebar")
          }
        >
          <LuMenu size={20} strokeWidth={3} />
        </button>
        {mobileMenu && (
          <DialogTrigger asChild>
            <button
              type="button"
              aria-label="Open navigation"
              className="-ml-2 flex size-11 shrink-0 items-center justify-center rounded-md text-white transition-colors hover:bg-[var(--color-background-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white lg:hidden"
            >
              <LuMenu size={20} strokeWidth={3} />
            </button>
          </DialogTrigger>
        )}
        <Link
          to="/"
          aria-label="StreamFusion"
          className="flex min-w-0 items-center gap-2 text-xl font-bold text-white tracking-tight hover:opacity-90 transition-opacity"
        >
          <img src={streamFusionLogo} alt="" className="h-7 w-7 shrink-0 object-contain" />
          <span className="hidden min-[400px]:inline">StreamFusion</span>
        </Link>
      </div>

      {/* Center - Search */}
      <div className="col-span-2 row-start-2 flex w-full min-w-0 items-center justify-center pb-2 lg:col-span-1 lg:col-start-2 lg:row-start-1 lg:pb-0">
        <SearchBar className="w-full max-w-none lg:max-w-[420px]" />
      </div>

      {/* Right side - Notifications + User */}
      <div className="col-start-2 row-start-1 ml-1 flex min-w-0 items-center justify-end gap-2 [&>div>button]:min-h-11 lg:col-start-3 lg:ml-4 lg:gap-4 lg:[&>div>button]:min-h-0">
        {showPlatformHealth && <PlatformHealthIndicator />}
        <RecordingGlobalIndicator />

        {/* Notifications Dropdown */}
        <NotificationsDropdown />

        {/* User Avatar Dropdown */}
        <ProfileDropdown />
      </div>
    </div>
  );
});
