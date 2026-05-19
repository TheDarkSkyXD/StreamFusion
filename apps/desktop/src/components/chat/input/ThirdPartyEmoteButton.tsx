/**
 * ThirdPartyEmoteButton — trigger button + anchored EmoteDialog pair for the
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
import { useRef } from "react";
import type { Emote } from "../../../backend/services/emotes/emote-types";
import type { ChatPlatform } from "../../../shared/chat-types";
import { EmoteDialog } from "../EmoteDialog";
import { SevenTVIcon } from "../../icons/PlatformIcons";

interface ThirdPartyEmoteButtonProps {
  platform: ChatPlatform;
  channelId: string;
  isOpen: boolean;
  onOpenRequest: () => void;
  onEmoteSelect: (emote: Emote) => void;
  disabled?: boolean;
}

export const ThirdPartyEmoteButton: React.FC<ThirdPartyEmoteButtonProps> = ({
  platform,
  channelId,
  isOpen,
  onOpenRequest,
  onEmoteSelect,
  disabled = false,
}) => {
  const buttonRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={onOpenRequest}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex-shrink-0 p-1.5 hover:bg-white/10 rounded transition-colors text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label="Open third-party emote picker"
        aria-pressed={isOpen}
        data-testid="third-party-emote-button"
        disabled={disabled}
      >
        <SevenTVIcon size={18} />
      </button>
      <EmoteDialog
        isOpen={isOpen}
        onClose={onOpenRequest}
        onSelect={onEmoteSelect}
        anchorRef={buttonRef as React.RefObject<HTMLElement>}
        scope="thirdParty"
        platform={platform}
        channelId={channelId}
      />
    </>
  );
};

ThirdPartyEmoteButton.displayName = "ThirdPartyEmoteButton";

export default ThirdPartyEmoteButton;
