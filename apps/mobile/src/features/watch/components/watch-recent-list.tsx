import { useQuery } from "@tanstack/react-query";
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
  const query = useQuery({
    queryFn: () => history.list(),
    queryKey: ["watch-history", "watch-empty-recent"],
  });
  const items = (query.data ?? []).slice(0, RECENT_LIMIT);
  if (query.isLoading) {
    return (
      <Text selectable style={styles.caption} testID="watch-recent-loading">
        Loading Continue Watching…
      </Text>
    );
  }
  if (items.length === 0) {
    return onOpenSearch ? (
      <MobileButton
        accessibilityHint="Opens Search to find something to watch"
        accessibilityLabel="Find something in Search"
        onPress={onOpenSearch}
        testID="watch-empty-open-search"
        variant="secondary"
      >
        Find something in Search
      </MobileButton>
    ) : null;
  }
  return (
    <View style={styles.stack} testID="watch-recent-list">
      <Text selectable style={styles.heading} testID="continue-watching-heading">
        Continue Watching
      </Text>
      <Text selectable style={styles.caption}>
        Resume or open from History. Playback never autoplays.
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
  const canResume = canResumeWatchHistory(item);
  const progress = watchHistoryProgressRatio(item);
  return (
    <Pressable
      accessibilityHint={
        canResume
          ? "Resumes this recording from your saved position"
          : "Opens this item without autoplay"
      }
      accessibilityLabel={`${canResume ? "Resume" : "Open"} ${item.title}`}
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
              accessibilityLabel={`${Math.round(progress * 100)} percent watched`}
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
        accessibilityLabel={`${canResume ? "Resume" : "Open"} ${item.title}`}
        onPress={() => onWatch(canResume ? "resume" : "open")}
        testID={`watch-recent-open-${item.id}`}
        variant="secondary"
      >
        {canResume ? "Resume" : "Open"}
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
