import { Image, Pressable, StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type { WatchHistoryItem } from "../capabilities/watch-history";
import { watchHistoryProgressRatio } from "../domain/watch-history";
import { watchHistoryRowActions } from "../domain/watch-history-view";

export function HistoryRow({
  item,
  onOpen,
  onRemove,
  onReplay,
  onResume,
}: {
  readonly item: WatchHistoryItem;
  readonly onOpen: () => void;
  readonly onRemove: () => void;
  readonly onReplay: () => void;
  readonly onResume: () => void;
}) {
  const actions = watchHistoryRowActions(item);
  const progress = watchHistoryProgressRatio(item);
  return (
    <View style={styles.card} testID={`history-row-${item.id}`}>
      <View style={styles.thumbWrap}>
        <HistoryMediaImage
          resizeMode="cover"
          style={styles.thumb}
          testID={`history-thumbnail-${item.id}`}
          uri={item.thumbnailUrl}
        />
        <View style={styles.kindBadge}>
          <Text selectable style={styles.kindLabel}>
            {item.kind.toUpperCase()}
          </Text>
        </View>
        <View
          style={[
            styles.platformBadge,
            item.platform === "twitch" ? styles.twitchBadge : styles.kickBadge,
          ]}
        >
          <Text selectable style={styles.platformLabel}>
            {item.platform.toUpperCase()}
          </Text>
        </View>
        {progress === null ? null : (
          <View
            style={styles.progressTrack}
            testID={`history-progress-${item.id}`}
          >
            <View style={[styles.progressFill, { width: `${progress * 100}%` }]} />
          </View>
        )}
      </View>
      <View style={styles.meta}>
        <HistoryMediaImage
          style={styles.avatar}
          testID={`history-avatar-${item.id}`}
          uri={item.avatarUrl}
        />
        <View style={styles.copy}>
          <Text selectable style={styles.title}>
            {item.title}
          </Text>
          <Text selectable style={styles.channel}>
            {item.channelDisplayName}
          </Text>
          <Text selectable style={styles.when}>
            {formatWatchedAt(item.updatedAt)}
          </Text>
        </View>
      </View>
      <View style={styles.actions}>
        {actions.open ? (
          <RowAction
            label={`Open ${item.title}`}
            onPress={onOpen}
            testID={`history-open-${item.id}`}
            text="Open"
          />
        ) : null}
        {actions.resume ? (
          <RowAction
            label={`Resume ${item.title}`}
            onPress={onResume}
            testID={`history-resume-${item.id}`}
            text="Resume"
          />
        ) : null}
        {actions.replay ? (
          <RowAction
            label={`Replay ${item.title}`}
            onPress={onReplay}
            testID={`history-replay-${item.id}`}
            text="Replay"
          />
        ) : null}
        <RowAction
          label={`Remove ${item.title} from history`}
          onPress={onRemove}
          testID={`history-remove-${item.id}`}
          text="Remove"
        />
      </View>
    </View>
  );
}

function HistoryMediaImage({
  resizeMode,
  style,
  testID,
  uri,
}: {
  readonly resizeMode?: "cover";
  readonly style: typeof styles.avatar | typeof styles.thumb;
  readonly testID: string;
  readonly uri: string;
}) {
  if (!uri) return <View style={style} testID={testID} />;
  return (
    <Image
      accessibilityIgnoresInvertColors
      resizeMode={resizeMode}
      source={{ uri }}
      style={style}
      testID={testID}
    />
  );
}

function RowAction({
  label,
  onPress,
  testID,
  text,
}: {
  readonly label: string;
  readonly onPress: () => void;
  readonly testID: string;
  readonly text: string;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed ? styles.pressed : null]}
      testID={testID}
    >
      <Text selectable style={styles.actionLabel}>
        {text}
      </Text>
    </Pressable>
  );
}

function formatWatchedAt(updatedAt: number): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
  }).format(new Date(updatedAt));
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    overflow: "hidden",
  },
  thumbWrap: {
    aspectRatio: 16 / 9,
    backgroundColor: mobileColors.surfaceMuted,
    width: "100%",
  },
  thumb: {
    height: "100%",
    width: "100%",
  },
  kindBadge: {
    backgroundColor: "rgba(0,0,0,0.72)",
    borderRadius: mobileRadii.small,
    left: mobileSpacing.small,
    paddingHorizontal: mobileSpacing.small,
    paddingVertical: mobileSpacing.xSmall,
    position: "absolute",
    top: mobileSpacing.small,
  },
  kindLabel: {
    color: mobileColors.textPrimary,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 14,
  },
  platformBadge: {
    borderRadius: mobileRadii.small,
    justifyContent: "center",
    minHeight: 24,
    paddingHorizontal: mobileSpacing.small,
    position: "absolute",
    right: mobileSpacing.small,
    top: mobileSpacing.small,
  },
  twitchBadge: {
    backgroundColor: "#9146ff",
  },
  kickBadge: {
    backgroundColor: "#53fc18",
  },
  platformLabel: {
    color: mobileColors.background,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 14,
  },
  progressTrack: {
    backgroundColor: "rgba(255,255,255,0.24)",
    bottom: 0,
    height: 4,
    left: 0,
    position: "absolute",
    right: 0,
  },
  progressFill: {
    backgroundColor: mobileColors.textPrimary,
    height: 4,
  },
  meta: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
  avatar: {
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.full,
    height: 40,
    width: 40,
  },
  copy: {
    flex: 1,
    gap: mobileSpacing.xSmall,
  },
  title: {
    color: mobileColors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  channel: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  when: {
    color: mobileColors.textCategory,
    fontSize: 13,
    lineHeight: 18,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.small,
    paddingBottom: mobileSpacing.small,
    paddingHorizontal: mobileSpacing.medium,
  },
  action: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    minWidth: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.small,
  },
  actionLabel: {
    color: mobileColors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
  },
  pressed: {
    opacity: 0.76,
  },
});
