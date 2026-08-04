export interface StartupSessionDependencies {
  wasCleanShutdown(): boolean;
  markSessionStarted(): void;
  logger: {
    warn(scope: string, message: string): void;
  };
}

export function beginStartupSession({
  wasCleanShutdown,
  markSessionStarted,
  logger,
}: StartupSessionDependencies): void {
  if (!wasCleanShutdown()) {
    logger.warn("Main:Startup", "Previous session ended uncleanly; preserving Chromium cache");
  }

  markSessionStarted();
}
