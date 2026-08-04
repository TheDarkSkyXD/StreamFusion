export interface StartupApp {
  requestSingleInstanceLock(): boolean;
  exit(exitCode?: number): void;
  once(event: "ready", listener: () => void | Promise<void>): unknown;
}

export interface StartupPhases {
  beforeReady(): void;
  ready(): void | Promise<void>;
}

export function startPrimaryInstance(app: StartupApp, startup: StartupPhases): void {
  const isPrimaryInstance = app.requestSingleInstanceLock();

  if (!isPrimaryInstance) {
    app.exit(0);
    return;
  }

  startup.beforeReady();
  app.once("ready", startup.ready);
}
