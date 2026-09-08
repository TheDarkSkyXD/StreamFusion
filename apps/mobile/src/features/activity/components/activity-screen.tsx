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
import type { DevelopmentActivityProofViewModel } from "@mobile/features/activity/capabilities/development-activity-proof";
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

function isCompletedActivity(item: ActivityItem): boolean {
  return item.kind !== "job" || item.job.state.kind === "terminal";
}

export function ActivityScreen({
  developmentProof,
  model,
  onCancelDismissal,
  onConfirmDismissal,
  onDismissVisibleCompleted,
  onExitDevelopmentProof,
  onRetryDevelopmentProof,
  onMarkAllRead,
  onOpen,
  onRefresh,
  onSelectFilter,
}: {
  readonly developmentProof?: DevelopmentActivityProofViewModel | null;
  readonly model: ActivityViewModel;
  readonly onCancelDismissal: () => void;
  readonly onConfirmDismissal: () => Promise<void>;
  readonly onDismissVisibleCompleted: () => void;
  readonly onExitDevelopmentProof?: () => Promise<void>;
  readonly onRetryDevelopmentProof?: () => Promise<void>;
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
          <DevelopmentActivityProofBanner
            model={developmentProof ?? null}
            {...(onExitDevelopmentProof ? { onExit: onExitDevelopmentProof } : {})}
            {...(onRetryDevelopmentProof ? { onRetry: onRetryDevelopmentProof } : {})}
          />
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
          <ClearCompletedButton
            disabled={
              model.allItems.every((item) => !isCompletedActivity(item)) ||
              model.isDismissing ||
              model.isRefreshing
            }
            isDismissing={model.isDismissing}
            onDismissVisibleCompleted={onDismissVisibleCompleted}
          />
          <DismissalStatus
            model={model}
            onCancel={onCancelDismissal}
            onConfirm={onConfirmDismissal}
          />
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

function ClearCompletedButton({
  disabled,
  isDismissing,
  onDismissVisibleCompleted,
}: {
  readonly disabled: boolean;
  readonly isDismissing: boolean;
  readonly onDismissVisibleCompleted: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel="Clear completed Activity"
      accessibilityRole="button"
      accessibilityState={{ busy: isDismissing, disabled }}
      disabled={disabled}
      onPress={onDismissVisibleCompleted}
      style={[
        styles.clearCompletedButton,
        disabled ? styles.disabledButton : null,
      ]}
      testID="activity-clear-completed"
    >
      <Text selectable style={styles.markAllText}>
        {isDismissing
          ? "Clearing completed Activity"
          : "Clear completed Activity"}
      </Text>
    </Pressable>
  );
}

function DismissalStatus({
  model,
  onCancel,
  onConfirm,
}: {
  readonly model: Pick<
    ActivityViewModel,
    | "dismissalConfirmation"
    | "dismissalFailure"
    | "dismissalResult"
    | "isDismissing"
  >;
  readonly onCancel: () => void;
  readonly onConfirm: () => Promise<void>;
}) {
  const confirmation = model.dismissalConfirmation;
  if (confirmation) {
    const count = confirmation.eventIds.length;
    return (
      <View
        style={styles.confirmation}
        testID="activity-dismissal-confirmation"
      >
        <Text
          accessibilityLiveRegion="polite"
          selectable
          style={styles.itemBody}
        >
          {confirmation.kind === "clear-completed"
            ? `Hide ${count} completed Activity ${count === 1 ? "item" : "items"} across all Activity tabs? Active jobs stay visible. This does not cancel jobs or change Android notifications.`
            : "Hide this completed Activity item? This does not cancel work or change Android notifications."}
        </Text>
        {model.dismissalFailure ? (
          <Text
            accessibilityLiveRegion="polite"
            selectable
            style={styles.itemBody}
          >
            Activity could not save that dismissal. Try again or cancel.
          </Text>
        ) : null}
        <View style={styles.confirmationActions}>
          <Pressable
            accessibilityLabel="Cancel Activity dismissal"
            accessibilityRole="button"
            accessibilityState={{ busy: false, disabled: model.isDismissing }}
            disabled={model.isDismissing}
            onPress={onCancel}
            style={styles.cancelButton}
            testID="activity-dismissal-cancel"
          >
            <Text selectable style={styles.markAllText}>
              Cancel
            </Text>
          </Pressable>
          <Pressable
            accessibilityLabel="Confirm Activity dismissal"
            accessibilityRole="button"
            accessibilityState={{
              busy: model.isDismissing,
              disabled: model.isDismissing,
            }}
            disabled={model.isDismissing}
            onPress={() => void onConfirm()}
            style={styles.openButton}
            testID="activity-dismissal-confirm"
          >
            <Text selectable style={styles.openButtonText}>
              {model.isDismissing
                ? "Hiding Activity"
                : "Hide completed Activity"}
            </Text>
          </Pressable>
        </View>
      </View>
    );
  }
  if (!model.dismissalResult) return null;
  const { activeCount, alreadyDismissedCount, dismissedCount, missingCount } =
    model.dismissalResult;
  return (
    <Text
      accessibilityLiveRegion="polite"
      selectable
      style={styles.itemBody}
      testID="activity-dismissal-result"
    >
      {`Hidden ${dismissedCount} completed ${dismissedCount === 1 ? "item" : "items"}.${alreadyDismissedCount > 0 ? ` ${alreadyDismissedCount} ${alreadyDismissedCount === 1 ? "item was" : "items were"} already hidden.` : ""}${activeCount > 0 ? ` Kept ${activeCount} active ${activeCount === 1 ? "job" : "jobs"}.` : ""}${missingCount > 0 ? ` ${missingCount} ${missingCount === 1 ? "item was" : "items were"} no longer available.` : ""}`}
    </Text>
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
  developmentProof,
  dismissalConfirmation,
  dismissalFailure,
  dismissalResult,
  eventId,
  isDismissing,
  isMarkingRead,
  items,
  mutationFailure,
  onMarkRead,
  onDismissItem,
  onExitDevelopmentProof,
  onRetryDevelopmentProof,
  onCancelDismissal,
  onConfirmDismissal,
  onOpen,
}: {
  readonly developmentProof?: DevelopmentActivityProofViewModel | null;
  readonly dismissalConfirmation: ActivityViewModel["dismissalConfirmation"];
  readonly dismissalFailure: ActivityViewModel["dismissalFailure"];
  readonly dismissalResult: ActivityViewModel["dismissalResult"];
  readonly eventId: string;
  readonly isDismissing: boolean;
  readonly isMarkingRead: boolean;
  readonly items: readonly ActivityItem[];
  readonly mutationFailure: ActivityViewModel["mutationFailure"];
  readonly onMarkRead: (eventId: string) => Promise<void>;
  readonly onDismissItem: (eventId: string) => void;
  readonly onExitDevelopmentProof?: () => Promise<void>;
  readonly onRetryDevelopmentProof?: () => Promise<void>;
  readonly onCancelDismissal: () => void;
  readonly onConfirmDismissal: () => Promise<void>;
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
          {isCompletedActivity(item) ? (
            <Pressable
              accessibilityLabel="Dismiss Activity item"
              accessibilityRole="button"
              accessibilityState={{
                busy: isDismissing,
                disabled: isDismissing,
              }}
              disabled={isDismissing}
              onPress={() => onDismissItem(item.eventId)}
              style={styles.dismissButton}
              testID="activity-dismiss-item"
            >
              <Text selectable style={styles.markAllText}>
                Dismiss from Activity
              </Text>
            </Pressable>
          ) : (
            <Text
              selectable
              style={styles.itemBody}
              testID="activity-active-job-dismissal-note"
            >
              Active jobs stay in Activity until terminal reconciliation.
            </Text>
          )}
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
      <DevelopmentActivityProofBanner
        model={developmentProof ?? null}
        {...(onExitDevelopmentProof ? { onExit: onExitDevelopmentProof } : {})}
        {...(onRetryDevelopmentProof ? { onRetry: onRetryDevelopmentProof } : {})}
      />
      <DismissalStatus
        model={{
          dismissalConfirmation,
          dismissalFailure,
          dismissalResult,
          isDismissing,
        }}
        onCancel={onCancelDismissal}
        onConfirm={onConfirmDismissal}
      />
    </ScrollView>
  );
}

function DevelopmentActivityProofBanner({
  model,
  onExit,
  onRetry,
}: {
  readonly model: DevelopmentActivityProofViewModel | null;
  readonly onExit?: () => Promise<void>;
  readonly onRetry?: () => Promise<void>;
}) {
  if ((model?.kind !== "proof" && model?.kind !== "cleanup-required") ||
    (!onExit && !onRetry)) return null;
  return (
    <View style={styles.proofBanner} testID="activity-proof-banner">
      <Text selectable style={styles.itemBody}>
        {model.kind === "cleanup-required" && !model.selected
          ? `Pending isolated Activity proof ${model.namespace}. Main Activity is selected. ${model.detail}`
          : `Isolated Activity proof ${model.namespace}. ${model.detail}`}
      </Text>
      {model.kind === "proof" && onExit ? (
        <Pressable
          accessibilityLabel="Exit isolated Activity proof"
          accessibilityRole="button"
          accessibilityState={{ busy: false, disabled: false }}
          onPress={() => void onExit()}
          style={styles.retryButton}
          testID="exit-activity-proof"
        >
          <Text selectable style={styles.markAllText}>
            Exit isolated Activity proof
          </Text>
        </Pressable>
      ) : null}
      {model.kind === "cleanup-required" && onRetry ? (
        <Pressable
          accessibilityLabel="Retry isolated Activity cleanup"
          accessibilityRole="button"
          accessibilityState={{ busy: false, disabled: false }}
          onPress={() => void onRetry()}
          style={styles.retryButton}
          testID="retry-activity-proof-cleanup"
        >
          <Text selectable style={styles.markAllText}>
            Retry isolated Activity cleanup
          </Text>
        </Pressable>
      ) : null}
    </View>
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
  proofBanner: {
    backgroundColor: mobileColors.surfaceRaised,
    borderRadius: mobileRadii.medium,
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
  clearCompletedButton: {
    alignSelf: "flex-start",
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.small,
  },
  confirmation: {
    backgroundColor: mobileColors.surface,
    borderColor: mobileColors.border,
    borderRadius: mobileRadii.medium,
    borderWidth: 1,
    gap: mobileSpacing.small,
    padding: mobileSpacing.medium,
  },
  confirmationActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: mobileSpacing.small,
  },
  cancelButton: {
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
  disabledButton: { opacity: 0.5 },
  dismissButton: {
    alignSelf: "flex-start",
    justifyContent: "center",
    minHeight: mobileSizing.minimumTouchTarget,
    paddingHorizontal: mobileSpacing.medium,
  },
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
