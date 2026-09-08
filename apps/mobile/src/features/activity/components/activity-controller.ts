import {
  toSerializedTimestamp,
  type SystemActivityItem,
} from "@streamfusion/core/activity";
import { useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import type {
  ActivityFilter,
  ActivityRepository,
} from "@mobile/features/storage/capabilities/persistence";

import type { ActivityInboxViewModel } from "../domain/activity-inbox-workflow";
import { createActivityInboxLifecycle } from "../domain/activity-inbox-lifecycle";

export type ActivityViewModel = ActivityInboxViewModel;

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
  const lifecycle = useMemo(
    () => createActivityInboxLifecycle({ now, repository: options.repository }),
    [now, options.repository],
  );
  const [model, setModel] = useState<ActivityViewModel>(() =>
    lifecycle.snapshot(),
  );

  useEffect(() => {
    return lifecycle.attach(setModel);
  }, [lifecycle]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") void lifecycle.refresh();
    });
    return () => subscription.remove();
  }, [lifecycle]);

  return {
    markAllRead: lifecycle.markAllRead,
    markRead: lifecycle.markRead,
    model,
    recordStorageCheck: () =>
      lifecycle.record(createStorageCheckActivityItem(now())),
    refresh: lifecycle.refresh,
    selectFilter: lifecycle.selectFilter,
  };
}
