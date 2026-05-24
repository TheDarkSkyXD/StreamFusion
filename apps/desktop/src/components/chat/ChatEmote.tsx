import type React from "react";
import { memo, useCallback, useMemo, useState } from "react";
import type { Emote } from "../../backend/services/emotes/emote-types";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES } from "../../shared/auth-types";
import { useAuthStore } from "../../store/auth-store";
import { EmoteTooltip } from "./tooltips/EmoteTooltip";

interface ChatEmoteProps {
  id: string;
  name: string;
  url: string;
  platform: "twitch" | "kick";
  isAnimated?: boolean;
}

/**
 * ChatEmote Component - Performance Optimized
 *
 * Renders inline emotes in chat messages with tooltip support.
 * Memoized to prevent re-renders when props haven't changed.
 */
export const ChatEmote: React.FC<ChatEmoteProps> = memo(
  ({ id, name, url, platform, isAnimated }) => {
    const emoteSizePx =
      useAuthStore((s) => s.preferences?.chatDisplay?.emoteSizePx) ??
      DEFAULT_CHAT_DISPLAY_PREFERENCES.emoteSizePx;
    const [showTooltip, setShowTooltip] = useState(false);
    const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

    const handleMouseEnter = useCallback((e: React.MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
      setShowTooltip(true);
    }, []);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
    }, []);

    const handleMouseLeave = useCallback(() => {
      setShowTooltip(false);
    }, []);

    // Memoized emote object for tooltip
    const emoteObj = useMemo<Emote>(() => {
      // Infer provider from URL
      let provider: Emote["provider"] = platform;
      if (url.includes("7tv.app")) provider = "7tv";
      else if (url.includes("betterttv")) provider = "bttv";
      else if (url.includes("frankerfacez")) provider = "ffz";

      return {
        id,
        name,
        provider,
        isGlobal: false,
        isAnimated: !!isAnimated,
        isZeroWidth: false,
        urls: {
          url1x: url,
          url2x: url,
          url4x: url,
        },
      };
    }, [id, name, url, platform, isAnimated]);

    return (
      <>
        <img
          src={url}
          alt={name}
          loading="lazy"
          style={{ height: emoteSizePx }}
          className="inline-block w-auto mx-0.5 align-middle cursor-pointer transition-transform hover:scale-110"
          onMouseEnter={handleMouseEnter}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />

        <EmoteTooltip show={showTooltip} mousePos={mousePos} emote={emoteObj} />
      </>
    );
  }
);

ChatEmote.displayName = "ChatEmote";
