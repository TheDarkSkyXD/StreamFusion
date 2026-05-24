import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { LuSettings, LuTrash2, LuX } from "react-icons/lu";

import {
  RangeRow,
  SettingRow,
  SwitchRow,
  useChatDisplay,
} from "@/components/settings/ChatSettingsSection";
import type { ChatDensity } from "@/shared/auth-types";

/**
 * Quick chat-settings popover (U7). Opened from the gear in the chat panel
 * header on BOTH Twitch and Kick. Renders a SUBSET of the Settings → Chat tab
 * (U6) — font size, emote size, density, timestamps, message limit — and
 * writes back to the same global `chatDisplay` group via U6's `useChatDisplay`
 * writer (no duplicated persistence). A "More settings" link deep-links to the
 * full Chat tab; the gear's old "Clear local chat" action moves in here as a
 * destructive button at the bottom.
 *
 * Behavior (identical both platforms): the gear lives in the chat panel header
 * chrome OUTSIDE `ChatPanelTabs` so the single-tab viewer path doesn't strip it
 * (see chat-header-banner-lost-in-tab-shell-refactor learning); the popover
 * drops down from that header gear, right-aligned so it overlays as little of
 * the message list as possible. Dismissed on outside-click AND Escape. The host
 * (TwitchChat / KickChat) owns the open state and the accent gear styling.
 */

const DENSITY_OPTIONS: { value: ChatDensity; label: string }[] = [
  { value: "cozy", label: "Cozy" },
  { value: "compact", label: "Compact" },
];

export function ChatQuickSettingsPopover({
  onClose,
  onClearChat,
}: {
  /** Dismiss the popover (outside-click / Escape / "More settings" / close). */
  onClose: () => void;
  /** Wire to the host's existing clear-chat handler (the old gear action). */
  onClearChat: () => void;
}) {
  const { cd, set } = useChatDisplay();
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);

  // Dismiss on outside-click + Escape (matches the ProfileDropdown pattern,
  // with Escape added per the U7 spec). `mousedown` fires before the message
  // list's click handlers so a click outside closes cleanly.
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Quick chat settings"
      // Drops down from the header gear, right-aligned to the panel edge so it
      // overlays as little of the message list as possible. The host wraps this
      // in a `relative` container.
      className="absolute top-full right-0 mt-2 z-50 w-72 rounded-xl border border-[#27272a] bg-[#121214] shadow-xl animate-in fade-in slide-in-from-top-2 duration-200"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#27272a]">
        <h3 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
          Chat settings
        </h3>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat settings"
          className="text-zinc-500 hover:text-zinc-200 transition-colors"
        >
          <LuX size={14} />
        </button>
      </div>

      <div className="px-4 py-1 divide-y divide-[#27272a]/60">
        <RangeRow
          label="Font size"
          value={cd.fontSizePx}
          min={10}
          max={20}
          unit="px"
          onChange={(v) => set("fontSizePx", v)}
        />
        <RangeRow
          label="Emote size"
          value={cd.emoteSizePx}
          min={16}
          max={56}
          unit="px"
          onChange={(v) => set("emoteSizePx", v)}
        />
        <SettingRow
          label="Density"
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
          checked={cd.timestamps}
          onChange={(v) => set("timestamps", v)}
        />
        <RangeRow
          label="Message limit"
          note="Higher values use more memory."
          value={cd.messageLimit}
          min={10}
          max={400}
          step={10}
          onChange={(v) => set("messageLimit", v)}
        />
      </div>

      <div className="px-4 py-3 border-t border-[#27272a] space-y-1">
        <button
          type="button"
          onClick={() => {
            navigate({ to: "/settings", search: { tab: "chat" } });
            onClose();
          }}
          className="flex items-center gap-2 w-full px-2 py-2 rounded-md text-sm text-zinc-300 hover:bg-[#27272a]/60 hover:text-white transition-colors"
        >
          <LuSettings size={14} />
          More settings
        </button>
        <button
          type="button"
          onClick={() => {
            onClearChat();
            onClose();
          }}
          className="flex items-center gap-2 w-full px-2 py-2 rounded-md text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
        >
          <LuTrash2 size={14} />
          Clear local chat
        </button>
      </div>
    </div>
  );
}
