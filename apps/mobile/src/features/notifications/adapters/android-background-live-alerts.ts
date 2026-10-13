import { safeNotificationPayloadSchema } from "@streamfusion/core/relay";

import type {
  BackgroundLiveAlerts,
  BackgroundStatus,
} from "../capabilities/background-live-alerts";
import { getNativeNotifications } from "./android-notifications-module";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStatus(value: string): BackgroundStatus {
  const result: unknown = JSON.parse(value);
  if (!isRecord(result) || result.schemaVersion !== 1 ||
    Object.keys(result).length !== 6 ||
    Object.keys(result).some((key) => ![
      "schemaVersion", "scheduled", "intervalMinutes", "channelCount",
      "lastCheckedAtMs", "failure",
    ].includes(key)) ||
    typeof result.scheduled !== "boolean" || result.intervalMinutes !== 15 ||
    !Number.isSafeInteger(result.channelCount) || Number(result.channelCount) < 0 ||
    !(result.lastCheckedAtMs === null ||
      (Number.isSafeInteger(result.lastCheckedAtMs) && Number(result.lastCheckedAtMs) >= 0)) ||
    !(result.failure === null || result.failure === "provider-unavailable" ||
      result.failure === "inbox-full" || result.failure === "storage-unavailable")) {
    throw new Error("Invalid background check status.");
  }
  return {
    schemaVersion: 1,
    scheduled: result.scheduled,
    intervalMinutes: 15,
    channelCount: Number(result.channelCount),
    lastCheckedAtMs: result.lastCheckedAtMs === null ? null : Number(result.lastCheckedAtMs),
    failure: result.failure,
  };
}

export function createAndroidBackgroundLiveAlerts(): BackgroundLiveAlerts {
  return {
    async configure(snapshot) {
      return parseStatus(await getNativeNotifications().configureBackgroundChecks(JSON.stringify(snapshot)));
    },
    async status() {
      return parseStatus(await getNativeNotifications().getBackgroundCheckStatus());
    },
    async pending() {
      const value: unknown = JSON.parse(await getNativeNotifications().readBackgroundEvents());
      if (!Array.isArray(value) || !value.every((entry) => safeNotificationPayloadSchema.is(entry))) {
        throw new Error("Invalid pending background events.");
      }
      return value;
    },
    acknowledge(eventIds) {
      return getNativeNotifications().acknowledgeBackgroundEvents(JSON.stringify(eventIds));
    },
  };
}
