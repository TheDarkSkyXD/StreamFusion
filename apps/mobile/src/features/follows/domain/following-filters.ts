import type { GuestFollow } from "@streamfusion/core/follows";
import type { Stream } from "@streamfusion/core/content";
import type { Platform } from "@streamfusion/core/platform";

import type { FollowingChip } from "../capabilities/following-session";
import { matchesQuery } from "../utils/following-query";

export function filterByChip<T extends { readonly platform: Platform }>(
  items: readonly T[],
  chip: FollowingChip,
  isLive: (item: T) => boolean,
): readonly T[] {
  if (chip === "all") return items;
  if (chip === "live") return items.filter(isLive);
  return items.filter((item) => item.platform === chip);
}

export function filterStreams(
  streams: readonly Stream[],
  chip: FollowingChip,
  query: string,
): readonly Stream[] {
  return filterByChip(streams, chip, (stream) => stream.isLive).filter(
    (stream) =>
      matchesQuery(query, [
        stream.channelDisplayName,
        stream.channelName,
        stream.title,
        stream.categoryName ?? "",
      ]),
  );
}

export function liveStreamFor(
  streams: readonly Stream[],
  follow: GuestFollow,
): Stream | null {
  return (
    streams.find(
      (stream) =>
        stream.platform === follow.platform &&
        (stream.channelId === follow.channelId ||
          stream.channelName.toLowerCase() === follow.channelLogin),
    ) ?? null
  );
}

export function recordedVisible<
  T extends { readonly platform: Platform; readonly title: string },
>(
  items: readonly T[],
  chip: FollowingChip,
  query: string,
): readonly T[] {
  return filterByChip(items, chip, () => true).filter((item) =>
    matchesQuery(query, [item.title, item.platform]),
  );
}
