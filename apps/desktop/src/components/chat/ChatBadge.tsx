import type React from "react";
import { memo, useCallback, useMemo, useState } from "react";
import { BadgeTooltip } from "./tooltips/BadgeTooltip";

interface ChatBadgeProps {
  badge: {
    imageUrl?: string;
    title?: string;
    setId?: string;
    version?: string;
  };
  platform?: "twitch" | "kick";
}

/**
 * ChatBadge Component - Performance Optimized
 *
 * Renders chat badges with tooltip support.
 * Memoized to prevent re-renders when props haven't changed.
 */
export const ChatBadge: React.FC<ChatBadgeProps> = memo(({ badge, platform = "kick" }) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const badgeClassName =
    platform === "kick"
      ? "inline-block h-[calc(1em*(18/13))] w-[calc(1em*(18/13))] object-contain align-middle cursor-pointer"
      : "h-4 w-4 object-contain inline-block align-middle cursor-pointer";

  // Capture position once on hover-enter — tooltip is anchored, doesn't follow the cursor.
  // Previously onMouseMove fired ~60 Hz allocating a fresh {x,y} object per frame.
  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    setMousePos({ x: e.clientX, y: e.clientY });
    setShowTooltip(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setShowTooltip(false);
  }, []);

  // Memoize badge info for tooltip
  const badgeInfo = useMemo(
    () => ({
      src: badge.imageUrl || "",
      title: badge.title || "Badge",
      platform: platform === "twitch" ? ("Twitch" as const) : ("Kick" as const),
    }),
    [badge.imageUrl, badge.title, platform]
  );

  if (!badge.imageUrl) return null;

  return (
    <>
      <img
        src={badge.imageUrl}
        alt={badge.title || "Badge"}
        loading="lazy"
        decoding="async"
        fetchPriority="low"
        className={badgeClassName}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      />

      <BadgeTooltip show={showTooltip} mousePos={mousePos} badgeInfo={badgeInfo} />
    </>
  );
});

ChatBadge.displayName = "ChatBadge";
