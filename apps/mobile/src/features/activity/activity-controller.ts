import {
  toSerializedTimestamp,
  type ActivityItem,
  type SystemActivityItem,
} from "@streamfusion/core/activity";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import type {
  ActivityFilter,
  ActivityRepository,
} from "@mobile/capabilities/persistence";

import {
  markActivityReadSafely,
  markAllActivityReadSafely,
  recordActivitySafely,
} from "./activity-operations";

export interface ActivityViewModel {
  readonly allItems: readonly ActivityItem[];
  readonly filter: ActivityFilter;
  readonly items: readonly ActivityItem[];
  readonly mutationFailure: "record" | "mark-read" | "mark-all" | null;
  readonly status: "loading" | "ready" | "unavailable";
  readonly unreadCount: number;
}

export function createStorageCheckActivityItem(
  nowMs: number,
): SystemActivityItem {
  return {
    schemaVersion: 1,
    eventId: "device:native-storage-check:v1",
    kind: "system",
    event: "device-health",
    source: "local",
    occurredAt: toSerializedTimestamp(new Date(nowMs).toISOString()),
    readAt: null,
    title: "Storage check finished",
    body: "Open Diagnostics to review the latest on-device storage result.",
    destination: { kind: "diagnostics" },
  };
}

export function useActivityController(options: {
  readonly now?: () => number;
  readonly repository: ActivityRepository;
}): {
  readonly markAllRead: () => Promise<void>;
  readonly markRead: (eventId: string) => Promise<void>;
  readonly model: ActivityViewModel;
  readonly recordStorageCheck: () => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly selectFilter: (filter: ActivityFilter) => void;
} {
  const now = options.now ?? Date.now;
  const [allItems, setAllItems] = useState<readonly ActivityItem[]>([]);
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [status, setStatus] = useState<ActivityViewModel["status"]>("loading");
  const [mutationFailure, setMutationFailure] =
    useState<ActivityViewModel["mutationFailure"]>(null);

  const refresh = useCallback(async () => {
    try {
      setAllItems(await options.repository.list());
      setStatus("ready");
    } catch {
      setStatus("unavailable");
    }
  }, [options.repository]);

  useEffect(() => {
    let active = true;
    void options.repository
      .list()
      .then((items) => {
        if (!active) return;
        setAllItems(items);
        setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("unavailable");
      });
    return () => {
      active = false;
    };
  }, [options.repository]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") void refresh();
    });
    return () => subscription.remove();
  }, [refresh]);

  const markRead = useCallback(
    async (eventId: string) => {
      const result = await markActivityReadSafely(
        options.repository,
        eventId,
        toSerializedTimestamp(new Date(now()).toISOString()),
      );
      if (result.kind === "failed") {
        setMutationFailure("mark-read");
        return;
      }
      const item = result.value;
      if (!item) return;
      setAllItems((items) =>
        items.map((candidate) =>
          candidate.eventId === item.eventId ? item : candidate,
        ),
      );
      setMutationFailure(null);
    },
    [now, options.repository],
  );

  const markAllRead = useCallback(async () => {
    const readAt = toSerializedTimestamp(new Date(now()).toISOString());
    const result = await markAllActivityReadSafely(options.repository, readAt);
    if (result.kind === "saved") {
      setAllItems((items) =>
        items.map((item) =>
          item.readAt === null ? { ...item, readAt } : item,
        ),
      );
      setMutationFailure(null);
    } else {
      setMutationFailure("mark-all");
    }
  }, [now, options.repository]);

  const recordStorageCheck = useCallback(async () => {
    const result = await recordActivitySafely(
      options.repository,
      createStorageCheckActivityItem(now()),
    );
    if (result.kind === "saved") {
      setMutationFailure(null);
      await refresh();
    } else {
      setMutationFailure("record");
    }
  }, [now, options.repository, refresh]);

  const items = useMemo(() => {
    if (filter === "channels")
      return allItems.filter((item) => item.kind === "channel");
    if (filter === "jobs")
      return allItems.filter((item) => item.kind === "job");
    return allItems;
  }, [allItems, filter]);

  return {
    markAllRead,
    markRead,
    model: {
      allItems,
      filter,
      items,
      mutationFailure,
      status,
      unreadCount: allItems.filter((item) => item.readAt === null).length,
    },
    recordStorageCheck,
    refresh,
    selectFilter: setFilter,
  };
}
