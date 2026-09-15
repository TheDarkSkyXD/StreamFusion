import {
  hasOnlyKeys,
  isBoolean,
  isRecord,
  isSerializedTimestamp,
  isString,
  type ContractSchema,
} from "../foundations/contract-schema.ts";
import type { Platform } from "../platform/index.ts";
import {
  isFollowEligibleForLiveNotification,
  type GuestFollow,
  type LiveNotificationPreferences,
} from "../features/follows/domain/index.ts";

export const LIVE_NOTIFICATION_PAYLOAD_SCHEMA_VERSION = 1 as const;
export const NATIVE_PUSH_REGISTRATION_SCHEMA_VERSION = 1 as const;
export const MAX_LIVE_NOTIFICATION_PAIRS = 2_000;
export const NATIVE_PUSH_TOKEN_FINGERPRINT_LENGTH = 16;
export const NATIVE_PUSH_TOKEN_TYPE = "fcm" as const;

export type NotificationChannelId = "live" | "media" | "account-device";
export type NativePushTokenType = typeof NATIVE_PUSH_TOKEN_TYPE;
export type LiveStreamState = "live" | "ended";

export type LiveNotificationPair = {
  readonly platform: Platform;
  readonly channelId: string;
};

export type LiveNotificationProjection = {
  readonly schemaVersion: typeof NATIVE_PUSH_REGISTRATION_SCHEMA_VERSION;
  readonly version: number;
  readonly pairs: readonly LiveNotificationPair[];
};

export type NativePushRegistrationRequest = {
  readonly schemaVersion: typeof NATIVE_PUSH_REGISTRATION_SCHEMA_VERSION;
  readonly nativeToken: string;
  readonly tokenType: NativePushTokenType;
  readonly projection: LiveNotificationProjection;
  readonly remoteDeliveryEnabled: boolean;
};

export type NativePushDisableRequest = {
  readonly schemaVersion: typeof NATIVE_PUSH_REGISTRATION_SCHEMA_VERSION;
};

export type NativePushRegistrationGrant = {
  readonly registered: true;
  readonly tokenFingerprint: string;
  readonly projectionVersion: number;
  readonly reconciledAt: string;
};

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
const nativeTokenPattern = /^[A-Za-z0-9:_-]{32,4096}$/u;
const fingerprintPattern = /^[a-f0-9]{16}$/u;
const forbiddenKeyPattern =
  /^(access[_-]?token|authorization|credential|hls|password|playbackurl|secret|token|url)$/iu;
const CHANNEL_IDS = {
  live: true,
  media: true,
  "account-device": true,
} as const;

export const liveNotificationProjectionSchema: ContractSchema<LiveNotificationProjection> =
  { is: isLiveNotificationProjection };

export const nativePushRegistrationRequestSchema: ContractSchema<NativePushRegistrationRequest> =
  { is: isNativePushRegistrationRequest };

export const nativePushDisableRequestSchema: ContractSchema<NativePushDisableRequest> =
  { is: isNativePushDisableRequest };

export const nativePushRegistrationGrantSchema: ContractSchema<NativePushRegistrationGrant> =
  { is: isNativePushRegistrationGrant };

export const safeNotificationPayloadSchema: ContractSchema<SafeNotificationPayload> =
  { is: isSafeNotificationPayload };

export function buildLiveNotificationProjection(input: {
  readonly membership: readonly GuestFollow[];
  readonly preferences: LiveNotificationPreferences;
  readonly version: number;
}): LiveNotificationProjection {
  const pairs: LiveNotificationPair[] = [];
  const seen = new Set<string>();
  for (const follow of input.membership) {
    if (
      !isFollowEligibleForLiveNotification({
        channel: { platform: follow.platform, id: follow.channelId },
        followSource: "guest",
        preferences: input.preferences,
      })
    ) {
      continue;
    }
    const key = `${follow.platform}:${follow.channelId}`;
    if (seen.has(key) || pairs.length >= MAX_LIVE_NOTIFICATION_PAIRS) continue;
    seen.add(key);
    pairs.push({ platform: follow.platform, channelId: follow.channelId });
  }
  return {
    schemaVersion: NATIVE_PUSH_REGISTRATION_SCHEMA_VERSION,
    version: input.version,
    pairs,
  };
}

export async function fingerprintNativePushToken(
  token: string,
): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, NATIVE_PUSH_TOKEN_FINGERPRINT_LENGTH);
}

function isNativePushRegistrationRequest(
  value: unknown,
): value is NativePushRegistrationRequest {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "schemaVersion",
      "nativeToken",
      "tokenType",
      "projection",
      "remoteDeliveryEnabled",
    ]) &&
    value.schemaVersion === NATIVE_PUSH_REGISTRATION_SCHEMA_VERSION &&
    isNativeToken(value.nativeToken) &&
    value.tokenType === NATIVE_PUSH_TOKEN_TYPE &&
    isLiveNotificationProjection(value.projection) &&
    isBoolean(value.remoteDeliveryEnabled)
  );
}

function isNativePushDisableRequest(
  value: unknown,
): value is NativePushDisableRequest {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["schemaVersion"]) &&
    value.schemaVersion === NATIVE_PUSH_REGISTRATION_SCHEMA_VERSION
  );
}

function isNativePushRegistrationGrant(
  value: unknown,
): value is NativePushRegistrationGrant {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      "registered",
      "tokenFingerprint",
      "projectionVersion",
      "reconciledAt",
    ]) &&
    value.registered === true &&
    isFingerprint(value.tokenFingerprint) &&
    isPositiveSafeInteger(value.projectionVersion) &&
    isSerializedTimestamp(value.reconciledAt)
  );
}

function isLiveNotificationProjection(
  value: unknown,
): value is LiveNotificationProjection {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["schemaVersion", "version", "pairs"]) &&
    value.schemaVersion === NATIVE_PUSH_REGISTRATION_SCHEMA_VERSION &&
    isPositiveSafeInteger(value.version) &&
    Array.isArray(value.pairs) &&
    value.pairs.length <= MAX_LIVE_NOTIFICATION_PAIRS &&
    value.pairs.every(isLiveNotificationPair) &&
    uniquePairCount(value.pairs) === value.pairs.length
  );
}

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

function isSafeDestination(value: unknown): value is SafeNotificationDestination {
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

function isLiveNotificationPair(value: unknown): value is LiveNotificationPair {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ["platform", "channelId"]) &&
    isPlatform(value.platform) &&
    isIdentifier(value.channelId)
  );
}

function uniquePairCount(pairs: readonly LiveNotificationPair[]): number {
  return new Set(pairs.map((pair) => `${pair.platform}:${pair.channelId}`)).size;
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

function isNativeToken(value: unknown): value is string {
  return isString(value) && nativeTokenPattern.test(value);
}

function isFingerprint(value: unknown): value is string {
  return isString(value) && fingerprintPattern.test(value);
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

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
