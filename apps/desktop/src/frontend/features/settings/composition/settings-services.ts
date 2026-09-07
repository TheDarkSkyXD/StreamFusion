export {
  desktopDiagnostics as getDiagnosticsClient,
  desktopLogs as getLogReader,
  desktopBugReports as getBugReportWriter,
  desktopPlatformHealth as getPlatformHealthFeed,
  desktopControls as getDesktopControls,
  desktopEnvironment as getEnvironmentReader,
  desktopPlaybackBudget as getPlaybackBudgetSettings,
  desktopNotificationCoverage as getNotificationCoverageReader,
  desktopProxy as getProxySettings,
} from "../adapters/electron/settings-services";
