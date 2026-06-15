import { useNavigate } from "@tanstack/react-router";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { FaChevronRight } from "react-icons/fa";
import {
  LuArrowLeft,
  LuClock,
  LuLayoutList,
  LuPalette,
  LuSettings,
  LuSlidersHorizontal,
  LuX,
} from "react-icons/lu";

import { SettingRow, SwitchRow, useChatDisplay } from "@/components/settings/ChatSettingsSection";
import { ProxiedImage } from "@/components/ui/proxied-image";
import { type ChatDensity, DEFAULT_CHAT_DISPLAY_PREFERENCES } from "@/shared/auth-types";
import type { ChatPlatform } from "@/shared/chat-types";
import { useAuthStore } from "@/store/auth-store";

/**
 * Quick chat-settings popover (U7). Opened from the chat settings gear on BOTH
 * Twitch and Kick. Drill-in menu with a root view (Chat
 * appearance entry + More settings link) and an "appearance" sub-view (font,
 * emote size, density, timestamps). Writes back to the same global
 * `chatDisplay` group via U6's `useChatDisplay` writer (no duplicated
 * persistence). "More settings" deep-links to the full Chat tab.
 *
 * Behavior (identical both platforms): the popover anchors to the gear and can
 * open down from a header or up from the chat footer, right-aligned so it
 * overlays as little of the message list as possible. Dismissed on
 * outside-click; Escape backs out of a sub-view, then closes the popover.
 */

const DENSITY_OPTIONS: { value: ChatDensity; label: string }[] = [
  { value: "cozy", label: "Cozy" },
  { value: "compact", label: "Compact" },
];

const ICON_SIZE = 16;
const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 20;
const FONT_SIZE_DEFAULT = DEFAULT_CHAT_DISPLAY_PREFERENCES.fontSizePx;
const FONT_SIZE_STOPS = [FONT_SIZE_MIN, FONT_SIZE_DEFAULT, 18, FONT_SIZE_MAX];
const EMOTE_SIZE_MIN = 16;
const EMOTE_SIZE_MAX = 56;
const EMOTE_SIZE_DEFAULT = DEFAULT_CHAT_DISPLAY_PREFERENCES.emoteSizePx;
const EMOTE_SIZE_STOPS = [EMOTE_SIZE_MIN, EMOTE_SIZE_DEFAULT, 42, EMOTE_SIZE_MAX];
const PREVIEW_EMOTES: Record<ChatPlatform, { name: string; url: string }> = {
  twitch: {
    name: "Kappa",
    url: "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/3.0",
  },
  kick: {
    name: "emojiCheerful",
    url: "https://files.kick.com/emotes/1730756/fullsize",
  },
};

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
  platform = "twitch",
  placement = "bottom",
  triggerRef,
}: {
  /** Dismiss the popover (outside-click / Escape / "More settings" / close). */
  onClose: () => void;
  /** Active stream platform; determines which authenticated username appears in the preview. */
  platform?: ChatPlatform;
  /** The gear's current edge: header gears open down, footer gears open up. */
  placement?: "bottom" | "top";
  /** Keeps a click on the gear from being treated as an outside click. */
  triggerRef?: React.RefObject<HTMLElement | null>;
}) {
  const { cd, set } = useChatDisplay();
  const twitchUser = useAuthStore((state) => state.twitchUser);
  const kickUser = useAuthStore((state) => state.kickUser);
  const previewUsername =
    platform === "twitch"
      ? (twitchUser?.displayName ?? twitchUser?.login ?? "guest")
      : (kickUser?.username ?? kickUser?.slug ?? "guest");
  const navigate = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<PopoverView>("root");

  // Dismiss on outside-click + Escape (matches the ProfileDropdown pattern,
  // with Escape added per the U7 spec). `mousedown` fires before the message
  // list's click handlers so a click outside closes cleanly. Escape inside a
  // sub-view backs out instead of closing the whole popover.
  useEffect(() => {
    function onPointerDown(event: MouseEvent) {
      if (triggerRef?.current?.contains(event.target as Node)) return;
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
  }, [onClose, triggerRef, view]);

  return (
    <div
      ref={ref}
      role="dialog"
      aria-label="Quick chat settings"
      // Right-aligned inside the chat input's action row; Kick-sized, but
      // capped to the chat column so it cannot spill past narrow panels.
      className={`absolute right-0 z-50 w-[320px] max-w-full min-w-0 rounded-xl border border-[#27272a] bg-[#232629] shadow-xl animate-in fade-in duration-200 ${
        placement === "top"
          ? "bottom-full mb-2 slide-in-from-bottom-2"
          : "top-full mt-2 slide-in-from-top-2"
      }`}
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
        <AppearanceView cd={cd} platform={platform} previewUsername={previewUsername} set={set} />
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
    <div className="flex items-center justify-between px-4 py-2.5 border-b border-[#27272a]">
      <div className="flex items-center gap-2">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to chat settings"
            className="flex h-8 w-8 items-center justify-center rounded-sm text-white hover:bg-[#2F3438] transition-colors"
          >
            <LuArrowLeft size={16} />
          </button>
        ) : (
          <LuSlidersHorizontal size={16} className="text-white" aria-hidden />
        )}
        <h3 className="text-base font-semibold leading-6 text-zinc-100">{title}</h3>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close chat settings"
        className="flex h-8 w-8 items-center justify-center rounded-full text-white hover:bg-[#2F3438] transition-colors"
      >
        <LuX size={20} strokeWidth={3} />
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
        className="flex items-center gap-3 w-full px-2 py-2 rounded-md text-sm font-medium leading-5 text-zinc-300 hover:bg-[#2F3438] hover:text-white transition-colors"
      >
        <span className="flex-shrink-0 text-white" aria-hidden>
          <LuSettings size={ICON_SIZE} />
        </span>
        More settings
      </button>
    </div>
  );
}

function AppearanceView({
  cd,
  platform,
  previewUsername,
  set,
}: {
  cd: ChatDisplay;
  platform: ChatPlatform;
  previewUsername: string;
  set: ChatDisplaySet;
}) {
  return (
    <div>
      <ChatAppearancePreview
        density={cd.density}
        fontSizePx={cd.fontSizePx}
        emoteSizePx={cd.emoteSizePx}
        platform={platform}
        username={previewUsername}
      />
      <div className="px-4 py-3 border-b border-[#2F3438]">
        <KickFontSizeSlider value={cd.fontSizePx} onChange={(v) => set("fontSizePx", v)} />
      </div>
      <div className="px-4 py-3 border-b border-[#2F3438]">
        <KickEmoteSizeSlider
          platform={platform}
          value={cd.emoteSizePx}
          onChange={(v) => set("emoteSizePx", v)}
        />
      </div>
      <div className="px-4 py-1 divide-y divide-[#2F3438]">
        <SettingRow
          label="Density"
          icon={
            <span className="text-white">
              <LuLayoutList size={ICON_SIZE} />
            </span>
          }
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
          icon={
            <span className="text-white">
              <LuClock size={ICON_SIZE} />
            </span>
          }
          checked={cd.timestamps}
          onChange={(v) => set("timestamps", v)}
        />
      </div>
    </div>
  );
}

function ChatAppearancePreview({
  density,
  fontSizePx,
  emoteSizePx,
  platform,
  username,
}: {
  density: ChatDensity;
  fontSizePx: number;
  emoteSizePx: number;
  platform: ChatPlatform;
  username: string;
}) {
  const isCompact = density === "compact";
  const rows = [
    {
      badgeClassName: "bg-[#1f9dff]",
      badgeText: platform === "kick" ? "K" : "T",
      message: "Hi there!",
      testId: "chat-preview-row-primary",
      username,
      usernameClassName: platform === "kick" ? "text-[#00ad96]" : "text-[#a970ff]",
      withEmote: true,
    },
    {
      badgeClassName: "bg-[#7c3aed]",
      badgeText: "M",
      message: "Spacing changes right here",
      testId: "chat-preview-row-mod",
      username: "modbot",
      usernameClassName: "text-[#f5a623]",
      withEmote: false,
    },
    {
      badgeClassName: "bg-[#4b5563]",
      badgeText: "#",
      message: "Same font, tighter rows",
      testId: "chat-preview-row-viewer",
      username: "viewer",
      usernameClassName: "text-[#7dd3fc]",
      withEmote: false,
    },
  ];

  return (
    <div
      data-testid="chat-appearance-preview"
      className="overflow-hidden px-3 pt-2 pb-3 border-b border-[#3a3f44] bg-[#2F3438]"
    >
      <h4 className="text-sm font-semibold leading-5 text-zinc-300">Chat Appearance</h4>
      <div
        data-density={density}
        data-testid="chat-appearance-density-preview"
        className={`mt-2 min-w-0 overflow-hidden text-white transition-[gap] duration-150 ${
          isCompact ? "space-y-0" : "space-y-1"
        }`}
        style={{ fontSize: fontSizePx }}
      >
        {rows.map((row) => (
          <ChatAppearancePreviewRow
            key={row.testId}
            badgeClassName={row.badgeClassName}
            badgeText={row.badgeText}
            density={density}
            emoteSizePx={emoteSizePx}
            message={row.message}
            platform={platform}
            testId={row.testId}
            username={row.username}
            usernameClassName={row.usernameClassName}
            withEmote={row.withEmote}
          />
        ))}
      </div>
      <p className="mt-3 text-xs font-semibold leading-4 text-zinc-400">
        You may customize your Chat appearance below.
      </p>
    </div>
  );
}

function ChatAppearancePreviewRow({
  badgeClassName,
  badgeText,
  density,
  emoteSizePx,
  message,
  platform,
  testId,
  username,
  usernameClassName,
  withEmote,
}: {
  badgeClassName: string;
  badgeText: string;
  density: ChatDensity;
  emoteSizePx: number;
  message: string;
  platform: ChatPlatform;
  testId: string;
  username: string;
  usernameClassName: string;
  withEmote: boolean;
}) {
  const isCompact = density === "compact";

  return (
    <div
      data-testid={testId}
      className={`flex min-w-0 items-center whitespace-nowrap transition-[padding,line-height] duration-150 ${
        isCompact ? "gap-1 py-0 leading-4" : "gap-1.5 py-1.5 leading-5"
      }`}
    >
      <span
        className={`inline-flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-sm text-[9px] font-black leading-none text-white ${badgeClassName}`}
      >
        {badgeText}
      </span>
      <span className={`min-w-0 flex-shrink truncate font-semibold ${usernameClassName}`}>
        {username}:
      </span>
      <span className="min-w-0 truncate text-zinc-100">{message}</span>
      {withEmote && (
        <PlatformPreviewEmote
          platform={platform}
          sizePx={emoteSizePx}
          testId="chat-preview-emote"
          aria-label="preview emote"
        />
      )}
    </div>
  );
}

function KickFontSizeSlider({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const snappedValue = snapSizeToStop(value, FONT_SIZE_STOPS);
  const selectedIndex = getStopIndex(snappedValue, FONT_SIZE_STOPS);
  const percent = getStopPercent(snappedValue, FONT_SIZE_STOPS);
  const labelClass = (stop: number, sizeClass: string) =>
    `${sizeClass} font-bold leading-none transition-colors ${
      snappedValue === stop ? "text-white" : "text-[#9ca3af]"
    }`;

  return (
    <div>
      <label htmlFor="quick-chat-font-size" className="text-sm font-bold leading-5 text-white">
        Font size
      </label>
      <div className="relative mt-2 h-7">
        <span
          data-testid="font-size-label-min"
          className={`absolute bottom-0 -translate-x-1/2 ${labelClass(FONT_SIZE_MIN, "text-sm")}`}
          style={{ left: `${getStopPercent(FONT_SIZE_MIN, FONT_SIZE_STOPS)}%` }}
        >
          Aa
        </span>
        <span
          data-testid="font-size-label-default"
          className={`absolute bottom-0 -translate-x-1/2 ${labelClass(FONT_SIZE_DEFAULT, "text-sm")}`}
          style={{ left: `${getStopPercent(FONT_SIZE_DEFAULT, FONT_SIZE_STOPS)}%` }}
        >
          Default
        </span>
        <span
          data-testid="font-size-label-large"
          className={`absolute bottom-0 -translate-x-1/2 ${labelClass(18, "text-xl")}`}
          style={{ left: `${getStopPercent(18, FONT_SIZE_STOPS)}%` }}
        >
          Aa
        </span>
        <span
          data-testid="font-size-label-max"
          className={`absolute bottom-0 -translate-x-1/2 ${labelClass(FONT_SIZE_MAX, "text-2xl")}`}
          style={{ left: `${getStopPercent(FONT_SIZE_MAX, FONT_SIZE_STOPS)}%` }}
        >
          Aa
        </span>
      </div>
      <div className="relative mt-2 h-5">
        <div className="absolute top-1/2 left-0 z-0 h-0.5 w-full -translate-y-1/2 bg-[#4a4d52]" />
        {FONT_SIZE_STOPS.map((mark) => {
          return (
            <span
              key={mark}
              data-testid="font-size-stop-dot"
              className="absolute top-1/2 z-[2] h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-[#5b6068] bg-[#232629] shadow-[0_0_0_2px_#232629]"
              style={{
                left: `${getStopPercent(mark, FONT_SIZE_STOPS)}%`,
                borderColor: "#5b6068",
              }}
              aria-hidden
            />
          );
        })}
        <span
          className="absolute top-1/2 z-[3] h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-white"
          style={{ left: `${percent}%` }}
          aria-hidden
        />
        <input
          id="quick-chat-font-size"
          aria-label="Font size"
          aria-valuetext={`${snappedValue}px`}
          type="range"
          min={0}
          max={FONT_SIZE_STOPS.length - 1}
          step={1}
          value={selectedIndex}
          onChange={(event) =>
            onChange(getStopValue(Number(event.target.value), FONT_SIZE_STOPS, snappedValue))
          }
          className="absolute inset-0 z-[4] h-5 w-full cursor-pointer opacity-0"
        />
      </div>
    </div>
  );
}

function KickEmoteSizeSlider({
  platform,
  value,
  onChange,
}: {
  platform: ChatPlatform;
  value: number;
  onChange: (value: number) => void;
}) {
  const snappedValue = snapSizeToStop(value, EMOTE_SIZE_STOPS);
  const selectedIndex = getStopIndex(snappedValue, EMOTE_SIZE_STOPS);
  const percent = getStopPercent(snappedValue, EMOTE_SIZE_STOPS);

  return (
    <div>
      <label htmlFor="quick-chat-emote-size" className="text-sm font-bold leading-5 text-white">
        Emote size
      </label>
      <div className="relative mt-2 h-8 text-[#9ca3af]">
        <EmoteSizeLabel
          platform={platform}
          sizePx={16}
          stop={EMOTE_SIZE_MIN}
          testId="emote-size-label-min"
        />
        <span
          data-testid="emote-size-label-default"
          className="absolute bottom-0 -translate-x-1/2 text-sm font-bold leading-none text-white"
          style={{ left: `${getStopPercent(EMOTE_SIZE_DEFAULT, EMOTE_SIZE_STOPS)}%` }}
        >
          Default
        </span>
        <EmoteSizeLabel platform={platform} sizePx={24} stop={42} testId="emote-size-label-large" />
        <EmoteSizeLabel
          platform={platform}
          sizePx={32}
          stop={EMOTE_SIZE_MAX}
          testId="emote-size-label-max"
        />
      </div>
      <div className="relative mt-2 h-5">
        <div className="absolute top-1/2 left-0 z-0 h-0.5 w-full -translate-y-1/2 bg-[#4a4d52]" />
        {EMOTE_SIZE_STOPS.map((mark) => {
          return (
            <span
              key={mark}
              data-testid="emote-size-stop-dot"
              className="absolute top-1/2 z-[2] h-[18px] w-[18px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-[#5b6068] bg-[#232629] shadow-[0_0_0_2px_#232629]"
              style={{
                left: `${getStopPercent(mark, EMOTE_SIZE_STOPS)}%`,
                borderColor: "#5b6068",
              }}
              aria-hidden
            />
          );
        })}
        <span
          className="absolute top-1/2 z-[3] h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-white"
          style={{ left: `${percent}%` }}
          aria-hidden
        />
        <input
          id="quick-chat-emote-size"
          aria-label="Emote size"
          aria-valuetext={`${snappedValue}px`}
          type="range"
          min={0}
          max={EMOTE_SIZE_STOPS.length - 1}
          step={1}
          value={selectedIndex}
          onChange={(event) =>
            onChange(getStopValue(Number(event.target.value), EMOTE_SIZE_STOPS, snappedValue))
          }
          className="absolute inset-0 z-[4] h-5 w-full cursor-pointer opacity-0"
        />
      </div>
    </div>
  );
}

function EmoteSizeLabel({
  platform,
  sizePx,
  stop,
  testId,
}: {
  platform: ChatPlatform;
  sizePx: number;
  stop: number;
  testId: string;
}) {
  return (
    <PlatformPreviewEmote
      platform={platform}
      sizePx={sizePx}
      testId={testId}
      className="absolute bottom-0 -translate-x-1/2"
      style={{ left: `${getStopPercent(stop, EMOTE_SIZE_STOPS)}%` }}
    />
  );
}

function PlatformPreviewEmote({
  platform,
  sizePx,
  testId,
  className = "",
  style,
  "aria-label": ariaLabel,
}: {
  platform: ChatPlatform;
  sizePx: number;
  testId: string;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
}) {
  const emote = PREVIEW_EMOTES[platform];
  return (
    <span
      data-testid={testId}
      data-emote-name={emote.name}
      data-emote-url={emote.url}
      role={ariaLabel ? "img" : undefined}
      aria-label={ariaLabel}
      className={`inline-flex flex-shrink-0 items-center justify-center ${className}`}
      style={{ width: sizePx, height: sizePx, ...style }}
    >
      <ProxiedImage
        src={emote.url}
        alt={emote.name}
        className="h-full w-full object-contain"
        width={sizePx}
        height={sizePx}
        loading="eager"
      />
    </span>
  );
}

function getStopPercent(value: number, stops: number[]) {
  const safeIndex = getStopIndex(value, stops);
  const lastIndex = Math.max(stops.length - 1, 1);
  return (Math.max(safeIndex, 0) / lastIndex) * 100;
}

function getStopIndex(value: number, stops: number[]) {
  const index = stops.indexOf(value);
  if (index >= 0) return index;
  return Math.max(stops.indexOf(snapSizeToStop(value, stops)), 0);
}

function getStopValue(index: number, stops: number[], fallback: number) {
  const roundedIndex = Math.round(index);
  return stops[Math.min(Math.max(roundedIndex, 0), stops.length - 1)] ?? fallback;
}

function snapSizeToStop(rawValue: number, stops: number[], previousValue = rawValue) {
  const direction = rawValue - previousValue;
  return stops.reduce((closest, stop) => {
    const closestDistance = Math.abs(rawValue - closest);
    const stopDistance = Math.abs(rawValue - stop);
    if (stopDistance < closestDistance) return stop;
    if (stopDistance === closestDistance && direction >= 0) return Math.max(closest, stop);
    if (stopDistance === closestDistance && direction < 0) return Math.min(closest, stop);
    return closest;
  }, stops[0] ?? rawValue);
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
      className="flex items-center gap-3 w-full px-2 py-2 rounded-md text-left text-zinc-200 hover:bg-[#2F3438] transition-colors"
    >
      <span className="flex-shrink-0 text-white" aria-hidden>
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium leading-5">{label}</p>
        {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
      </div>
      <span
        className="flex h-6 w-6 flex-shrink-0 items-center justify-center text-white"
        aria-hidden
      >
        <FaChevronRight size={22} />
      </span>
    </button>
  );
}
