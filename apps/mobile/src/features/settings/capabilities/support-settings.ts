import type { UpdatePhase, UpdateRelease } from "@mobile/features/app-update/capabilities/android-updater";

export const SUPPORT_SETTINGS_KEY = "support-settings.v1";

export const DIAGNOSTIC_WINDOWS = [
  "realtime",
  "5m",
  "30m",
  "1h",
  "24h",
  "7d",
  "30d",
  "90d",
] as const;

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export const LOG_SOURCES = [
  "all",
  "player",
  "network",
  "storage",
  "jobs",
] as const;
export const CHECK_FREQUENCIES = ["hourly", "daily", "weekly"] as const;

export type DiagnosticWindow = (typeof DIAGNOSTIC_WINDOWS)[number];
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogSource = (typeof LOG_SOURCES)[number];
export type CheckFrequency = (typeof CHECK_FREQUENCIES)[number];

export type SupportMaintenanceKind =
  | "clear-history"
  | "remove-media"
  | "disconnect-accounts"
  | "reset-app";

export type SupportSettings = {
  readonly allowPrerelease: boolean;
  readonly attachLogs: boolean;
  readonly attachProfile: boolean;
  readonly automaticForegroundUpdateChecks: boolean;
  readonly checkFrequency: CheckFrequency;
  readonly diagnosticDetail: boolean;
  readonly diagnosticIoWindow: DiagnosticWindow;
  readonly diagnosticWindow: DiagnosticWindow;
  readonly lastCheckAt: number | null;
  readonly lastCheckCopy: string;
  readonly lastReport: string;
  readonly logLevel: LogLevel;
  readonly logSource: LogSource;
  readonly reportDescription: string;
  readonly postponedUpdate: { readonly tag: string; readonly until: number } | null;
  readonly acknowledgedUpdateOperation: string | null;
};

export type SupportPreferencePatch = Partial<SupportSettings>;

export type AndroidRelease = UpdateRelease;

export type GithubReleaseCheck =
  | { readonly status: "available"; readonly release: AndroidRelease }
  | { readonly status: "current"; readonly release: AndroidRelease | null }
  | { readonly status: "error"; readonly message: string };

export type SupportLogEntry = {
  readonly level: LogLevel;
  readonly message: string;
  readonly source: Exclude<LogSource, "all">;
};

export type UpdateCheckState =
  | { readonly status: "idle" }
  | { readonly status: "checking" }
  | { readonly status: "available"; readonly release: AndroidRelease }
  | { readonly status: "current"; readonly release: AndroidRelease | null }
  | { readonly status: "error"; readonly message: string };

export type SupportSettingsView = {
  readonly deniedCopy: string;
  readonly installedVersion: string;
  readonly licensesCopy: string;
  readonly logs: readonly SupportLogEntry[];
  readonly pending: SupportMaintenanceKind | null;
  readonly pendingCopy: string;
  readonly preferences: SupportSettings;
  readonly privacyCopy: string;
  readonly reportPreview: string;
  readonly resultCopy: string;
  readonly updateCopy: string;
  readonly update: UpdateCheckState;
  readonly releaseOpenError: string | null;
  readonly updater: UpdatePhase;
  readonly updatePopupVisible: boolean;
  readonly updateOperationError: string | null;
};

export interface SupportReleaseCheckPort {
  check(input: {
    readonly installedVersion: string;
    readonly allowPrerelease: boolean;
  }): Promise<GithubReleaseCheck>;
}

export interface SupportReleaseOpenPort {
  open(url: string): Promise<void>;
}

export interface SupportSharePort {
  share(message: string): Promise<string>;
}

export interface SupportMaintenancePort {
  clearHistory(): Promise<string>;
  disconnectAccounts(): Promise<string>;
  removeCompletedMedia(): Promise<string>;
  resetApp(): Promise<string>;
}

export interface SupportLogPort {
  list(): readonly SupportLogEntry[];
}

export interface SupportSettingsStore {
  read(): Promise<SupportSettings>;
  write(value: unknown): Promise<SupportSettings>;
}

export interface SupportSettingsSession {
  apply(patch: SupportPreferencePatch): Promise<SupportSettingsView>;
  buildReport(): Promise<SupportSettingsView>;
  cancelMaintenance(): Promise<SupportSettingsView>;
  checkForUpdates(): Promise<SupportSettingsView>;
  checkOnLaunch(): Promise<SupportSettingsView>;
  checkOnForeground(): Promise<SupportSettingsView>;
  confirmMaintenance(): Promise<SupportSettingsView>;
  load(): Promise<SupportSettingsView>;
  peek(): SupportSettingsView;
  downloadUpdate(): Promise<void>;
  cancelUpdate(): Promise<void>;
  retryUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
  hideUpdate(): Promise<void>;
  laterUpdate(): Promise<void>;
  openUpdate(): void;
  openRelease(): Promise<void>;
  requestMaintenance(kind: SupportMaintenanceKind): Promise<SupportSettingsView>;
  shareReport(): Promise<SupportSettingsView>;
  subscribe(listener: () => void): () => void;
}
