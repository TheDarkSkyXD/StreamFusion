import { useQuery } from "@tanstack/react-query";
import { StyleSheet, Text, View } from "react-native";

import { MobileButton } from "@mobile/design/button";
import { MobilePlatformBadge } from "@mobile/design/platform-badge";
import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
  mobileType,
} from "@mobile/design/tokens";
import type { WatchHistoryItem } from "@mobile/features/media-library/capabilities/watch-history";
import type { WatchHistoryRepository } from "@mobile/features/media-library/capabilities/watch-history";
import { watchTargetFromHistory } from "@mobile/features/media-library/domain/watch-history";
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
        Loading recent watches…
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
      <Text selectable style={styles.heading}>
        Recent
      </Text>
      <Text selectable style={styles.caption}>
        Continue from Watch History without autoplay.
      </Text>
      {items.map((item) => (
        <RecentRow
          item={item}
          key={item.id}
          onWatch={() => onWatch(watchTargetFromHistory(item, "open"))}
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
  readonly onWatch: () => void;
}) {
  return (
    <View style={styles.card} testID={`watch-recent-${item.id}`}>
      <View style={styles.meta}>
        <MobilePlatformBadge platform={item.platform} />
        <View style={styles.copy}>
          <Text numberOfLines={2} selectable style={styles.title}>
            {item.title}
          </Text>
          <Text numberOfLines={1} selectable style={styles.channel}>
            {item.channelDisplayName}
          </Text>
        </View>
      </View>
      <MobileButton
        accessibilityLabel={`Open ${item.title}`}
        onPress={onWatch}
        testID={`watch-recent-open-${item.id}`}
        variant="secondary"
      >
        Open
      </MobileButton>
    </View>
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
    padding: mobileSpacing.medium,
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
});
