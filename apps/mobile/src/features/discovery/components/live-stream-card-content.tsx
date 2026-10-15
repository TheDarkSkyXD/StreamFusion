import { useLayoutEffect, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { MobileAvatar } from "@mobile/design/avatar";
import { MobileVerifiedBadge } from "@mobile/design/verified-badge";
import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import type { Stream } from "@streamfusion/core/content";
import { languageLabel } from "../domain/broadcast-languages";
import { isBroadcastLanguage } from "../utils/broadcast-languages";
import { useLiveStreamCards } from "./live-stream-cards-provider";

const viewerCountFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export function LiveStreamCardContent({
  stream,
  tagsTestID,
}: {
  readonly stream: Stream;
  readonly tagsTestID?: string;
}) {
  const { generation, showLargeStreamCards } = useLiveStreamCards();
  const category = streamMetadata(stream);
  const uptime = streamUptime(stream.startedAt);
  const viewerLabel = `${viewerCountFormatter.format(stream.viewerCount)} viewers`;
  const thumbnail = (
    <View style={styles.thumbnail}>
      <LiveThumbnail generation={generation} uri={stream.thumbnailUrl} />
      {!showLargeStreamCards && stream.isLive ? (
        <View style={styles.uptimeBadge}>
          <Text style={mobileType.caption}>{uptime ?? "LIVE"}</Text>
        </View>
      ) : null}
    </View>
  );
  const channelName = (
    <Text numberOfLines={1} style={styles.channel}>
      {stream.channelDisplayName}
    </Text>
  );
  if (showLargeStreamCards) {
    return (
      <View style={styles.largeCard} testID="live-card-large">
        {thumbnail}
        <View style={styles.largeInfo}>
          <MobileAvatar
            livePlatform={stream.platform}
            name={stream.channelDisplayName}
            size={32}
            uri={stream.channelAvatar}
          />
          <View style={styles.largeCopy}>
            <View style={styles.largeTopRow}>
              <View style={styles.largeChannel}>
                {channelName}
                {stream.channelIsVerified ? (
                  <MobileVerifiedBadge platform={stream.platform} />
                ) : null}
              </View>
              <Text
                numberOfLines={1}
                style={styles.largeTitle}
                testID="live-card-title"
              >
                {stream.title}
              </Text>
            </View>
            <View style={styles.largeBottomRow}>
              {stream.isLive ? <View style={styles.liveDot} /> : null}
              {uptime ? <Text style={styles.metaText}>{uptime}</Text> : null}
              <Text
                accessibilityLabel={`${stream.viewerCount} viewers`}
                style={styles.metaText}
                testID="stream-viewer-count"
              >
                {viewerLabel}
              </Text>
              {category ? (
                <Text
                  numberOfLines={1}
                  style={styles.largeCategory}
                  testID={tagsTestID}
                >
                  {category}
                </Text>
              ) : null}
            </View>
          </View>
        </View>
      </View>
    );
  }
  return (
    <View style={styles.compactCard} testID="live-card-compact">
      <View style={styles.compactThumbnail}>{thumbnail}</View>
      <View style={styles.compactCopy}>
        <View style={styles.identity}>
          <MobileAvatar
            livePlatform={stream.platform}
            name={stream.channelDisplayName}
            size={24}
            uri={stream.channelAvatar}
          />
          {channelName}
          {stream.channelIsVerified ? (
            <MobileVerifiedBadge platform={stream.platform} />
          ) : null}
        </View>
        <Text
          numberOfLines={1}
          style={styles.compactTitle}
          testID="live-card-title"
        >
          {stream.title}
        </Text>
        {category ? (
          <Text numberOfLines={1} style={styles.category} testID={tagsTestID}>
            {category}
          </Text>
        ) : null}
        <Text
          accessibilityLabel={`${stream.viewerCount} viewers`}
          style={styles.metaText}
          testID="stream-viewer-count"
        >
          {viewerLabel}
        </Text>
      </View>
    </View>
  );
}

function LiveThumbnail({
  generation,
  uri,
}: {
  readonly generation: number;
  readonly uri: string;
}) {
  const { claimThumbnailRefresh, needsThumbnailRefresh } = useLiveStreamCards();
  const [reload, setReload] = useState<{
    uri: string;
    generation: number;
  } | null>(null);
  useLayoutEffect(() => {
    if (!uri) return;
    if (claimThumbnailRefresh(uri)) setReload({ uri, generation });
  }, [claimThumbnailRefresh, generation, uri]);
  if (!uri) return null;
  const shouldReload =
    needsThumbnailRefresh(uri) ||
    (reload?.uri === uri && reload.generation === generation);
  return (
    <Image
      accessibilityIgnoresInvertColors
      key={`${uri}:${shouldReload ? generation : "cached"}`}
      resizeMode="cover"
      source={{ uri, cache: shouldReload ? "reload" : "default" }}
      style={StyleSheet.absoluteFill}
      testID="live-card-thumbnail"
    />
  );
}

function streamMetadata(stream: Stream): string {
  const languageCode = stream.language?.toLowerCase();
  const language =
    languageCode && isBroadcastLanguage(languageCode)
      ? languageLabel(languageCode)
      : stream.language;
  const extraTag = stream.tags.find(
    (tag) =>
      tag.trim() !== "" &&
      tag.trim().toLowerCase() !== languageCode &&
      tag.trim().toLowerCase() !== language?.toLowerCase(),
  );
  return [
    stream.isMature ? "18+" : null,
    stream.categoryName,
    language,
    extraTag,
  ]
    .filter(Boolean)
    .join(" · ");
}

function streamUptime(startedAt: Stream["startedAt"]): string | null {
  if (startedAt === null) return null;
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return null;
  const elapsed = Math.max(0, Math.floor((Date.now() - started) / 1000));
  const hours = Math.floor(elapsed / 3600);
  const minutes = Math.floor((elapsed % 3600) / 60);
  const seconds = elapsed % 60;
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

const styles = StyleSheet.create({
  compactCard: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.medium,
  },
  compactThumbnail: { width: "34%" },
  compactCopy: { flex: 1, gap: 3, minWidth: 0 },
  largeCard: { gap: mobileSpacing.small },
  thumbnail: {
    aspectRatio: 16 / 9,
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.large,
    overflow: "hidden",
    width: "100%",
  },
  uptimeBadge: {
    backgroundColor: mobileColors.overlay,
    borderRadius: mobileRadii.small,
    bottom: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
    position: "absolute",
    right: 3,
  },
  identity: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.xSmall,
    minWidth: 0,
  },
  channel: { ...mobileType.title, flexShrink: 1, fontSize: 15 },
  compactTitle: {
    ...mobileType.body,
    color: mobileColors.textSecondary,
    fontSize: 14,
  },
  category: {
    ...mobileType.body,
    color: mobileColors.textCategory,
    fontSize: 14,
  },
  metaText: {
    ...mobileType.body,
    color: mobileColors.textSecondary,
    fontSize: 14,
  },
  largeInfo: { flexDirection: "row", gap: mobileSpacing.small },
  largeCopy: { flex: 1, gap: 2, minWidth: 0 },
  largeTopRow: { alignItems: "center", flexDirection: "row", gap: 4 },
  largeChannel: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.xSmall,
    maxWidth: "45%",
    minWidth: 0,
  },
  largeTitle: {
    ...mobileType.body,
    color: mobileColors.textSecondary,
    flex: 1,
    fontSize: 14,
  },
  largeBottomRow: { alignItems: "center", flexDirection: "row", gap: 5 },
  liveDot: {
    backgroundColor: mobileColors.live,
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  largeCategory: {
    ...mobileType.body,
    color: mobileColors.textCategory,
    flex: 1,
    fontSize: 14,
  },
});
