import { Link, useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { lazy, Suspense, useState, type ReactNode } from "react";
import { LuHistory as HistoryIcon, LuPlay, LuTrash2 } from "react-icons/lu";

import {
  parseVideoOrClips,
  type VideoOrClip,
} from "@/features/playback/components/related-content/types";
import { VodProgressBar } from "@/features/playback/components/vod-progress-bar";
import { Button } from "@/components/ui/button";
import { useChannelByUsername } from "@/features/discovery/data/queries/useChannels";
import { useHistoryActions, useHistoryQuery } from "@/features/media-library/data/useHistoryQuery";
import { resolveProxiedImageSrc } from "@/lib/proxied-image-url";
import type { HistoryItem } from "@/store/history-store";

const ClipDialog = lazy(() =>
  import("@/features/playback/components/related-content/ClipDialog").then((module) => ({
    default: module.ClipDialog,
  }))
);

const HistoryItemLink = ({
  item,
  children,
  className,
}: {
  item: HistoryItem;
  children: ReactNode;
  className?: string;
}) => {
  if (item.type === "video") {
    return (
      <Link
        to="/video/$platform/$videoId"
        params={{ platform: item.platform, videoId: item.originalId }}
        className={className}
      >
        {children}
      </Link>
    );
  }
  if (item.type === "clip") {
    return (
      <Link
        to="/stream/$platform/$channel"
        params={{ platform: item.platform, channel: item.channelName }}
        search={{ tab: "clips" }}
        className={className}
      >
        {children}
      </Link>
    );
  }
  return (
    <Link
      to="/stream/$platform/$channel"
      params={{ platform: item.platform, channel: item.channelName }}
      search={{ tab: "home" }}
      className={className}
    >
      {children}
    </Link>
  );
};

export function HistoryPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: history = [] } = useHistoryQuery();
  const { clearHistory, removeFromHistory } = useHistoryActions();
  const [verifyingItemId, setVerifyingItemId] = useState<string | null>(null);
  const [selectedClip, setSelectedClip] = useState<VideoOrClip | null>(null);
  const [clipPlaybackUrl, setClipPlaybackUrl] = useState<string | null>(null);
  const [clipError, setClipError] = useState<string | null>(null);
  const [clipLoading, setClipLoading] = useState(false);
  const selectedClipChannelName = selectedClip?.channelSlug || selectedClip?.channelName || "";
  const { data: selectedClipChannelData } = useChannelByUsername(
    selectedClipChannelName,
    selectedClip?.platform || "twitch"
  );

  const handleClearHistory = () => {
    if (confirm("Are you sure you want to clear your watch history?")) {
      clearHistory();
    }
  };

  const formatDate = (timestamp: number) => {
    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    }).format(new Date(timestamp));
  };

  const toClipDialogItem = (item: HistoryItem): VideoOrClip => ({
    id: item.originalId,
    title: item.title || "Untitled clip",
    duration: item.clipDuration || "",
    views: item.clipViews || "",
    date: item.clipDate || new Date(item.timestamp).toISOString(),
    created_at: item.clipCreatedAt,
    creatorName: item.clipCreatorName,
    thumbnailUrl: item.thumbnail || "",
    url: item.playbackUrl,
    embedUrl: item.playbackUrl,
    shareUrl: item.shareUrl,
    channelSlug: item.channelName,
    channelName: item.channelDisplayName || item.channelName,
    channelAvatar: item.channelAvatar || null,
    channelFollowerCount: item.channelFollowerCount,
    gameName: item.clipGameName,
    category: item.clipCategory,
    vodId: item.clipVodId,
    language: item.clipLanguage,
    platform: item.platform,
  });

  const findRealClipMetadata = async (item: HistoryItem): Promise<VideoOrClip | null> => {
    const api = window.electronAPI;
    if (!api?.clips?.getByChannel || !item.channelName) return null;

    let result;
    try {
      result = await api.clips.getByChannel({
        platform: item.platform,
        channelName: item.channelName,
        limit: 100,
        sort: "date",
        timeRange: "all",
      });
    } catch (_error) {
      return null;
    }

    const clips = result?.success ? parseVideoOrClips(result.data) : [];
    return clips.find((clip: VideoOrClip) => clip.id === item.originalId) || null;
  };

  const verifyVideo = async (item: HistoryItem) => {
    if (item.platform !== "twitch" && item.playbackUrl) return true;

    const api = window.electronAPI;
    if (!api?.videos?.getPlaybackUrl) return true;

    const result = await api.videos.getPlaybackUrl({
      platform: item.platform,
      videoId: item.originalId,
    });
    return Boolean(result?.success && result?.data?.url);
  };

  const watchHistoryItem = async (item: HistoryItem) => {
    if (item.type === "stream") return;

    setVerifyingItemId(item.id);
    try {
      if (item.type === "video") {
        const canPlay = await verifyVideo(item);
        if (!canPlay) {
          removeFromHistory(item.id);
          return;
        }

        await navigate({
          to: "/video/$platform/$videoId",
          params: { platform: item.platform, videoId: item.originalId },
          search: {
            src: item.platform === "kick" ? item.playbackUrl || undefined : undefined,
            title: item.title,
            channelName: item.channelName,
            channelDisplayName: item.channelDisplayName || item.channelName,
            channelAvatar: item.channelAvatar || undefined,
            thumbnail: item.thumbnail || undefined,
            shareUrl: item.shareUrl,
          },
        });
        return;
      }

      setClipLoading(true);
      setClipError(null);
      const baseClip = toClipDialogItem(item);
      setSelectedClip(baseClip);
      const realClip = await findRealClipMetadata(item);
      const dialogClip = realClip
        ? {
            ...baseClip,
            ...realClip,
            channelSlug: realClip.channelSlug || baseClip.channelSlug,
            channelName: realClip.channelName || baseClip.channelName,
            channelAvatar: realClip.channelAvatar || baseClip.channelAvatar,
          }
        : baseClip;
      setSelectedClip(dialogClip);
      const api = window.electronAPI;
      const result = await api?.clips?.getPlaybackUrl?.({
        platform: item.platform,
        clipId: item.originalId,
        clipUrl: dialogClip.embedUrl || dialogClip.url || item.playbackUrl,
        thumbnailUrl: dialogClip.thumbnailUrl || item.thumbnail,
      });

      if (result?.success && result?.data?.url) {
        setClipPlaybackUrl(result.data.url);
      } else if (item.platform === "twitch") {
        setClipPlaybackUrl(null);
      } else {
        removeFromHistory(item.id);
        setSelectedClip(null);
      }
    } catch (_error) {
      removeFromHistory(item.id);
      setSelectedClip(null);
      setClipError(t("mediaLibrary.historyItemUnavailable"));
    } finally {
      setClipLoading(false);
      setVerifyingItemId(null);
    }
  };

  return (
    <div className="p-6 max-w-[1800px] mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HistoryIcon className="w-8 h-8 text-[var(--color-primary)]" />
          <h1 className="text-3xl font-bold">{t("mediaLibrary.watchHistory")}</h1>
        </div>
        {history.length > 0 && (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleClearHistory}
            className="flex items-center gap-2"
          >
            <LuTrash2 className="w-4 h-4" />
            {t("mediaLibrary.clearHistory")}
          </Button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-20 text-[var(--color-foreground-secondary)]">
          <HistoryIcon className="w-16 h-16 mb-4 opacity-20" />
          <h2 className="text-xl font-semibold mb-2">{t("mediaLibrary.noWatchHistory")}</h2>
          <p>{t("mediaLibrary.emptyHistory")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {history.map((item) => {
            const thumbnail = resolveProxiedImageSrc(item.thumbnail);
            return (
              <div
                key={item.id}
                className="group relative bg-[var(--color-background-secondary)] rounded-lg overflow-hidden border border-[var(--color-border)] hover:border-[var(--color-primary)] transition-all"
              >
                {/* Thumbnail Container */}
                <div className="relative aspect-video bg-black/50">
                  {thumbnail ? (
                    <img
                      src={thumbnail}
                      alt={item.title}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-zinc-800">
                      <LuPlay className="w-8 h-8 text-white/20" />
                    </div>
                  )}

                  {/* Overlay on hover */}
                  <div className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                    {item.type === "stream" ? (
                      <HistoryItemLink
                        item={item}
                        className="flex h-12 w-12 scale-90 items-center justify-center rounded-full border border-white/35 bg-black/70 text-white backdrop-blur-sm transition-all hover:bg-white hover:text-black group-hover:scale-100"
                      >
                        <LuPlay className="h-5 w-5 fill-current" />
                      </HistoryItemLink>
                    ) : (
                      <button
                        type="button"
                        onClick={() => watchHistoryItem(item)}
                        disabled={verifyingItemId === item.id}
                        className="flex h-12 w-12 scale-90 items-center justify-center rounded-full border border-white/35 bg-black/70 text-white backdrop-blur-sm transition-all hover:bg-white hover:text-black disabled:opacity-60 group-hover:scale-100"
                        aria-label={`Watch ${item.title}`}
                      >
                        <LuPlay className="h-5 w-5 fill-current" />
                      </button>
                    )}
                  </div>

                  {/* Platform Badge */}
                  <div className="absolute top-2 left-2 px-2 py-0.5 rounded text-xs font-bold uppercase text-white bg-black/60 backdrop-blur-sm">
                    {item.platform}
                  </div>

                  {/* Type Badge */}
                  <div className="absolute top-2 right-2 rounded bg-white px-2 py-0.5 text-xs font-bold uppercase text-black">
                    {item.type}
                  </div>

                  {/* Remove Button */}
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      removeFromHistory(item.id);
                    }}
                    className="absolute bottom-2 right-2 p-1.5 rounded-full bg-black/60 hover:bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                    title={t("mediaLibrary.removeFromHistory")}
                  >
                    <LuTrash2 className="w-3.5 h-3.5" />
                  </button>

                  {item.type === "video" && (
                    <VodProgressBar platform={item.platform} videoId={item.originalId} />
                  )}
                </div>

                {/* Info */}
                <div className="p-3">
                  {item.type === "stream" ? (
                    <HistoryItemLink item={item} className="block">
                      <h3
                        className="font-medium text-sm line-clamp-2 mb-1 group-hover:text-[var(--color-primary)] transition-colors"
                        title={item.title}
                      >
                        {item.title || `Untitled ${item.type}`}
                      </h3>
                    </HistoryItemLink>
                  ) : (
                    <button
                      type="button"
                      onClick={() => watchHistoryItem(item)}
                      disabled={verifyingItemId === item.id}
                      className="block w-full text-left disabled:opacity-60"
                    >
                      <h3
                        className="font-medium text-sm line-clamp-2 mb-1 group-hover:text-[var(--color-primary)] transition-colors"
                        title={item.title}
                      >
                        {item.title || `Untitled ${item.type}`}
                      </h3>
                    </button>
                  )}
                  <div className="flex justify-between items-center text-xs text-[var(--color-foreground-secondary)]">
                    <span className="font-medium hover:text-[var(--color-foreground)] transition-colors">
                      {item.channelDisplayName || item.channelName}
                    </span>
                    <span>{formatDate(item.timestamp)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {selectedClip && (
        <Suspense fallback={null}>
          <ClipDialog
            selectedClip={selectedClip}
            onClose={() => {
              setSelectedClip(null);
              setClipPlaybackUrl(null);
              setClipError(null);
            }}
            clipLoading={clipLoading}
            clipError={clipError}
            clipPlaybackUrl={clipPlaybackUrl}
            platform={selectedClip.platform || "twitch"}
            channelName={selectedClip.channelSlug || selectedClip.channelName || ""}
            channelData={selectedClipChannelData}
            onPlaybackError={() => {
              setClipError(t("playback.failedToPlayClip"));
              removeFromHistory(`${selectedClip.platform}-clip-${selectedClip.id}`);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
