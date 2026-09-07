import type { DiagnosticsClient } from "../../capabilities/diagnostics-client";
import type { BugReportWriter, LogReader } from "../../capabilities/support-files";
import type { PlatformHealthFeed } from "../../capabilities/platform-health-feed";
import type {
  DesktopControls,
  EnvironmentReader,
  PlaybackBudgetSettings,
  NotificationCoverageReader,
  ProxySettings,
} from "../../capabilities/desktop-settings";

export function desktopDiagnostics(): DiagnosticsClient {
  return window.electronAPI.diagnostics;
}

export function desktopLogs(): LogReader | undefined {
  return window.electronAPI?.logs;
}

export function desktopBugReports(): BugReportWriter | undefined {
  return window.electronAPI?.bugReports;
}

export function desktopPlatformHealth(): PlatformHealthFeed | undefined {
  return window.electronAPI?.platformHealth;
}

export function desktopControls(): DesktopControls | undefined {
  return typeof window === "undefined" ? undefined : window.electronAPI;
}

export function desktopEnvironment(): EnvironmentReader | undefined {
  return window.electronAPI?.env;
}

export function desktopPlaybackBudget(): PlaybackBudgetSettings | undefined {
  return window.electronAPI?.slot;
}

export function desktopNotificationCoverage(): NotificationCoverageReader | undefined {
  return window.electronAPI?.notifications;
}

export function desktopProxy(): ProxySettings | undefined {
  return window.electronAPI?.proxy;
}
