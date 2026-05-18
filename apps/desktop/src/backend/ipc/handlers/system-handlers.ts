import { app, BrowserWindow, ipcMain, Notification, nativeTheme, shell } from "electron";

import { IPC_CHANNELS } from "../../../shared/ipc-channels";

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
      console.warn(`⚠️ Could not send to ${channel}: Window disposed`);
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
  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, () => {
    const win = BrowserWindow.getFocusedWindow();
    win?.minimize();
  });

  ipcMain.on(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win?.isMaximized()) {
      win.unmaximize();
    } else {
      win?.maximize();
    }
  });

  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, () => {
    const win = BrowserWindow.getFocusedWindow();
    win?.close();
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
      console.error("Invalid URL:", url);
    }
  });

  // ========== Notifications ==========
  ipcMain.handle(
    IPC_CHANNELS.NOTIFICATION_SHOW,
    (_event, { title, body }: { title: string; body: string }) => {
      if (Notification.isSupported()) {
        const notification = new Notification({
          title,
          body,
          icon: undefined, // TODO: Add app icon
        });
        notification.show();
      }
    }
  );

  // Image fetching for Kick CDN is handled via the kick-image:// custom
  // protocol (see backend/protocols/kick-image-protocol.ts). Renderer images
  // hit that scheme directly from <img src>, so there is no IPC round-trip
  // and Chromium can cache the decoded bitmaps natively.
}
