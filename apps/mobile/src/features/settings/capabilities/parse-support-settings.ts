import {
  DIAGNOSTIC_WINDOWS,
  LOG_LEVELS,
  LOG_SOURCES,
  type SupportSettings,
} from "./support-settings";

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
    logSource: oneOf(
      record.logSource,
      LOG_SOURCES,
      DEFAULT_SUPPORT_SETTINGS.logSource,
    ),
    reportDescription:
      typeof record.reportDescription === "string"
        ? record.reportDescription.slice(0, 4000)
        : "",
  };
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
