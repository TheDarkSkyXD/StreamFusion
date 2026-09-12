import { Pressable, StyleSheet, Text, View } from "react-native";
import type { Category, Clip, Stream, Video } from "@streamfusion/core/content";
import type { Platform } from "@streamfusion/core/platform";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";

import type {
  FollowingChannelRow,
  FollowingView,
  TabItems,
} from "../capabilities/following-session";
import { FollowingChannelCard } from "./following-channel-card";
import { FollowingStreamCard } from "./following-stream-card";
import { tabItemsCopy } from "./following-tab-copy";

export function FollowingTabBody({
  onOpenProvider,
  onRetry,
  view,
}: {
  readonly onOpenProvider: (target: {
    readonly platform: Platform;
    readonly channelLogin: string;
  }) => void;
  readonly onRetry: (platform: Platform) => void;
  readonly view: FollowingView;
}) {
  const items = itemsFor(view);
  return (
    <View style={styles.stack} testID={`following-tab-body-${view.tab}`}>
      <Text selectable style={styles.copy} testID="following-phase">
        {tabItemsCopy(view.tab, items)}
      </Text>
      {items.kind === "partial" || items.kind === "failed"
        ? retryRow(items, onRetry)
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
      {view.tab === "categories" ? categoryRows(items) : null}
      {view.tab === "videos" ? videoRows(items) : null}
      {view.tab === "clips" ? clipRows(items) : null}
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
) {
  const platforms =
    items.kind === "failed" ? items.retryablePlatforms : items.failedPlatforms;
  return (
    <View style={styles.row}>
      {platforms.map((platform) => (
        <Pressable
          accessibilityRole="button"
          key={platform}
          onPress={() => onRetry(platform)}
          style={styles.retry}
          testID={`following-retry-${platform}`}
        >
          <Text selectable style={styles.retryLabel}>
            {`Retry ${platform}`}
          </Text>
        </Pressable>
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

function categoryRows(items: TabItems<unknown>) {
  if (items.kind === "loading" || items.kind === "empty") return null;
  return (items.items as readonly Category[]).map((category) => (
    <View
      key={`${category.platform}:${category.id}`}
      style={styles.card}
      testID={`following-category-${category.platform}-${category.id}`}
    >
      <Text selectable style={styles.title}>
        {category.name}
      </Text>
      <Text selectable style={styles.meta}>
        {`${category.viewerCount ?? 0} viewers · ${category.platform}`}
      </Text>
    </View>
  ));
}

function videoRows(items: TabItems<unknown>) {
  if (items.kind === "loading" || items.kind === "empty") return null;
  return (items.items as readonly Video[]).map((video) => (
    <View
      key={`${video.platform}:${video.id}`}
      style={styles.card}
      testID={`following-video-${video.platform}-${video.id}`}
    >
      <Text selectable style={styles.title}>
        {video.title}
      </Text>
    </View>
  ));
}

function clipRows(items: TabItems<unknown>) {
  if (items.kind === "loading" || items.kind === "empty") return null;
  return (items.items as readonly Clip[]).map((clip) => (
    <View
      key={`${clip.platform}:${clip.id}`}
      style={styles.card}
      testID={`following-clip-${clip.platform}-${clip.id}`}
    >
      <Text selectable style={styles.title}>
        {clip.title}
      </Text>
    </View>
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
  retry: {
    backgroundColor: mobileColors.textPrimary,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  retryLabel: {
    color: mobileColors.background,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  card: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    padding: mobileSpacing.medium,
  },
  title: {
    color: mobileColors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  meta: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
});
