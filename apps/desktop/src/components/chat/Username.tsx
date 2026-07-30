import type React from "react";
import { logger } from "@/renderer/logging/logger";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES } from "../../shared/auth-types";
import type { ChatMessage, ChatPlatform } from "../../shared/chat-types";
import { useAuthStore } from "../../store/auth-store";
import { useOpenUserPopout } from "./mod/UserPopout/UserPopoutProvider";

/** Deterministic readable color for users who never picked one. Hashes the
 *  username into a hue and renders it at a fixed saturation/lightness tuned to
 *  read on the dark chat background. Same input always yields the same color. */
function deterministicColor(username: string): string {
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
    hash |= 0; // keep in 32-bit range
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 65%)`;
}

/** Relative luminance (0–1) of a `#rrggbb` color, per WCAG. Used to lift
 *  too-dark colors for the dark theme. Non-hex inputs return 1 (treated as
 *  already bright enough — no lift). */
function hexLuminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 1;
  const int = Number.parseInt(m[1], 16);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const r = channel((int >> 16) & 0xff);
  const g = channel((int >> 8) & 0xff);
  const b = channel(int & 0xff);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Lifts a low-luminance `#rrggbb` color toward white so it reads on the dark
 *  chat background, leaving already-bright colors untouched. */
function liftForDarkTheme(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const LUMINANCE_FLOOR = 0.18;
  if (hexLuminance(hex) >= LUMINANCE_FLOOR) return hex;
  const int = Number.parseInt(m[1], 16);
  const mix = (c: number) => Math.round(c + (255 - c) * 0.5);
  const r = mix((int >> 16) & 0xff);
  const g = mix((int >> 8) & 0xff);
  const b = mix(int & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * Optional channel-scope passed through ChatMessageList -> ChatMessage so
 * Username can open the popout with the right channel id / slug. Surfaces
 * that don't have a channel (search results, etc) simply omit it and the
 * popout falls back to the no-op dispatcher.
 */
export interface UsernameChannelContext {
  channelId: string;
  channelSlug: string;
  /** Kick chatroom id — required for the popout footer's Kick delete. */
  kickChatroomId?: number;
}

interface UsernameProps {
  userId: string;
  username: string;
  displayName: string;
  avatarUrl?: string;
  color?: string;
  platform: ChatPlatform;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  /** When provided, clicks open the user popout for this channel context. */
  currentChannelContext?: UsernameChannelContext;
  /** Exact message whose username opened the dialog. */
  openingMessage?: ChatMessage;
  /** Non-clickable inline content that must wrap with the username, e.g. a chat colon. */
  suffix?: React.ReactNode;
  /** Keep suffix punctuation visually attached to the username in compact highlight rows. */
  keepSuffixAttached?: boolean;
  /** Prevent compact attribution usernames from breaking across lines. */
  noWrap?: boolean;
  /** Render as text when the containing surface owns the row interaction. */
  interactive?: boolean;
}

export const Username: React.FC<UsernameProps> = ({
  userId,
  username,
  displayName,
  avatarUrl,
  color,
  platform,
  className,
  onClick,
  currentChannelContext,
  openingMessage,
  suffix,
  keepSuffixAttached = false,
  noWrap = false,
  interactive = true,
}) => {
  const cd = useAuthStore((s) => s.preferences?.chatDisplay) ?? DEFAULT_CHAT_DISPLAY_PREFERENCES;
  const platformDefaultColor = platform === "kick" ? "#53fc18" : "#9146ff";
  const openUserPopout = useOpenUserPopout();

  // Resolve the effective username color from prefs:
  // - no chosen color + readable-color on  -> deterministic per-username color
  // - no chosen color + readable-color off -> the platform default
  // - chosen color + theme-adapt on        -> lift if too dark for the dark bg
  let resolvedColor: string;
  if (!color) {
    resolvedColor = cd.readableColorForUncolored
      ? deterministicColor(username)
      : platformDefaultColor;
  } else {
    resolvedColor = cd.themeAdaptUsernameColor ? liftForDarkTheme(color) : color;
  }

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onClick) {
      onClick(e);
      return;
    }
    if (currentChannelContext) {
      openUserPopout({
        userId,
        username,
        displayName,
        avatarUrl,
        platform,
        channelId: currentChannelContext.channelId,
        channelSlug: currentChannelContext.channelSlug,
        kickChatroomId: currentChannelContext.kickChatroomId,
        openingMessage,
      });
      return;
    }
    // Defensive: no channel context and no override — surfaces like search
    // can still log without crashing.
    logger.debug("UI:Chat:Username", "user clicked", { username, userId });
  };

  return (
    <span
      className={`chat-line__username-container -mx-0.5 inline-block max-w-full break-words rounded-[4px] px-0.5 [overflow-wrap:anywhere] ${interactive ? "chat-line__username-container--hoverable transition-colors duration-100 hover:bg-[rgba(255,255,255,0.16)] active:bg-[rgba(255,255,255,0.16)] focus-within:bg-[rgba(255,255,255,0.16)]" : ""} ${keepSuffixAttached || noWrap ? "whitespace-nowrap" : ""}`}
    >
      <span
        className={`chat-line__username max-w-full break-words no-underline [overflow-wrap:anywhere] ${interactive ? "cursor-pointer hover:no-underline focus:outline-none focus-visible:ring-1 focus-visible:ring-white" : ""}`}
        onClick={interactive ? handleClick : undefined}
        role={interactive ? "button" : undefined}
        tabIndex={interactive ? 0 : undefined}
        onKeyDown={
          interactive
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  handleClick(e as unknown as React.MouseEvent);
                }
              }
            : undefined
        }
      >
        <span>
          <span
            className={`chat-author__display-name break-words font-bold [overflow-wrap:anywhere] ${className || ""}`}
            data-a-target="chat-message-username"
            data-a-user={username}
            data-test-selector="message-username"
            style={{ color: resolvedColor }}
          >
            {displayName}
          </span>
        </span>
      </span>
      {suffix}
    </span>
  );
};
