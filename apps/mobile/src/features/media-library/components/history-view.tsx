import { ScrollView, StyleSheet, Text, View } from "react-native";

import { MobileButton } from "@mobile/design/button";
import { MobileScreenHeader } from "@mobile/design/screen-header";
import { MobileStatusPanel } from "@mobile/design/status-panel";
import {
  mobileColors,
  mobileRadii,
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
      <MobileScreenHeader
        action={
          showClear ? (
            <MobileButton
              accessibilityHint="Asks before removing only Watch History"
              accessibilityLabel="Clear history"
              onPress={onClear}
              testID="history-clear"
              variant="ghost"
            >
              Clear
            </MobileButton>
          ) : undefined
        }
        summary="Streams, videos, and clips stay on this device. Reopening never autoplays."
        title="History"
      />
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
        <MobileButton
          accessibilityLabel="Confirm history change"
          onPress={onConfirm}
          testID="history-confirm"
          variant="primary"
        >
          Confirm
        </MobileButton>
        <MobileButton
          accessibilityLabel="Cancel history change"
          onPress={onCancel}
          testID="history-cancel"
          variant="ghost"
        >
          Cancel
        </MobileButton>
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
      <MobileStatusPanel testID="history-unavailable" tone="error">
        <Text selectable style={styles.summary}>
          History could not load. Retry stays on this screen.
        </Text>
        <MobileButton
          accessibilityLabel="Retry history"
          onPress={onRetry}
          testID="history-retry"
          variant="primary"
        >
          Retry
        </MobileButton>
      </MobileStatusPanel>
    );
  }
  if (status === "empty") {
    return (
      <MobileStatusPanel testID="history-empty" tone="empty">
        <Text selectable style={styles.summary}>
          Watched streams, videos, and clips appear here.
        </Text>
      </MobileStatusPanel>
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
  summary: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: 21,
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
});
