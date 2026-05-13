import { Link } from "@tanstack/react-router";
import { memo } from "react";
import { LuMenu } from "react-icons/lu";

import { ProfileDropdown } from "@/components/auth";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";

import { NotificationsDropdown } from "./NotificationsDropdown";
import { SearchBar } from "./SearchBar";

interface TopNavBarProps {
  className?: string;
}

export const TopNavBar = memo(function TopNavBar({ className }: TopNavBarProps) {
  // Use individual selectors so this component re-renders only when these
  // two values change — destructuring the full store subscribed to every
  // mutation (theater toggle, etc.) and caused 30s viewer-count polls to
  // re-render the nav chrome unnecessarily.
  const sidebarCollapsed = useAppStore((s) => s.sidebarCollapsed);
  const setSidebarCollapsed = useAppStore((s) => s.setSidebarCollapsed);

  return (
    <div
      className={cn(
        "h-14 grid grid-cols-[250px_1fr_250px] items-center px-4 bg-[var(--color-background)] border-b border-[var(--color-border)]",
        className
      )}
    >
      {/* Left side - Brand + Sidebar Toggle */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed, true)}
          className="p-2 -ml-2 rounded-md hover:bg-[var(--color-background-secondary)] transition-colors text-white"
          title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <LuMenu size={20} strokeWidth={3} />
        </button>
        <Link
          to="/"
          className="text-xl font-bold text-white tracking-tight hover:opacity-90 transition-opacity"
        >
          StreamFusion
        </Link>
      </div>

      {/* Center - Search */}
      <div className="flex items-center justify-center w-full">
        <SearchBar className="max-w-[420px]" />
      </div>

      {/* Right side - Notifications + User */}
      <div className="flex items-center justify-end gap-6 ml-4">
        {/* Notifications Dropdown */}
        <NotificationsDropdown />

        {/* User Avatar Dropdown */}
        <ProfileDropdown />
      </div>
    </div>
  );
});
