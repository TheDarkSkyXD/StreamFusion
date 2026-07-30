import type React from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Emote } from "../../backend/services/emotes/emote-types";
import { DEFAULT_CHAT_DISPLAY_PREFERENCES } from "../../shared/auth-types";
import { useAuthStore } from "../../store/auth-store";
import { useOfficialEmoteImageSource } from "./official-emote-image-source";
import { EmoteTooltip } from "./tooltips/EmoteTooltip";

interface ChatEmoteProps {
  id: string;
  name: string;
  url: string;
  platform: "twitch" | "kick";
  isAnimated?: boolean;
  /** Zero-width / overlay emote — stacks on the preceding emote when the
   *  viewer's `overlayEmotes` pref is on (mirrors EmoteImage's overlay styling). */
  isZeroWidth?: boolean;
}

/**
 * Return a static-frame URL for an animated emote when one can be derived from
 * the URL alone, otherwise null (caller falls back to the animated URL).
 *
 * Only the native-Twitch CDN exposes a clean static variant via a path swap
 * (`/default/` or `/animated/` → `/static/`). 7TV and BTTV serve animated and
 * static frames from the same file format at the same URL, so freezing them
 * isn't possible from the fragment URL alone — see the TODO below.
 */
function freezeEmoteUrl(url: string): string | null {
  // Native Twitch: .../emoticons/v2/{id}/{format}/{theme}/{scale}
  if (url.includes("static-cdn.jtvnw.net/emoticons/")) {
    if (url.includes("/animated/")) return url.replace("/animated/", "/static/");
    if (url.includes("/default/")) return url.replace("/default/", "/static/");
    return url; // already a /static/ url
  }
  // TODO(U3): 7TV (*.7tv.app) and BTTV (cdn.betterttv.net) animated emotes have
  // no static-frame variant reachable by URL transform — both serve the animated
  // and "static" forms from the same animated WEBP/AVIF/GIF at the same URL. A
  // true freeze for these needs either a non-animated size variant from the
  // provider record (not carried on the flattened ContentFragment) or a
  // canvas/first-frame paint. Returning null keeps the animated URL rather than
  // faking a freeze. Note third-party emotes are not yet woven into chat-message
  // fragments today, so this path is currently unreachable in production.
  return null;
}

/**
 * ChatEmote Component - Performance Optimized
 *
 * Renders inline emotes in chat messages with tooltip support. Honors the
 * viewer's chatDisplay prefs: `overlayEmotes` stacks zero-width emotes on the
 * previous emote, `animatedEmotes` (when off) freezes animated emotes to a
 * static frame where the URL allows it.
 *
 * Memoized to prevent re-renders when props haven't changed.
 */
export const ChatEmote: React.FC<ChatEmoteProps> = memo(
  ({ id, name, url, platform, isAnimated, isZeroWidth }) => {
    const cd = useAuthStore((s) => s.preferences?.chatDisplay) ?? DEFAULT_CHAT_DISPLAY_PREFERENCES;
    const emoteSizePx = cd.emoteSizePx;
    const [showTooltip, setShowTooltip] = useState(false);
    const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
    // Sticky tooltip — set by click, persists until outside-click or Escape.
    // Mirrors Xtra's tap-to-show-emote-info behavior so a viewer can keep the
    // emote name on screen without holding the cursor over the image.
    const [sticky, setSticky] = useState(false);
    const [stickyPos, setStickyPos] = useState<{ x: number; y: number } | null>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);

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

    const handleClick = useCallback((e: React.MouseEvent) => {
      setStickyPos({ x: e.clientX, y: e.clientY });
      setSticky((s) => !s);
    }, []);
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      const rect = triggerRef.current?.getBoundingClientRect();
      setStickyPos(rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 } : null);
      setSticky((s) => !s);
    }, []);

    useEffect(() => {
      if (!sticky) return;
      const onDocClick = (e: MouseEvent) => {
        if (triggerRef.current?.contains(e.target as Node)) return;
        setSticky(false);
      };
      const onKey = (e: KeyboardEvent) => {
        if (e.key === "Escape") setSticky(false);
      };
      document.addEventListener("click", onDocClick);
      document.addEventListener("keydown", onKey);
      return () => {
        document.removeEventListener("click", onDocClick);
        document.removeEventListener("keydown", onKey);
      };
    }, [sticky]);

    // When animation is disabled, render a static frame if the URL exposes one;
    // otherwise fall back to the original (animated) URL — never fake a freeze.
    const renderUrl = useMemo(() => {
      if (!isAnimated || cd.animatedEmotes) return url;
      return freezeEmoteUrl(url) ?? url;
    }, [url, isAnimated, cd.animatedEmotes]);
    const imageSource = useOfficialEmoteImageSource(renderUrl);

    // Treat as an overlay only when the emote is zero-width AND the viewer has
    // overlays enabled. With overlays off, zero-width emotes render inline.
    const renderAsOverlay = !!isZeroWidth && cd.overlayEmotes;

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
        isZeroWidth: !!isZeroWidth,
        urls: {
          url1x: url,
          url2x: url,
          url4x: url,
        },
      };
    }, [id, name, url, platform, isAnimated, isZeroWidth]);

    // Zero-width overlay positioning mirrors EmoteImage.tsx: pull the emote back
    // over the preceding one with a negative margin equal to the emote width and
    // take it out of flow so it doesn't consume horizontal space.
    const triggerStyle: React.CSSProperties = renderAsOverlay
      ? {
          height: emoteSizePx,
          width: emoteSizePx,
          maxWidth: "100%",
          position: "absolute",
          marginLeft: `-${emoteSizePx}px`,
        }
      : { height: emoteSizePx, width: emoteSizePx, maxWidth: "100%" };
    const imageStyle: React.CSSProperties = {
      height: emoteSizePx,
      width: emoteSizePx,
      maxWidth: "100%",
      objectFit: "contain",
    };

    return (
      <>
        <button
          ref={triggerRef}
          type="button"
          data-zero-width={renderAsOverlay ? "true" : undefined}
          style={triggerStyle}
          aria-label={`Show ${name} emote details`}
          className="inline-block mx-0.5 cursor-pointer border-0 bg-transparent p-0 align-middle leading-none"
          onMouseEnter={handleMouseEnter}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          onClick={handleClick}
          onKeyDown={handleKeyDown}
        >
          {imageSource.failed ? (
            <span className="inline-flex h-full items-center px-1 text-xs">{name}</span>
          ) : (
            <img
              src={imageSource.sourceUrl}
              alt={name}
              loading="lazy"
              decoding="async"
              fetchPriority="low"
              onLoad={imageSource.handleLoad}
              onError={imageSource.handleError}
              style={imageStyle}
              className="block"
            />
          )}
        </button>

        <EmoteTooltip
          show={showTooltip || sticky}
          mousePos={sticky ? stickyPos : mousePos}
          emote={emoteObj}
        />
      </>
    );
  }
);

ChatEmote.displayName = "ChatEmote";
