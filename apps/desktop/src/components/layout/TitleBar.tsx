/**
 * Custom Title Bar Component
 *
 * A frameless window title bar with app branding and window controls.
 * Keep this minimal - user info is in TopNavBar.
 */

import type React from "react";
import { LuCopy, LuMinus, LuSquare, LuX } from "react-icons/lu";

import { useWindowControls } from "@/hooks";
import { cn } from "@/lib/utils";

interface TitleBarProps {
  className?: string;
}

export function TitleBar({ className }: TitleBarProps) {
  const { isMaximized, minimize, maximize, close } = useWindowControls();
  const isMac = navigator.platform.toLowerCase().includes("mac");

  return (
    <div
      className={cn(
        "h-7 flex items-center justify-between bg-[var(--color-background-secondary)] border-b border-[var(--color-border)] select-none relative z-50 shrink-0",
        className
      )}
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Left side - Logo/Title */}
      <div className="flex items-center gap-2 px-4">
        {/* Spacer for macOS traffic lights */}
        {isMac && <div className="w-16" />}
        <span className="text-xs font-semibold text-[var(--color-foreground)]">🌩️ StreamFusion</span>
      </div>

      {/* Right side - Window controls (Windows/Linux only) */}
      {!isMac && (
        <div className="flex h-full" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <WindowButton onClick={minimize} aria-label="Minimize">
            <LuMinus size={20} />
          </WindowButton>
          <WindowButton onClick={maximize} aria-label={isMaximized ? "Restore" : "Maximize"}>
            {isMaximized ? <LuCopy size={18} className="rotate-180" /> : <LuSquare size={18} />}
          </WindowButton>
          <WindowButton onClick={close} isClose aria-label="Close">
            <LuX size={20} />
          </WindowButton>
        </div>
      )}
    </div>
  );
}

interface WindowButtonProps {
  onClick: () => void;
  isClose?: boolean;
  children: React.ReactNode;
  "aria-label": string;
}

function WindowButton({ onClick, isClose, children, "aria-label": ariaLabel }: WindowButtonProps) {
  return (
    <button
      onClick={onClick}
      aria-label={ariaLabel}
      className={cn(
        "w-12 h-full flex items-center justify-center transition-colors focus:outline-none",
        "text-white",
        isClose
          ? "hover:bg-red-500 hover:text-white"
          : "hover:bg-[var(--color-background-tertiary)]"
      )}
    >
      {children}
    </button>
  );
}
