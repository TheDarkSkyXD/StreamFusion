import type { ActivityItem } from "@streamfusion/core/activity";
import { ChevronRight } from "lucide-react-native";
import { memo, useEffect } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { ActivityFilter } from "@mobile/capabilities/persistence";
import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type { ActivityViewModel } from "@mobile/features/activity/activity-controller";
import type { ShellLocation } from "@mobile/features/shell/shell-navigation";

const activityDateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});
const filters = [
  { id: "all", label: "All" },
  { id: "channels", label: "Channels" },
  { id: "jobs", label: "Jobs" },
] as const satisfies readonly {
  readonly id: ActivityFilter;
  readonly label: string;
}[];

export function ActivityScreen({
  model,
  onMarkAllRead,
  onOpen,
  onRefresh,
  onSelectFilter,
}: {
  readonly model: ActivityViewModel;
  readonly onMarkAllRead: () => Promise<void>;
  readonly onOpen: (location: ShellLocation) => void;
  readonly onRefresh: () => Promise<void>;
  readonly onSelectFilter: (filter: ActivityFilter) => void;
}) {
  return (
    <FlatList
      contentContainerStyle={styles.listContent}
      contentInsetAdjustmentBehavior="automatic"
      data={model.items}
      keyExtractor={(item) => item.eventId}
      ListEmptyComponent={
        <ActivityEmptyState onRefresh={onRefresh} status={model.status} />
      }
      ListHeaderComponent={
        <View style={styles.headerContent}>
          <View style={styles.intro}>
            <Text
              accessibilityRole="header"
              selectable
              style={styles.screenTitle}
            >
              Activity
            </Text>
            <Text selectable style={styles.screenSummary}>
              Channel alerts, jobs, and device updates stay available offline
              and after you reopen the app.
            </Text>
          </View>
          {model.mutationFailure ? (
            <View
              accessible
              style={styles.failure}
              testID="activity-write-failure"
            >
              <Text selectable style={styles.itemBody}>
                Activity could not save that change. Try the action again.
              </Text>
            </View>
          ) : null}
          <View accessibilityLabel="Activity filters" style={styles.filters}>
            {filters.map((filter) => {
              const selected = model.filter === filter.id;
              return (
                <Pressable
                  accessibilityLabel={`${filter.label} Activity`}
                  accessibilityRole="tab"
                  accessibilityState={{ selected }}
                  key={filter.id}
                  onPress={() => onSelectFilter(filter.id)}
                  style={[
                    styles.filter,
                    selected ? styles.filterSelected : null,
                  ]}
                  testID={`activity-filter-${filter.id}`}
                >
                  <Text
                    selectable
                    style={
                      selected ? styles.filterTextSelected : styles.filterText
                    }
                  >
                    {filter.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.unreadRow}>
            <Text
              selectable
              style={styles.unreadText}
              testID="activity-unread-count"
            >
              {`${model.unreadCount} unread`}
            </Text>
            <Pressable
              accessibilityLabel="Mark all Activity read"
              accessibilityRole="button"
              disabled={model.unreadCount === 0}
              onPress={() => void onMarkAllRead()}
              style={styles.markAllButton}
              testID="activity-mark-all-read"
            >
              <Text selectable style={styles.markAllText}>
                Mark all read
              </Text>
            </Pressable>
          </View>
        </View>
      }
      renderItem={({ item }) => (
        <ActivityRow
          body={item.body}
          eventId={item.eventId}
          kind={item.kind}
          occurredAt={item.occurredAt}
          read={item.readAt !== null}
          title={item.title}
          onOpen={onOpen}
        />
      )}
      testID="activity-list"
    />
  );
}

const ActivityRow = memo(function ActivityRow({
  body,
  eventId,
  kind,
  occurredAt,
  onOpen,
  read,
  title,
}: {
  readonly body: string;
  readonly eventId: string;
  readonly kind: ActivityItem["kind"];
  readonly occurredAt: string;
  readonly onOpen: (location: ShellLocation) => void;
  readonly read: boolean;
  readonly title: string;
}) {
  return (
    <Pressable
      accessibilityHint="Opens this Activity item"
      accessibilityLabel={`${read ? "Read" : "Unread"} ${title}`}
      accessibilityRole="button"
      onPress={() => onOpen({ route: "activity/alert-preview", eventId })}
      style={({ pressed }) => [styles.item, pressed ? styles.pressed : null]}
      testID={`activity-item-${eventId}`}
    >
      <View style={styles.itemCopy}>
        <View style={styles.itemTitleRow}>
          {!read ? (
            <View accessibilityLabel="Unread" style={styles.unreadDot} />
          ) : null}
          <Text numberOfLines={1} selectable style={styles.itemTitle}>
            {title}
          </Text>
        </View>
        <Text numberOfLines={2} selectable style={styles.itemBody}>
          {body}
        </Text>
        <Text selectable style={styles.itemMeta}>
          {`${kind === "channel" ? "Channel" : kind === "job" ? "Job" : "System"} · ${activityDateFormat.format(new Date(occurredAt))}`}
        </Text>
      </View>
      <ChevronRight
        accessibilityElementsHidden
        color={mobileColors.textSecondary}
        size={mobileSizing.icon}
      />
    </Pressable>
  );
});

function ActivityEmptyState({
  onRefresh,
  status,
}: {
  readonly onRefresh: () => Promise<void>;
  readonly status: ActivityViewModel["status"];
}) {
  return (
    <View accessible style={styles.empty} testID="activity-empty-state">
      <Text selectable style={styles.itemTitle}>
        {status === "loading"
          ? "Opening Activity"
          : status === "unavailable"
            ? "Activity is temporarily unavailable"
            : "Nothing here yet"}
      </Text>
      <Text selectable style={styles.itemBody}>
        {status === "unavailable"
          ? "Saved Activity could not be opened. Try again."
          : "New local events will appear here without requiring notification permission."}
      </Text>
      {status === "unavailable" ? (
        <Pressable
          accessibilityLabel="Try opening Activity again"
          accessibilityRole="button"
          onPress={() => void onRefresh()}
          style={styles.retryButton}
          testID="activity-retry-load"
        >
          <Text selectable style={styles.markAllText}>
            Try again
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function ActivityDetailScreen({
  eventId,
  items,
  mutationFailure,
  onMarkRead,
  onOpen,
}: {
  readonly eventId: string;
  readonly items: readonly ActivityItem[];
  readonly mutationFailure: ActivityViewModel["mutationFailure"];
  readonly onMarkRead: (eventId: string) => Promise<void>;
  readonly onOpen: (location: ShellLocation) => void;
}) {
  const item = items.find((candidate) => candidate.eventId === eventId);
  useEffect(() => {
    if (item?.readAt === null) void onMarkRead(item.eventId);
  }, [item, onMarkRead]);

  return (
    <ScrollView
      contentContainerStyle={styles.detailContent}
      contentInsetAdjustmentBehavior="automatic"
      testID="activity-detail"
    >
      {item ? (
        <View style={styles.detailCard}>
          <Text selectable style={styles.itemMeta}>
            {item.source === "local" ? "LOCAL EVENT" : "RELAY EVENT"}
          </Text>
          <Text
            accessibilityRole="header"
            selectable
            style={styles.screenTitle}
          >
            {item.title}
          </Text>
          <Text selectable style={styles.screenSummary}>
            {item.body}
          </Text>
          {mutationFailure === "mark-read" ? (
            <Pressable
              accessibilityLabel="Try marking Activity read again"
              accessibilityRole="button"
              onPress={() => void onMarkRead(item.eventId)}
              style={styles.retryButton}
              testID="activity-retry-mark-read"
            >
              <Text selectable style={styles.markAllText}>
                Try marking read again
              </Text>
            </Pressable>
          ) : null}
          {activityDestinationLocation(item) ? (
            <Pressable
              accessibilityLabel="Open Activity destination"
              accessibilityRole="button"
              onPress={() => {
                const location = activityDestinationLocation(item);
                if (location) onOpen(location);
              }}
              style={styles.openButton}
              testID="activity-open-destination"
            >
              <Text selectable style={styles.openButtonText}>
                Open destination
              </Text>
            </Pressable>
          ) : null}
        </View>
      ) : (
        <View accessible style={styles.empty}>
          <Text selectable style={styles.itemTitle}>
            Activity item unavailable
          </Text>
          <Text selectable style={styles.itemBody}>
            This Activity item is no longer available on this device.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

export function activityDestinationLocation(
  item: ActivityItem,
): ShellLocation | null {
  if (item.kind === "channel") {
    return {
      route: "watch/session-preview",
      target: {
        kind: "channel",
        platform: item.destination.platform,
        channelId: item.destination.channelId,
        channelLogin: item.destination.channelLogin,
      },
    };
  }
  if (item.kind === "job")
    return { route: "activity/job-preview", jobId: item.destination.jobId };
  if (item.destination?.kind === "accounts") return { route: "more/accounts" };
  if (item.destination?.kind === "diagnostics")
    return { route: "more/diagnostics" };
  return null;
}

const styles = StyleSheet.create({
  listContent: {
    flexGrow: 1,
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
  headerContent: {
    gap: mobileSpacing.medium,
    paddingBottom: mobileSpacing.small,
  },
  intro: { gap: mobileSpacing.xSmall },
  screenTitle: {
    color: mobileColors.textPrimary,
    fontSize: 24,
    fontWeight: "700",
  },
  screenSummary: {
    color: mobileColors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
  },
  filters: { flexDirection: "row", gap: mobileSpacing.xSmall },
  filter: {
    alignItems: "center",
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  filterSelected: { backgroundColor: mobileColors.surfaceRaised },
  filterText: {
    color: mobileColors.textSecondary,
    fontSize: 14,
    fontWeight: "600",
  },
  filterTextSelected: {
    color: mobileColors.textPrimary,
    fontSize: 14,
    fontWeight: "700",
  },
  unreadRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  unreadText: {
    color: mobileColors.textSecondary,
    fontSize: 13,
    fontVariant: ["tabular-nums"],
  },
  markAllButton: {
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.small,
  },
  markAllText: {
    color: mobileColors.textPrimary,
    fontSize: 13,
    fontWeight: "600",
  },
  item: {
    alignItems: "center",
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    flexDirection: "row",
    gap: mobileSpacing.small,
    minHeight: 88,
    padding: mobileSpacing.medium,
  },
  pressed: { backgroundColor: mobileColors.surfaceRaised },
  itemCopy: { flex: 1, gap: mobileSpacing.xSmall },
  itemTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: mobileSpacing.small,
  },
  unreadDot: {
    backgroundColor: mobileColors.live,
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  itemTitle: {
    color: mobileColors.textPrimary,
    flexShrink: 1,
    fontSize: 15,
    fontWeight: "700",
  },
  itemBody: { color: mobileColors.textSecondary, fontSize: 14, lineHeight: 20 },
  itemMeta: {
    color: mobileColors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  empty: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    gap: mobileSpacing.small,
    padding: mobileSpacing.large,
  },
  failure: {
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.medium,
    padding: mobileSpacing.small,
  },
  detailContent: { flexGrow: 1, padding: mobileSpacing.medium },
  detailCard: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.large,
    borderWidth: 1,
    gap: mobileSpacing.medium,
    padding: mobileSpacing.large,
  },
  openButton: {
    alignItems: "center",
    backgroundColor: mobileColors.textPrimary,
    borderRadius: mobileRadii.medium,
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  openButtonText: {
    color: mobileColors.background,
    fontSize: 14,
    fontWeight: "700",
  },
  retryButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.small,
  },
});
