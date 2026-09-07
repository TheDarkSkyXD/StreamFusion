import type { UnifiedChannel, UnifiedClip, UnifiedStream, UnifiedVideo } from "@shared/platform-types";
import type {
  ChannelReader,
  ChannelRef,
  ClipReader,
  VideoReader,
} from "@streamfusion/core/discovery";
import type { ClipSearchSource } from "@backend/features/discovery/domain/progressive-clip-search";
import type { StreamDirectorySource } from "@backend/features/discovery/domain/progressive-stream-search";
import type { VideoSearchSource } from "@backend/features/discovery/domain/progressive-video-search";
import { rankSearchChannels } from "@streamfusion/core/discovery";
import { Platform } from "@streamfusion/core/platform";

const MATCHED_LIVE_CHANNEL_LIMIT = 20;

type MatchedChannelReader = Pick<ChannelReader<Platform, UnifiedChannel, ChannelRef>, "searchChannels">;
type RecentContentReader =
  VideoReader<Platform, UnifiedVideo, UnifiedChannel, AbortSignal> &
  ClipReader<Platform, UnifiedClip, UnifiedChannel, AbortSignal>;

async function searchMatchedChannels(
  reader: MatchedChannelReader,
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

function recentContentSources(channels: MatchedChannelReader, reader: RecentContentReader): {
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
  ) => searchMatchedChannels(channels, query, options);

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
  channels: Readonly<Record<Platform, MatchedChannelReader>>,
  readers: Readonly<Record<Platform, RecentContentReader>>
): Record<Platform, { videos: VideoSearchSource; clips: ClipSearchSource }> {
  return {
    twitch: recentContentSources(channels.twitch, readers.twitch),
    kick: recentContentSources(channels.kick, readers.kick),
  };
}

type FocusedStreamReader = MatchedChannelReader & {
  getStreamsByLogins?(logins: string[]): Promise<{ data: UnifiedStream[] }>;
  getStreamBySlug?(slug: string): Promise<UnifiedStream | null>;
};

async function hydrateMatchedStreams(
  readers: Readonly<Record<Platform, FocusedStreamReader>>,
  platform: Platform,
  query: string,
  signal: AbortSignal,
  consumeRequest: () => void
) {
  const channels = await searchMatchedChannels(
    readers[platform],
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
    const result = await readers.twitch.getStreamsByLogins?.(
      channels.data.map((channel: UnifiedChannel) => channel.username)
    );
    signal.throwIfAborted();
    return result?.data ?? [];
  }
  const streams = await Promise.all(
    channels.data.map(async (channel: UnifiedChannel) => {
      signal.throwIfAborted();
      consumeRequest();
      return readers.kick.getStreamBySlug?.(channel.username) ?? null;
    })
  );
  return streams.filter((stream) => stream !== null);
}

function streamSource(
  platform: Platform,
  readers: Readonly<Record<Platform, FocusedStreamReader>>
): StreamDirectorySource {
  return {
    platform,
    fetchNative(query, options) {
      const signal = options.signal ?? new AbortController().signal;
      return hydrateMatchedStreams(readers, platform, query, signal, options.consumeRequest);
    },
    async fetchDirectoryPage(options) {
      options.signal?.throwIfAborted();
      return { data: [], endReason: "exhausted" };
    },
  };
}

export function createFocusedStreamSources(
  readers: Readonly<Record<Platform, FocusedStreamReader>>
): Record<Platform, StreamDirectorySource> {
  return { twitch: streamSource("twitch", readers), kick: streamSource("kick", readers) };
}
