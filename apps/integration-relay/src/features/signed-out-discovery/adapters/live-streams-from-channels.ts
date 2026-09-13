import type { SignedOutSearchBody } from "@streamfusion/core/relay";

type SearchChannel = SignedOutSearchBody["channels"][number];
type SearchStream = SignedOutSearchBody["streams"][number];

export function streamsFromLiveChannels(
  channels: readonly SearchChannel[]
): readonly SearchStream[] {
  return channels.flatMap((channel) =>
    channel.isLive ? [streamFromLiveChannel(channel)] : []
  );
}

function streamFromLiveChannel(channel: SearchChannel): SearchStream {
  return {
    channelAvatar: channel.avatarUrl,
    channelDisplayName: channel.displayName,
    channelId: channel.id,
    channelName: channel.username,
    id: `live:${channel.platform}:${channel.id}`,
    isLive: true,
    language: "",
    platform: channel.platform,
    startedAt: null,
    tags: [],
    thumbnailUrl: "",
    title: channel.lastStreamTitle ?? channel.displayName,
    viewerCount: 0,
    ...(channel.categoryId === undefined
      ? {}
      : { categoryId: channel.categoryId }),
    ...(channel.categoryName === undefined
      ? {}
      : { categoryName: channel.categoryName })
  };
}
