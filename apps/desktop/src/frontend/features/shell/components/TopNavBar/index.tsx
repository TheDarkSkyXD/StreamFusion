import { Link } from "@tanstack/react-router";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { LuMenu } from "react-icons/lu";

import streamFusionLogo from "@/assets/brand/streamfusion-logo.png";
import { ProfileDropdown } from "@/features/auth/components/auth/ProfileDropdown";
import { PlatformHealthIndicator } from "@/features/shell/components/layout/PlatformHealthIndicator";
import { RecordingGlobalIndicator } from "@/features/media-library/components/recording/recording-global-indicator";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";

import { NotificationsDropdown } from "./NotificationsDropdown";
import { SearchBar } from "./SearchBar";

interface TopNavBarProps {
  className?: string;
  showPlatformHealth?: boolean;
}

export const TopNavBar = memo(function TopNavBar({
  className,
  showPlatformHealth = true,
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
        "grid h-14 grid-cols-[250px_minmax(0,1fr)_max-content] items-center border-b border-[var(--color-border)] bg-[var(--color-background)] px-4",
        className
      )}
    >
      {/* Left side - Brand + Sidebar Toggle */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed, true)}
          className="p-2 -ml-2 rounded-md hover:bg-[var(--color-background-secondary)] transition-colors text-white"
          title={
            sidebarCollapsed ? t("shell.topNav.expandSidebar") : t("shell.topNav.collapseSidebar")
          }
        >
          <LuMenu size={20} strokeWidth={3} />
        </button>
        <Link
          to="/"
          className="flex items-center gap-2 text-xl font-bold text-white tracking-tight hover:opacity-90 transition-opacity"
        >
          <img src={streamFusionLogo} alt="" className="h-7 w-7 shrink-0 object-contain" />
          StreamFusion
        </Link>
      </div>

      {/* Center - Search */}
      <div className="flex items-center justify-center w-full">
        <SearchBar className="max-w-[420px]" />
      </div>

      {/* Right side - Notifications + User */}
      <div className="ml-4 flex items-center justify-end gap-4">
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
