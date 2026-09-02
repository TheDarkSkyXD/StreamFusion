import { useTranslation } from "react-i18next";
import type React from "react";
import { memo, useCallback, useMemo, useState } from "react";
import { ProxiedImage } from "@/components/ui/proxied-image";
import { resolveProxiedImageSrc } from "@/lib/proxied-image-url";
import { BadgeTooltip } from "./tooltips/BadgeTooltip";

interface ChatBadgeProps {
  badge: {
    imageUrl?: string;
    title?: string;
    setId?: string;
    version?: string;
    backgroundColor?: string;
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
  const { t } = useTranslation();
  const [showTooltip, setShowTooltip] = useState(false);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const badgeClassName =
    platform === "kick"
      ? "inline-block h-[calc(1em*(18/13))] w-[calc(1em*(18/13))] object-contain align-middle cursor-pointer"
      : "h-4 w-4 object-contain inline-block align-middle cursor-pointer";
  const backgroundColor = /^#[\da-f]{6}$/i.test(badge.backgroundColor ?? "")
    ? badge.backgroundColor
    : undefined;
  const isSubscriptionBadge = badge.setId?.toLowerCase() === "subscriber";
  const canUseProxiedImage = /^(https?:|data:)/i.test(badge.imageUrl ?? "");

  // Capture position once on hover-enter — tooltip is anchored, doesn't follow the cursor.
  // Previously onMouseMove fired ~60 Hz allocating a fresh {x,y} object per frame.
  const handleMouseEnter = useCallback((e: React.MouseEvent) => {
    setMousePos({ x: e.clientX, y: e.clientY });
    setShowTooltip(true);
  }, []);

  const handleMouseLeave = useCallback(() => {
    setShowTooltip(false);
  }, []);

  // Keep the inline badge and tooltip on the same renderer-safe URL.
  const badgeInfo = useMemo(() => {
    const src = resolveProxiedImageSrc(badge.imageUrl) ?? badge.imageUrl;
    return src
      ? {
          src,
          title: badge.title || t("chat.badge"),
          platform: platform === "twitch" ? ("Twitch" as const) : ("Kick" as const),
        }
      : null;
  }, [badge.imageUrl, badge.title, platform, t]);

  if (!badgeInfo) return null;

  const loading = isSubscriptionBadge ? "eager" : "lazy";
  const fetchPriority = isSubscriptionBadge ? "auto" : "low";
  const imageProps = {
    alt: badgeInfo.title,
    loading,
    fetchPriority,
    className: badgeClassName,
    style: { backgroundColor },
    onMouseEnter: handleMouseEnter,
    onMouseLeave: handleMouseLeave,
  } satisfies React.ImgHTMLAttributes<HTMLImageElement>;

  return (
    <>
      {canUseProxiedImage ? (
        <ProxiedImage src={badge.imageUrl} {...imageProps} />
      ) : (
        <img src={badgeInfo.src} decoding="async" {...imageProps} />
      )}

      <BadgeTooltip show={showTooltip} mousePos={mousePos} badgeInfo={badgeInfo} />
    </>
  );
});

ChatBadge.displayName = "ChatBadge";
