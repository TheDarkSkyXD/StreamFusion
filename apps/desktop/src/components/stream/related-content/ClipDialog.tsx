import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import type { UnifiedChannel } from "@/backend/api/unified/platform-types";
import { KickVodPlayer } from "@/components/player/kick";
import { TwitchVodPlayer } from "@/components/player/twitch";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FollowButton } from "@/components/ui/follow-button";
import { KickLoadingSpinner, TwitchLoadingSpinner } from "@/components/ui/loading-spinner";
import { PlatformAvatar } from "@/components/ui/platform-avatar";
import { VisuallyHidden } from "@/components/ui/visually-hidden";
import { logger } from "@/renderer/logging/logger";
import type { Platform } from "@/shared/auth-types";
import { useHistoryStore } from "@/store/history-store";

import type { VideoOrClip } from "./types";

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
  const addToHistory = useHistoryStore((state) => state.addToHistory);
  const [vodLookupLoading, setVodLookupLoading] = useState(false);
  const [vodLookupError, setVodLookupError] = useState<string | null>(null);
  const clipPlatform = selectedClip?.platform ?? platform;

  useEffect(() => {
    if (!selectedClip || clipLoading) return;
    if (clipError || !clipPlaybackUrl) return;

    addToHistory({
      id: `${clipPlatform}-clip-${selectedClip.id}`,
      originalId: selectedClip.id,
      title: selectedClip.title,
      thumbnail: selectedClip.thumbnailUrl || "",
      playbackUrl: clipPlaybackUrl,
      platform: clipPlatform,
      type: "clip",
      channelName: selectedClip.channelSlug || channelName,
      channelDisplayName: channelData?.displayName || selectedClip.channelName || channelName,
      channelAvatar: selectedClip.channelAvatar || channelData?.avatarUrl || null,
    });
  }, [
    selectedClip,
    clipLoading,
    clipError,
    clipPlaybackUrl,
    clipPlatform,
    channelName,
    channelData,
    addToHistory,
  ]);

  // Handle Kick VOD lookup and navigation
  const handleKickWatchFullVideo = useCallback(async () => {
    if (!selectedClip?.vodId || !selectedClip?.channelSlug) return;

    setVodLookupLoading(true);
    setVodLookupError(null);

    try {
      const api = (window as any).electronAPI;
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
            channelDisplayName:
              result.data.channelDisplayName || channelData?.displayName || channelName,
            channelAvatar: result.data.channelAvatar || channelData?.avatarUrl || undefined,
            views: result.data.views,
            date: result.data.date,
            category: result.data.category,
            duration: result.data.duration,
            language: result.data.language || selectedClip.language || undefined,
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
      <DialogContent className="max-w-[90vw] w-full max-w-[1600px] bg-black border-[var(--color-border)] p-0 overflow-hidden">
        <VisuallyHidden>
          <DialogTitle>{selectedClip?.title || "Clip Viewer"}</DialogTitle>
          <DialogDescription>
            Viewing clip: {selectedClip?.title || "Selected clip"}
          </DialogDescription>
        </VisuallyHidden>
        {selectedClip && (
          <div className="flex flex-col md:flex-row p-0 overflow-hidden h-[80vh] w-full">
            {/* Left Side: Video Player */}
            <div className="flex-1 bg-black flex flex-col justify-center relative">
              <div className="aspect-video w-full flex items-center justify-center">
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
                      onError={onPlaybackError}
                    />
                  ) : (
                    <KickVodPlayer
                      streamUrl={clipPlaybackUrl}
                      autoPlay
                      className="w-full h-full"
                      videoId={selectedClip.id}
                      title={selectedClip.title}
                      onError={onPlaybackError}
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
            <div className="w-[350px] bg-[var(--color-background-secondary)] shrink-0 border-l border-[var(--color-border)] p-6 flex flex-col gap-6 overflow-y-auto">
              <div className="mt-8">
                <h2 className="text-xl font-bold text-white line-clamp-2">{selectedClip.title}</h2>
                <div className="flex items-center gap-2 text-sm text-[var(--color-foreground-secondary)] mt-1">
                  <span>{selectedClip.gameName}</span>
                  <span>•</span>
                  <span>{selectedClip.views} views</span>
                  <span>•</span>
                  <span>{selectedClip.date}</span>
                </div>
              </div>

              <div className="h-px bg-[var(--color-border)] w-full" />

              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-3">
                  <PlatformAvatar
                    src={channelData?.avatarUrl || ""}
                    alt={channelData?.displayName || channelName || ""}
                    platform={(clipPlatform as Platform) || "twitch"}
                    size="w-12 h-12"
                    className="bg-neutral-800"
                  />
                  <div className="flex flex-col">
                    <span className="font-bold text-lg hover:underline decoration-2 underline-offset-4 decoration-[var(--color-primary)] cursor-pointer">
                      {channelData?.displayName || channelName}
                    </span>
                    <span className="text-[var(--color-foreground-muted)] text-sm">
                      Followers hidden
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

                  <Button variant="secondary" className="px-4 rounded-full font-bold">
                    Share
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
