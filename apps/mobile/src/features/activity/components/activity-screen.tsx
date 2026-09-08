import type { ActivityItem } from "@streamfusion/core/activity";
import {
  Bell,
  BriefcaseBusiness,
  ChevronRight,
  CircleAlert,
} from "lucide-react-native";
import { memo, useEffect } from "react";
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import type { ActivityFilter } from "@mobile/features/storage/capabilities/persistence";
import {
  mobileColors,
  mobileRadii,
  mobileSizing,
  mobileSpacing,
} from "@mobile/design/tokens";
import type { ActivityViewModel } from "@mobile/features/activity/components/activity-controller";
import type { ShellLocation } from "@mobile/features/shell/domain/shell-navigation";

import {
  presentActivityItem,
  type ActivityVisualKind,
} from "../domain/activity-presentation";

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
        <ActivityEmptyState
          isRefreshing={model.isRefreshing}
          onRefresh={onRefresh}
          status={model.status}
        />
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
          <ActivityAvailabilityNotice
            hasItems={model.items.length > 0}
            isRefreshing={model.isRefreshing}
            onRefresh={onRefresh}
            status={model.status}
          />
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
            <MarkAllReadButton
              disabled={
                model.unreadCount === 0 ||
                model.isMarkingAllRead ||
                model.isRefreshing
              }
              isMarkingAllRead={model.isMarkingAllRead}
              onMarkAllRead={onMarkAllRead}
            />
          </View>
        </View>
      }
      renderItem={({ item }) => <ActivityRow item={item} onOpen={onOpen} />}
      testID="activity-list"
    />
  );
}

const ActivityRow = memo(function ActivityRow({
  item,
  onOpen,
}: {
  readonly item: ActivityItem;
  readonly onOpen: (location: ShellLocation) => void;
}) {
  const presentation = presentActivityItem(item);
  const read = item.readAt !== null;
  return (
    <Pressable
      accessibilityHint="Opens this Activity item"
      accessibilityLabel={`${read ? "Read" : "Unread"} ${presentation.kindLabel} ${item.title}. ${presentation.provenanceLabel}. Activity event ${presentation.eventIdentity}.`}
      accessibilityRole="button"
      onPress={() =>
        onOpen({ route: "activity/alert-preview", eventId: item.eventId })
      }
      style={({ pressed }) => [styles.item, pressed ? styles.pressed : null]}
      testID={`activity-item-${item.eventId}`}
    >
      <ActivityVisual visual={presentation.visual} />
      <View style={styles.itemCopy}>
        <View style={styles.itemTitleRow}>
          {!read ? (
            <View accessibilityLabel="Unread" style={styles.unreadDot} />
          ) : null}
          <Text selectable style={styles.itemTitle}>
            {item.title}
          </Text>
        </View>
        <Text numberOfLines={2} selectable style={styles.itemBody}>
          {item.body}
        </Text>
        <Text selectable style={styles.itemMeta}>
          {`${read ? "Read" : "Unread"} · ${presentation.provenanceLabel} · ${activityDateFormat.format(new Date(item.occurredAt))}`}
        </Text>
      </View>
      <ChevronRight
        accessibilityElementsHidden
        color={mobileColors.textSecondary}
        size={mobileSizing.icon}
        style={styles.itemChevron}
      />
    </Pressable>
  );
});

function ActivityVisual({ visual }: { readonly visual: ActivityVisualKind }) {
  const Icon =
    visual === "channel"
      ? Bell
      : visual === "job"
        ? BriefcaseBusiness
        : CircleAlert;
  return (
    <View accessibilityElementsHidden style={styles.itemVisual}>
      <Icon color={mobileColors.textCategory} size={mobileSizing.icon} />
    </View>
  );
}

function MarkAllReadButton({
  disabled,
  isMarkingAllRead,
  onMarkAllRead,
}: {
  readonly disabled: boolean;
  readonly isMarkingAllRead: boolean;
  readonly onMarkAllRead: () => Promise<void>;
}) {
  return (
    <Pressable
      accessibilityLabel="Mark all Activity read"
      accessibilityRole="button"
      accessibilityState={{ busy: isMarkingAllRead, disabled }}
      disabled={disabled}
      onPress={() => void onMarkAllRead()}
      style={[
        styles.markAllButton,
        disabled ? styles.markAllButtonDisabled : null,
      ]}
      testID="activity-mark-all-read"
    >
      <Text
        selectable
        style={[
          styles.markAllText,
          disabled ? styles.markAllTextDisabled : null,
        ]}
      >
        {isMarkingAllRead ? "Marking all read" : "Mark all read"}
      </Text>
    </Pressable>
  );
}

function ActivityAvailabilityNotice({
  hasItems,
  isRefreshing,
  onRefresh,
  status,
}: {
  readonly hasItems: boolean;
  readonly isRefreshing: boolean;
  readonly onRefresh: () => Promise<void>;
  readonly status: ActivityViewModel["status"];
}) {
  if (!hasItems || (status !== "unavailable" && !isRefreshing)) return null;
  const unavailable = status === "unavailable" && !isRefreshing;
  return (
    <View style={styles.availability} testID="activity-availability">
      <Text accessibilityLiveRegion="polite" selectable style={styles.itemBody}>
        {unavailable
          ? "Saved Activity remains visible, but the inbox could not refresh."
          : "Refreshing saved Activity."}
      </Text>
      {unavailable ? (
        <Pressable
          accessibilityLabel="Try refreshing Activity again"
          accessibilityRole="button"
          accessibilityState={{ busy: false, disabled: false }}
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

function ActivityEmptyState({
  isRefreshing,
  onRefresh,
  status,
}: {
  readonly isRefreshing: boolean;
  readonly onRefresh: () => Promise<void>;
  readonly status: ActivityViewModel["status"];
}) {
  return (
    <View style={styles.empty} testID="activity-empty-state">
      <Text
        accessibilityLiveRegion="polite"
        selectable
        style={styles.itemTitle}
      >
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
          accessibilityState={{ busy: isRefreshing, disabled: isRefreshing }}
          disabled={isRefreshing}
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
  isMarkingRead,
  items,
  mutationFailure,
  onMarkRead,
  onOpen,
}: {
  readonly eventId: string;
  readonly isMarkingRead: boolean;
  readonly items: readonly ActivityItem[];
  readonly mutationFailure: ActivityViewModel["mutationFailure"];
  readonly onMarkRead: (eventId: string) => Promise<void>;
  readonly onOpen: (location: ShellLocation) => void;
}) {
  const item = items.find((candidate) => candidate.eventId === eventId);
  const presentation = item ? presentActivityItem(item) : null;
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
            {`${presentation?.provenanceLabel} · ${activityDateFormat.format(new Date(item.occurredAt))}`}
          </Text>
          <Text selectable style={styles.itemMeta}>
            {`Activity event ${presentation?.eventIdentity} · ${item.readAt === null ? "Unread" : "Read"}`}
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
              accessibilityState={{
                busy: isMarkingRead,
                disabled: isMarkingRead,
              }}
              disabled={isMarkingRead}
              onPress={() => void onMarkRead(item.eventId)}
              style={styles.retryButton}
              testID="activity-retry-mark-read"
            >
              <Text selectable style={styles.markAllText}>
                {isMarkingRead ? "Marking read" : "Try marking read again"}
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
  markAllButtonDisabled: { opacity: 0.5 },
  markAllText: {
    color: mobileColors.textPrimary,
    fontSize: 13,
    fontWeight: "600",
  },
  markAllTextDisabled: { color: mobileColors.textSecondary },
  item: {
    alignItems: "flex-start",
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
  itemVisual: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    minWidth: mobileSizing.minimumTouchTarget,
  },
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
  itemChevron: { marginTop: mobileSpacing.small },
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
  availability: {
    backgroundColor: mobileColors.surfaceMuted,
    borderRadius: mobileRadii.medium,
    gap: mobileSpacing.small,
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
