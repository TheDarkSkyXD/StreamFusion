import {
  hasOnlyKeys,
  isRecord,
  isSerializedTimestamp,
  isString,
  type ContractSchema,
  type SerializedTimestamp,
} from "../foundations/contract-schema.ts";
import type { Platform } from "../platform/index.ts";

export type { SerializedTimestamp };
export { toSerializedTimestamp } from "../foundations/contract-schema.ts";

export const ACTIVITY_ITEM_SCHEMA_VERSION = 1 as const;
export const DEFAULT_ACTIVITY_RETENTION = {
  maximumCompletedAgeMs: 90 * 24 * 60 * 60 * 1_000,
  maximumCompletedItems: 2_000,
} as const;

export type ActivityDeliverySource = "local" | "relay";

export interface ActivityChannelIdentity {
  readonly platform: Platform;
  readonly id: string;
  readonly login: string;
  readonly displayName: string;
}

export type ChannelActivityDestination = {
  readonly kind: "watch-channel";
  readonly platform: Platform;
  readonly channelId: string;
  readonly channelLogin: string;
};

export type JobActivityDestination = {
  readonly kind: "media-job";
  readonly jobId: string;
};

export type SystemActivityDestination =
  { readonly kind: "diagnostics" } | { readonly kind: "accounts" } | null;

interface ActivityItemBase {
  readonly schemaVersion: typeof ACTIVITY_ITEM_SCHEMA_VERSION;
  readonly eventId: string;
  readonly source: ActivityDeliverySource;
  readonly occurredAt: SerializedTimestamp;
  readonly readAt: SerializedTimestamp | null;
  readonly title: string;
  readonly body: string;
}

export type ChannelActivityItem = ActivityItemBase & {
  readonly kind: "channel";
  readonly event: "live-alert" | "moderation-result";
  readonly channel: ActivityChannelIdentity;
  readonly destination: ChannelActivityDestination;
};

export type JobActivityItem = ActivityItemBase & {
  readonly kind: "job";
  readonly job: {
    readonly id: string;
    readonly state: { readonly kind: "active" } | { readonly kind: "terminal" };
  };
  readonly destination: JobActivityDestination;
};

export type SystemActivityItem = ActivityItemBase & {
  readonly kind: "system";
  readonly event: "device-health" | "update" | "account-maintenance";
  readonly destination: SystemActivityDestination;
};

export type ActivityItem =
  ChannelActivityItem | JobActivityItem | SystemActivityItem;

const BASE_KEYS = [
  "schemaVersion",
  "eventId",
  "kind",
  "source",
  "occurredAt",
  "readAt",
  "title",
  "body",
] as const;

export const activityItemSchema: ContractSchema<ActivityItem> = {
  is: isActivityItem,
};

function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.length > 0;
}

const identifierPattern = /^[a-zA-Z0-9._:-]{1,256}$/u;
const channelLoginPattern = /^[a-zA-Z0-9_-]{1,64}$/u;

function isIdentifier(value: unknown): value is string {
  return isString(value) && identifierPattern.test(value);
}

function isChannelLogin(value: unknown): value is string {
  return isString(value) && channelLoginPattern.test(value);
}

function isPlatform(value: unknown): value is Platform {
  return value === "twitch" || value === "kick";
}

function hasValidBase(value: Readonly<Record<string, unknown>>): boolean {
  return (
    value.schemaVersion === ACTIVITY_ITEM_SCHEMA_VERSION &&
    isIdentifier(value.eventId) &&
    (value.source === "local" || value.source === "relay") &&
    isSerializedTimestamp(value.occurredAt) &&
    (value.readAt === null || isSerializedTimestamp(value.readAt)) &&
    isNonEmptyString(value.title) &&
    isString(value.body)
  );
}

function isChannelIdentity(value: unknown): value is ActivityChannelIdentity {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["platform", "id", "login", "displayName"]) &&
    isPlatform(value.platform) &&
    isIdentifier(value.id) &&
    isChannelLogin(value.login) &&
    isNonEmptyString(value.displayName)
  );
}

function isChannelDestination(
  value: unknown,
): value is ChannelActivityDestination {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["kind", "platform", "channelId", "channelLogin"]) &&
    value.kind === "watch-channel" &&
    isPlatform(value.platform) &&
    isIdentifier(value.channelId) &&
    isChannelLogin(value.channelLogin)
  );
}

function isJobState(value: unknown): value is JobActivityItem["job"]["state"] {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["kind"]) &&
    (value.kind === "active" || value.kind === "terminal")
  );
}

function isJob(value: unknown): value is JobActivityItem["job"] {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["id", "state"]) &&
    isIdentifier(value.id) &&
    isJobState(value.state)
  );
}

function isJobDestination(value: unknown): value is JobActivityDestination {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["kind", "jobId"]) &&
    value.kind === "media-job" &&
    isIdentifier(value.jobId)
  );
}

function isSystemDestination(
  value: unknown,
): value is SystemActivityDestination {
  return (
    value === null ||
    (isRecord(value) &&
      hasOnlyKeys(value, ["kind"]) &&
      (value.kind === "diagnostics" || value.kind === "accounts"))
  );
}

function isActivityItem(value: unknown): value is ActivityItem {
  if (!isRecord(value) || !hasValidBase(value)) return false;

  if (value.kind === "channel") {
    if (
      !hasOnlyKeys(value, [...BASE_KEYS, "event", "channel", "destination"]) ||
      (value.event !== "live-alert" && value.event !== "moderation-result") ||
      !isChannelIdentity(value.channel) ||
      !isChannelDestination(value.destination)
    ) {
      return false;
    }
    return (
      value.channel.platform === value.destination.platform &&
      value.channel.id === value.destination.channelId &&
      value.channel.login === value.destination.channelLogin
    );
  }

  if (value.kind === "job") {
    return (
      hasOnlyKeys(value, [...BASE_KEYS, "job", "destination"]) &&
      isJob(value.job) &&
      isJobDestination(value.destination) &&
      value.job.id === value.destination.jobId
    );
  }

  if (value.kind === "system") {
    return (
      hasOnlyKeys(value, [...BASE_KEYS, "event", "destination"]) &&
      (value.event === "device-health" ||
        value.event === "update" ||
        value.event === "account-maintenance") &&
      isSystemDestination(value.destination)
    );
  }

  return false;
}

export function markActivityItemRead(
  item: ActivityItem,
  readAt: SerializedTimestamp,
): ActivityItem {
  return item.readAt === null ? { ...item, readAt } : item;
}

export function reconcileActivityItem(
  existing: ActivityItem,
  incoming: ActivityItem,
): ActivityItem {
  if (existing.eventId !== incoming.eventId) {
    throw new Error(
      "Activity reconciliation requires the same event identity.",
    );
  }
  if (existing.kind !== incoming.kind) {
    throw new Error(
      "An Activity event cannot change kind during reconciliation.",
    );
  }
  const readAt = null;
  switch (incoming.kind) {
    case "channel":
      if (existing.kind !== "channel")
        throw new Error("Activity kind mismatch.");
      return { ...incoming, occurredAt: existing.occurredAt, readAt };
    case "job":
      if (existing.kind !== "job") throw new Error("Activity kind mismatch.");
      return { ...incoming, occurredAt: existing.occurredAt, readAt };
    case "system":
      if (existing.kind !== "system")
        throw new Error("Activity kind mismatch.");
      return { ...incoming, occurredAt: existing.occurredAt, readAt };
  }
}

export function selectRetainedActivityEventIds(
  items: readonly ActivityItem[],
  policy: {
    readonly nowMs: number;
    readonly maximumCompletedItems?: number;
    readonly maximumCompletedAgeMs?: number;
  },
): string[] {
  const maximumCompletedItems =
    policy.maximumCompletedItems ??
    DEFAULT_ACTIVITY_RETENTION.maximumCompletedItems;
  const maximumCompletedAgeMs =
    policy.maximumCompletedAgeMs ??
    DEFAULT_ACTIVITY_RETENTION.maximumCompletedAgeMs;
  const byNewest = (left: ActivityItem, right: ActivityItem) =>
    Date.parse(right.occurredAt) - Date.parse(left.occurredAt) ||
    left.eventId.localeCompare(right.eventId);
  const activeJobs = items
    .filter(
      (item): item is JobActivityItem =>
        item.kind === "job" && item.job.state.kind === "active",
    )
    .sort(byNewest);
  const completed = items
    .filter(
      (item) =>
        !(item.kind === "job" && item.job.state.kind === "active") &&
        policy.nowMs - Date.parse(item.occurredAt) <= maximumCompletedAgeMs,
    )
    .sort(byNewest)
    .slice(0, maximumCompletedItems);
  const seen = new Set<string>();
  return [...activeJobs, ...completed]
    .filter((item) => {
      if (seen.has(item.eventId)) return false;
      seen.add(item.eventId);
      return true;
    })
    .map((item) => item.eventId);
}
