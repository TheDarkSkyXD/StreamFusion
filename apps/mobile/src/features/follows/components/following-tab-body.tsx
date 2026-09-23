import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import type { Category, Clip, Stream, Video } from "@streamfusion/core/content";
import type { Platform } from "@streamfusion/core/platform";

import { MobileButton } from "@mobile/design/button";
import { mobileColors, mobileSpacing } from "@mobile/design/tokens";
import {
  watchTargetFromClip,
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
  onOpenProvider,
  onRetry,
  onWatch,
  view,
}: {
  readonly onOpenCategory?: (category: FollowingCategoryTarget) => void;
  readonly onOpenProvider: (target: {
    readonly platform: Platform;
    readonly channelLogin: string;
  }) => void;
  readonly onRetry: (platform: Platform) => void;
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
      {items.kind === "partial" || items.kind === "failed"
        ? retryRow(items, onRetry, translate)
        : null}
      {view.tab === "live" && items.kind !== "loading" && items.kind !== "empty"
        ? (items.items as readonly Stream[]).map((stream) => (
            <FollowingStreamCard
              key={`${stream.platform}:${stream.id}`}
              onOpenProvider={onOpenProvider}
              stream={stream}
            />
          ))
        : null}
      {view.tab === "channels" ? channelRows(items, onOpenProvider) : null}
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

function retryRow(
  items: Extract<TabItems<unknown>, { kind: "partial" | "failed" }>,
  onRetry: (platform: Platform) => void,
  t: (key: string, values?: Record<string, unknown>) => string,
) {
  const platforms =
    items.kind === "failed" ? items.retryablePlatforms : items.failedPlatforms;
  return (
    <View style={styles.row}>
      {platforms.map((platform) => (
        <MobileButton
          accessibilityLabel={t("discovery.following.retryPlatform", { platform })}
          key={platform}
          onPress={() => onRetry(platform)}
          testID={`following-retry-${platform}`}
          variant={platform}
        >
          {t("discovery.following.retryPlatform", { platform })}
        </MobileButton>
      ))}
    </View>
  );
}

function channelRows(
  items: TabItems<unknown>,
  onOpenProvider: (target: {
    readonly platform: Platform;
    readonly channelLogin: string;
  }) => void,
) {
  if (items.kind === "loading" || items.kind === "empty") return null;
  return (items.items as readonly FollowingChannelRow[]).map((row) => (
    <FollowingChannelCard
      key={`${row.follow.platform}:${row.follow.channelId}`}
      onOpenProvider={onOpenProvider}
      row={row}
    />
  ));
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
  row: { flexDirection: "row", flexWrap: "wrap", gap: mobileSpacing.small },
});
