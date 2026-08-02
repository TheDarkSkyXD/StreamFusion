import type React from "react";
import { getSevenTvPaintStyle, resolveChatUsernameColor } from "@/lib/chat-visuals";
import { logger } from "@/renderer/logging/logger";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES } from "../../shared/auth-types";
import type { ChatMessage, ChatPlatform } from "../../shared/chat-types";
import { useAuthStore } from "../../store/auth-store";
import { useChatCosmeticsStore } from "../../store/chat-cosmetics-store";
import { useOpenUserPopout } from "./mod/UserPopout/UserPopoutProvider";

/** Deterministic readable color for users who never picked one. Hashes the
 *  username into a hue and renders it at a fixed saturation/lightness tuned to
 *  read on the dark chat background. Same input always yields the same color. */
/** Relative luminance (0–1) of a `#rrggbb` color, per WCAG. Used to lift
 *  too-dark colors for the dark theme. Non-hex inputs return 1 (treated as
 *  already bright enough — no lift). */
/** Lifts a low-luminance `#rrggbb` color toward white so it reads on the dark
 *  chat background, leaving already-bright colors untouched. */
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
  const openUserPopout = useOpenUserPopout();
  const paintId = useChatCosmeticsStore((state) =>
    platform === "twitch" && currentChannelContext
      ? state.userPaintAssignments.get(`${currentChannelContext.channelId}:${userId}`)
      : undefined
  );
  const paint = useChatCosmeticsStore((state) =>
    paintId ? state.paintDefinitions.get(paintId) : undefined
  );

  // Resolve the effective username color from prefs:
  // - no chosen color + readable-color on  -> deterministic per-username color
  // - no chosen color + readable-color off -> the platform default
  // - chosen color + theme-adapt on        -> lift if too dark for the dark bg
  const resolvedColor = resolveChatUsernameColor({
    color,
    platform,
    readableColorForUncolored: cd.readableColorForUncolored,
    themeAdaptUsernameColor: cd.themeAdaptUsernameColor,
    username,
  });
  const paintStyle =
    platform === "twitch" && cd.enable7tvUsernamePaints
      ? getSevenTvPaintStyle(paint, resolvedColor)
      : null;

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
            style={paintStyle ?? { color: resolvedColor }}
          >
            {displayName}
          </span>
        </span>
      </span>
      {suffix}
    </span>
  );
};
