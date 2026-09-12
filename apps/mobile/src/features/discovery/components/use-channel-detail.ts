import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ChannelIdentity } from "@streamfusion/core/platform";

import type { DiscoverySession } from "../capabilities/platform-reads";
import { composeChannelDetail } from "../domain/channel-detail";

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
    enabled,
    queryFn: ({ signal }) =>
      input.session.readChannelVideos({
        channel: input.channel,
        ...(signal === undefined ? {} : { signal }),
      }),
    queryKey: channelVideosQueryKey(input.channel),
    retry: false,
  });
  const clips = useQuery({
    enabled,
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
      loading: enabled && (page.isPending || videos.isPending || clips.isPending),
      ...(clips.data === undefined ? {} : { clips: clips.data }),
      ...(page.data === undefined ? {} : { page: page.data }),
      ...(videos.data === undefined ? {} : { videos: videos.data }),
    }),
  };
}
