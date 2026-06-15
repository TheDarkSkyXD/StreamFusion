import { Link } from "@tanstack/react-router";

import type { UnifiedStream } from "@/backend/api/unified/platform-types";
import { KickIcon, TwitchIcon } from "@/components/icons/PlatformIcons";
import { Button } from "@/components/ui/button";
import { ProxiedImage } from "@/components/ui/proxied-image";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, formatViewerCount } from "@/lib/utils";

interface FeaturedStreamProps {
  stream?: UnifiedStream;
  isLoading?: boolean;
}

export function FeaturedStream({ stream, isLoading }: FeaturedStreamProps) {
  if (isLoading) {
    return (
      <div className="w-full h-[400px] rounded-xl overflow-hidden relative">
        <Skeleton className="w-full h-full" />
        <div className="absolute inset-x-0 bottom-0 p-8 flex items-end bg-gradient-to-t from-black/90 to-transparent">
          <div className="w-full space-y-4">
            <div className="flex gap-4 items-center">
              <Skeleton className="w-16 h-16 rounded-full" />
              <div className="space-y-2">
                <Skeleton className="h-6 w-64" />
                <Skeleton className="h-4 w-32" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!stream) return null;

  const PlatformIcon = stream.platform === "twitch" ? TwitchIcon : KickIcon;
  const platformColor = stream.platform === "twitch" ? "text-[#9146FF]" : "text-[#53FC18]";
  const buttonVariant = stream.platform === "twitch" ? "twitch" : "kick";

  return (
    <div className="w-full rounded-xl overflow-hidden relative group bg-[var(--color-background-secondary)] shadow-2xl">
      {/* Background Image / Thumbnail - darker for contrast */}
      <div className="absolute inset-0">
        <ProxiedImage
          src={stream.thumbnailUrl.replace("{width}", "1920").replace("{height}", "1080")} // Try to get higher res if template
          alt={stream.title}
          className="w-full h-full object-cover blur-sm opacity-50 scale-105 group-hover:scale-110 transition-transform duration-700"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[var(--color-background)] via-[var(--color-background)]/80 to-transparent" />
      </div>

      <div className="relative z-10 flex flex-col md:flex-row h-full min-h-[400px]">
        {/* Content Section */}
        <div className="flex-1 p-8 flex flex-col justify-center space-y-6">
          <div className="flex items-center gap-2">
            <span className="px-2 py-1 rounded bg-red-600 text-white text-xs font-bold uppercase tracking-wider">
              Live
            </span>
            <span className={cn("flex items-center gap-1 font-semibold", platformColor)}>
              <PlatformIcon size={16} />
              <span className="capitalize">{stream.platform}</span>
            </span>
            <span className="text-[var(--color-foreground-muted)] text-sm">
              {formatViewerCount(stream.viewerCount)} viewers
            </span>
          </div>

          <div className="space-y-2">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-[var(--color-border)]">
                <ProxiedImage
                  src={stream.channelAvatar}
                  alt={stream.channelDisplayName}
                  className="w-full h-full object-cover"
                />
              </div>
              <Link
                to="/stream/$platform/$channel"
                params={{ platform: stream.platform, channel: stream.channelName }}
                search={{ tab: "home" }}
                className="text-xl font-bold text-[var(--color-foreground-secondary)] hover:text-[var(--color-primary)] transition-colors"
              >
                {stream.channelDisplayName}
              </Link>
            </div>

            <h1 className="text-3xl md:text-4xl font-bold text-white leading-tight line-clamp-2">
              {stream.title}
            </h1>

            <div className="text-[var(--color-primary)] font-medium text-lg">
              Playing {stream.categoryName}
            </div>
          </div>

          <div className="pt-4 flex gap-4">
            <Link
              to="/stream/$platform/$channel"
              params={{ platform: stream.platform, channel: stream.channelName }}
              search={{ tab: "home" }}
            >
              <Button variant={buttonVariant} size="lg" className="font-bold">
                Watch Live
              </Button>
            </Link>
          </div>
        </div>

        {/* Hero Image Section - Clean view of stream */}
        <div className="hidden md:flex flex-1 items-center justify-center p-8">
          <Link
            to="/stream/$platform/$channel"
            params={{ platform: stream.platform, channel: stream.channelName }}
            search={{ tab: "home" }}
            className="relative rounded-xl overflow-hidden shadow-2xl border border-[var(--color-border)] transform transition-transform duration-300 hover:scale-[1.02] hover:ring-2 ring-[var(--color-primary)] w-full aspect-video"
          >
            <ProxiedImage
              src={stream.thumbnailUrl}
              alt={stream.title}
              className="w-full h-full object-cover"
            />
            <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors" />
          </Link>
        </div>
      </div>
    </div>
  );
}
