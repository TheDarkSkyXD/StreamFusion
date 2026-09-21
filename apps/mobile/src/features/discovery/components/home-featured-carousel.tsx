import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { Stream } from "@streamfusion/core/content";

import { MobileButton } from "@mobile/design/button";
import { MobilePlatformBadge } from "@mobile/design/platform-badge";
import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import { MobileVerifiedBadge } from "@mobile/design/verified-badge";

/** Match Electron FeaturedStage / FeaturedStream: up to 10 top live streams. */
export const HOME_FEATURED_CAROUSEL_LIMIT = 10;

export function featuredCarouselStreams(
  streams: readonly Stream[],
): readonly Stream[] {
  return streams.slice(0, HOME_FEATURED_CAROUSEL_LIMIT);
}

/** Electron Live Now uses streams.slice(1) — first card stays in the carousel. */
export function recommendedLiveStreams(
  streams: readonly Stream[],
): readonly Stream[] {
  return streams.slice(1);
}

export function HomeFeaturedCarouselView({
  activeIndex,
  onSelectIndex,
  onWatch,
  streams,
}: {
  readonly activeIndex: number;
  readonly onSelectIndex: (index: number) => void;
  readonly onWatch: (stream: Stream) => void;
  readonly streams: readonly Stream[];
}) {
  if (streams.length === 0) return null;
  const safeIndex =
    activeIndex >= 0 && activeIndex < streams.length ? activeIndex : 0;
  const active = streams[safeIndex]!;
  const hasMultiple = streams.length > 1;
  const goPrevious = () => {
    onSelectIndex(safeIndex === 0 ? streams.length - 1 : safeIndex - 1);
  };
  const goNext = () => {
    onSelectIndex(safeIndex >= streams.length - 1 ? 0 : safeIndex + 1);
  };
  const watchLabel = `Watch ${active.channelDisplayName}`;
  return (
    <View style={styles.root} testID="home-featured-carousel">
      <Pressable
        accessibilityHint="Starts watching this featured stream"
        accessibilityLabel={watchLabel}
        accessibilityRole="button"
        onPress={() => onWatch(active)}
        style={styles.stage}
        testID="home-featured-stage"
      >
        {active.thumbnailUrl ? (
          <Image
            accessibilityIgnoresInvertColors
            source={{ uri: active.thumbnailUrl }}
            style={styles.thumb}
          />
        ) : (
          <View style={styles.thumb} />
        )}
        <View style={styles.scrim} />
        <View style={styles.viewerBadge}>
          <View
            style={[
              styles.liveDot,
              active.platform === "twitch"
                ? styles.liveDotTwitch
                : styles.liveDotKick,
            ]}
          />
          <Text selectable style={styles.viewerLabel}>
            {`${active.viewerCount} viewers`}
          </Text>
        </View>
        <View style={styles.panel}>
          <View style={styles.panelRow}>
            {active.channelAvatar ? (
              <Image
                accessibilityIgnoresInvertColors
                source={{ uri: active.channelAvatar }}
                style={styles.avatar}
              />
            ) : (
              <View style={styles.avatar} />
            )}
            <View style={styles.copy}>
              <View style={styles.channelRow}>
                <Text numberOfLines={1} selectable style={styles.channel}>
                  {active.channelDisplayName}
                </Text>
                {active.channelIsVerified ? (
                  <MobileVerifiedBadge platform={active.platform} />
                ) : null}
                <MobilePlatformBadge platform={active.platform} />
              </View>
              <Text numberOfLines={2} selectable style={styles.title}>
                {active.title}
              </Text>
              {active.categoryName ? (
                <Text numberOfLines={1} selectable style={styles.category}>
                  {active.categoryName}
                </Text>
              ) : null}
            </View>
          </View>
          <MobileButton
            accessibilityLabel={watchLabel}
            onPress={() => onWatch(active)}
            testID="home-featured-watch"
            variant={active.platform}
          >
            Watch now
          </MobileButton>
          {hasMultiple ? (
            <View style={styles.controls}>
              <View style={styles.dots}>
                {streams.map((stream, index) => {
                  const selected = index === safeIndex;
                  return (
                    <Pressable
                      accessibilityLabel={`Show ${stream.channelDisplayName}`}
                      accessibilityRole="button"
                      accessibilityState={{ selected }}
                      key={`${stream.platform}:${stream.id}`}
                      onPress={() => onSelectIndex(index)}
                      style={[styles.dot, selected ? styles.dotActive : null]}
                      testID={`home-featured-dot-${index}`}
                    />
                  );
                })}
              </View>
              <View style={styles.arrows}>
                <Pressable
                  accessibilityLabel="Previous featured stream"
                  accessibilityRole="button"
                  onPress={goPrevious}
                  style={styles.arrow}
                  testID="home-featured-prev"
                >
                  <Text style={styles.arrowLabel}>‹</Text>
                </Pressable>
                <Pressable
                  accessibilityLabel="Next featured stream"
                  accessibilityRole="button"
                  onPress={goNext}
                  style={styles.arrow}
                  testID="home-featured-next"
                >
                  <Text style={styles.arrowLabel}>›</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    width: "100%",
  },
  stage: {
    backgroundColor: mobileColors.background,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    overflow: "hidden",
    width: "100%",
  },
  thumb: {
    aspectRatio: 16 / 9,
    backgroundColor: mobileColors.surfaceMuted,
    width: "100%",
  },
  scrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: mobileColors.playerScrim,
  },
  viewerBadge: {
    alignItems: "center",
    backgroundColor: mobileColors.overlay,
    borderRadius: mobileRadii.small,
    flexDirection: "row",
    gap: mobileSpacing.xSmall,
    left: mobileSpacing.small,
    paddingHorizontal: mobileSpacing.small,
    paddingVertical: mobileSpacing.xSmall,
    position: "absolute",
    top: mobileSpacing.small,
  },
  liveDot: {
    borderRadius: mobileRadii.full,
    height: 10,
    width: 10,
  },
  liveDotTwitch: {
    backgroundColor: mobileColors.twitch,
  },
  liveDotKick: {
    backgroundColor: mobileColors.kick,
  },
  viewerLabel: {
    color: mobileColors.textPrimary,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 16,
  },
  panel: {
    backgroundColor: mobileColors.overlay,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    bottom: mobileSpacing.small,
    gap: mobileSpacing.small,
    left: mobileSpacing.small,
    padding: mobileSpacing.medium,
    position: "absolute",
    right: mobileSpacing.small,
  },
  panelRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.small,
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
  channel: {
    ...mobileType.title,
    flexShrink: 1,
  },
  title: {
    color: mobileColors.textPrimary,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18,
    textTransform: "uppercase",
  },
  category: {
    color: mobileColors.textCategory,
    fontSize: 12,
    fontWeight: "500",
    lineHeight: 16,
  },
  controls: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.small,
    justifyContent: "space-between",
    marginTop: mobileSpacing.xSmall,
  },
  dots: {
    alignItems: "center",
    flexDirection: "row",
    flex: 1,
    flexWrap: "wrap",
    gap: mobileSpacing.xSmall,
  },
  dot: {
    backgroundColor: "rgba(255,255,255,0.35)",
    borderRadius: mobileRadii.full,
    height: 8,
    width: 8,
  },
  dotActive: {
    backgroundColor: mobileColors.textPrimary,
    width: 28,
  },
  arrows: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.small,
  },
  arrow: {
    alignItems: "center",
    height: mobileSizing.minimumTouchTarget,
    justifyContent: "center",
    minWidth: mobileSizing.minimumTouchTarget,
  },
  arrowLabel: {
    color: mobileColors.textPrimary,
    fontSize: 28,
    fontWeight: "700",
    lineHeight: 32,
  },
});
