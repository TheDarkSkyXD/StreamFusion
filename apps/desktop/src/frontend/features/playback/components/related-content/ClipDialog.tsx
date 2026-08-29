import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import type { IconType } from "react-icons";
import {
  LuCalendarClock,
  LuCheck,
  LuDownload,
  LuEye,
  LuGamepad2,
  LuScissors,
  LuShare2,
} from "react-icons/lu";

import type { UnifiedChannel } from "@shared/platform-types";
import { KickVodPlayer } from "@/features/playback/components/player/kick";
import { TwitchVodPlayer } from "@/features/playback/components/player/twitch";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FollowButton } from "@/components/ui/follow-button";
import { KickLoadingSpinner, TwitchLoadingSpinner } from "@/components/ui/loading-spinner";
import { PlatformAvatar } from "@/components/ui/platform-avatar";
import { VisuallyHidden } from "@/components/ui/visually-hidden";
import { useHistoryActions } from "@/features/media-library/data/useHistoryQuery";
import { useDownloadActions } from "@/features/media-library/data/use-download-actions";
import { useShareAction } from "@/features/playback/data/use-share-action";
import { logger } from "@/renderer/logging/logger";
import type { Platform } from "@shared/auth-types";

import type { VideoOrClip } from "./types";
import { formatTimeAgo, formatViews } from "./utils";

interface ClipDialogProps {
  selectedClip: VideoOrClip | null;
  onClose: () => void;
  clipLoading: boolean;
  clipError: string | null;
  clipPlaybackUrl: string | null;
  clipQualities?: { quality: string; url: string }[];
  platform: Platform;
  channelName: string;
  channelData: UnifiedChannel | null | undefined;
  onPlaybackError: () => void;
}

type ClipMetadataItem = {
  key: string;
  label: string;
  Icon: IconType;
};

function normalizeMetadataNumber(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value.toString() : null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstMetadataNumber(...values: Array<string | number | null | undefined>): string | null {
  for (const value of values) {
    const normalized = normalizeMetadataNumber(value);
    if (normalized !== null) return normalized;
  }
  return null;
}

export function ClipDialog({
  selectedClip,
  onClose,
  clipLoading,
  clipError,
  clipPlaybackUrl,
  clipQualities,
  platform,
  channelName,
  channelData,
  onPlaybackError,
}: ClipDialogProps) {
  const navigate = useNavigate();
  const { addToHistory } = useHistoryActions();
  const [vodLookupLoading, setVodLookupLoading] = useState(false);
  const [vodLookupError, setVodLookupError] = useState<string | null>(null);
  const [readyPlaybackKey, setReadyPlaybackKey] = useState<string | null>(null);
  const [failedPlaybackKey, setFailedPlaybackKey] = useState<string | null>(null);
  const clipPlatform = selectedClip?.platform ?? platform;
  const channelSlug = (
    selectedClip?.channelSlug ||
    channelData?.username ||
    channelName
  ).trim();
  const channelDestination = channelSlug
    ? { platform: clipPlatform, channel: channelSlug }
    : null;
  const channelDisplayName = channelData?.displayName || selectedClip?.channelName || channelName;
  const channelAvatar = channelData?.avatarUrl || selectedClip?.channelAvatar || "";
  const followerCount = channelData?.followerCount ?? selectedClip?.channelFollowerCount;
  const clipCategory = selectedClip?.category || selectedClip?.gameName;
  const clipCreatorName = selectedClip?.creatorName?.trim();
  const clipViews = firstMetadataNumber(
    selectedClip?.views,
    selectedClip?.viewCount,
    selectedClip?.view_count
  );
  const clipMetadata: Array<ClipMetadataItem | null> = [
    clipCreatorName
      ? { key: "creator", label: `Clipped by @${clipCreatorName}`, Icon: LuScissors }
      : null,
    clipCategory ? { key: "category", label: clipCategory, Icon: LuGamepad2 } : null,
    clipViews ? { key: "views", label: `${formatViews(clipViews)} views`, Icon: LuEye } : null,
    selectedClip?.created_at || selectedClip?.date
      ? {
          key: "date",
          label: formatTimeAgo(selectedClip.created_at || selectedClip.date),
          Icon: LuCalendarClock,
        }
      : null,
  ];
  const visibleClipMetadata = clipMetadata.filter((value): value is ClipMetadataItem =>
    Boolean(value)
  );
  const playbackKey =
    selectedClip && clipPlaybackUrl ? `${selectedClip.id}:${clipPlaybackUrl}` : null;
  const playbackFailed = playbackKey !== null && failedPlaybackKey === playbackKey;
  const isPlaybackReady = Boolean(
    selectedClip &&
      clipPlaybackUrl &&
      readyPlaybackKey === playbackKey &&
      !clipLoading &&
      !clipError &&
      !playbackFailed
  );

  useEffect(() => {
    if (readyPlaybackKey !== null && readyPlaybackKey !== playbackKey) {
      setReadyPlaybackKey(null);
    }
    if (failedPlaybackKey !== null && failedPlaybackKey !== playbackKey) {
      setFailedPlaybackKey(null);
    }
  }, [failedPlaybackKey, playbackKey, readyPlaybackKey]);

  const { downloadClip } = useDownloadActions();
  const shareAction = useShareAction({
    shareUrl: selectedClip?.shareUrl,
    isPlaybackReady,
    contentLabel: "Clip",
    contentKey: selectedClip?.id,
  });

  const handlePlayerReady = useCallback(() => {
    if (playbackKey) setReadyPlaybackKey(playbackKey);
  }, [playbackKey]);

  const handlePlayerError = useCallback(() => {
    setReadyPlaybackKey(null);
    if (playbackKey) setFailedPlaybackKey(playbackKey);
    onPlaybackError();
  }, [onPlaybackError, playbackKey]);

  const handleDownload = useCallback(() => {
    if (!selectedClip || !isPlaybackReady) return;
    void downloadClip({
      platform: clipPlatform,
      clipId: selectedClip.id,
      title: selectedClip.title,
      channelName: selectedClip.channelSlug || channelName,
      clipUrl: clipPlaybackUrl || undefined,
      thumbnailUrl: selectedClip.thumbnailUrl,
    });
  }, [channelName, clipPlatform, clipPlaybackUrl, downloadClip, isPlaybackReady, selectedClip]);

  useEffect(() => {
    if (!selectedClip || clipLoading) return;
    if (clipError || !clipPlaybackUrl) return;

    addToHistory({
      id: `${clipPlatform}-clip-${selectedClip.id}`,
      originalId: selectedClip.id,
      title: selectedClip.title,
      thumbnail: selectedClip.thumbnailUrl || "",
      ...(clipPlatform === "kick" ? { playbackUrl: clipPlaybackUrl } : {}),
      shareUrl: selectedClip.shareUrl,
      platform: clipPlatform,
      type: "clip",
      channelName: selectedClip.channelSlug || channelName,
      channelDisplayName: channelData?.displayName || selectedClip.channelName || channelName,
      channelAvatar: channelData?.avatarUrl || selectedClip.channelAvatar || null,
      channelFollowerCount: channelData?.followerCount ?? selectedClip.channelFollowerCount,
      clipDuration: selectedClip.duration,
      clipViews: clipViews ?? selectedClip.views,
      clipDate: selectedClip.date,
      clipCreatedAt: selectedClip.created_at,
      clipCreatorName,
      clipGameName: selectedClip.gameName,
      clipCategory,
      clipVodId: selectedClip.vodId,
      clipLanguage: selectedClip.language,
    });
  }, [
    selectedClip,
    clipLoading,
    clipError,
    clipPlaybackUrl,
    clipPlatform,
    clipCategory,
    clipCreatorName,
    channelName,
    channelData,
    clipViews,
    addToHistory,
  ]);

  // Handle Kick VOD lookup and navigation
  const handleKickWatchFullVideo = useCallback(async () => {
    if (!selectedClip?.vodId || !selectedClip?.channelSlug) return;

    setVodLookupLoading(true);
    setVodLookupError(null);

    try {
      const api = window.electronAPI;
      if (!api?.videos?.getByLivestreamId) {
        setVodLookupError("VOD lookup not available");
        return;
      }
      const result = await api.videos.getByLivestreamId({
        channelSlug: selectedClip.channelSlug,
        livestreamId: selectedClip.vodId,
      });

      if (result.success && result.data) {
        // Close dialog and navigate to video page with source URL
        // Use channelData as fallback for avatar since VOD API may not have it
        onClose();
        navigate({
          to: "/video/$platform/$videoId",
          params: { platform: "kick", videoId: result.data.id },
          search: {
            src: result.data.source,
            title: result.data.title,
            channelName: result.data.channelName || channelData?.username || channelName,
            channelDisplayName: channelData?.displayName || result.data.channelName || channelName,
            channelAvatar: channelData?.avatarUrl || undefined,
            views: result.data.views,
            date: result.data.date,
            category: result.data.category,
            duration: result.data.duration,
            language: selectedClip.language || undefined,
            shareUrl: result.data.shareUrl || undefined,
          },
        });
      } else {
        setVodLookupError(result.error || "VOD not found");
      }
    } catch (error) {
      logger.error("Stream:ClipDialog", "failed to lookup VOD", {
        error: error instanceof Error ? error.message : String(error),
      });
      setVodLookupError("Failed to lookup VOD");
    } finally {
      setVodLookupLoading(false);
    }
  }, [selectedClip, onClose, navigate, channelData, channelName]);
  return (
    <Dialog open={!!selectedClip} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-[90vw] max-w-[1600px] gap-0 bg-black border-[var(--color-border)] p-0 overflow-hidden">
        <VisuallyHidden>
          <DialogTitle>{selectedClip?.title || "Clip Viewer"}</DialogTitle>
          <DialogDescription>
            Viewing clip: {selectedClip?.title || "Selected clip"}
          </DialogDescription>
        </VisuallyHidden>
        {selectedClip && (
          <div className="flex w-full flex-col overflow-hidden p-0 md:flex-row">
            {/* Left Side: Video Player */}
            <div className="relative flex min-w-0 flex-1 bg-black">
              <div className="flex aspect-video w-full items-center justify-center">
                {clipLoading ? (
                  <div className="text-center text-white">
                    <div className="mb-3 flex justify-center">
                      {clipPlatform === "kick" ? <KickLoadingSpinner /> : <TwitchLoadingSpinner />}
                    </div>
                    <p>Loading clip...</p>
                  </div>
                ) : clipError ? (
                  <div className="text-center text-red-500">
                    <p className="mb-2">Failed to load clip</p>
                    <p className="text-sm text-[var(--color-foreground-muted)]">{clipError}</p>
                  </div>
                ) : playbackFailed ? (
                  <div className="text-center text-red-500">
                    <p className="mb-2">Unable to play this clip</p>
                    <p className="text-sm text-[var(--color-foreground-muted)]">
                      Try closing and reopening the clip, or try again later.
                    </p>
                  </div>
                ) : clipPlaybackUrl ? (
                  // Platform-specific VOD player for clips
                  clipPlatform === "twitch" ? (
                    <TwitchVodPlayer
                      streamUrl={clipPlaybackUrl}
                      autoPlay
                      className="w-full h-full"
                      videoId={selectedClip.id}
                      title={selectedClip.title}
                      qualities={clipQualities}
                      onReady={handlePlayerReady}
                      onError={handlePlayerError}
                    />
                  ) : (
                    <KickVodPlayer
                      streamUrl={clipPlaybackUrl}
                      autoPlay
                      className="w-full h-full"
                      videoId={selectedClip.id}
                      title={selectedClip.title}
                      onReady={handlePlayerReady}
                      onError={handlePlayerError}
                      // Kick clips are handled differently or might not have manual qualities exposed the same way yet
                    />
                  )
                ) : (
                  <div className="text-center text-white/50">
                    <p>No playback URL available</p>
                  </div>
                )}
              </div>
            </div>

            {/* Right Side: Info & Actions */}
            <div className="w-[350px] shrink-0 overflow-x-hidden overflow-y-auto border-l border-[var(--color-border)] bg-[var(--color-background-secondary)] p-6 flex flex-col gap-6">
              <div className="mt-8">
                <h2 className="text-xl font-bold text-white line-clamp-2">{selectedClip.title}</h2>
                <div className="mt-3 flex flex-wrap gap-2">
                  {visibleClipMetadata.length > 0 ? (
                    visibleClipMetadata.map(({ key, label, Icon }) => (
                      <span
                        key={key}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-background-tertiary)] px-2.5 py-1 text-xs font-semibold text-[var(--color-foreground-secondary)]"
                      >
                        <Icon
                          aria-hidden="true"
                          className="h-3.5 w-3.5 shrink-0 text-[var(--color-foreground-muted)]"
                        />
                        <span className="min-w-0 truncate">{label}</span>
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-[var(--color-foreground-muted)]">
                      Clip metadata unavailable
                    </span>
                  )}
                </div>
              </div>

              <div className="h-px bg-[var(--color-border)] w-full" />

              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <PlatformAvatar
                    src={channelAvatar}
                    alt={channelDisplayName || ""}
                    platform={(clipPlatform as Platform) || "twitch"}
                    size="w-12 h-12"
                    className="bg-neutral-800"
                  />
                  <div className="flex flex-col">
                    {channelDestination ? (
                      <Link
                        to="/stream/$platform/$channel"
                        params={channelDestination}
                        onClick={onClose}
                        className="font-bold text-lg hover:underline decoration-2 underline-offset-4 decoration-[var(--color-primary)]"
                      >
                        {channelDisplayName}
                      </Link>
                    ) : (
                      <span className="font-bold text-lg">{channelDisplayName}</span>
                    )}
                    <span className="text-[var(--color-foreground-muted)] text-sm">
                      {typeof followerCount === "number"
                        ? `${formatViews(followerCount)} followers`
                        : "Followers unavailable"}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2 w-full">
                  {channelData ? (
                    <FollowButton channel={channelData} className="flex-1" />
                  ) : (
                    <Button disabled className="flex-1 rounded-full">
                      Follow
                    </Button>
                  )}

                  <Button
                    variant="secondary"
                    className="px-4 rounded-full font-bold gap-2"
                    onClick={() => void shareAction.share()}
                    disabled={!shareAction.canShare}
                    title={!shareAction.canShare ? shareAction.unavailableTitle : undefined}
                  >
                    {shareAction.copied ? (
                      <LuCheck aria-hidden="true" />
                    ) : (
                      <LuShare2 aria-hidden="true" />
                    )}
                    {shareAction.copied ? "Copied" : "Share"}
                  </Button>
                  <Button
                    variant="secondary"
                    className="px-4 rounded-full font-bold gap-2"
                    onClick={handleDownload}
                    disabled={!isPlaybackReady}
                    title={
                      !isPlaybackReady
                        ? "Download is available when this Clip is ready to play."
                        : undefined
                    }
                  >
                    <LuDownload aria-hidden="true" />
                    Download
                  </Button>
                </div>
              </div>

              <div className="h-px bg-[var(--color-border)] w-full" />

              <div className="flex flex-col gap-3 mt-auto">
                {selectedClip.isLive && (
                  <Button variant="secondary" className="w-full h-12 text-base font-bold">
                    Watch Livestream
                  </Button>
                )}
                {/* Watch Full Video button - show if VOD is available */}
                {/* vodId is empty string when VOD is deleted/unavailable */}
                {selectedClip.vodId &&
                  (clipPlatform === "twitch" ? (
                    // Twitch: Direct link using vodId
                    <Link
                      to="/video/$platform/$videoId"
                      params={{ platform: clipPlatform, videoId: selectedClip.vodId }}
                      className="w-full"
                    >
                      <Button
                        variant="outline"
                        className="w-full h-12 text-base font-bold border-[var(--color-border)] hover:bg-[var(--color-background-tertiary)]"
                      >
                        Watch Full Video
                      </Button>
                    </Link>
                  ) : (
                    // Kick: Need to look up VOD first
                    <Button
                      variant="outline"
                      className="w-full h-12 text-base font-bold border-[var(--color-border)] hover:bg-[var(--color-background-tertiary)]"
                      onClick={handleKickWatchFullVideo}
                      disabled={vodLookupLoading || !selectedClip.channelSlug}
                    >
                      {vodLookupLoading ? "Loading VOD..." : "Watch Full Video"}
                    </Button>
                  ))}
                {/* Show VOD lookup error for Kick */}
                {vodLookupError && (
                  <p className="text-sm text-red-400 text-center">{vodLookupError}</p>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
