import { Link, useNavigate } from "@tanstack/react-router";
import type React from "react";
import { useState } from "react";
import { LuHistory as HistoryIcon, LuPlay, LuTrash2 } from "react-icons/lu";

import { ClipDialog } from "@/components/stream/related-content/ClipDialog";
import type { VideoOrClip } from "@/components/stream/related-content/types";
import { Button } from "@/components/ui/button";
import { type HistoryItem, useHistoryStore } from "@/store/history-store";

const HistoryItemLink = ({
  item,
  children,
  className,
}: {
  item: HistoryItem;
  children: React.ReactNode;
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
  const navigate = useNavigate();
  const { history, clearHistory, removeFromHistory } = useHistoryStore();
  const [verifyingItemId, setVerifyingItemId] = useState<string | null>(null);
  const [selectedClip, setSelectedClip] = useState<VideoOrClip | null>(null);
  const [clipPlaybackUrl, setClipPlaybackUrl] = useState<string | null>(null);
  const [clipError, setClipError] = useState<string | null>(null);
  const [clipLoading, setClipLoading] = useState(false);

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
    duration: "",
    views: "",
    date: new Date(item.timestamp).toISOString(),
    thumbnailUrl: item.thumbnail || "",
    url: item.playbackUrl,
    embedUrl: item.playbackUrl,
    channelSlug: item.channelName,
    channelName: item.channelDisplayName || item.channelName,
    channelAvatar: item.channelAvatar || null,
    platform: item.platform,
  });

  const verifyVideo = async (item: HistoryItem) => {
    if (item.platform !== "twitch" && item.playbackUrl) return true;

    const api = (window as any).electronAPI;
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
          },
        });
        return;
      }

      setClipLoading(true);
      setClipError(null);
      setSelectedClip(toClipDialogItem(item));
      const api = (window as any).electronAPI;
      const result = await api?.clips?.getPlaybackUrl?.({
        platform: item.platform,
        clipId: item.originalId,
        clipUrl: item.playbackUrl,
        thumbnailUrl: item.thumbnail,
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
      setClipError("This item is no longer available.");
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
          <h1 className="text-3xl font-bold">Watch History</h1>
        </div>
        {history.length > 0 && (
          <Button
            variant="destructive"
            size="sm"
            onClick={handleClearHistory}
            className="flex items-center gap-2"
          >
            <LuTrash2 className="w-4 h-4" />
            Clear History
          </Button>
        )}
      </div>

      {history.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-20 text-[var(--color-foreground-secondary)]">
          <HistoryIcon className="w-16 h-16 mb-4 opacity-20" />
          <h2 className="text-xl font-semibold mb-2">No watch history yet</h2>
          <p>Videos and clips you watch will appear here.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {history.map((item) => (
            <div
              key={item.id}
              className="group relative bg-[var(--color-background-secondary)] rounded-lg overflow-hidden border border-[var(--color-border)] hover:border-[var(--color-primary)] transition-all"
            >
              {/* Thumbnail Container */}
              <div className="relative aspect-video bg-black/50">
                {item.thumbnail ? (
                  <img
                    src={item.thumbnail}
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
                  title="Remove from history"
                >
                  <LuTrash2 className="w-3.5 h-3.5" />
                </button>
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
          ))}
        </div>
      )}
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
        platform={selectedClip?.platform || "twitch"}
        channelName={selectedClip?.channelSlug || selectedClip?.channelName || ""}
        channelData={null}
        onPlaybackError={() => {
          setClipError("Failed to play clip");
          if (selectedClip) {
            removeFromHistory(`${selectedClip.platform}-clip-${selectedClip.id}`);
          }
        }}
      />
    </div>
  );
}
