import type {
  LogLevel,
  SupportLogEntry,
  SupportMaintenanceKind,
  SupportPreferencePatch,
  SupportSettings,
  SupportSettingsView,
} from "../capabilities/support-settings";
import {
  DEFAULT_SUPPORT_SETTINGS,
  parseSupportSettings,
} from "../capabilities/parse-support-settings";

export {
  DEFAULT_SUPPORT_SETTINGS,
  parseSupportSettings,
} from "../capabilities/parse-support-settings";

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
