import type {
  ActivityItem,
  SerializedTimestamp,
} from "@streamfusion/core/activity";

import type { ActivityRepository } from "@mobile/capabilities/persistence";

export type ActivityMutationResult<T> =
  { readonly kind: "saved"; readonly value: T } | { readonly kind: "failed" };

export async function markActivityReadSafely(
  repository: ActivityRepository,
  eventId: string,
  readAt: SerializedTimestamp,
): Promise<ActivityMutationResult<ActivityItem | null>> {
  try {
    return { kind: "saved", value: await repository.markRead(eventId, readAt) };
  } catch {
    return { kind: "failed" };
  }
}

export async function markAllActivityReadSafely(
  repository: ActivityRepository,
  readAt: SerializedTimestamp,
): Promise<ActivityMutationResult<number>> {
  try {
    return { kind: "saved", value: await repository.markAllRead(readAt) };
  } catch {
    return { kind: "failed" };
  }
}

export async function recordActivitySafely(
  repository: ActivityRepository,
  item: ActivityItem,
): Promise<ActivityMutationResult<ActivityItem>> {
  try {
    return {
      kind: "saved",
      value: (await repository.record(item)).item,
    };
  } catch {
    return { kind: "failed" };
  }
}
