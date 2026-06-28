import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Emote } from "../../../backend/services/emotes/emote-types";

interface EmoteTooltipProps {
  show: boolean;
  mousePos: { x: number; y: number } | null;
  emote: Emote;
}

const PROVIDER_COLORS: Record<string, string> = {
  twitch: "#9146FF",
  kick: "#53FC18", // Keeping for text color if needed, but styling is neutral button in screenshot
  bttv: "#D50014",
  ffz: "#5D8FBC",
  "7tv": "#29B6F6",
};

export const EmoteTooltip: React.FC<EmoteTooltipProps> = ({ show, mousePos, emote }) => {
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<{ top: number; left: number; opacity: number }>({
    top: 0,
    left: 0,
    opacity: 0,
  });
  const [imageLoaded, setImageLoaded] = useState(false);

  // Reset image loaded state when emote changes
  useEffect(() => {
    setImageLoaded(false);
  }, []);

  useLayoutEffect(() => {
    if (!mousePos || !show || !tooltipRef.current) {
      // Hide if not valid, but keep in DOM for measurement if needed next frame
      if (style.opacity !== 0) {
        setStyle((prev) => ({ ...prev, opacity: 0 }));
      }
      return;
    }

    const calculatePosition = () => {
      const offset = 10;
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;

      // Measure actual dimensions
      const rect = tooltipRef.current?.getBoundingClientRect();
      const width = rect?.width || 200;
      const height = rect?.height || 180;

      let top = mousePos.y + offset;
      let left = mousePos.x + offset;

      // Prevent going off right edge
      if (left + width > windowWidth - 20) {
        left = mousePos.x - width - offset;
      }
      // Ensure not off-screen left
      if (left < 20) {
        left = windowWidth - width - 20;
      }

      // Prevent going off bottom edge
      if (top + height > windowHeight - 20) {
        top = mousePos.y - height - offset;
      }
      // Ensure not off-screen top
      if (top < 20) {
        top = 20;
      }

      // Set position and show immediately
      setStyle({ top, left, opacity: 1 });
    };

    calculatePosition();
  }, [mousePos, show, style.opacity]); // Recalculate if image loading changes size, though width is fixed-ish

  if (!show || !mousePos) return null;

  const displayUrl = emote.urls.url2x || emote.urls.url1x;

  // Determine provider color for badge
  const _providerColor = PROVIDER_COLORS[emote.provider] || "#ffffff";

  // Match KickTalk's "Jun 22, 2023" format; force en-US so the layout stays predictable
  // across locales. 7TV ActiveEmote.timestamp is unix-ms (0 means absent → undefined).
  const addedOnLabel = emote.addedAt
    ? new Date(emote.addedAt).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return createPortal(
    <div
      ref={tooltipRef}
      style={{
        top: style.top,
        left: style.left,
        opacity: style.opacity,
        position: "fixed",
        zIndex: 9999,
        transition: "opacity 0.1s ease-out",
      }}
      className="pointer-events-none flex flex-col items-center bg-[#0b0c0f] border border-white/10 rounded-lg p-4 shadow-2xl min-w-[160px]"
    >
      {/* Emote Preview */}
      <div className="mb-3">
        <img
          src={displayUrl}
          alt={emote.name}
          className={`h-24 w-auto object-contain transition-opacity duration-200 ${imageLoaded ? "opacity-100" : "opacity-0"}`}
          onLoad={() => setImageLoaded(true)}
        />
      </div>

      {/* Content */}
      <div className="flex flex-col items-center w-full gap-3">
        <span className="text-white font-extrabold text-xl tracking-wide uppercase leading-none">
          {emote.name}
        </span>

        {/* Provider Button/Badge */}
        <div className="w-full bg-[#1e1f23] border border-white/10 rounded px-4 py-1.5 text-center">
          <span className="text-[#b0b3b8] font-bold text-sm">
            {emote.provider === "kick"
              ? "Kick"
              : emote.provider === "twitch"
                ? "Twitch"
                : emote.provider === "7tv"
                  ? "7TV"
                  : emote.provider.toUpperCase()}
          </span>
        </div>

        {/* Author + Added date (mirrors KickTalk's tooltip) */}
        {(emote.owner || addedOnLabel) && (
          <div className="flex flex-col items-center gap-0.5 -mt-1">
            {emote.owner && (
              <span className="text-[#b0b3b8] text-xs">
                Made by <span className="text-white">{emote.owner.displayName}</span>
              </span>
            )}
            {addedOnLabel && (
              <span className="text-[#b0b3b8] text-xs">Added on {addedOnLabel}</span>
            )}
          </div>
        )}

        {/* Extra Flags */}
        {(emote.isAnimated || emote.isZeroWidth) && (
          <div className="flex gap-2">
            {emote.isAnimated && (
              <span className="text-[10px] font-bold text-neutral-500 uppercase">GIF</span>
            )}
            {emote.isZeroWidth && (
              <span className="text-[10px] font-bold text-neutral-500 uppercase">ZW</span>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
