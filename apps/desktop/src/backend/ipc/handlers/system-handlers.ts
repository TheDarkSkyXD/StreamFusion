import path from "node:path";

import { app, type BrowserWindow, ipcMain, Notification, nativeTheme, shell } from "electron";

import { logger } from "@/backend/logging/logger";
import { storageService } from "@/backend/services/storage-service";
import { IPC_CHANNELS } from "../../../shared/ipc-channels";

const appIconPath = path.join(__dirname, "../../assets/icons/icon.png");

export function registerSystemHandlers(mainWindow: BrowserWindow): void {
  /**
   * Helper to safely send IPC messages to the renderer.
   * Prevents "Render frame was disposed" errors when the window is closing.
   */
  function safeSend(channel: string, ...args: unknown[]): void {
    try {
      if (
        mainWindow &&
        !mainWindow.isDestroyed() &&
        mainWindow.webContents &&
        !mainWindow.webContents.isDestroyed()
      ) {
        mainWindow.webContents.send(channel, ...args);
      }
    } catch {
      logger.warn("IPC:System", "Could not send to channel: Window disposed", { channel });
    }
  }

  // ========== App Info ==========
  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION, () => {
    return app.getVersion();
  });

  ipcMain.handle(IPC_CHANNELS.APP_GET_VERSION_INFO, () => {
    const version = app.getVersion();

    // Standard SemVer pre-release detection:
    // Pre-releases have a suffix like -alpha, -beta, -rc
    // Examples: 1.0.0-beta.1, 1.0.0-alpha.2, 1.0.0-rc.1
    const isPrerelease = version.includes("-");

    // Determine channel from version string
    let channel: "stable" | "beta" | "alpha" | "rc" = "stable";
    if (version.includes("-alpha")) {
      channel = "alpha";
    } else if (version.includes("-beta")) {
      channel = "beta";
    } else if (version.includes("-rc")) {
      channel = "rc";
    }

    // Create display version string
    const channelLabel =
      channel === "stable" ? "" : ` (${channel.charAt(0).toUpperCase() + channel.slice(1)})`;
    const displayVersion = `${version}${channelLabel}`;

    return {
      version,
      isPrerelease,
      channel,
      displayVersion,
    };
  });

  ipcMain.handle(IPC_CHANNELS.APP_GET_NAME, () => {
    return app.getName();
  });

  // ========== Window Management ==========
  // Operate on the registered mainWindow rather than `getFocusedWindow()`:
  // the title bar these IPCs back is part of the main window, so the target
  // is unambiguous. `getFocusedWindow()` returns null if a hidden helper
  // window steals focus or the call arrives during a focus transition,
  // silently dropping the user's click.
  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    if (!mainWindow.isDestroyed()) mainWindow.minimize();
  });

  ipcMain.on(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
    if (mainWindow.isDestroyed()) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, () => {
    if (!mainWindow.isDestroyed()) mainWindow.close();
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, () => {
    return mainWindow?.isMaximized() ?? false;
  });

  // Renderer-triggered DevTools toggle. Dev-only — guarded so a tampered
  // renderer can't pop DevTools in a packaged build.
  ipcMain.on(IPC_CHANNELS.WINDOW_TOGGLE_DEV_TOOLS, () => {
    if (process.env.NODE_ENV === "production") return;
    const wc = mainWindow?.webContents;
    if (!wc || wc.isDestroyed()) return;
    wc.toggleDevTools();
  });

  // Send maximize change events to renderer
  mainWindow?.on("maximize", () => {
    safeSend(IPC_CHANNELS.WINDOW_ON_MAXIMIZE_CHANGE, true);
  });

  mainWindow?.on("unmaximize", () => {
    safeSend(IPC_CHANNELS.WINDOW_ON_MAXIMIZE_CHANGE, false);
  });

  // ========== Theme ==========
  ipcMain.handle(IPC_CHANNELS.THEME_GET_SYSTEM, () => {
    return nativeTheme.shouldUseDarkColors ? "dark" : "light";
  });

  // ========== External Links ==========
  ipcMain.handle(IPC_CHANNELS.SHELL_OPEN_EXTERNAL, async (_event, { url }: { url: string }) => {
    // Validate URL before opening
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:" || parsed.protocol === "http:") {
        await shell.openExternal(url);
      }
    } catch {
      logger.error("IPC:System", "Invalid URL", { url });
    }
  });

  // ========== Notifications ==========
  ipcMain.handle(
    IPC_CHANNELS.NOTIFICATION_SHOW,
    (_event, { title, body }: { title: string; body: string }) => {
      const preferences = storageService.getPreferences().notifications;
      if (!preferences.enabled || !Notification.isSupported()) {
        return;
      }

      const notification = new Notification({
        title,
        body,
        icon: appIconPath,
        silent: !preferences.sound,
      });
      notification.show();
    }
  );

  ipcMain.handle(IPC_CHANNELS.NOTIFICATION_COVERAGE_GET, async () => {
    const { liveNotificationService } =
      await import("@/backend/services/live-notification-service");
    return liveNotificationService.getCoverageStatus();
  });

  // Image fetching for Kick CDN is handled via the kick-image:// custom
  // protocol (see backend/protocols/kick-image-protocol.ts). Renderer images
  // hit that scheme directly from <img src>, so there is no IPC round-trip
  // and Chromium can cache the decoded bitmaps natively.
}
