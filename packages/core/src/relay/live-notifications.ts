import {
  hasOnlyKeys,
  isRecord,
  isSerializedTimestamp,
  isString,
  type ContractSchema,
} from "../foundations/contract-schema.ts";
import type { Platform } from "../platform/index.ts";
export const LIVE_NOTIFICATION_PAYLOAD_SCHEMA_VERSION = 1 as const;
export type NotificationChannelId = "live" | "media" | "account-device";
export type LiveStreamState = "live" | "ended";

export type SafeNotificationDestination =
  | {
      readonly kind: "watch-channel";
      readonly platform: Platform;
      readonly channelId: string;
      readonly channelLogin: string;
      readonly streamState: LiveStreamState;
    }
  | { readonly kind: "media-job"; readonly jobId: string }
  | { readonly kind: "activity-item"; readonly eventId: string }
  | { readonly kind: "accounts" }
  | { readonly kind: "diagnostics" };

export type SafeNotificationPayload = {
  readonly schemaVersion: typeof LIVE_NOTIFICATION_PAYLOAD_SCHEMA_VERSION;
  readonly eventId: string;
  readonly sourceId: string;
  readonly channel: NotificationChannelId;
  readonly title: string;
  readonly body: string;
  readonly destination: SafeNotificationDestination;
  readonly occurredAt: string;
};

const identifierPattern = /^[a-zA-Z0-9._:-]{1,256}$/u;
const channelLoginPattern = /^[a-zA-Z0-9_-]{1,64}$/u;
const forbiddenKeyPattern =
  /^(access[_-]?token|authorization|credential|hls|password|playbackurl|secret|token|url)$/iu;
const CHANNEL_IDS = {
  live: true,
  media: true,
  "account-device": true,
} as const;

export const safeNotificationPayloadSchema: ContractSchema<SafeNotificationPayload> =
  { is: isSafeNotificationPayload };

function isSafeNotificationPayload(
  value: unknown,
): value is SafeNotificationPayload {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "schemaVersion",
      "eventId",
      "sourceId",
      "channel",
      "title",
      "body",
      "destination",
      "occurredAt",
    ]) &&
    value.schemaVersion === LIVE_NOTIFICATION_PAYLOAD_SCHEMA_VERSION &&
    isIdentifier(value.eventId) &&
    isIdentifier(value.sourceId) &&
    isChannelId(value.channel) &&
    isDisplayText(value.title) &&
    isDisplayText(value.body) &&
    isSafeDestination(value.destination) &&
    isSerializedTimestamp(value.occurredAt) &&
    !containsForbiddenMaterial(value)
  );
}

function isSafeDestination(
  value: unknown,
): value is SafeNotificationDestination {
  if (!isRecord(value) || !isString(value.kind)) return false;
  if (value.kind === "watch-channel") {
    return (
      hasOnlyKeys(value, [
        "kind",
        "platform",
        "channelId",
        "channelLogin",
        "streamState",
      ]) &&
      isPlatform(value.platform) &&
      isIdentifier(value.channelId) &&
      isChannelLogin(value.channelLogin) &&
      (value.streamState === "live" || value.streamState === "ended")
    );
  }
  if (value.kind === "media-job") {
    return hasOnlyKeys(value, ["kind", "jobId"]) && isIdentifier(value.jobId);
  }
  if (value.kind === "activity-item") {
    return (
      hasOnlyKeys(value, ["kind", "eventId"]) && isIdentifier(value.eventId)
    );
  }
  return (
    hasOnlyKeys(value, ["kind"]) &&
    (value.kind === "accounts" || value.kind === "diagnostics")
  );
}

function containsForbiddenMaterial(value: unknown): boolean {
  if (typeof value === "string") {
    return /https?:\/\//iu.test(value) || /bearer\s/iu.test(value);
  }
  if (Array.isArray(value)) return value.some(containsForbiddenMaterial);
  if (!isRecord(value)) return false;
  return Object.entries(value).some(
    ([key, item]) =>
      forbiddenKeyPattern.test(key) || containsForbiddenMaterial(item),
  );
}

function isChannelId(value: unknown): value is NotificationChannelId {
  return typeof value === "string" && Object.hasOwn(CHANNEL_IDS, value);
}

function isPlatform(value: unknown): value is Platform {
  return value === "twitch" || value === "kick";
}

function isIdentifier(value: unknown): value is string {
  return isString(value) && identifierPattern.test(value);
}

function isChannelLogin(value: unknown): value is string {
  return isString(value) && channelLoginPattern.test(value);
}

function isDisplayText(value: unknown): value is string {
  if (!isString(value) || value.length === 0 || value.length > 180) {
    return false;
  }
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) < 32) return false;
  }
  return !/https?:\/\//iu.test(value);
}
