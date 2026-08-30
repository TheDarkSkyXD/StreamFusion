/**
 * NativeEmoteButton — trigger button + anchored EmotePickerPopover pair for the
 * platform-native emote scope (Twitch global/channel or Kick global/channel/
 * emoji). Rendered inside ChatInput; parent owns the active-dialog state via
 * `isOpen` + `onOpenRequest`, so mutual exclusion with ThirdPartyEmoteButton
 * is enforced at the call site without an event bus.
 *
 * Icon is platform-aware:
 *   - twitch → TwitchIcon (glitch mark)
 *   - kick   → KickEmoteIcon (Kick wordmark)
 *
 * `viewerIsSubscribed` is only meaningful for the Kick-native dialog; it's
 * forwarded straight through (`undefined` → no lock per U8).
 */

import type React from "react";
import { useCallback, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { Emote } from "../../../../../../backend/services/emotes/emote-types";
import { useChannelByUsername } from "../../../../discovery/data/queries/useChannels";
import type { ChatPlatform } from "../../../../../../shared/chat-types";
import { useEmoteStore } from "../../../../../store/emote-store";
import { KickEmoteIcon, TwitchIcon } from "../../../../../components/icons/PlatformIcons";
import { EmotePickerPopover } from "../EmotePickerPopover";

const kickEmoteUrl = (id: string) => `https://files.kick.com/emotes/${id}/fullsize`;
const EMPTY_KICK_EMOTE_POOL: Emote[] = [];

interface NativeEmoteButtonProps {
  platform: ChatPlatform;
  /** Channel username (slug) — used to fetch the streamer's avatar for the
   *  picker's channel-tab thumbnail. The query is React-Query-cached and
   *  shares its key with Stream's `useChannelByUsername`, so this is a free
   *  cache hit on the chat page. */
  channel: string;
  channelId: string | null;
  kickUserId?: string | null;
  viewerUserId?: string;
  isOpen: boolean;
  onOpenRequest: () => void;
  onEmoteSelect: (emote: Emote) => void;
  disabled?: boolean;
  /** Forwarded to EmotePickerPopover. Only consulted for Kick-native. `undefined`
   *  means "unknown subscription status" → no lock overlay (U8 semantics). */
  viewerIsSubscribed?: boolean;
  /**
   * Optional positioning anchor for the popover. ChatInput passes the 7TV button
   * here so native Kick/Twitch pickers open from the same viewport position as
   * the third-party picker.
   */
  popoverAnchorRef?: React.RefObject<HTMLElement | null>;
}

export const NativeEmoteButton: React.FC<NativeEmoteButtonProps> = ({
  platform,
  channel,
  channelId,
  kickUserId,
  viewerUserId,
  isOpen,
  onOpenRequest,
  onEmoteSelect,
  disabled = false,
  viewerIsSubscribed,
  popoverAnchorRef,
}) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const anchorRef = popoverAnchorRef ?? buttonRef;
  const label = `Open ${platform} emote picker`;
  const { data: channelData } = useChannelByUsername(channel, platform);
  const channelAvatarUrl = channelData?.avatarUrl ?? null;
  const channelLabel = channelData?.displayName || channelData?.username || channel;

  // Kick-specific: cycle through real channel/global Kick emotes on hover so
  // the button matches KickTalk's `kickEmoteButton` UX (random emote image
  // updates each time the cursor enters). Twitch keeps its static glitch mark.
  //
  const kickEmotePool = useEmoteStore(
    useShallow((state) => {
      if (platform !== "kick") return EMPTY_KICK_EMOTE_POOL;
      const pool = state.getEmotesByProvider().get("kick");
      if (!pool?.length) return EMPTY_KICK_EMOTE_POOL;
      return pool.filter((emote) => !emote.subscribersOnly);
    })
  );

  const kickPoolKey = `${platform}:${channelId ?? channel}`;
  const [hoverEmote, setHoverEmote] = useState<{ key: string; id: string } | null>(null);
  const displayKickEmoteId =
    hoverEmote?.key === kickPoolKey ? hoverEmote.id : (kickEmotePool[0]?.id ?? null);

  const rerollKickEmote = useCallback(() => {
    if (platform !== "kick" || kickEmotePool.length === 0) return;
    const next = kickEmotePool[Math.floor(Math.random() * kickEmotePool.length)];
    if (next) setHoverEmote({ key: kickPoolKey, id: next.id });
  }, [platform, kickEmotePool, kickPoolKey]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={onOpenRequest}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseEnter={rerollKickEmote}
        className={`group flex-shrink-0 flex items-center justify-center w-14 h-full transition-colors text-white disabled:opacity-50 disabled:cursor-not-allowed ${
          isOpen ? "bg-white/20" : "hover:bg-white/10"
        }`}
        aria-label={label}
        aria-pressed={isOpen}
        data-testid="native-emote-button"
        disabled={disabled}
      >
        {/* KickTalk's `.emoteBtn img` — 50% opacity at rest, 100% on hover/open. */}
        <span
          className={`block transition-opacity duration-200 ease-out ${
            isOpen ? "opacity-100" : "opacity-50 group-hover:opacity-100"
          }`}
        >
          {platform === "kick" && displayKickEmoteId ? (
            <img
              src={kickEmoteUrl(displayKickEmoteId)}
              alt=""
              width={24}
              height={24}
              loading="lazy"
              decoding="async"
              className="block transition-transform duration-150 ease-out group-hover:scale-110"
            />
          ) : platform === "kick" ? (
            <KickEmoteIcon size={24} />
          ) : (
            <TwitchIcon size={24} />
          )}
        </span>
      </button>
      <EmotePickerPopover
        isOpen={isOpen}
        onClose={onOpenRequest}
        onSelect={onEmoteSelect}
        anchorRef={anchorRef as React.RefObject<HTMLElement>}
        scope="native"
        platform={platform}
        channelId={channelId}
        channelName={channel}
        kickUserId={kickUserId}
        viewerUserId={viewerUserId}
        viewerIsSubscribed={viewerIsSubscribed}
        channelAvatarUrl={channelAvatarUrl}
        channelLabel={channelLabel}
      />
    </>
  );
};

NativeEmoteButton.displayName = "NativeEmoteButton";

export default NativeEmoteButton;
