import {
  toSerializedTimestamp,
  type ActivityItem,
  type SerializedTimestamp,
} from "@streamfusion/core/activity";

import type {
  ActivityFilter,
  ActivityRepository,
} from "@mobile/features/storage/capabilities/persistence";

import {
  dismissCompletedActivitySafely,
  markActivityReadSafely,
  markAllActivityReadSafely,
  recordActivitySafely,
} from "./activity-operations";

export type ActivityDismissalConfirmation =
  | {
      readonly eventIds: readonly string[];
      readonly kind: "clear-completed";
    }
  | {
      readonly eventIds: readonly [string];
      readonly kind: "dismiss-item";
    };

export interface ActivityInboxViewModel {
  readonly allItems: readonly ActivityItem[];
  readonly filter: ActivityFilter;
  readonly dismissalConfirmation: ActivityDismissalConfirmation | null;
  readonly dismissalFailure: boolean;
  readonly dismissalResult: {
    readonly activeCount: number;
    readonly alreadyDismissedCount: number;
    readonly dismissedCount: number;
    readonly missingCount: number;
  } | null;
  readonly isDismissing: boolean;
  readonly isMarkingAllRead: boolean;
  readonly isRefreshing: boolean;
  readonly items: readonly ActivityItem[];
  readonly markingReadEventIds: readonly string[];
  readonly mutationFailure: "record" | "mark-read" | "mark-all" | null;
  readonly status: "loading" | "ready" | "unavailable";
  readonly unreadCount: number;
}

export interface ActivityInboxWorkflow {
  cancelDismissal(): void;
  confirmDismissal(): Promise<void>;
  dispose(): void;
  dismissItem(eventId: string): void;
  dismissAllCompleted(): void;
  markAllRead(): Promise<void>;
  markRead(eventId: string): Promise<void>;
  record(item: ActivityItem): Promise<void>;
  refresh(): Promise<void>;
  selectFilter(filter: ActivityFilter): void;
  snapshot(): ActivityInboxViewModel;
  subscribe(listener: (snapshot: ActivityInboxViewModel) => void): () => void;
}

type ActivityMutationFailure = ActivityInboxViewModel["mutationFailure"];

export const initialActivityInboxViewModel: ActivityInboxViewModel = {
  allItems: [],
  dismissalConfirmation: null,
  dismissalFailure: false,
  dismissalResult: null,
  filter: "all",
  isDismissing: false,
  isMarkingAllRead: false,
  isRefreshing: false,
  items: [],
  markingReadEventIds: [],
  mutationFailure: null,
  status: "loading",
  unreadCount: 0,
};

function projectSnapshot(input: {
  readonly allItems: readonly ActivityItem[];
  readonly dismissalConfirmation: ActivityDismissalConfirmation | null;
  readonly dismissalFailure: boolean;
  readonly dismissalResult: ActivityInboxViewModel["dismissalResult"];
  readonly filter: ActivityFilter;
  readonly isDismissing: boolean;
  readonly isMarkingAllRead: boolean;
  readonly isRefreshing: boolean;
  readonly markingReadEventIds: ReadonlySet<string>;
  readonly mutationFailure: ActivityMutationFailure;
  readonly status: ActivityInboxViewModel["status"];
}): ActivityInboxViewModel {
  const items =
    input.filter === "channels"
      ? input.allItems.filter((item) => item.kind === "channel")
      : input.filter === "jobs"
        ? input.allItems.filter((item) => item.kind === "job")
        : input.allItems;
  return {
    allItems: input.allItems,
    dismissalConfirmation: input.dismissalConfirmation,
    dismissalFailure: input.dismissalFailure,
    dismissalResult: input.dismissalResult,
    filter: input.filter,
    isDismissing: input.isDismissing,
    isMarkingAllRead: input.isMarkingAllRead,
    isRefreshing: input.isRefreshing,
    items,
    markingReadEventIds: [...input.markingReadEventIds],
    mutationFailure: input.mutationFailure,
    status: input.status,
    unreadCount: input.allItems.filter((item) => item.readAt === null).length,
  };
}

export function createActivityInboxWorkflow(options: {
  readonly now: () => number;
  readonly repository: ActivityRepository;
}): ActivityInboxWorkflow {
  let disposed = false;
  let listGeneration = 0;
  let state = initialActivityInboxViewModel;
  const listeners = new Set<(snapshot: ActivityInboxViewModel) => void>();

  const publish = (next: ActivityInboxViewModel) => {
    if (disposed) return;
    state = next;
    for (const listener of listeners) listener(state);
  };
  const update = (changes: Partial<ActivityInboxViewModel>) =>
    publish(
      projectSnapshot({
        allItems: changes.allItems ?? state.allItems,
        dismissalConfirmation: Object.hasOwn(changes, "dismissalConfirmation")
          ? (changes.dismissalConfirmation ?? null)
          : state.dismissalConfirmation,
        dismissalFailure: changes.dismissalFailure ?? state.dismissalFailure,
        dismissalResult: Object.hasOwn(changes, "dismissalResult")
          ? (changes.dismissalResult ?? null)
          : state.dismissalResult,
        filter: changes.filter ?? state.filter,
        isDismissing: changes.isDismissing ?? state.isDismissing,
        isMarkingAllRead: changes.isMarkingAllRead ?? state.isMarkingAllRead,
        isRefreshing: changes.isRefreshing ?? state.isRefreshing,
        markingReadEventIds: new Set(
          changes.markingReadEventIds ?? state.markingReadEventIds,
        ),
        mutationFailure: Object.hasOwn(changes, "mutationFailure")
          ? (changes.mutationFailure ?? null)
          : state.mutationFailure,
        status: changes.status ?? state.status,
      }),
    );
  const invalidateList = () => {
    listGeneration += 1;
    if (state.isRefreshing) update({ isRefreshing: false });
  };
  const unavailableAfterInvalidatedInitialLoad = () =>
    state.status === "loading" && state.allItems.length === 0
      ? "unavailable"
      : state.status;
  const timestamp = (): SerializedTimestamp =>
    toSerializedTimestamp(new Date(options.now()).toISOString());
  const isCompleted = (item: ActivityItem) =>
    item.kind !== "job" || item.job.state.kind === "terminal";

  const refresh = async () => {
    if (disposed) return;
    const generation = ++listGeneration;
    update({ isRefreshing: true });
    try {
      const allItems = await options.repository.list();
      if (disposed || generation !== listGeneration) return;
      update({ allItems, isRefreshing: false, status: "ready" });
    } catch {
      if (disposed || generation !== listGeneration) return;
      update({ isRefreshing: false, status: "unavailable" });
    }
  };

  const markAllRead = async () => {
    if (disposed || state.isMarkingAllRead) return;
    invalidateList();
    update({ isMarkingAllRead: true, mutationFailure: null });
    const result = await markAllActivityReadSafely(
      options.repository,
      timestamp(),
    );
    if (disposed) return;
    if (result.kind === "failed") {
      update({
        isMarkingAllRead: false,
        mutationFailure: "mark-all",
        status: unavailableAfterInvalidatedInitialLoad(),
      });
      return;
    }
    await refresh();
    if (disposed) return;
    update({ isMarkingAllRead: false });
  };

  const markRead = async (eventId: string) => {
    if (disposed || state.markingReadEventIds.includes(eventId)) return;
    invalidateList();
    update({
      markingReadEventIds: [...state.markingReadEventIds, eventId],
      mutationFailure: null,
    });
    const result = await markActivityReadSafely(
      options.repository,
      eventId,
      timestamp(),
    );
    if (disposed) return;
    if (result.kind === "failed") {
      update({
        markingReadEventIds: state.markingReadEventIds.filter(
          (id) => id !== eventId,
        ),
        mutationFailure: "mark-read",
        status: unavailableAfterInvalidatedInitialLoad(),
      });
      return;
    }
    await refresh();
    if (disposed) return;
    update({
      markingReadEventIds: state.markingReadEventIds.filter(
        (id) => id !== eventId,
      ),
    });
  };

  const record = async (item: ActivityItem) => {
    if (disposed) return;
    invalidateList();
    update({ mutationFailure: null });
    const result = await recordActivitySafely(options.repository, item);
    if (disposed) return;
    if (result.kind === "failed") {
      update({
        mutationFailure: "record",
        status: unavailableAfterInvalidatedInitialLoad(),
      });
      return;
    }
    await refresh();
  };

  const dismissItem = (eventId: string) => {
    if (disposed || state.isDismissing) return;
    const item = state.allItems.find(
      (candidate) => candidate.eventId === eventId,
    );
    if (!item || !isCompleted(item)) return;
    update({
      dismissalConfirmation: { eventIds: [eventId], kind: "dismiss-item" },
      dismissalFailure: false,
      dismissalResult: null,
    });
  };

  const dismissAllCompleted = () => {
    if (disposed || state.isDismissing) return;
    const eventIds = state.allItems
      .filter(isCompleted)
      .map((item) => item.eventId);
    if (eventIds.length === 0) return;
    update({
      dismissalConfirmation: { eventIds, kind: "clear-completed" },
      dismissalFailure: false,
      dismissalResult: null,
    });
  };

  const cancelDismissal = () => {
    if (disposed || state.isDismissing) return;
    update({ dismissalConfirmation: null, dismissalFailure: false });
  };

  const confirmDismissal = async () => {
    const confirmation = state.dismissalConfirmation;
    if (disposed || state.isDismissing || !confirmation) return;
    invalidateList();
    update({ isDismissing: true, dismissalFailure: false });
    const result = await dismissCompletedActivitySafely(
      options.repository,
      confirmation.eventIds,
      timestamp(),
    );
    if (disposed) return;
    if (result.kind === "failed") {
      update({
        dismissalFailure: true,
        isDismissing: false,
        status: unavailableAfterInvalidatedInitialLoad(),
      });
      return;
    }
    const hidden = new Set([
      ...result.value.dismissedEventIds,
      ...result.value.alreadyDismissedEventIds,
      ...result.value.missingEventIds,
    ]);
    update({
      allItems: state.allItems.filter((item) => !hidden.has(item.eventId)),
      dismissalConfirmation: null,
      dismissalFailure: false,
      dismissalResult: {
        activeCount: result.value.activeEventIds.length,
        alreadyDismissedCount: result.value.alreadyDismissedEventIds.length,
        dismissedCount: result.value.dismissedEventIds.length,
        missingCount: result.value.missingEventIds.length,
      },
    });
    await refresh();
    if (disposed) return;
    update({ isDismissing: false });
  };

  return {
    cancelDismissal,
    confirmDismissal,
    dispose() {
      disposed = true;
      listeners.clear();
    },
    dismissItem,
    dismissAllCompleted,
    markAllRead,
    markRead,
    record,
    refresh,
    selectFilter(filter) {
      update({ filter });
    },
    snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
