/**
 * ThirdPartyEmoteButton — trigger button + anchored EmotePickerPopover pair for the
 * third-party emote scope (7TV/BTTV/FFZ on Twitch, 7TV on Kick).
 *
 * Always shows the 7TV brand mark — it's the only third-party provider that
 * spans both platforms, and matches KickTalk's convention of pairing the
 * third-party slot with the 7TV logo regardless of which providers are
 * actually loaded in the dialog.
 *
 * Mutual exclusion with NativeEmoteButton is enforced by the parent via
 * `isOpen` + `onOpenRequest`.
 */

import type React from "react";
import { useCallback, useRef } from "react";
import type { Emote } from "../../../backend/services/emotes/emote-types";
import { useChannelByUsername } from "../../../hooks/queries/useChannels";
import type { ChatPlatform } from "../../../shared/chat-types";
import { SevenTVIcon } from "../../icons/PlatformIcons";
import { EmotePickerPopover } from "../EmotePickerPopover";

interface ThirdPartyEmoteButtonProps {
  platform: ChatPlatform;
  /** Channel username (slug) — used to fetch the streamer's avatar for the
   *  picker's channel-tab thumbnail (Kick third-party only; the Twitch
   *  third-party tab row is 7TV/BTTV/FFZ and has no channel sub-section). */
  channel: string;
  channelId: string | null;
  kickUserId?: string | null;
  viewerUserId?: string;
  isOpen: boolean;
  onOpenRequest: () => void;
  onEmoteSelect: (emote: Emote) => void;
  disabled?: boolean;
  /**
   * Shared popover anchor written with this button element. Native pickers use
   * the same ref so all emote popovers open from the 7TV button position.
   */
  popoverAnchorRef?: React.MutableRefObject<HTMLElement | null>;
}

export const ThirdPartyEmoteButton: React.FC<ThirdPartyEmoteButtonProps> = ({
  platform,
  channel,
  channelId,
  kickUserId,
  viewerUserId,
  isOpen,
  onOpenRequest,
  onEmoteSelect,
  disabled = false,
  popoverAnchorRef,
}) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const setButtonRef = useCallback(
    (node: HTMLButtonElement | null) => {
      buttonRef.current = node;
      if (popoverAnchorRef) popoverAnchorRef.current = node;
    },
    [popoverAnchorRef]
  );
  const { data: channelData } = useChannelByUsername(channel, platform);
  const channelAvatarUrl = channelData?.avatarUrl ?? null;
  const channelLabel = channelData?.displayName || channelData?.username || channel;

  return (
    <>
      <button
        ref={setButtonRef}
        type="button"
        onClick={onOpenRequest}
        onMouseDown={(e) => e.stopPropagation()}
        className={`group flex-shrink-0 flex items-center justify-center w-14 h-full transition-colors text-white disabled:opacity-50 disabled:cursor-not-allowed ${
          isOpen ? "bg-white/20" : "hover:bg-white/10"
        }`}
        aria-label="Open third-party emote picker"
        aria-pressed={isOpen}
        data-testid="third-party-emote-button"
        disabled={disabled}
      >
        {/* KickTalk's `.emoteBtn img` — currentColor is white so opacity:0.5
            renders as half-white (matching KickTalk's <img src={STVLogo}>);
            opacity lifts to 1 on hover/open. */}
        <span
          className={`block transition-opacity duration-200 ease-out ${
            isOpen ? "opacity-100" : "opacity-50 group-hover:opacity-100"
          }`}
        >
          <SevenTVIcon size={24} />
        </span>
      </button>
      <EmotePickerPopover
        isOpen={isOpen}
        onClose={onOpenRequest}
        onSelect={onEmoteSelect}
        anchorRef={(popoverAnchorRef ?? buttonRef) as React.RefObject<HTMLElement>}
        scope="thirdParty"
        platform={platform}
        channelId={channelId}
        channelName={channel}
        kickUserId={kickUserId}
        viewerUserId={viewerUserId}
        channelAvatarUrl={channelAvatarUrl}
        channelLabel={channelLabel}
      />
    </>
  );
};

ThirdPartyEmoteButton.displayName = "ThirdPartyEmoteButton";

export default ThirdPartyEmoteButton;
