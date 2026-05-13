import { Link, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { LuCircleAlert, LuHeart, LuHeartCrack, LuLock } from "react-icons/lu";

import { KickVodPlayer } from "@/components/player/kick";
import { TwitchVodPlayer } from "@/components/player/twitch";
import type { VideoOrClip } from "@/components/stream/related-content/types";
import { VideoCard } from "@/components/stream/related-content/VideoCard";
import { Button } from "@/components/ui/button";
import type { Platform } from "@/shared/auth-types";
import { useFollowStore } from "@/store/follow-store";
import { useHistoryStore } from "@/store/history-store";

interface VideoMetadata {
  id: string;
  title: string;
  channelId: string;
  channelName: string;
  channelDisplayName: string;
  channelAvatar: string | null;
  views: number;
  duration: string;
  createdAt: string;
  thumbnailUrl: string;
  description: string;
  type: string;
  platform: string;
  category?: string;
  tags?: string[];
  language?: string;
  isMature?: boolean;
}

function formatViews(views: number | string): string {
  const num = typeof views === "string" ? parseInt(views, 10) : views;
  if (Number.isNaN(num)) return "0";
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(0)}K`;
  return num.toString();
}

function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} months ago`;
  return `${Math.floor(diffDays / 365)} years ago`;
}

export function VideoPage() {
  const { platform, videoId } = useParams({ from: "/_app/video/$platform/$videoId" });
  const searchParams = useSearch({ from: "/_app/video/$platform/$videoId" });

  // Extract all metadata from search params
  const {
    src: directSourceUrl,
    title: passedTitle,
    channelName: passedChannelName,
    channelDisplayName: passedChannelDisplayName,
    channelAvatar: passedChannelAvatar,
    views: passedViews,
    date: passedDate,
    category: passedCategory,
    duration: passedDuration,
    isSubOnly: passedIsSubOnly,
    tags: passedTags,
    language: passedLanguage,
    isMature: passedIsMature,
  } = searchParams;

  // Check if this is a subscriber-only VOD
  const isSubOnly = passedIsSubOnly === true;

  const [isHoveringFollow, setIsHoveringFollow] = useState(false);
  const { isFollowing: checkIsFollowing, toggleFollow } = useFollowStore();
  const [streamUrl, setStreamUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [videoMetadata, setVideoMetadata] = useState<VideoMetadata | null>(null);
  const [_isLoading, setIsLoading] = useState(true);

  const [relatedVideos, setRelatedVideos] = useState<VideoOrClip[]>([]);
  const [isRelatedLoading, setIsRelatedLoading] = useState(false);

  useEffect(() => {
    const fetchVideoData = async () => {
      setError(null);
      setStreamUrl(null);
      setIsLoading(true);

      try {
        if (!window.electronAPI) {
          throw new Error("Electron API not found");
        }

        // Case 0: Subscriber-only VODs - don't try to fetch playback URL
        if (isSubOnly) {
          // Still set metadata for display purposes
          if (passedTitle && passedChannelName) {
            setVideoMetadata({
              id: videoId,
              title: passedTitle,
              channelId: "",
              channelName: passedChannelName,
              channelDisplayName: passedChannelDisplayName || passedChannelName,
              channelAvatar: passedChannelAvatar || null,
              views: passedViews ? parseInt(passedViews, 10) : 0,
              duration: passedDuration || "0:00",
              createdAt: passedDate || new Date().toISOString(),
              thumbnailUrl: "",
              description: "",
              type: "archive",
              platform: platform,
              category: passedCategory,
            });
          }
          setIsLoading(false);
          return;
        }

        // Case 1: If we have a direct source URL (from video list), use it directly
        // This is the preferred path for Kick VODs since the api/v1/video endpoint
        // requires UUID which we may not have
        if (directSourceUrl) {
          setStreamUrl(directSourceUrl);

          // If we have metadata from search params, use it directly
          if (passedTitle && passedChannelName) {
            setVideoMetadata({
              id: videoId,
              title: passedTitle,
              channelId: "",
              channelName: passedChannelName,
              channelDisplayName: passedChannelDisplayName || passedChannelName,
              channelAvatar: passedChannelAvatar || null,
              views: passedViews ? parseInt(passedViews, 10) : 0,
              duration: passedDuration || "0:00",
              createdAt: passedDate || new Date().toISOString(),
              thumbnailUrl: "",
              description: "",
              type: "archive",
              platform: platform,
              category: passedCategory,
            });
            setIsLoading(false);
            return;
          }

          // Fallback: try to fetch metadata from API
          try {
            const metadataResult = await window.electronAPI.videos.getMetadata({
              platform: platform as "twitch" | "kick",
              videoId,
            });
            if (metadataResult.success && metadataResult.data) {
              setVideoMetadata(metadataResult.data);
            }
          } catch (_metaErr) {
            console.warn("Could not fetch metadata, continuing with video playback");
          }

          setIsLoading(false);
          return;
        }

        // Case 2: No direct URL - fetch playback URL and metadata from API
        const [playbackResult, metadataResult] = await Promise.all([
          window.electronAPI.videos.getPlaybackUrl({
            platform: platform as "twitch" | "kick",
            videoId,
          }),
          window.electronAPI.videos.getMetadata({
            platform: platform as "twitch" | "kick",
            videoId,
          }),
        ]);

        if (playbackResult.success && playbackResult.data) {
          setStreamUrl(playbackResult.data.url);
        } else {
          console.error("VOD Fetch Error:", playbackResult.error);
          setError(playbackResult.error || "Failed to resolve VOD URL");
        }

        if (metadataResult.success && metadataResult.data) {
          setVideoMetadata(metadataResult.data);
        } else {
          console.warn("Metadata Fetch Warning:", metadataResult.error);
        }
      } catch (err) {
        console.error(err);
        setError("Failed to load video");
      } finally {
        setIsLoading(false);
      }
    };
    if (platform && videoId) fetchVideoData();
  }, [
    platform,
    videoId,
    directSourceUrl,
    passedTitle,
    passedChannelName,
    passedChannelDisplayName,
    passedChannelAvatar,
    passedViews,
    passedDate,
    passedCategory,
    passedDuration,
    isSubOnly,
  ]);

  // Use fetched data or passed data or fallbacks
  const videoTitle = videoMetadata?.title || passedTitle || "Loading...";
  const channelName = videoMetadata?.channelName || passedChannelName || "channel";
  const channelDisplayName =
    videoMetadata?.channelDisplayName || passedChannelDisplayName || passedChannelName || "Channel";
  const channelAvatar = videoMetadata?.channelAvatar || passedChannelAvatar;

  // Save to history
  const { addToHistory } = useHistoryStore();
  useEffect(() => {
    if (platform && videoId && videoTitle !== "Loading...") {
      addToHistory({
        id: `${platform}-video-${videoId}`,
        originalId: videoId,
        title: videoTitle,
        thumbnail: videoMetadata?.thumbnailUrl || "", // Would be nice to have passedThumbnail
        platform: platform as "twitch" | "kick",
        type: "video",
        channelName: channelName,
        channelDisplayName: channelDisplayName,
      });
    }
  }, [platform, videoId, videoTitle, channelName, channelDisplayName, videoMetadata, addToHistory]);
  const views = videoMetadata
    ? formatViews(videoMetadata.views)
    : passedViews
      ? formatViews(passedViews)
      : "—";
  const date = videoMetadata
    ? formatRelativeDate(videoMetadata.createdAt)
    : passedDate
      ? formatRelativeDate(passedDate)
      : "—";
  const category = videoMetadata?.category || passedCategory;

  // Create channel object for follow store
  const channelForFollow = useMemo(
    () => ({
      id: channelName, // Use username as ID to match follow store format
      platform: platform as Platform,
      username: channelName,
      displayName: channelDisplayName,
      avatarUrl: channelAvatar || "",
      isLive: false,
      isVerified: false,
      isPartner: false,
    }),
    [platform, channelName, channelDisplayName, channelAvatar]
  );

  // Check if channel is being followed using the store
  const isFollowing = checkIsFollowing(channelForFollow.id);

  // Fetch related videos based on channelName
  useEffect(() => {
    const fetchRelated = async () => {
      if (!platform || !channelName || channelName === "channel") return;

      setIsRelatedLoading(true);
      try {
        const api = (window as any).electronAPI;
        const result = await api.videos.getByChannel({
          platform,
          channelName,
          limit: 100,
        });

        if (result.success && result.data) {
          setRelatedVideos(result.data);
        }
      } catch (err) {
        console.error("Failed to fetch related", err);
      } finally {
        setIsRelatedLoading(false);
      }
    };

    if (channelName) fetchRelated();
  }, [platform, channelName]);

  const getFollowButtonStyles = () => {
    if (isFollowing) {
      return "bg-neutral-800 hover:bg-neutral-700 border-transparent border";
    }
    if (platform === "twitch")
      return "bg-[#9146FF] hover:bg-[#9146FF]/90 text-white border-transparent";
    if (platform === "kick")
      return "bg-[#53FC18] hover:bg-[#53FC18]/90 text-black border-transparent";
    return "bg-primary text-primary-foreground";
  };

  return (
    <div className="h-full flex overflow-hidden">
      {/* Video Player Area */}
      <div className="flex-1 flex flex-col overflow-y-auto">
        <div className="aspect-video bg-black flex items-center justify-center shrink-0 text-white relative group">
          {isSubOnly ? (
            <div className="text-center">
              <div className="w-16 h-16 rounded-full bg-purple-600/20 flex items-center justify-center mx-auto mb-4">
                <LuLock className="w-8 h-8 text-purple-400" />
              </div>
              <h3 className="text-xl font-semibold text-white mb-2">Subscriber Only VOD</h3>
              <p className="text-white/60 max-w-md mx-auto">
                This VOD is only available to subscribers of this channel. Subscribe on Kick to
                watch this content.
              </p>
            </div>
          ) : streamUrl ? (
            platform === "kick" ? (
              <KickVodPlayer
                streamUrl={streamUrl}
                autoPlay={true}
                className="size-full"
                videoId={videoId}
                title={videoTitle}
                thumbnail={videoMetadata?.thumbnailUrl || passedChannelAvatar || undefined}
              />
            ) : (
              <TwitchVodPlayer
                streamUrl={streamUrl}
                autoPlay={true}
                className="size-full"
                videoId={videoId}
                title={videoTitle}
                thumbnail={videoMetadata?.thumbnailUrl || passedChannelAvatar || undefined}
              />
            )
          ) : error ? (
            <div className="text-center text-red-500">
              <LuCircleAlert className="w-8 h-8 mx-auto mb-2" />
              <p>{error}</p>
            </div>
          ) : (
            <div className="text-center text-white/50">
              <div className="animate-spin w-8 h-8 border-4 border-white border-t-transparent rounded-full mx-auto mb-2" />
              <p>Loading VOD...</p>
            </div>
          )}
        </div>

        <div className="p-6 space-y-6">
          <div className="flex justify-between items-start gap-4">
            <Link
              to="/stream/$platform/$channel"
              params={{ platform: platform || "twitch", channel: channelName }}
              search={{ tab: "videos" }}
              className="shrink-0"
            >
              {channelAvatar ? (
                <img
                  src={channelAvatar}
                  alt={channelDisplayName}
                  className={`w-14 h-14 rounded-full shadow-lg ring-2 ring-offset-2 ring-offset-[var(--color-background)] ${platform === "twitch" ? "ring-[#9146FF] hover:ring-[#9146FF]/80" : "ring-[#53FC18] hover:ring-[#53FC18]/80"} transition-all object-cover`}
                />
              ) : (
                <div
                  className={`w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold text-white shadow-lg ${platform === "twitch" ? "bg-[#9146FF]" : "bg-[#53FC18] text-black"} ring-2 ring-offset-2 ring-offset-[var(--color-background)] ${platform === "twitch" ? "ring-[#9146FF] hover:ring-[#9146FF]/80" : "ring-[#53FC18] hover:ring-[#53FC18]/80"} transition-all`}
                >
                  {channelDisplayName.slice(0, 1).toUpperCase()}
                </div>
              )}
            </Link>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-white mb-1">{videoTitle}</h1>
              <div className="flex items-center gap-3 text-[var(--color-foreground-secondary)] text-sm flex-wrap">
                <Link
                  to="/stream/$platform/$channel"
                  params={{ platform: platform || "twitch", channel: channelName }}
                  search={{ tab: "videos" }}
                  className={`font-bold text-white hover:underline ${platform === "twitch" ? "decoration-[#9146FF]" : "decoration-[#53FC18]"} decoration-2 underline-offset-4`}
                >
                  {channelDisplayName}
                </Link>
                {category && (
                  <>
                    <span>•</span>
                    <span className="text-[#adadad]">{category}</span>
                  </>
                )}
                <span>•</span>
                <span>{views} views</span>
                <span>•</span>
                <span>{date}</span>
              </div>
              {/* Tags */}
              {(() => {
                const displayLanguage = videoMetadata?.language || passedLanguage;
                const displayIsMature = videoMetadata?.isMature || passedIsMature;
                const displayTags =
                  videoMetadata?.tags ||
                  (passedTags ? (Array.isArray(passedTags) ? passedTags : [passedTags]) : []);
                const hasTags = displayLanguage || displayIsMature || displayTags.length > 0;

                if (!hasTags) return null;

                return (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {/* Language Tag */}
                    {displayLanguage && (
                      <span className="text-xs px-3 py-1 rounded-full font-medium bg-[#4a4d55] text-[#efeff1] hover:bg-[#5a5d66] transition-colors cursor-default">
                        {new Intl.DisplayNames(["en"], { type: "language" }).of(displayLanguage) ||
                          displayLanguage.toUpperCase()}
                      </span>
                    )}
                    {/* Mature Content Tag */}
                    {displayIsMature && (
                      <span className="text-xs px-3 py-1 rounded-full font-medium bg-[#4a4d55] text-[#efeff1] hover:bg-[#5a5d66] transition-colors cursor-default">
                        18+
                      </span>
                    )}
                    {/* Custom Tags */}
                    {displayTags.length > 0 &&
                      displayTags.map((tag: string, index: number) => (
                        <span
                          key={`${tag}-${index}`}
                          className="text-xs px-3 py-1 rounded-full font-medium bg-[#4a4d55] text-[#efeff1] hover:bg-[#5a5d66] transition-colors cursor-default"
                        >
                          {tag}
                        </span>
                      ))}
                  </div>
                );
              })()}
            </div>
            <div className="flex gap-4">
              <Button
                className={`rounded-full font-bold transition-all gap-2 ${isFollowing ? "w-10 h-10 p-0" : "min-w-[100px]"} ${getFollowButtonStyles()}`}
                size="sm"
                onClick={() => toggleFollow(channelForFollow)}
                onMouseEnter={() => setIsHoveringFollow(true)}
                onMouseLeave={() => setIsHoveringFollow(false)}
              >
                {isFollowing ? (
                  isHoveringFollow ? (
                    <LuHeartCrack className="w-5 h-5 text-red-500" strokeWidth={3} />
                  ) : (
                    <LuHeart className="w-5 h-5 fill-current text-white" strokeWidth={3} />
                  )
                ) : (
                  <>
                    <LuHeart
                      className={`w-4 h-4 ${isHoveringFollow ? "fill-current" : ""}`}
                      strokeWidth={3}
                    />{" "}
                    Follow
                  </>
                )}
              </Button>
              <Link
                to="/stream/$platform/$channel"
                params={{ platform: platform || "twitch", channel: channelName }}
                search={{ tab: "videos" }}
              >
                <Button
                  className="rounded-full font-bold bg-neutral-800 hover:bg-neutral-700 text-white border-transparent gap-2"
                  size="sm"
                >
                  Watch Live
                </Button>
              </Link>
            </div>
          </div>

          {/* Related Videos */}
          <div>
            <h2 className="text-lg font-bold text-white mb-4">More from {channelDisplayName}</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {isRelatedLoading ? (
                Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="space-y-3">
                    <div className="aspect-video bg-[var(--color-background-tertiary)] rounded-xl animate-pulse" />
                    <div className="space-y-2">
                      <div className="h-4 bg-[var(--color-background-tertiary)] rounded w-3/4 animate-pulse" />
                      <div className="h-3 bg-[var(--color-background-tertiary)] rounded w-1/2 animate-pulse" />
                    </div>
                  </div>
                ))
              ) : relatedVideos.length > 0 ? (
                relatedVideos
                  .filter((v) => v.id !== videoId)
                  .map((video) => (
                    <div key={video.id} className="h-full">
                      <VideoCard
                        video={video}
                        platform={platform as Platform}
                        channelName={channelName}
                        channelData={{
                          id: "",
                          platform: platform as Platform,
                          username: channelName,
                          displayName: channelDisplayName,
                          avatarUrl: channelAvatar || "",
                          isLive: false,
                          isVerified: false,
                          isPartner: false,
                        }}
                      />
                    </div>
                  ))
              ) : (
                <p className="text-[var(--color-foreground-muted)] col-span-full">
                  No other videos found.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Chat Replay Panel (Placeholder) */}
      <div className="w-80 border-l border-[var(--color-border)] bg-[var(--color-background-secondary)] flex flex-col shrink-0 hidden lg:flex">
        <div className="p-3 border-b border-[var(--color-border)]">
          <h2 className="font-semibold text-[var(--color-foreground)]">Chat Replay</h2>
        </div>
        <div className="flex-1 p-3 flex items-center justify-center">
          <p className="text-[var(--color-foreground-muted)] text-sm text-center">
            Chat replay not available for this video
          </p>
        </div>
      </div>
    </div>
  );
}
