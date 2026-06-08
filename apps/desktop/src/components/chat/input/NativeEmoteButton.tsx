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
import { useCallback, useEffect, useRef, useState } from "react";
import type { Emote } from "../../../backend/services/emotes/emote-types";
import type { ChatPlatform } from "../../../shared/chat-types";
import { useEmoteStore } from "../../../store/emote-store";
import { TwitchIcon } from "../../icons/PlatformIcons";
import { EmotePickerPopover } from "../EmotePickerPopover";

/** KickTalk's hardcoded fallback Kick emote ID (used when no provider emotes
 *  are loaded yet). Surfaces a recognizable green-blob KEKW on first paint. */
const KICK_FALLBACK_EMOTE_ID = "1730762";
const kickEmoteUrl = (id: string) => `https://files.kick.com/emotes/${id}/fullsize`;

interface NativeEmoteButtonProps {
  platform: ChatPlatform;
  channelId: string | null;
  isOpen: boolean;
  onOpenRequest: () => void;
  onEmoteSelect: (emote: Emote) => void;
  disabled?: boolean;
  /** Forwarded to EmotePickerPopover. Only consulted for Kick-native. `undefined`
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
  const label = `Open ${platform} emote picker`;

  // Kick-specific: cycle through real channel/global Kick emotes on hover so
  // the button matches KickTalk's `kickEmoteButton` UX (random emote image
  // updates each time the cursor enters). Twitch keeps its static glitch mark.
  //
  // We can't read this via a zustand selector — `getEmotesByProvider()` builds
  // a new Map on every call, which would force-rerender on every store update
  // and (because pool is in the dep array of the seeding effect) loop forever.
  // Instead we pull a stable snapshot inside an effect that subscribes to the
  // store directly.
  const [kickEmotePool, setKickEmotePool] = useState<Emote[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `channelId` is the re-subscribe trigger; the body reads from the store imperatively, so the value isn't referenced directly
  useEffect(() => {
    if (platform !== "kick") {
      setKickEmotePool([]);
      return;
    }
    const refresh = () => {
      const pool = useEmoteStore.getState().getEmotesByProvider().get("kick");
      setKickEmotePool((pool ?? []).filter((e) => !e.subscribersOnly));
    };
    refresh();
    const unsubscribe = useEmoteStore.subscribe(refresh);
    return unsubscribe;
  }, [platform, channelId]);

  const [hoverEmoteId, setHoverEmoteId] = useState<string>(KICK_FALLBACK_EMOTE_ID);

  // Reseed when the pool changes (channel switch, lazy emote load) so the
  // default ID isn't sticky on a channel that has its own emotes loaded.
  useEffect(() => {
    if (platform !== "kick" || kickEmotePool.length === 0) return;
    const seed = kickEmotePool[Math.floor(Math.random() * kickEmotePool.length)];
    if (seed) setHoverEmoteId(seed.id);
  }, [platform, kickEmotePool]);

  const rerollKickEmote = useCallback(() => {
    if (platform !== "kick" || kickEmotePool.length === 0) return;
    const next = kickEmotePool[Math.floor(Math.random() * kickEmotePool.length)];
    if (next) setHoverEmoteId(next.id);
  }, [platform, kickEmotePool]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={onOpenRequest}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseEnter={rerollKickEmote}
        className={`group flex-shrink-0 flex items-center justify-center w-10 h-full transition-colors text-white disabled:opacity-50 disabled:cursor-not-allowed ${
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
          {platform === "kick" ? (
            <img
              src={kickEmoteUrl(hoverEmoteId)}
              alt=""
              width={24}
              height={24}
              loading="lazy"
              decoding="async"
              className="block transition-transform duration-150 ease-out group-hover:scale-110"
            />
          ) : (
            <TwitchIcon size={24} />
          )}
        </span>
      </button>
      <EmotePickerPopover
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
