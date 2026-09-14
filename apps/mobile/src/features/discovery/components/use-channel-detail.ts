import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChannelIdentity, Platform } from "@streamfusion/core/platform";

import type {
  ChannelMediaRead,
  DiscoverySession,
} from "../capabilities/platform-reads";
import { composeChannelDetail, unsupportedMedia } from "../domain/channel-detail";

export function channelQueryKey(
  channel: ChannelIdentity,
): readonly ["discovery", "channel", string, string, string] {
  return ["discovery", "channel", channel.platform, channel.id, channel.username];
}

export function channelVideosQueryKey(
  channel: ChannelIdentity,
): readonly ["discovery", "videos", string, string, string] {
  return ["discovery", "videos", channel.platform, channel.id, channel.username];
}

export function channelClipsQueryKey(
  channel: ChannelIdentity,
): readonly ["discovery", "clips", string, string, string] {
  return ["discovery", "clips", channel.platform, channel.id, channel.username];
}

export function useChannelDetail(input: {
  readonly channel: ChannelIdentity;
  readonly enabled?: boolean;
  readonly loadClips?: boolean;
  readonly session: DiscoverySession;
}) {
  const queryClient = useQueryClient();
  const enabled = input.enabled !== false;
  const page = useQuery({
    enabled,
    queryFn: ({ signal }) =>
      input.session.readChannel({
        channel: input.channel,
        ...(signal === undefined ? {} : { signal }),
      }),
    queryKey: channelQueryKey(input.channel),
    retry: false,
  });
  const videos = useQuery({
    enabled: enabled && page.isFetched,
    queryFn: ({ signal }) =>
      input.session.readChannelVideos({
        channel: input.channel,
        ...(signal === undefined ? {} : { signal }),
      }),
    queryKey: channelVideosQueryKey(input.channel),
    retry: false,
  });
  const clips = useQuery({
    enabled: enabled && page.isFetched && input.loadClips === true,
    queryFn: ({ signal }) =>
      input.session.readChannelClips({
        channel: input.channel,
        ...(signal === undefined ? {} : { signal }),
      }),
    queryKey: channelClipsQueryKey(input.channel),
    retry: false,
  });
  return {
    retry() {
      void queryClient.invalidateQueries({ queryKey: channelQueryKey(input.channel) });
      void queryClient.invalidateQueries({
        queryKey: channelVideosQueryKey(input.channel),
      });
      void queryClient.invalidateQueries({
        queryKey: channelClipsQueryKey(input.channel),
      });
    },
    view: composeChannelDetail({
      loading:
        enabled && (page.isLoading || videos.isLoading || clips.isLoading),
      ...(page.data === undefined ? {} : { page: page.data }),
      ...optionalLane("clips", clips, input.channel.platform),
      ...optionalLane("videos", videos, input.channel.platform),
    }),
  };
}

function optionalLane<T, K extends "clips" | "videos">(
  media: K,
  query: {
    readonly data?: ChannelMediaRead<T> | undefined;
    readonly isError: boolean;
  },
  platform: Platform,
): { readonly [P in K]: ChannelMediaRead<T> } | Record<string, never> {
  if (query.data !== undefined) {
    return { [media]: query.data } as { readonly [P in K]: ChannelMediaRead<T> };
  }
  if (query.isError) {
    return { [media]: failedLane(platform, media) } as {
      readonly [P in K]: ChannelMediaRead<T>;
    };
  }
  return {};
}

function failedLane<T>(
  platform: Platform,
  media: "videos" | "clips",
): ChannelMediaRead<T> {
  if (platform === "kick" && media === "clips") {
    return unsupportedMedia(platform, media);
  }
  return {
    kind: "page",
    outcome: {
      cache: { kind: "miss" },
      error: { code: "twitch-failed", retry: "manual" },
      items: [],
      path: { kind: "guest", platform },
      platform,
      status: "failed",
    },
  };
}
