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
};

export type SupportPreferencePatch = Partial<SupportSettings>;

export type SupportLogEntry = {
  readonly level: LogLevel;
  readonly message: string;
  readonly source: Exclude<LogSource, "all">;
};

export type SupportNetwork = "offline" | "online";

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
};

export interface SupportReleaseCheckPort {
  check(installedVersion: string): Promise<{
    readonly copy: string;
    readonly network: SupportNetwork;
  }>;
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
  confirmMaintenance(): Promise<SupportSettingsView>;
  load(): Promise<SupportSettingsView>;
  peek(): SupportSettingsView;
  requestMaintenance(kind: SupportMaintenanceKind): Promise<SupportSettingsView>;
  shareReport(): Promise<SupportSettingsView>;
  subscribe(listener: () => void): () => void;
}
