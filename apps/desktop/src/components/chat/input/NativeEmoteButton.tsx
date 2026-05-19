/**
 * NativeEmoteButton — trigger button + anchored EmoteDialog pair for the
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
import { useRef } from "react";
import type { Emote } from "../../../backend/services/emotes/emote-types";
import type { ChatPlatform } from "../../../shared/chat-types";
import { EmoteDialog } from "../EmoteDialog";
import { KickEmoteIcon, TwitchIcon } from "../../icons/PlatformIcons";

interface NativeEmoteButtonProps {
  platform: ChatPlatform;
  channelId: string | null;
  isOpen: boolean;
  onOpenRequest: () => void;
  onEmoteSelect: (emote: Emote) => void;
  disabled?: boolean;
  /** Forwarded to EmoteDialog. Only consulted for Kick-native. `undefined`
   *  means "unknown subscription status" → no lock overlay (U8 semantics). */
  viewerIsSubscribed?: boolean;
}

export const NativeEmoteButton: React.FC<NativeEmoteButtonProps> = ({
  platform,
  channelId,
  isOpen,
  onOpenRequest,
  onEmoteSelect,
  disabled = false,
  viewerIsSubscribed,
}) => {
  const buttonRef = useRef<HTMLButtonElement>(null);

  const Icon = platform === "twitch" ? TwitchIcon : KickEmoteIcon;
  const label = `Open ${platform} emote picker`;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={onOpenRequest}
        onMouseDown={(e) => e.stopPropagation()}
        className="flex-shrink-0 p-1.5 hover:bg-white/10 rounded transition-colors text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
        aria-label={label}
        aria-pressed={isOpen}
        data-testid="native-emote-button"
        disabled={disabled}
      >
        <Icon size={18} />
      </button>
      <EmoteDialog
        isOpen={isOpen}
        onClose={onOpenRequest}
        onSelect={onEmoteSelect}
        anchorRef={buttonRef as React.RefObject<HTMLElement>}
        scope="native"
        platform={platform}
        channelId={channelId}
        viewerIsSubscribed={viewerIsSubscribed}
      />
    </>
  );
};

NativeEmoteButton.displayName = "NativeEmoteButton";

export default NativeEmoteButton;
