import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  LuArrowLeft,
  LuChevronRight,
  LuClock,
  LuLayoutList,
  LuPalette,
  LuSettings,
  LuSlidersHorizontal,
  LuSmile,
  LuType,
  LuX,
} from "react-icons/lu";

import {
  RangeRow,
  SettingRow,
  SwitchRow,
  useChatDisplay,
} from "@/components/settings/ChatSettingsSection";
import type { ChatDensity } from "@/shared/auth-types";

/**
 * Quick chat-settings popover (U7). Opened from the gear in the chat panel
 * header on BOTH Twitch and Kick. Drill-in menu with a root view (Chat
 * appearance entry + More settings link) and an "appearance" sub-view (font,
 * emote size, density, timestamps). Writes back to the same global
 * `chatDisplay` group via U6's `useChatDisplay` writer (no duplicated
 * persistence). "More settings" deep-links to the full Chat tab.
 *
 * Behavior (identical both platforms): the gear lives in the chat panel header
 * chrome OUTSIDE `ChatPanelTabs` so the single-tab viewer path doesn't strip it
 * (see chat-header-banner-lost-in-tab-shell-refactor learning); the popover
 * drops down from that header gear, right-aligned so it overlays as little of
 * the message list as possible. Dismissed on outside-click; Escape backs out
 * of a sub-view, then closes the popover. The host (TwitchChat / KickChat)
 * owns the open state and the accent gear styling.
 */

const DENSITY_OPTIONS: { value: ChatDensity; label: string }[] = [
  { value: "cozy", label: "Cozy" },
  { value: "compact", label: "Compact" },
];

const ICON_SIZE = 14;

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="px-4 pt-3 pb-1">
      <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{children}</h4>
    </div>
  );
}

type PopoverView = "root" | "appearance";

export function ChatQuickSettingsPopover({
  onClose,
}: {
  /** Dismiss the popover (outside-click / Escape / "More settings" / close). */
  onClose: () => void;
}) {
  const { cd, set } = useChatDisplay();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<PopoverView>("root");

  // Dismiss on outside-click + Escape (matches the ProfileDropdown pattern,
  // with Escape added per the U7 spec). `mousedown` fires before the message
  // list's click handlers so a click outside closes cleanly. Escape inside a
  // sub-view backs out instead of closing the whole popover.
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (view !== "root") {
        setView("root");
      } else {
        onClose();
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose, view]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Quick chat settings"
      // Drops down from the header gear, right-aligned to the panel edge so it
      // overlays as little of the message list as possible. The host wraps this
      // in a `relative` container.
      className="absolute top-full right-0 mt-2 z-50 w-96 rounded-xl border border-[#27272a] bg-[#121214] shadow-xl animate-in fade-in slide-in-from-top-2 duration-200"
    >
      <PopoverHeader
        title={view === "root" ? "Chat settings" : "Chat appearance"}
        onBack={view === "root" ? undefined : () => setView("root")}
        onClose={onClose}
      />

      {view === "root" ? (
        <RootView
          onOpenAppearance={() => setView("appearance")}
          onMoreSettings={() => {
            navigate({ to: "/settings", search: { tab: "chat" } });
            onClose();
          }}
        />
      ) : (
        <AppearanceView cd={cd} set={set} />
      )}
    </div>
  );
}

function PopoverHeader({
  title,
  onBack,
  onClose,
}: {
  title: string;
  onBack?: () => void;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center justify-between px-4 py-3 border-b border-[#27272a]">
      <div className="flex items-center gap-2">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to chat settings"
            className="text-zinc-500 hover:text-zinc-200 transition-colors"
          >
            <LuArrowLeft size={14} />
          </button>
        ) : (
          <LuSlidersHorizontal size={14} className="text-zinc-500" aria-hidden />
        )}
        <h3 className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest">{title}</h3>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close chat settings"
        className="text-zinc-500 hover:text-zinc-200 transition-colors"
      >
        <LuX size={14} />
      </button>
    </div>
  );
}

type ChatDisplay = ReturnType<typeof useChatDisplay>["cd"];
type ChatDisplaySet = ReturnType<typeof useChatDisplay>["set"];

function RootView({
  onOpenAppearance,
  onMoreSettings,
}: {
  onOpenAppearance: () => void;
  onMoreSettings: () => void;
}) {
  return (
    <div className="px-2 py-2 space-y-1">
      <NavRow
        icon={<LuPalette size={ICON_SIZE} />}
        label="Chat appearance"
        description="Font, emote size, density, timestamps."
        onClick={onOpenAppearance}
      />
      <button
        type="button"
        onClick={onMoreSettings}
        className="flex items-center gap-3 w-full px-2 py-2 rounded-md text-sm text-zinc-300 hover:bg-[#27272a]/60 hover:text-white transition-colors"
      >
        <LuSettings size={ICON_SIZE} className="flex-shrink-0 text-zinc-500" aria-hidden />
        More settings
      </button>
    </div>
  );
}

function AppearanceView({ cd, set }: { cd: ChatDisplay; set: ChatDisplaySet }) {
  return (
    <div className="px-4 py-1 divide-y divide-[#27272a]/60">
      <RangeRow
        label="Font size"
        icon={<LuType size={ICON_SIZE} />}
        value={cd.fontSizePx}
        min={10}
        max={20}
        unit="px"
        onChange={(v) => set("fontSizePx", v)}
      />
      <RangeRow
        label="Emote size"
        icon={<LuSmile size={ICON_SIZE} />}
        value={cd.emoteSizePx}
        min={16}
        max={56}
        unit="px"
        onChange={(v) => set("emoteSizePx", v)}
      />
      <SettingRow
        label="Density"
        icon={<LuLayoutList size={ICON_SIZE} />}
        control={
          <div className="flex rounded-md border border-[#27272a] overflow-hidden">
            {DENSITY_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => set("density", o.value)}
                aria-pressed={cd.density === o.value}
                className={
                  cd.density === o.value
                    ? "px-3 py-1 text-xs font-medium bg-[#dc143c] text-white"
                    : "px-3 py-1 text-xs font-medium text-zinc-400 hover:text-zinc-200"
                }
              >
                {o.label}
              </button>
            ))}
          </div>
        }
      />
      <SwitchRow
        label="Show timestamps"
        icon={<LuClock size={ICON_SIZE} />}
        checked={cd.timestamps}
        onChange={(v) => set("timestamps", v)}
      />
    </div>
  );
}

function NavRow({
  icon,
  label,
  description,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  description?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-3 w-full px-2 py-2 rounded-md text-left text-zinc-200 hover:bg-[#27272a]/60 transition-colors"
    >
      <span className="flex-shrink-0 text-zinc-500" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-sm">{label}</p>
        {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
      </div>
      <LuChevronRight size={14} className="flex-shrink-0 text-zinc-500" aria-hidden />
    </button>
  );
}
