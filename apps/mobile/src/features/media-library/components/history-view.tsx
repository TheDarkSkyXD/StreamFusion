import { useState } from "react";
import { MobileFilterChip } from "@mobile/design/chip";
import { MobileTextField } from "@mobile/design/text-input";
import { StyleSheet, Text, View } from "react-native";

import { MobileButton } from "@mobile/design/button";
import { warningHaptic } from "@mobile/design/haptics";
import { MobileRefreshableScroll } from "@mobile/design/refreshable";
import { MobileStatusPanel } from "@mobile/design/status-panel";
import {
  mobileColors,
  mobileRadii,
  mobileSpacing,
} from "@mobile/design/tokens";
import type { WatchHistoryItem } from "../capabilities/watch-history";
import type {
  WatchHistoryStatus,
  WatchHistoryView,
} from "../domain/watch-history-view";
import { HistoryRow } from "./history-row";

const historyDayFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
});

export function HistoryView({
  model,
  onCancel,
  onChangeQuery,
  onClear,
  onConfirm,
  onOpen,
  onRefresh,
  onRemove,
  onReplay,
  onResume,
  onRetry,
  refreshing = false,
}: {
  readonly model: WatchHistoryView;
  readonly onCancel: () => void;
  readonly onChangeQuery: (query: string) => void;
  readonly onClear: () => void;
  readonly onConfirm: () => void;
  readonly onOpen: (item: WatchHistoryItem) => void;
  readonly onRefresh?: () => void | Promise<void>;
  readonly onRemove: (item: WatchHistoryItem) => void;
  readonly onReplay: (item: WatchHistoryItem) => void;
  readonly onResume: (item: WatchHistoryItem) => void;
  readonly onRetry: () => void;
  readonly refreshing?: boolean;
}) {
  const [filter, setFilter] = useState<"all" | "video" | "clip" | "stream">(
    "all",
  );
  const visibleItems = model.items.filter(
    (item) => filter === "all" || item.kind === filter,
  );
  const showClear =
    model.items.length > 0 || model.confirmation?.kind === "clear";
  return (
    <MobileRefreshableScroll
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardDismissMode="on-drag"
      keyboardShouldPersistTaps="handled"
      onRefresh={onRefresh ?? onRetry}
      refreshing={refreshing}
      style={styles.screen}
      testID="screen-history"
    >
      {showClear ? (
        <MobileButton
          accessibilityHint="Asks before removing only Watch History"
          accessibilityLabel="Clear history"
          onPress={() => {
            void warningHaptic();
            onClear();
          }}
          testID="history-clear"
          variant="ghost"
        >
          Clear History
        </MobileButton>
      ) : null}
      <MobileTextField
        label="Search history"
        onChange={onChangeQuery}
        placeholder="Channel or title"
        value={model.query}
      />
      <View style={styles.confirmActions}>
        {(
          [
            { value: "all", label: "All" },
            { value: "video", label: "Videos" },
            { value: "clip", label: "Clips" },
            { value: "stream", label: "Live" },
          ] as const
        ).map((item) => (
          <MobileFilterChip
            key={item.value}
            label={item.label}
            accessibilityLabel={item.label}
            testID={`history-filter-${item.value}`}
            selected={filter === item.value}
            onPress={() => setFilter(item.value)}
          />
        ))}
      </View>
      {model.confirmation ? (
        <HistoryConfirmation
          confirmation={model.confirmation}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      ) : null}
      <HistoryStatusNotice onRetry={onRetry} status={model.status} />
      {visibleItems.length === 0 && model.items.length > 0 ? (
        <Text style={styles.summary}>No matching history.</Text>
      ) : null}
      {visibleItems.map((item, index) => {
        const day = historyDayFormat.format(new Date(item.updatedAt));
        const previous = visibleItems[index - 1];
        const beginsDay =
          !previous ||
          day !== historyDayFormat.format(new Date(previous.updatedAt));
        return (
          <View key={item.id} style={{ gap: mobileSpacing.small }}>
            {beginsDay ? (
              <Text accessibilityRole="header" style={styles.summary}>
                {day}
              </Text>
            ) : null}
            <HistoryRow
              item={item}
              key={item.id}
              onOpen={() => onOpen(item)}
              onRemove={() => onRemove(item)}
              onReplay={() => onReplay(item)}
              onResume={() => onResume(item)}
            />
          </View>
        );
      })}
    </MobileRefreshableScroll>
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
      ? "Are you sure you want to clear your watch history?"
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
          {confirmation.kind === "clear" ? "Clear History" : "Remove from history"}
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
          No watch history yet
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
