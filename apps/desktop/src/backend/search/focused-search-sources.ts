import type { UnifiedChannel, UnifiedClip, UnifiedVideo } from "@shared/platform-types";
import type {
  ChannelReader,
  ChannelRef,
  ClipReader,
  VideoReader,
} from "@streamfusion/core/discovery";
import { kickClient } from "@backend/api/platforms/kick/kick-client";
import { twitchClient } from "@backend/api/platforms/twitch/twitch-client";
import type { ClipSearchSource } from "@backend/search/progressive-clip-search";
import type { StreamDirectorySource } from "@backend/search/progressive-stream-search";
import type { VideoSearchSource } from "@backend/search/progressive-video-search";
import { rankSearchChannels } from "@/features/discovery/utils/search/channel-search-contract";
import type { Platform } from "@shared/auth-types";

const MATCHED_LIVE_CHANNEL_LIMIT = 20;

type RecentContentReader = ChannelReader<Platform, UnifiedChannel, ChannelRef> &
  VideoReader<Platform, UnifiedVideo, UnifiedChannel, AbortSignal> &
  ClipReader<Platform, UnifiedClip, UnifiedChannel, AbortSignal>;

async function searchMatchedChannels(
  reader: Pick<RecentContentReader, "searchChannels">,
  query: string,
  options: { cursor?: string; limit: number; signal: AbortSignal; consumeRequest: () => void },
  liveOnly: boolean = false
) {
  options.signal.throwIfAborted();
  options.consumeRequest();
  const limit = liveOnly ? Math.min(options.limit, MATCHED_LIVE_CHANNEL_LIMIT) : options.limit;
  const result = await reader.searchChannels(query, {
    limit,
    cursor: options.cursor,
    liveOnly,
  });
  options.signal.throwIfAborted();
  return {
    data: rankSearchChannels(result.data, query),
    cursor: result.cursor,
  };
}

function recentContentSources(reader: RecentContentReader): {
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
  ) => searchMatchedChannels(reader, query, options);

  return {
    videos: {
      searchChannels,
      async fetchVideos(channel, options) {
        options.signal.throwIfAborted();
        options.consumeRequest();
        const result = await reader.readChannelVideos(channel, {
          limit: options.limit,
          cursor: options.cursor,
          signal: options.signal,
        });
        options.signal.throwIfAborted();
        return {
          data: result.data,
          cursor: result.cursor,
        };
      },
    },
    clips: {
      searchChannels,
      async fetchClips(channel, options) {
        options.signal.throwIfAborted();
        options.consumeRequest();
        const result = await reader.readChannelClips(channel, {
          limit: options.limit,
          cursor: options.cursor,
          signal: options.signal,
        });
        options.signal.throwIfAborted();
        return {
          data: result.data,
          cursor: result.cursor,
        };
      },
    },
  };
}

export function createFocusedRecentContentSources(
  readers: Readonly<Record<Platform, RecentContentReader>>
): Record<Platform, { videos: VideoSearchSource; clips: ClipSearchSource }> {
  return {
    twitch: recentContentSources(readers.twitch),
    kick: recentContentSources(readers.kick),
  };
}

async function hydrateMatchedStreams(
  platform: Platform,
  query: string,
  signal: AbortSignal,
  consumeRequest: () => void
) {
  const channels = await searchMatchedChannels(
    platform === "twitch" ? twitchClient : kickClient,
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
