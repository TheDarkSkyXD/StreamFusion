import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import { DiscoverySearchDock } from "@mobile/features/discovery/components/discovery-search-dock";
import type { WatchHistoryItem } from "../capabilities/watch-history";
import type {
  WatchHistoryStatus,
  WatchHistoryView,
} from "../domain/watch-history-view";
import { HistoryRow } from "./history-row";

export function HistoryView({
  model,
  onCancel,
  onChangeQuery,
  onClear,
  onConfirm,
  onOpen,
  onRemove,
  onReplay,
  onResume,
  onRetry,
}: {
  readonly model: WatchHistoryView;
  readonly onCancel: () => void;
  readonly onChangeQuery: (query: string) => void;
  readonly onClear: () => void;
  readonly onConfirm: () => void;
  readonly onOpen: (item: WatchHistoryItem) => void;
  readonly onRemove: (item: WatchHistoryItem) => void;
  readonly onReplay: (item: WatchHistoryItem) => void;
  readonly onResume: (item: WatchHistoryItem) => void;
  readonly onRetry: () => void;
}) {
  const showClear =
    model.items.length > 0 || model.confirmation?.kind === "clear";
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      style={styles.screen}
      testID="screen-history"
    >
      <View style={styles.header}>
        <View style={styles.heading}>
          <Text accessibilityRole="header" selectable style={styles.title}>
            History
          </Text>
          <Text selectable style={styles.summary}>
            Streams, videos, and clips stay on this device. Reopening never
            autoplays.
          </Text>
        </View>
        {showClear ? (
          <Pressable
            accessibilityHint="Asks before removing only Watch History"
            accessibilityLabel="Clear history"
            accessibilityRole="button"
            onPress={onClear}
            style={({ pressed }) => [
              styles.clear,
              pressed ? styles.pressed : null,
            ]}
            testID="history-clear"
          >
            <Text selectable style={styles.clearLabel}>
              Clear
            </Text>
          </Pressable>
        ) : null}
      </View>
      <DiscoverySearchDock
        onChangeQuery={onChangeQuery}
        placeholder="Search history"
        query={model.query}
        testID="history-search"
      />
      {model.confirmation ? (
        <HistoryConfirmation
          confirmation={model.confirmation}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      ) : null}
      <HistoryStatusNotice onRetry={onRetry} status={model.status} />
      {model.items.map((item) => (
        <HistoryRow
          item={item}
          key={item.id}
          onOpen={() => onOpen(item)}
          onRemove={() => onRemove(item)}
          onReplay={() => onReplay(item)}
          onResume={() => onResume(item)}
        />
      ))}
    </ScrollView>
  );
}

function HistoryConfirmation({
  confirmation,
  onCancel,
  onConfirm,
}: {
  readonly confirmation: NonNullable<WatchHistoryView["confirmation"]>;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
}) {
  const message =
    confirmation.kind === "clear"
      ? "Clear Watch History on this device?"
      : `Remove ${confirmation.title} from History?`;
  return (
    <View style={styles.confirm} testID="history-confirmation">
      <Text selectable style={styles.summary}>
        {message}
      </Text>
      <View style={styles.confirmActions}>
        <Pressable
          accessibilityLabel="Confirm history change"
          accessibilityRole="button"
          onPress={onConfirm}
          style={({ pressed }) => [
            styles.confirmButton,
            pressed ? styles.pressed : null,
          ]}
          testID="history-confirm"
        >
          <Text selectable style={styles.confirmLabel}>
            Confirm
          </Text>
        </Pressable>
        <Pressable
          accessibilityLabel="Cancel history change"
          accessibilityRole="button"
          onPress={onCancel}
          style={({ pressed }) => [
            styles.cancel,
            pressed ? styles.pressed : null,
          ]}
          testID="history-cancel"
        >
          <Text selectable style={styles.cancelLabel}>
            Cancel
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function HistoryStatusNotice({
  onRetry,
  status,
}: {
  readonly onRetry: () => void;
  readonly status: WatchHistoryStatus;
}) {
  if (status === "ready") return null;
  if (status === "unavailable") {
    return (
      <>
        <Text selectable style={styles.summary} testID="history-unavailable">
          History could not load. Retry stays on this screen.
        </Text>
        <Pressable
          accessibilityLabel="Retry history"
          accessibilityRole="button"
          onPress={onRetry}
          style={({ pressed }) => [
            styles.cancel,
            pressed ? styles.pressed : null,
          ]}
          testID="history-retry"
        >
          <Text selectable style={styles.cancelLabel}>
            Retry
          </Text>
        </Pressable>
      </>
    );
  }
  if (status === "empty") {
    return (
      <Text selectable style={styles.summary} testID="history-empty">
        Watched streams, videos, and clips appear here.
      </Text>
    );
  }
  return (
    <Text selectable style={styles.summary} testID="history-offline">
      Showing saved History while offline. Opening a row still needs a playback
      source.
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    gap: mobileSpacing.medium,
    padding: mobileSpacing.medium,
    paddingBottom: 96,
  },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: mobileSpacing.small,
  },
  heading: {
    flex: 1,
    gap: mobileSpacing.xSmall,
  },
  title: {
    color: mobileColors.textPrimary,
    fontSize: 28,
    fontWeight: "700",
    lineHeight: 34,
  },
  summary: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 21,
  },
  clear: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    minWidth: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.small,
  },
  clearLabel: {
    color: mobileColors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
  },
  confirm: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
  confirmActions: {
    flexDirection: "row",
    gap: mobileSpacing.small,
  },
  confirmButton: {
    alignItems: "center",
    backgroundColor: mobileColors.textPrimary,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  confirmLabel: {
    color: mobileColors.background,
    fontSize: 14,
    fontWeight: "700",
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
  },
  pressed: {
    opacity: 0.76,
  },
});
