import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import type { Category, Clip, Stream, Video } from "@streamfusion/core/content";
import type { ChannelIdentity, Platform } from "@streamfusion/core/platform";

import { mobileColors, mobileSpacing } from "@mobile/design/tokens";
import {
  watchTargetFromClip,
  watchTargetFromStream,
  watchTargetFromVideo,
} from "@mobile/features/discovery/domain/channel-watch-target";
import type { WatchTarget } from "@mobile/features/watch/capabilities/watch";

import type {
  FollowingChannelRow,
  FollowingView,
  TabItems,
} from "../capabilities/following-session";
import { FollowingCategoryCard } from "./following-category-card";
import { FollowingChannelCard } from "./following-channel-card";
import { FollowingMediaCard } from "./following-media-card";
import { FollowingStreamCard } from "./following-stream-card";
import { tabItemsCopy } from "./following-tab-copy";

export type FollowingCategoryTarget = {
  readonly id: string;
  readonly name: string;
  readonly platform: Platform;
  readonly boxArtUrl: string;
  readonly otherId?: string;
};

export function FollowingTabBody({
  onOpenCategory,
  onOpenChannel,
  onWatch,
  view,
}: {
  readonly onOpenCategory?: (category: FollowingCategoryTarget) => void;
  readonly onOpenChannel?: (channel: ChannelIdentity) => void;
  readonly onWatch?: (target: WatchTarget) => void;
  readonly view: FollowingView;
}) {
  const { t } = useTranslation();
  const translate = (key: string, values?: Record<string, unknown>) =>
    values === undefined ? t(key) : t(key, values);
  const items = itemsFor(view);
  return (
    <View style={styles.stack} testID={`following-tab-body-${view.tab}`}>
      <Text selectable style={styles.copy} testID="following-phase">
        {tabItemsCopy(view.tab, items, translate)}
      </Text>
      {view.tab === "live" && items.kind !== "loading" && items.kind !== "empty"
        ? (items.items as readonly Stream[]).map((stream) => (
            <FollowingStreamCard
              key={`${stream.platform}:${stream.id}`}
              onOpen={() => onWatch?.(watchTargetFromStream(stream))}
              stream={stream}
            />
          ))
        : null}
      {view.tab === "channels"
        ? channelRows(items, {
            ...(onOpenChannel === undefined ? {} : { onOpenChannel }),
            ...(onWatch === undefined ? {} : { onWatch }),
          })
        : null}
      {view.tab === "categories"
        ? categoryRows(items, translate, onOpenCategory)
        : null}
      {view.tab === "videos" ? videoRows(items, onWatch) : null}
      {view.tab === "clips" ? clipRows(items, onWatch) : null}
    </View>
  );
}

function itemsFor(view: FollowingView): TabItems<unknown> {
  if (view.tab === "live") return view.live;
  if (view.tab === "videos") return view.videos;
  if (view.tab === "clips") return view.clips;
  if (view.tab === "categories") return view.categories;
  return view.channels;
}

function channelRows(
  items: TabItems<unknown>,
  handlers: {
    readonly onOpenChannel?: (channel: ChannelIdentity) => void;
    readonly onWatch?: (target: WatchTarget) => void;
  },
) {
  if (items.kind === "loading" || items.kind === "empty") return null;
  return (items.items as readonly FollowingChannelRow[]).map((row) => (
    <FollowingChannelCard
      key={`${row.follow.platform}:${row.follow.channelId}`}
      onOpen={() => openChannelRow(row, handlers)}
      row={row}
    />
  ));
}

function openChannelRow(
  row: FollowingChannelRow,
  handlers: {
    readonly onOpenChannel?: (channel: ChannelIdentity) => void;
    readonly onWatch?: (target: WatchTarget) => void;
  },
): void {
  if (row.isLive && row.stream && handlers.onWatch) {
    handlers.onWatch(watchTargetFromStream(row.stream));
    return;
  }
  handlers.onOpenChannel?.({
    id: row.follow.channelId,
    platform: row.follow.platform,
    username: row.follow.channelLogin,
  });
}

function categoryRows(
  items: TabItems<unknown>,
  t: (key: string, values?: Record<string, unknown>) => string,
  onOpenCategory?: (category: FollowingCategoryTarget) => void,
) {
  if (items.kind === "loading" || items.kind === "empty") return null;
  return (items.items as readonly Category[]).map((category) => (
    <FollowingCategoryCard
      key={`${category.platform}:${category.id}`}
      category={category}
      viewersLabel={t("discovery.following.viewersMeta", {
        count: category.viewerCount ?? 0,
        platform: category.platform,
      })}
      {...(onOpenCategory === undefined
        ? {}
        : {
            onPress: () =>
              onOpenCategory({
                boxArtUrl: category.boxArtUrl,
                id: category.id,
                name: category.name,
                platform: category.platform,
              }),
          })}
    />
  ));
}

function videoRows(
  items: TabItems<unknown>,
  onWatch?: (target: WatchTarget) => void,
) {
  if (items.kind === "loading" || items.kind === "empty") return null;
  return (items.items as readonly Video[]).map((video) => (
    <FollowingMediaCard
      key={`${video.platform}:${video.id}`}
      item={video}
      testID={`following-video-${video.platform}-${video.id}`}
      {...(onWatch === undefined
        ? {}
        : { onPress: () => onWatch(watchTargetFromVideo(video)) })}
    />
  ));
}

function clipRows(
  items: TabItems<unknown>,
  onWatch?: (target: WatchTarget) => void,
) {
  if (items.kind === "loading" || items.kind === "empty") return null;
  return (items.items as readonly Clip[]).map((clip) => (
    <FollowingMediaCard
      key={`${clip.platform}:${clip.id}`}
      item={clip}
      testID={`following-clip-${clip.platform}-${clip.id}`}
      {...(onWatch === undefined
        ? {}
        : { onPress: () => onWatch(watchTargetFromClip(clip)) })}
    />
  ));
}

const styles = StyleSheet.create({
  stack: { gap: mobileSpacing.medium },
  copy: {
    color: mobileColors.textCategory,
    fontSize: 16,
    fontWeight: "500",
    lineHeight: 24,
  },
});
