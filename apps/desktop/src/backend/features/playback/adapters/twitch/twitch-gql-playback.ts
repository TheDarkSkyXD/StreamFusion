import {
  type ClipsCardsUserData,
  type FilterableVideoTowerVideosData,
  getQueryClipsCardsUser,
  getQueryFilterableVideoTowerVideos,
  getQueryPlaybackAccessToken,
  getQueryVideoMetadata,
  getRawQuery,
  type PlaybackAccessTokenData,
  type VideoAccessTokenClipData,
  type VideoMetadataData,
} from "twitch-gql-queries";
import type { UnifiedClip, UnifiedVideo } from "@shared/platform-types";
import type {
  PaginatedResult,
  PaginationOptions,
} from "@backend/api/platforms/twitch/twitch-types";
import { gqlRequest } from "@backend/api/platforms/twitch/twitch-gql-client";

/**
 * Get videos for a channel
 */
export async function gqlGetVideosByChannel(
  channelLogin: string,
  options: PaginationOptions & { type?: "archive" | "highlight" | "upload" } = {}
): Promise<PaginatedResult<UnifiedVideo>> {
  const limit = options.first || 20;

  const broadcastType =
    options.type === "archive"
      ? "ARCHIVE"
      : options.type === "highlight"
        ? "HIGHLIGHT"
        : options.type === "upload"
          ? "UPLOAD"
          : null;

  const [response] = (await gqlRequest([
    getQueryFilterableVideoTowerVideos({
      limit,
      channelOwnerLogin: channelLogin,
      broadcastType,
      videoSort: "TIME",
    }),
  ])) as [{ data: FilterableVideoTowerVideosData }];

  const videos = response.data?.user?.videos;
  if (!videos) return { data: [] };

  const result: UnifiedVideo[] = videos.edges.map((edge) => {
    const v = edge.node;
    const thumbnailUrl = v.previewThumbnailURL
      .replace("{width}", "320")
      .replace("{height}", "180")
      .replace("%{width}", "320")
      .replace("%{height}", "180");

    return {
      id: v.id,
      platform: "twitch" as const,
      channelId: v.owner?.id || "",
      channelName: v.owner?.login || channelLogin,
      channelDisplayName: v.owner?.displayName || channelLogin,
      channelAvatar: v.owner?.profileImageURL || "",
      title: v.title || "",
      thumbnailUrl,
      duration: v.lengthSeconds,
      viewCount: v.viewCount,
      publishedAt: v.publishedAt || "",
      url: `https://www.twitch.tv/videos/${v.id}`,
      shareUrl: `https://www.twitch.tv/videos/${v.id}`,
      type: "archive", // FilterableVideoTower doesn't expose broadcastType directly
    };
  });

  const lastCursor = videos.edges[videos.edges.length - 1]?.cursor;
  return {
    data: result,
    cursor: videos.pageInfo.hasNextPage ? lastCursor || undefined : undefined,
  };
}

/**
 * Get clips for a channel via GQL
 */
export async function gqlGetClipsByChannel(
  channelLogin: string,
  options: PaginationOptions & { filter?: string } = {}
): Promise<PaginatedResult<UnifiedClip>> {
  const limit = options.first || 20;
  const filter =
    (options.filter as "LAST_DAY" | "LAST_WEEK" | "LAST_MONTH" | "ALL_TIME") || "LAST_WEEK";

  const [response] = (await gqlRequest([
    getQueryClipsCardsUser({
      login: channelLogin,
      limit,
      criteria: { filter },
      cursor: options.after || null,
    }),
  ])) as [{ data: ClipsCardsUserData }];

  const clips = response.data?.user?.clips;
  if (!clips) return { data: [] };

  const result: UnifiedClip[] = clips.edges.map((edge) => {
    const c = edge.node;
    return {
      // Slug (URL identifier), not numeric c.id: VideoAccessToken_Clip and the
      // clips.twitch.tv/embed?clip=... fallback both key off the slug. Helix
      // /clips also returns the slug as `id`, so this keeps the two paths
      // consistent with UnifiedClip.
      id: c.slug,
      platform: "twitch" as const,
      channelId: c.broadcaster?.id || "",
      channelName: c.broadcaster?.login || channelLogin,
      channelDisplayName: c.broadcaster?.displayName || channelLogin,
      channelAvatar: c.broadcaster?.profileImageURL || "",
      title: c.title,
      thumbnailUrl: c.thumbnailURL || "",
      clipUrl: c.url,
      shareUrl: c.url || `https://clips.twitch.tv/${c.slug}`,
      embedUrl: c.embedURL,
      duration: c.durationSeconds,
      viewCount: c.viewCount,
      createdAt: c.createdAt,
      creatorName: c.curator?.displayName || "",
      gameId: c.game?.id,
      gameName: c.game?.name,
    };
  });

  const lastCursor = clips.edges[clips.edges.length - 1]?.cursor;
  return {
    data: result,
    cursor: clips.pageInfo.hasNextPage ? lastCursor || undefined : undefined,
  };
}

/**
 * Get playback access token for a live stream (via GQL)
 * This replaces TwitchStreamResolver.getPlaybackAccessToken for live streams
 */
export async function gqlGetPlaybackAccessToken(
  login: string
): Promise<{ value: string; signature: string }> {
  const [response] = (await gqlRequest([
    getQueryPlaybackAccessToken({
      isLive: true,
      login,
      isVod: false,
      vodID: "",
      playerType: "site",
      platform: "web",
    }),
  ])) as [{ data: PlaybackAccessTokenData }];

  const token = response.data?.streamPlaybackAccessToken;
  if (!token) {
    throw new Error("No stream token found. The channel might be offline.");
  }

  return { value: token.value, signature: token.signature };
}

/**
 * Get playback access token for a VOD (via GQL)
 */
export async function gqlGetVodAccessToken(
  vodId: string
): Promise<{ value: string; signature: string }> {
  const [response] = (await gqlRequest([
    getQueryPlaybackAccessToken({
      isLive: false,
      login: "",
      isVod: true,
      vodID: vodId,
      playerType: "site",
      platform: "web",
    }),
  ])) as [{ data: PlaybackAccessTokenData }];

  const token = response.data?.videoPlaybackAccessToken;
  if (!token) {
    throw new Error("No VOD token found. The VOD might be sub-only or deleted.");
  }

  return { value: token.value, signature: token.signature };
}

/**
 * Get clip access token and qualities (via GQL)
 */
export async function gqlGetClipAccessToken(slug: string): Promise<{
  qualities: { quality: string; sourceURL: string; frameRate?: number }[];
  signature: string;
  value: string;
}> {
  const query = `query VideoAccessToken_Clip($slug: ID!) {
    clip(slug: $slug) {
      playbackAccessToken(params: { platform: "web", playerBackend: "mediaplayer", playerType: "site" }) {
        signature
        value
      }
      videoQualities {
        frameRate
        quality
        sourceURL
      }
    }
  }`;

  const [response] = (await gqlRequest([
    getRawQuery<VideoAccessTokenClipData>({ query, variables: { slug } }),
  ])) as [{ data: VideoAccessTokenClipData }];

  const clip = response.data?.clip;
  if (!clip) {
    throw new Error("Clip not found");
  }

  return {
    qualities: clip.videoQualities.map((q) => ({
      quality: q.quality,
      sourceURL: q.sourceURL,
      frameRate: q.frameRate,
    })),
    signature: clip.playbackAccessToken.signature,
    value: clip.playbackAccessToken.value,
  };
}

/**
 * Get video metadata via GQL
 */
export async function gqlGetVideoMetadata(
  videoId: string,
  channelLogin: string = ""
): Promise<UnifiedVideo | null> {
  const [response] = (await gqlRequest([
    getQueryVideoMetadata({ videoID: videoId, channelLogin }),
  ])) as [{ data: VideoMetadataData }];

  const video = response.data?.video;
  if (!video) return null;

  const thumbnailUrl = video.previewThumbnailURL
    .replace("{width}", "320")
    .replace("{height}", "180")
    .replace("%{width}", "320")
    .replace("%{height}", "180");

  const broadcastType =
    video.broadcastType === "ARCHIVE"
      ? "archive"
      : video.broadcastType === "HIGHLIGHT"
        ? "highlight"
        : "upload";

  return {
    id: video.id,
    platform: "twitch",
    channelId: video.owner.id,
    channelName: video.owner.login,
    channelDisplayName: video.owner.displayName,
    channelAvatar: "",
    title: video.title || "",
    description: video.description || undefined,
    thumbnailUrl,
    duration: video.lengthSeconds,
    viewCount: video.viewCount,
    publishedAt: video.publishedAt || video.createdAt,
    url: `https://www.twitch.tv/videos/${video.id}`,
    shareUrl: `https://www.twitch.tv/videos/${video.id}`,
    type: broadcastType,
  };
}

/**
 * Batch fetch game data for multiple videos via GQL
 * Uses raw aliased queries since GQL doesn't support batch video lookups
 */
export async function gqlFetchGamesForVideos(
  videoIds: string[]
): Promise<Record<string, { id: string; name: string }>> {
  if (!videoIds.length) return {};

  const validIds = videoIds.filter((id) => /^\d+$/.test(id));
  if (!validIds.length) return {};

  const queryFields = validIds
    .map(
      (id) => `
        v${id}: video(id: "${id}") {
          id
          game {
            id
            displayName
            name
          }
        }
      `
    )
    .join("\n");

  const query = `query GetVideosGameData { ${queryFields} }`;

  type VideoGameData = {
    id: string;
    game: { id: string; displayName: string; name?: string } | null;
  };

  const [response] = (await gqlRequest([
    getRawQuery<Record<string, VideoGameData>>({ query }),
  ])) as [{ data: Record<string, VideoGameData> }];

  const result: Record<string, { id: string; name: string }> = {};

  if (response.data) {
    for (const videoData of Object.values(response.data)) {
      if (videoData?.game) {
        result[videoData.id] = {
          id: videoData.game.id,
          name: videoData.game.displayName || videoData.game.name || "",
        };
      }
    }
  }

  return result;
}
