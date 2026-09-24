import {
  toSerializedTimestamp,
  type ActivityItem,
} from "@streamfusion/core/activity";
import type { SafeNotificationPayload } from "@streamfusion/core/relay";

import type { NotificationOpenLocation } from "../capabilities/native-notifications";

type PayloadDestination = SafeNotificationPayload["destination"];
type WatchDestination = Extract<PayloadDestination, { kind: "watch-channel" }>;
type MediaDestination = Extract<PayloadDestination, { kind: "media-job" }>;
type SystemDestination = Extract<
  PayloadDestination,
  { kind: "accounts" } | { kind: "diagnostics" }
>;

export function notificationOpenLocation(
  payload: SafeNotificationPayload,
  liveNow?: boolean,
): NotificationOpenLocation {
  const destination = payload.destination;
  if (destination.kind === "watch-channel") {
    const live = liveNow ?? destination.streamState === "live";
    if (live) {
      return {
        kind: "watch",
        platform: destination.platform,
        channelId: destination.channelId,
        channelLogin: destination.channelLogin,
      };
    }
    return {
      kind: "channel",
      platform: destination.platform,
      id: destination.channelId,
      username: destination.channelLogin,
    };
  }
  if (destination.kind === "media-job") {
    return { kind: "job", jobId: destination.jobId };
  }
  if (destination.kind === "activity-item") {
    return { kind: "activity", eventId: destination.eventId };
  }
  return { kind: destination.kind };
}

function activityFields(payload: SafeNotificationPayload) {
  return {
    schemaVersion: 1 as const,
    eventId: payload.eventId,
    source: "relay" as const,
    occurredAt: toSerializedTimestamp(payload.occurredAt),
    readAt: null,
    title: payload.title,
    body: payload.body,
  };
}

function liveAlertItem(
  payload: SafeNotificationPayload,
  destination: WatchDestination,
): ActivityItem {
  return {
    ...activityFields(payload),
    kind: "channel",
    event: "live-alert",
    channel: {
      platform: destination.platform,
      id: destination.channelId,
      login: destination.channelLogin,
      displayName: payload.title,
    },
    destination: {
      kind: "watch-channel",
      platform: destination.platform,
      channelId: destination.channelId,
      channelLogin: destination.channelLogin,
    },
  };
}

function mediaJobItem(
  payload: SafeNotificationPayload,
  destination: MediaDestination,
): ActivityItem {
  return {
    ...activityFields(payload),
    kind: "job",
    job: { id: destination.jobId, state: { kind: "terminal" } },
    destination: { kind: "media-job", jobId: destination.jobId },
  };
}

function systemItem(
  payload: SafeNotificationPayload,
  destination: SystemDestination,
): ActivityItem {
  return {
    ...activityFields(payload),
    kind: "system",
    event:
      destination.kind === "accounts" ? "account-maintenance" : "device-health",
    destination: { kind: destination.kind },
  };
}

export function activityItemFromPayload(
  payload: SafeNotificationPayload,
): ActivityItem | null {
  const destination = payload.destination;
  if (destination.kind === "watch-channel") {
    // Go-live only: stream-ended payloads must not enter Activity.
    if (destination.streamState !== "live") return null;
    return liveAlertItem(payload, destination);
  }
  if (destination.kind === "media-job") {
    return mediaJobItem(payload, destination);
  }
  if (destination.kind === "accounts" || destination.kind === "diagnostics") {
    return systemItem(payload, destination);
  }
  return {
    ...activityFields(payload),
    kind: "system",
    event: "device-health",
    destination: null,
  };
}

export function proofLivePayload(nowIso: string): SafeNotificationPayload {
  return {
    schemaVersion: 1,
    eventId: "proof:live-alert:started:v1",
    sourceId: "device:notification-proof:v1",
    channel: "live",
    title: "xQc is live",
    body: "xQc went live on Twitch.",
    destination: {
      kind: "watch-channel",
      platform: "twitch",
      channelId: "71092938",
      channelLogin: "xqc",
      streamState: "live",
    },
    occurredAt: nowIso,
  };
}
