import type React from "react";
import type { ChatPlatform } from "../../shared/chat-types";
import { useOpenUserPopout } from "./mod/UserPopout/UserPopoutProvider";

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
  color?: string;
  platform: ChatPlatform;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  /** When provided, clicks open the user popout for this channel context. */
  currentChannelContext?: UsernameChannelContext;
}

export const Username: React.FC<UsernameProps> = ({
  userId,
  username,
  displayName,
  color,
  platform,
  className,
  onClick,
  currentChannelContext,
}) => {
  const defaultColor = platform === "kick" ? "#53fc18" : "#9146ff";
  const openUserPopout = useOpenUserPopout();

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
        platform,
        channelId: currentChannelContext.channelId,
        channelSlug: currentChannelContext.channelSlug,
        kickChatroomId: currentChannelContext.kickChatroomId,
      });
      return;
    }
    // Defensive: no channel context and no override — surfaces like search
    // can still log without crashing.
    // biome-ignore lint/suspicious/noConsole: defensive fallback when chat surface lacks context.
    console.debug(`User clicked: ${username} (${userId})`);
  };

  return (
    <span
      className={`font-bold cursor-pointer hover:underline ${className || ""}`}
      style={{ color: color || defaultColor }}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          handleClick(e as unknown as React.MouseEvent);
        }
      }}
    >
      {displayName}
    </span>
  );
};
