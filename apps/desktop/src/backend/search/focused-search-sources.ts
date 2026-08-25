import type {
  UnifiedChannel,
  UnifiedClip,
  UnifiedVideo,
} from "@/backend/api/unified/platform-types";
import { kickClient } from "@/backend/api/platforms/kick/kick-client";
import { twitchClient } from "@/backend/api/platforms/twitch/twitch-client";
import type { ClipSearchSource } from "@/backend/search/progressive-clip-search";
import type { StreamDirectorySource } from "@/backend/search/progressive-stream-search";
import type { VideoSearchSource } from "@/backend/search/progressive-video-search";
import { rankSearchChannels } from "@/search/channel-search-contract";
import type { Platform } from "@/shared/auth-types";

const MATCHED_LIVE_CHANNEL_LIMIT = 20;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number.parseInt(textValue(value), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function durationSeconds(value: unknown, sourceDurationMs?: unknown): number {
  if (typeof sourceDurationMs === "number" && Number.isFinite(sourceDurationMs)) {
    return Math.max(0, Math.round(sourceDurationMs / 1_000));
  }
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  const parts = textValue(value).split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function normalizeKickVideos(channel: UnifiedChannel, values: readonly unknown[]): UnifiedVideo[] {
  return values.flatMap((value) => {
    if (!isRecord(value)) return [];
    const publishedAt = textValue(value.sourceCreatedAt || value.created_at || value.date);
    const url = textValue(value.shareUrl || value.url || value.source);
    return [
      {
        ...value,
        id: textValue(value.id),
        platform: "kick",
        channelId: channel.id,
        channelName: channel.username,
        channelDisplayName: channel.displayName,
        channelAvatar: channel.avatarUrl,
        title: textValue(value.title),
        thumbnailUrl: textValue(value.thumbnailUrl),
        duration: durationSeconds(value.duration, value.sourceDurationMs),
        viewCount: numberValue(value.viewCount ?? value.views),
        publishedAt,
        url,
        shareUrl: textValue(value.shareUrl) || url,
        type: "archive",
      },
    ];
  });
}

function normalizeKickClips(channel: UnifiedChannel, values: readonly unknown[]): UnifiedClip[] {
  return values.flatMap((value) => {
    if (!isRecord(value)) return [];
    const clipUrl = textValue(value.url || value.shareUrl || value.embedUrl);
    const embedUrl = textValue(value.embedUrl || value.url);
    return [
      {
        ...value,
        id: textValue(value.id),
        platform: "kick",
        channelId: channel.id,
        channelName: channel.username,
        channelDisplayName: channel.displayName,
        channelAvatar: channel.avatarUrl,
        title: textValue(value.title),
        thumbnailUrl: textValue(value.thumbnailUrl),
        clipUrl,
        embedUrl,
        duration: durationSeconds(value.duration),
        viewCount: numberValue(value.viewCount ?? value.views),
        createdAt: textValue(value.createdAt || value.created_at || value.date),
        creatorName: textValue(value.creatorName),
      },
    ];
  });
}

async function searchMatchedChannels(
  platform: Platform,
  query: string,
  options: { cursor?: string; limit: number; signal: AbortSignal; consumeRequest: () => void },
  liveOnly: boolean = false
) {
  options.signal.throwIfAborted();
  options.consumeRequest();
  const limit = liveOnly ? Math.min(options.limit, MATCHED_LIVE_CHANNEL_LIMIT) : options.limit;
  const result =
    platform === "twitch"
      ? await twitchClient.searchChannels(query, { first: limit, after: options.cursor, liveOnly })
      : await kickClient.searchChannels(query, { limit, cursor: options.cursor, liveOnly });
  options.signal.throwIfAborted();
  return {
    data: rankSearchChannels(result.data, query),
    cursor: result.cursor,
  };
}

function recentContentSources(platform: Platform): {
  videos: VideoSearchSource;
  clips: ClipSearchSource;
} {
  const searchChannels = (
    query: string,
    options: {
      cursor?: string;
      limit: number;
      signal: AbortSignal;
      consumeRequest: () => void;
    }
  ) => searchMatchedChannels(platform, query, options);

  return {
    videos: {
      searchChannels,
      async fetchVideos(channel, options) {
        options.signal.throwIfAborted();
        options.consumeRequest();
        const result =
          platform === "twitch"
            ? await twitchClient.getVideosByChannel(channel.username, {
                first: options.limit,
                after: options.cursor,
              })
            : await kickClient.getVideos(channel.username, {
                limit: options.limit,
                cursor: options.cursor,
                signal: options.signal,
              });
        options.signal.throwIfAborted();
        return {
          data: platform === "kick" ? normalizeKickVideos(channel, result.data) : result.data,
          cursor: result.cursor,
        };
      },
    },
    clips: {
      searchChannels,
      async fetchClips(channel, options) {
        options.signal.throwIfAborted();
        options.consumeRequest();
        const result =
          platform === "twitch"
            ? await twitchClient.getClipsByChannel(channel.username, {
                first: options.limit,
                after: options.cursor,
              })
            : await kickClient.getClips(channel.username, {
                limit: options.limit,
                cursor: options.cursor,
                signal: options.signal,
              });
        options.signal.throwIfAborted();
        return {
          data: platform === "kick" ? normalizeKickClips(channel, result.data) : result.data,
          cursor: result.cursor,
        };
      },
    },
  };
}

export const focusedRecentContentSources = {
  twitch: recentContentSources("twitch"),
  kick: recentContentSources("kick"),
} satisfies Record<Platform, { videos: VideoSearchSource; clips: ClipSearchSource }>;

async function hydrateMatchedStreams(
  platform: Platform,
  query: string,
  signal: AbortSignal,
  consumeRequest: () => void
) {
  const channels = await searchMatchedChannels(
    platform,
    query,
    {
      limit: MATCHED_LIVE_CHANNEL_LIMIT,
      signal,
      consumeRequest,
    },
    true
  );
  if (platform === "twitch") {
    consumeRequest();
    const result = await twitchClient.getStreamsByLogins(
      channels.data.map((channel: UnifiedChannel) => channel.username)
    );
    signal.throwIfAborted();
    return result.data;
  }
  const streams = await Promise.all(
    channels.data.map(async (channel: UnifiedChannel) => {
      signal.throwIfAborted();
      consumeRequest();
      return kickClient.getStreamBySlug(channel.username);
    })
  );
  return streams.filter((stream) => stream !== null);
}

function streamSource(platform: Platform): StreamDirectorySource {
  return {
    platform,
    fetchNative(query, options) {
      const signal = options.signal ?? new AbortController().signal;
      return hydrateMatchedStreams(platform, query, signal, options.consumeRequest);
    },
    async fetchDirectoryPage(options) {
      options.signal?.throwIfAborted();
      return { data: [], endReason: "exhausted" };
    },
  };
}

export const focusedStreamSources = {
  twitch: streamSource("twitch"),
  kick: streamSource("kick"),
} satisfies Record<Platform, StreamDirectorySource>;
