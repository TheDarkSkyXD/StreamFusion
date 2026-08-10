import { Button } from "@/components/ui/button";
import { PlatformAvatar } from "@/components/ui/platform-avatar";
import { ProxiedImage } from "@/components/ui/proxied-image";
import { cn } from "@/lib/utils";
import type { Platform } from "@/shared/auth-types";

interface OfflineOverlayProps {
  platform: Platform;
  channelName: string;
  displayName?: string;
  avatarUrl?: string;
  bannerUrl?: string;
  categoryName?: string;
  lastStreamTitle?: string;
  statusMessage?: string;
  onCheckAgain: () => void;
  compact?: boolean;
}

export function OfflineOverlay({
  platform,
  channelName,
  displayName,
  avatarUrl,
  bannerUrl,
  categoryName,
  lastStreamTitle,
  statusMessage = "is currently offline",
  onCheckAgain,
  compact = false,
}: OfflineOverlayProps) {
  const name = displayName || channelName;

  return (
    <div className="absolute inset-0 z-20 overflow-hidden">
      {bannerUrl ? (
        <ProxiedImage
          src={bannerUrl}
          alt="Offline banner"
          className="absolute inset-0 w-full h-full object-cover"
        />
      ) : avatarUrl ? (
        <>
          <ProxiedImage
            src={avatarUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover blur-3xl scale-150 opacity-40"
            fallback={<div className="absolute inset-0 bg-[var(--color-background-secondary)]" />}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/80 to-black" />
        </>
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-purple-900/50 via-neutral-900 to-black" />
      )}
      <div className="absolute inset-0 bg-gradient-to-b from-black/35 via-black/55 to-black/80" />
      <div
        className={cn(
          "absolute inset-0 flex flex-col items-center justify-center",
          compact ? "px-16" : "px-6"
        )}
      >
        {avatarUrl && !bannerUrl && !compact && (
          <div className="mb-6">
            <PlatformAvatar
              src={avatarUrl}
              alt={name}
              platform={platform}
              size="w-24 h-24"
              className="border-4 border-white/20 shadow-2xl"
              disablePlatformBorder
            />
          </div>
        )}
        <div className="text-center max-w-xl">
          <p
            className={cn(
              "text-white font-bold drop-shadow-lg",
              compact ? "text-base mb-0.5" : "text-3xl mb-2"
            )}
          >
            {name}
          </p>
          <p className={cn("text-white/70", compact ? "text-xs mb-3" : "text-lg mb-4")}>
            {statusMessage}
          </p>
          {!compact && lastStreamTitle && (
            <p className="text-white/90 text-base font-medium line-clamp-2 mb-2">
              {lastStreamTitle}
            </p>
          )}
          {!compact && categoryName && (
            <p className="text-white/70 text-sm mb-8">Last streamed in {categoryName}</p>
          )}
          {!compact && !categoryName && !lastStreamTitle && <div className="mb-8" />}
          <Button
            variant="outline"
            size={compact ? "sm" : "lg"}
            className="bg-white/10 border-white/30 hover:bg-white/20 backdrop-blur-sm"
            onClick={onCheckAgain}
          >
            Check Again
          </Button>
        </div>
      </div>
    </div>
  );
}
