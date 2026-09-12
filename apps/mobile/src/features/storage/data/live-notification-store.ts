import {
  DEFAULT_LIVE_NOTIFICATION_PREFERENCES,
  getLiveNotificationPreferences,
  type LiveNotificationPreferences,
  type LiveNotificationRestartGraceMinutes,
} from "@streamfusion/core/follows";

import type { StoreDatabase } from "./database-contracts";

export const LIVE_NOTIFICATIONS_SETTING_KEY = "live-notifications.v1";

export class LiveNotificationStore {
  constructor(private readonly database: StoreDatabase) {}

  async read(): Promise<LiveNotificationPreferences> {
    const row = await this.database.first<{ readonly value: string }>(
      "SELECT value FROM settings WHERE key = ?",
      [LIVE_NOTIFICATIONS_SETTING_KEY],
    );
    if (!row) return DEFAULT_LIVE_NOTIFICATION_PREFERENCES;
    return (
      parseLiveNotificationWrite(row.value) ??
      DEFAULT_LIVE_NOTIFICATION_PREFERENCES
    );
  }

  async write(
    value: unknown,
    updatedAt = Date.now(),
  ): Promise<LiveNotificationPreferences> {
    const preferences = parseLiveNotificationWrite(value);
    if (!preferences) {
      throw new RangeError("Live notification preferences are invalid.");
    }
    await this.database.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET
         value = excluded.value,
         updated_at = excluded.updated_at`,
      [LIVE_NOTIFICATIONS_SETTING_KEY, JSON.stringify(preferences), updatedAt],
    );
    return preferences;
  }
}

export function parseLiveNotificationWrite(
  value: unknown,
): LiveNotificationPreferences | null {
  const record = recordFrom(value);
  if (!record) return null;
  if (!isBooleanMap(record.perChannelNotifications ?? {})) return null;
  if (
    record.restartGracePeriodMinutes !== undefined &&
    !isGrace(record.restartGracePeriodMinutes)
  ) {
    return null;
  }
  const partial = partialPreferences(record);
  return partial === null ? null : getLiveNotificationPreferences(partial);
}

function recordFrom(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return isPlainRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isPlainRecord(value) ? value : null;
}

function partialPreferences(
  record: Record<string, unknown>,
): Partial<LiveNotificationPreferences> | null {
  const flags: (keyof LiveNotificationPreferences)[] = [
    "enabled",
    "liveAlerts",
    "twitch",
    "kick",
    "guestFollows",
    "toastAlerts",
    "sound",
    "favoriteChannelsOnly",
  ];
  const partial: Record<string, unknown> = {};
  for (const flag of flags) {
    if (record[flag] === undefined) continue;
    if (typeof record[flag] !== "boolean") return null;
    partial[flag] = record[flag];
  }
  if (isGrace(record.restartGracePeriodMinutes)) {
    partial.restartGracePeriodMinutes = record.restartGracePeriodMinutes;
  }
  if (record.perChannelNotifications !== undefined) {
    partial.perChannelNotifications = record.perChannelNotifications;
  }
  return partial;
}

function isGrace(value: unknown): value is LiveNotificationRestartGraceMinutes {
  return value === 0 || value === 5 || value === 15 || value === 30;
}

function isBooleanMap(value: unknown): value is Record<string, boolean> {
  if (!isPlainRecord(value)) return false;
  return Object.values(value).every((item) => typeof item === "boolean");
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
