import type {
  LiveNotificationPreferences,
  LiveNotificationRestartGraceMinutes,
} from "@streamfusion/core/follows";

export type NotificationPermissionStatus =
  | "granted"
  | "denied"
  | "not-requested"
  | "unavailable";

export type NotificationNetwork = "online" | "offline";

export type NotificationPermissionSnapshot = {
  readonly apiLevel: number;
  readonly permission: NotificationPermissionStatus;
};

export interface NotificationPermissionPort {
  openSystemSettings(): Promise<void>;
  read(): Promise<NotificationPermissionSnapshot>;
  request(): Promise<NotificationPermissionSnapshot>;
}

export type NotificationSettingsView = {
  readonly apiLevel: number;
  readonly deliveryCopy: string;
  readonly denied: boolean;
  readonly network: NotificationNetwork;
  readonly permission: NotificationPermissionStatus;
  readonly permissionCopy: string;
  readonly preferences: LiveNotificationPreferences;
  readonly registrationCopy: string;
  readonly lifecycleCopy: string;
};

export type NotificationPreferencePatch = Partial<{
  readonly enabled: boolean;
  readonly favoriteChannelsOnly: boolean;
  readonly guestFollows: boolean;
  readonly kick: boolean;
  readonly liveAlerts: boolean;
  readonly restartGracePeriodMinutes: LiveNotificationRestartGraceMinutes;
  readonly sound: boolean;
  readonly toastAlerts: boolean;
  readonly twitch: boolean;
}>;

export interface NotificationSettingsSession {
  apply(patch: NotificationPreferencePatch): Promise<NotificationSettingsView>;
  load(): Promise<NotificationSettingsView>;
  openSystemSettings(): Promise<void>;
  peek(): NotificationSettingsView;
  retryPermission(): Promise<NotificationSettingsView>;
  subscribe(listener: () => void): () => void;
}
