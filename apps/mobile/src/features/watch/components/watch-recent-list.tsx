import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { MobileButton } from "@mobile/design/button";
import { MobilePlatformBadge } from "@mobile/design/platform-badge";
import {
  mobileColors,
  mobilePressedOpacity,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import type {
  WatchHistoryItem,
  WatchHistoryRepository,
} from "@mobile/features/media-library/capabilities/watch-history";
import {
  canResumeWatchHistory,
  watchHistoryProgressRatio,
  watchTargetFromHistory,
} from "@mobile/features/media-library/domain/watch-history";
import { impactHaptic } from "@mobile/design/haptics";
import type { WatchTarget } from "../capabilities/watch";

const RECENT_LIMIT = 8;

export function WatchRecentList({
  history,
  onOpenSearch,
  onWatch,
}: {
  readonly history: WatchHistoryRepository;
  readonly onOpenSearch?: () => void;
  readonly onWatch: (target: WatchTarget) => void;
}) {
  const { t } = useTranslation();
  const query = useQuery({
    queryFn: () => history.list(),
    queryKey: ["watch-history", "watch-empty-recent"],
  });
  const items = (query.data ?? []).slice(0, RECENT_LIMIT);
  if (query.isLoading) {
    return (
      <Text selectable style={styles.caption} testID="watch-recent-loading">
        {t("playback.watch.continueWatchingLoading")}
      </Text>
    );
  }
  if (items.length === 0) {
    return onOpenSearch ? (
      <MobileButton
        accessibilityHint={t("playback.watch.findInSearchHint")}
        accessibilityLabel={t("playback.watch.findInSearch")}
        onPress={onOpenSearch}
        testID="watch-empty-open-search"
        variant="secondary"
      >
        {t("playback.watch.findInSearch")}
      </MobileButton>
    ) : null;
  }
  return (
    <View style={styles.stack} testID="watch-recent-list">
      <Text selectable style={styles.heading} testID="continue-watching-heading">
        {t("playback.watch.continueWatching")}
      </Text>
      <Text selectable style={styles.caption}>
        {t("playback.watch.continueWatchingCaption")}
      </Text>
      {items.map((item) => (
        <RecentRow
          item={item}
          key={item.id}
          onWatch={(mode) => {
            void impactHaptic("light");
            onWatch(watchTargetFromHistory(item, mode));
          }}
        />
      ))}
    </View>
  );
}

function RecentRow({
  item,
  onWatch,
}: {
  readonly item: WatchHistoryItem;
  readonly onWatch: (mode: "open" | "resume") => void;
}) {
  const { t } = useTranslation();
  const canResume = canResumeWatchHistory(item);
  const progress = watchHistoryProgressRatio(item);
  const actionLabel = canResume
    ? t("playback.watch.resumeItem", { title: item.title })
    : t("playback.watch.openItem", { title: item.title });
  return (
    <Pressable
      accessibilityHint={
        canResume
          ? t("playback.watch.resumeHint")
          : t("playback.watch.openHint")
      }
      accessibilityLabel={actionLabel}
      accessibilityRole="button"
      android_ripple={{ color: mobileColors.surfaceRaised }}
      onPress={() => onWatch(canResume ? "resume" : "open")}
      style={({ pressed }) => [
        styles.card,
        pressed ? styles.cardPressed : null,
      ]}
      testID={`watch-recent-${item.id}`}
    >
      <View style={styles.meta}>
        <MobilePlatformBadge platform={item.platform} />
        <View style={styles.copy}>
          <Text numberOfLines={2} selectable style={styles.title}>
            {item.title}
          </Text>
          <Text numberOfLines={1} selectable style={styles.channel}>
            {item.channelDisplayName}
          </Text>
          {progress !== null ? (
            <View
              accessibilityLabel={t("playback.watch.percentWatched", {
                percent: Math.round(progress * 100),
              })}
              style={styles.progressTrack}
              testID={`watch-recent-progress-${item.id}`}
            >
              <View
                style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]}
              />
            </View>
          ) : null}
        </View>
      </View>
      <MobileButton
        accessibilityLabel={actionLabel}
        onPress={() => onWatch(canResume ? "resume" : "open")}
        testID={`watch-recent-open-${item.id}`}
        variant="secondary"
      >
        {canResume ? t("mediaLibrary.resume") : t("mediaLibrary.open")}
      </MobileButton>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  stack: { gap: mobileSpacing.small },
  heading: {
    ...mobileType.title,
    fontSize: 18,
  },
  caption: {
    ...mobileType.body,
    color: mobileColors.textSecondary,
  },
  card: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    gap: mobileSpacing.small,
    minHeight: mobileSizing.minimumTouchTarget,
    padding: mobileSpacing.medium,
  },
  cardPressed: {
    opacity: mobilePressedOpacity,
  },
  meta: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: mobileSpacing.small,
  },
  copy: { flex: 1, gap: 2, minWidth: 0 },
  title: {
    color: mobileColors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  channel: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 20,
  },
  progressTrack: {
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.full,
    height: 4,
    marginTop: mobileSpacing.xSmall,
    overflow: "hidden",
    width: "100%",
  },
  progressFill: {
    backgroundColor: mobileColors.textPrimary,
    height: "100%",
  },
});
