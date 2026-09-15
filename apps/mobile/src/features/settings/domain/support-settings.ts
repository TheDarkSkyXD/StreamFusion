import type {
  LogLevel,
  SupportLogEntry,
  SupportMaintenanceKind,
  SupportPreferencePatch,
  SupportSettings,
  SupportSettingsView,
} from "../capabilities/support-settings";
import {
  DIAGNOSTIC_WINDOWS,
  LOG_LEVELS,
  LOG_SOURCES,
} from "../capabilities/support-settings";

export const DEFAULT_SUPPORT_SETTINGS: SupportSettings = {
  attachLogs: true,
  attachProfile: true,
  automaticForegroundUpdateChecks: false,
  diagnosticDetail: false,
  diagnosticIoWindow: "5m",
  diagnosticWindow: "5m",
  lastCheckAt: null,
  lastCheckCopy: "No GitHub check has run on this device.",
  lastReport: "",
  logLevel: "info",
  logSource: "all",
  reportDescription: "",
};

export const LICENSE_COPY =
  "StreamFusion Mobile includes React Native, Expo, and other open-source libraries. Notices ship with this build and remain readable offline.";

export const PRIVACY_COPY =
  "Live alerts, History, jobs, and Settings stay on this device unless you share a redacted report. GitHub update checks send only a public release request. OAuth credentials never appear in reports.";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export function mergeSupportSettings(
  current: SupportSettings,
  patch: SupportPreferencePatch,
): SupportSettings {
  return parseSupportSettings({ ...current, ...patch });
}

export function parseSupportSettings(value: unknown): SupportSettings {
  const record = asRecord(value);
  if (!record) return DEFAULT_SUPPORT_SETTINGS;
  return {
    attachLogs: boolOr(record.attachLogs, DEFAULT_SUPPORT_SETTINGS.attachLogs),
    attachProfile: boolOr(
      record.attachProfile,
      DEFAULT_SUPPORT_SETTINGS.attachProfile,
    ),
    automaticForegroundUpdateChecks: boolOr(
      record.automaticForegroundUpdateChecks,
      DEFAULT_SUPPORT_SETTINGS.automaticForegroundUpdateChecks,
    ),
    diagnosticDetail: boolOr(
      record.diagnosticDetail,
      DEFAULT_SUPPORT_SETTINGS.diagnosticDetail,
    ),
    diagnosticIoWindow: oneOf(
      record.diagnosticIoWindow,
      DIAGNOSTIC_WINDOWS,
      DEFAULT_SUPPORT_SETTINGS.diagnosticIoWindow,
    ),
    diagnosticWindow: oneOf(
      record.diagnosticWindow,
      DIAGNOSTIC_WINDOWS,
      DEFAULT_SUPPORT_SETTINGS.diagnosticWindow,
    ),
    lastCheckAt:
      typeof record.lastCheckAt === "number" ? record.lastCheckAt : null,
    lastCheckCopy:
      typeof record.lastCheckCopy === "string" && record.lastCheckCopy.length > 0
        ? record.lastCheckCopy
        : DEFAULT_SUPPORT_SETTINGS.lastCheckCopy,
    lastReport: typeof record.lastReport === "string" ? record.lastReport : "",
    logLevel: oneOf(record.logLevel, LOG_LEVELS, DEFAULT_SUPPORT_SETTINGS.logLevel),
    logSource: oneOf(record.logSource, LOG_SOURCES, DEFAULT_SUPPORT_SETTINGS.logSource),
    reportDescription:
      typeof record.reportDescription === "string"
        ? record.reportDescription.slice(0, 4000)
        : "",
  };
}

export function filterSupportLogs(
  entries: readonly SupportLogEntry[],
  preferences: SupportSettings,
): readonly SupportLogEntry[] {
  const minimum = LEVEL_RANK[preferences.logLevel];
  return entries.filter(
    (entry) =>
      LEVEL_RANK[entry.level] >= minimum &&
      (preferences.logSource === "all" || entry.source === preferences.logSource),
  );
}

export function composeSupportSettingsView(input: {
  readonly installedVersion: string;
  readonly logs: readonly SupportLogEntry[];
  readonly pending: SupportMaintenanceKind | null;
  readonly preferences: SupportSettings;
  readonly resultCopy: string;
}): SupportSettingsView {
  const { installedVersion, logs, pending, preferences, resultCopy } = input;
  return {
    deniedCopy: automaticCheckCopy(preferences.automaticForegroundUpdateChecks),
    installedVersion,
    licensesCopy: LICENSE_COPY,
    logs: filterSupportLogs(logs, preferences),
    pending,
    pendingCopy: pending ? maintenanceCopy(pending) : "",
    preferences,
    privacyCopy: PRIVACY_COPY,
    reportPreview:
      preferences.lastReport ||
      "No local report is ready. Build report keeps a redacted copy on this device.",
    resultCopy,
    updateCopy: preferences.lastCheckCopy,
  };
}

export function defaultSupportSettingsView(
  installedVersion = "development",
): SupportSettingsView {
  return composeSupportSettingsView({
    installedVersion,
    logs: [],
    pending: null,
    preferences: DEFAULT_SUPPORT_SETTINGS,
    resultCopy: "",
  });
}

export function buildLocalReport(input: {
  readonly installedVersion: string;
  readonly logs: readonly SupportLogEntry[];
  readonly preferences: SupportSettings;
  readonly profileCopy: string;
}): string {
  const body = {
    attachLogs: input.preferences.attachLogs,
    attachProfile: input.preferences.attachProfile,
    description: input.preferences.reportDescription,
    installedVersion: input.installedVersion,
    logs: input.preferences.attachLogs
      ? filterSupportLogs(input.logs, input.preferences).map((entry) => ({
          level: entry.level,
          message: entry.message,
          source: entry.source,
        }))
      : [],
    profile: input.preferences.attachProfile ? input.profileCopy : "omitted",
    redacted: true,
  };
  return JSON.stringify(body);
}

export function maintenanceCopy(kind: SupportMaintenanceKind): string {
  switch (kind) {
    case "clear-history":
      return "Clear History removes only local Watch History. Guest Follows, jobs, and Settings stay.";
    case "remove-media":
      return "Remove media deletes completed, canceled, or failed app-private jobs. Active jobs stay until they finish.";
    case "disconnect-accounts":
      return "Disconnect removes local provider credentials if any exist. Guest Follows, History, and Settings stay. OAuth is not started.";
    case "reset-app":
      return "Reset restores product Settings and support Settings, clears History, and empties the disposable cache. Guest Follows and credentials stay unless you disconnect first.";
  }
}

function automaticCheckCopy(enabled: boolean): string {
  return enabled
    ? "Preference is saved. Automatic foreground checks every 24 hours wait until the native updater ships."
    : "Automatic GitHub checks stay off. Manual Check now still inspects the latest stable release.";
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return (allowed as readonly string[]).includes(String(value))
    ? (value as T)
    : fallback;
}

function boolOr(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
