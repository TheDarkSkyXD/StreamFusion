/**
 * App environment IPC bridge.
 *
 * Single channel `APP_GET_ENVIRONMENT` returns a snapshot of the runtime
 * context (dev/prod, platform, app + electron + node versions). The renderer
 * Settings UI uses `isDev` to dev-gate the LogsSection, and the bug-report
 * task embeds the version triple in every report so issue threads stay
 * cross-referenceable to a specific build.
 *
 * Distinct from `system-handlers.ts` (window controls, theme, notifications)
 * so the env probe stays a focused, side-effect-free read.
 */

import { app, ipcMain } from "electron";

import { IPC_CHANNELS } from "../../../shared/ipc-channels";

export interface AppEnvironment {
  isDev: boolean;
  platform: NodeJS.Platform;
  appVersion: string;
  electronVersion: string;
  nodeVersion: string;
}

export function registerAppHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.APP_GET_ENVIRONMENT, (): AppEnvironment => {
    return {
      isDev: !app.isPackaged,
      platform: process.platform,
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron ?? "",
      nodeVersion: process.versions.node ?? "",
    };
  });
}
