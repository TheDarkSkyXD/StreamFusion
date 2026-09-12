import type { Channel, Stream } from "@streamfusion/core/content";

import type { SearchCatalogPage } from "../capabilities/platform-reads";

export function emptySearchCatalog(): SearchCatalogPage {
  return {
    categories: [],
    channels: [],
    clips: [],
    streams: [],
    videos: [],
  };
}

export function streamsFromLiveChannels(
  channels: readonly Channel[],
): readonly Stream[] {
  return channels.flatMap((channel) =>
    channel.isLive ? [streamFromLiveChannel(channel)] : [],
  );
}

export function dedupeByIdentity<
  TItem extends { readonly id: string; readonly platform: string },
>(items: readonly TItem[]): readonly TItem[] {
  const seen = new Set<string>();
  const next: TItem[] = [];
  for (const item of items) {
    const key = `${item.platform}:${item.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(item);
  }
  return next;
}

function streamFromLiveChannel(channel: Channel): Stream {
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
    ...(channel.categoryId === undefined ? {} : { categoryId: channel.categoryId }),
    ...(channel.categoryName === undefined
      ? {}
      : { categoryName: channel.categoryName }),
  };
}
