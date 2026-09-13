import { Pressable, StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type {
  SearchHistoryByScope,
  SearchHistoryScope,
} from "../capabilities/platform-reads";

const SCOPE_LABEL: Readonly<Record<SearchHistoryScope, string>> = {
  categories: "Category",
  channels: "Channel",
  streams: "Stream",
};

export function SearchHistoryPanel({
  confirmClear,
  history,
  onCancelClear,
  onClear,
  onConfirmClear,
  onRemove,
  onRepeat,
  scope,
}: {
  readonly confirmClear: boolean;
  readonly history: SearchHistoryByScope;
  readonly onCancelClear: () => void;
  readonly onClear: () => void;
  readonly onConfirmClear: () => void;
  readonly onRemove: (query: string) => void;
  readonly onRepeat: (query: string) => void;
  readonly scope: SearchHistoryScope;
}) {
  const queries = history[scope];
  return (
    <View style={styles.panel} testID="search-history">
      <View style={styles.heading}>
        <View style={styles.headingCopy}>
          <Text selectable style={styles.label}>
            Search history
          </Text>
          <Text selectable style={styles.hint}>
            Last 10 per type
          </Text>
        </View>
        {confirmClear ? (
          <View style={styles.confirmRow}>
            <Pressable
              accessibilityHint="Removes only this Search history type"
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
        ) : queries.length > 0 ? (
          <Pressable
            accessibilityHint="Asks before removing only this Search history type"
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
      {queries.length === 0 ? (
        <Text selectable style={styles.empty} testID="search-history-empty">
          Recent Channel, Stream, and Category searches stay on this device.
        </Text>
      ) : (
        queries.map((query) => (
          <View key={query} style={styles.row}>
            <View style={styles.copy}>
              <Text selectable style={styles.query}>
                {query}
              </Text>
              <Text selectable style={styles.hint}>
                {`${SCOPE_LABEL[scope]} · this device`}
              </Text>
            </View>
            <Pressable
              accessibilityLabel={`Search again for ${query}`}
              accessibilityRole="button"
              onPress={() => onRepeat(query)}
              style={({ pressed }) => [
                styles.action,
                pressed ? styles.pressed : null,
              ]}
              testID={`repeat-search-${historyToken(query)}`}
            >
              <Text selectable style={styles.actionLabel}>
                Repeat
              </Text>
            </Pressable>
            <Pressable
              accessibilityLabel={`Remove ${query} from history`}
              accessibilityRole="button"
              onPress={() => onRemove(query)}
              style={({ pressed }) => [
                styles.action,
                pressed ? styles.pressed : null,
              ]}
              testID={`remove-search-${historyToken(query)}`}
            >
              <Text selectable style={styles.actionLabel}>
                Remove
              </Text>
            </Pressable>
          </View>
        ))
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
  headingCopy: {
    flex: 1,
    gap: mobileSpacing.xSmall,
  },
  label: {
    color: mobileColors.textCategory,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1,
    lineHeight: 16,
  },
  hint: {
    color: mobileColors.textCategory,
    fontSize: 13,
    fontWeight: "500",
    lineHeight: 18,
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
  copy: {
    flex: 1,
    gap: mobileSpacing.xSmall,
  },
  query: {
    color: mobileColors.textPrimary,
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
    color: mobileColors.textPrimary,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
  pressed: {
    opacity: 0.76,
  },
});
