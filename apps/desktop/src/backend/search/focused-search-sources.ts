import type { UnifiedChannel } from "@/backend/api/unified/platform-types";
import { kickClient } from "@/backend/api/platforms/kick/kick-client";
import { twitchClient } from "@/backend/api/platforms/twitch/twitch-client";
import type { ClipSearchSource } from "@/backend/search/progressive-clip-search";
import type { StreamDirectorySource } from "@/backend/search/progressive-stream-search";
import type { VideoSearchSource } from "@/backend/search/progressive-video-search";
import { rankSearchChannels } from "@/search/channel-search-contract";
import type { Platform } from "@/shared/auth-types";

const MATCHED_CHANNEL_LIMIT = 8;
const MATCHED_LIVE_CHANNEL_LIMIT = 20;

async function searchMatchedChannels(
  platform: Platform,
  query: string,
  options: { limit: number; signal: AbortSignal; consumeRequest: () => void },
  liveOnly: boolean = false
) {
  options.signal.throwIfAborted();
  options.consumeRequest();
  const limit = Math.min(
    options.limit,
    liveOnly ? MATCHED_LIVE_CHANNEL_LIMIT : MATCHED_CHANNEL_LIMIT
  );
  const result =
    platform === "twitch"
      ? await twitchClient.searchChannels(query, { first: limit, liveOnly })
      : await kickClient.searchChannels(query, { limit, liveOnly });
  options.signal.throwIfAborted();
  return { data: rankSearchChannels(result.data, query).slice(0, limit) };
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
        return { data: result.data };
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
        return { data: result.data };
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
