import { Link } from "@tanstack/react-router";
import { LuMenu } from "react-icons/lu";

import { ProfileDropdown } from "@/components/auth";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";

import { NotificationsDropdown } from "./NotificationsDropdown";
import { SearchBar } from "./SearchBar";

interface TopNavBarProps {
  className?: string;
}

export function TopNavBar({ className }: TopNavBarProps) {
  // App state for sidebar
  const { sidebarCollapsed, setSidebarCollapsed } = useAppStore();

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
        <SearchBar />
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
}
