import { useTranslation } from "react-i18next";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { Platform } from "@streamfusion/core/platform";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type {
  SearchHistoryByScope,
  SearchHistoryEntry,
  SearchHistoryScope,
} from "../capabilities/platform-reads";
import {
  channelIdentityFromHistory,
  historyEntryAvatarUrl,
  historyEntryLabel,
} from "../domain/search-history";

export function SearchHistoryPanel({
  confirmClear,
  fallbackPlatform = "twitch",
  history,
  onCancelClear,
  onClear,
  onConfirmClear,
  onOpenChannel,
  onRemove,
  onRepeat,
  scope,
}: {
  readonly confirmClear: boolean;
  readonly fallbackPlatform?: Platform;
  readonly history: SearchHistoryByScope;
  readonly onCancelClear: () => void;
  readonly onClear: () => void;
  readonly onConfirmClear: () => void;
  readonly onOpenChannel?: (channel: {
    readonly id: string;
    readonly platform: Platform;
    readonly username: string;
    readonly avatarUrl?: string;
  }) => void;
  readonly onRemove: (entry: SearchHistoryEntry) => void;
  readonly onRepeat: (entry: SearchHistoryEntry) => void;
  readonly scope: SearchHistoryScope;
}) {
  const { t } = useTranslation();
  const entries = history[scope];
  return (
    <View style={styles.panel} testID="search-history">
      <View style={styles.heading}>
        <Text selectable style={styles.label}>
          {t("discovery.search.history")}
        </Text>
        {confirmClear ? (
          <View style={styles.confirmRow}>
            <Pressable
              accessibilityLabel="Confirm clear search history"
              accessibilityRole="button"
              android_ripple={{ color: mobileColors.surfaceRaised }}
              onPress={onConfirmClear}
              style={({ pressed }) => [
                styles.clear,
                pressed ? styles.pressed : null,
              ]}
              testID="search-clear-confirm"
            >
              <Text selectable style={styles.clearLabel}>
                Clear
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Cancel clear search history"
              accessibilityRole="button"
              onPress={onCancelClear}
              style={({ pressed }) => [
                styles.cancel,
                pressed ? styles.pressed : null,
              ]}
              testID="search-clear-cancel"
            >
              <Text selectable style={styles.cancelLabel}>
                Cancel
              </Text>
            </Pressable>
          </View>
        ) : entries.length > 0 ? (
          <Pressable
            accessibilityLabel="Clear search history"
            accessibilityRole="button"
            onPress={onClear}
            style={({ pressed }) => [
              styles.cancel,
              pressed ? styles.pressed : null,
            ]}
            testID="search-clear-history"
          >
            <Text selectable style={styles.cancelLabel}>
              Clear
            </Text>
          </Pressable>
        ) : null}
      </View>
      {confirmClear ? (
        <Text selectable style={styles.empty}>
          Clear this search history?
        </Text>
      ) : null}
      {entries.length === 0 ? (
        <Text selectable style={styles.empty} testID="search-history-empty">
          Recent searches appear here.
        </Text>
      ) : (
        entries.map((entry) => {
          const label = historyEntryLabel(entry);
          const avatarUrl = historyEntryAvatarUrl(entry);
          const token = historyToken(label);
          const openChannel =
            scope === "channels" || scope === "streams"
              ? channelIdentityFromHistory(entry, fallbackPlatform)
              : null;
          const onPress = () => {
            if (openChannel && onOpenChannel) {
              onOpenChannel({
                ...openChannel,
                ...(avatarUrl ? { avatarUrl } : {}),
              });
              return;
            }
            onRepeat(entry);
          };
          return (
            <View key={`${entry.platform ?? "any"}:${entry.channelId ?? label}`} style={styles.row}>
              <Pressable
                accessibilityLabel={
                  openChannel
                    ? `Open ${label} channel`
                    : `Search again for ${label}`
                }
                accessibilityRole="button"
                onPress={onPress}
                style={({ pressed }) => [
                  styles.cardPress,
                  pressed ? styles.pressed : null,
                ]}
                testID={`repeat-search-${token}`}
              >
                {avatarUrl ? (
                  <Image
                    accessibilityIgnoresInvertColors
                    source={{ uri: avatarUrl }}
                    style={styles.avatar}
                    testID={`search-history-avatar-${token}`}
                  />
                ) : (
                  <View style={styles.avatar} testID={`search-history-avatar-placeholder-${token}`}>
                    <Text style={styles.avatarLetter}>
                      {label.slice(0, 1).toUpperCase()}
                    </Text>
                  </View>
                )}
                <Text numberOfLines={1} selectable style={styles.query}>
                  {label}
                </Text>
              </Pressable>
              <Pressable
                accessibilityLabel={`Remove ${label} from history`}
                accessibilityRole="button"
                onPress={() => onRemove(entry)}
                style={({ pressed }) => [
                  styles.action,
                  pressed ? styles.pressed : null,
                ]}
                testID={`remove-search-${token}`}
              >
                <Text selectable style={styles.actionLabel}>
                  ✕
                </Text>
              </Pressable>
            </View>
          );
        })
      )}
    </View>
  );
}

export function historyToken(query: string): string {
  return query.trim().replace(/\s+/g, "-");
}

const styles = StyleSheet.create({
  panel: {
    gap: mobileSpacing.small,
  },
  heading: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.small,
  },
  label: {
    color: mobileColors.textCategory,
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    lineHeight: 16,
  },
  confirmRow: {
    flexDirection: "row",
    gap: mobileSpacing.small,
  },
  clear: {
    alignItems: "center",
    backgroundColor: mobileColors.textPrimary,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    minWidth: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  clearLabel: {
    color: mobileColors.background,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  cancel: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    minWidth: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.small,
  },
  cancelLabel: {
    color: mobileColors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },
  empty: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 21,
  },
  row: {
    alignItems: "center",
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    flexDirection: "row",
    gap: mobileSpacing.small,
    paddingHorizontal: mobileSpacing.medium,
    paddingVertical: mobileSpacing.small,
  },
  cardPress: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: mobileSpacing.medium,
    minHeight: mobileSizing.minimumTouchTarget,
  },
  avatar: {
    alignItems: "center",
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.full,
    height: 40,
    justifyContent: "center",
    overflow: "hidden",
    width: 40,
  },
  avatarLetter: {
    color: mobileColors.textPrimary,
    fontSize: 16,
    fontWeight: "700",
  },
  query: {
    color: mobileColors.textPrimary,
    flex: 1,
    fontSize: 16,
    fontWeight: "700",
    lineHeight: 22,
  },
  action: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    minWidth: mobileSizing.minimumTouchTarget,
  },
  actionLabel: {
    color: mobileColors.textSecondary,
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 20,
  },
  pressed: {
    opacity: 0.76,
  },
});
