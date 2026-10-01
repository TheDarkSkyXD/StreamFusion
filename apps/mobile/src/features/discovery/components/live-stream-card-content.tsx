import { Image, StyleSheet, Text, View } from "react-native";
import Svg, { Defs, LinearGradient, Rect, Stop } from "react-native-svg";

import { MobilePlatformBadge } from "@mobile/design/platform-badge";
import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
} from "@mobile/design/tokens";
import { MobileVerifiedBadge } from "@mobile/design/verified-badge";
import type { Stream } from "@streamfusion/core/content";

import { languageLabel } from "../domain/broadcast-languages";
import { isBroadcastLanguage } from "../utils/broadcast-languages";

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
  const viewerCount = viewerCountFormatter.format(stream.viewerCount);
  const languageCode = stream.language?.toLowerCase();
  const language =
    languageCode && isBroadcastLanguage(languageCode)
      ? languageLabel(languageCode)
      : stream.language;
  const tagLabels = language ? [language] : [];
  const extraTag = stream.tags.find(
    (tag) => tag.trim() !== "" && tag.toLowerCase() !== languageCode,
  );
  if (extraTag) tagLabels.push(extraTag);

  return (
    <View style={styles.canvas}>
      {stream.thumbnailUrl ? (
        <Image
          accessibilityIgnoresInvertColors
          resizeMode="cover"
          source={{ uri: stream.thumbnailUrl }}
          style={styles.thumbnail}
        />
      ) : null}
      <Svg height="100%" pointerEvents="none" style={styles.scrim} width="100%">
        <Defs>
          <LinearGradient id="cardScrim" x1="0" x2="0" y1="0" y2="1">
            <Stop offset="0" stopColor="#0f0f0f" stopOpacity="0" />
            <Stop offset="0.48" stopColor="#0f0f0f" stopOpacity="0.04" />
            <Stop offset="1" stopColor="#0f0f0f" stopOpacity="0.94" />
          </LinearGradient>
        </Defs>
        <Rect fill="url(#cardScrim)" height="100%" width="100%" />
      </Svg>
      <View style={styles.viewerBadge}>
        <Text
          accessibilityLabel={`${stream.viewerCount} viewers`}
          style={styles.viewerCount}
          testID="stream-viewer-count"
        >
          {viewerCount}
        </Text>
      </View>
      <MobilePlatformBadge
        platform={stream.platform}
        style={styles.platformBadge}
        variant="icon"
      />
      <View style={styles.metadata}>
        {stream.channelAvatar ? (
          <Image
            accessibilityIgnoresInvertColors
            source={{ uri: stream.channelAvatar }}
            style={styles.avatar}
          />
        ) : (
          <View style={styles.avatar} />
        )}
        <View style={styles.copy}>
          <View style={styles.channelRow}>
            <Text
              ellipsizeMode="tail"
              numberOfLines={1}
              style={styles.channelName}
            >
              {stream.channelDisplayName}
            </Text>
            {stream.channelIsVerified ? (
              <MobileVerifiedBadge platform={stream.platform} />
            ) : null}
            {tagLabels.length > 0 ? (
              <View
                style={styles.tags}
                {...(tagsTestID === undefined ? {} : { testID: tagsTestID })}
              >
                {tagLabels.map((tag) => (
                  <View key={tag} style={styles.tag}>
                    <Text
                      accessibilityLabel={tag}
                      ellipsizeMode="tail"
                      numberOfLines={1}
                      style={styles.tagLabel}
                    >
                      {tag}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            {stream.isMature ? (
              <View style={styles.maturityTag}>
                <Text style={styles.maturityLabel}>18+</Text>
              </View>
            ) : null}
          </View>
          <Text ellipsizeMode="tail" numberOfLines={1} style={styles.title}>
            {stream.title}
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  canvas: {
    aspectRatio: 4 / 3,
    backgroundColor: mobileColors.surfaceMuted,
    overflow: "hidden",
    width: "100%",
  },
  thumbnail: {
    height: "100%",
    width: "100%",
  },
  scrim: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  viewerBadge: {
    backgroundColor: mobileColors.overlay,
    borderRadius: mobileRadii.medium,
    left: mobileSpacing.medium,
    paddingHorizontal: 10,
    paddingVertical: 5,
    position: "absolute",
    top: mobileSpacing.medium,
  },
  viewerCount: {
    color: mobileColors.textPrimary,
    fontSize: 17,
    fontWeight: "700",
    lineHeight: 21,
  },
  platformBadge: {
    position: "absolute",
    right: mobileSpacing.medium,
    top: mobileSpacing.medium,
  },
  metadata: {
    alignItems: "flex-end",
    bottom: 0,
    flexDirection: "row",
    gap: mobileSpacing.small,
    left: 0,
    paddingBottom: 15,
    paddingHorizontal: mobileSpacing.medium,
    position: "absolute",
    right: 0,
  },
  avatar: {
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.full,
    height: 48,
    width: 48,
  },
  copy: {
    flex: 1,
    gap: mobileSpacing.xSmall,
    minWidth: 0,
  },
  channelRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.xSmall,
  },
  channelName: {
    color: mobileColors.textPrimary,
    flexShrink: 1,
    fontSize: 17,
    fontWeight: "700",
    lineHeight: 21,
  },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.xSmall,
  },
  tag: {
    backgroundColor: mobileColors.tagSurface,
    borderRadius: mobileRadii.full,
    maxWidth: 120,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  tagLabel: {
    color: mobileColors.tagText,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 14,
  },
  maturityTag: {
    backgroundColor: mobileColors.tagSurface,
    borderRadius: mobileRadii.full,
    paddingHorizontal: 10,
    paddingVertical: 2,
  },
  maturityLabel: {
    color: mobileColors.tagText,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 14,
  },
  title: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 18,
  },
});
