import { BrowserWindow, type Event } from "electron";

const TWITCH_ACTIVATION_ORIGIN = "https://www.twitch.tv";
const TWITCH_AUTH_ORIGINS = new Set([TWITCH_ACTIVATION_ORIGIN]);

function isAllowedTwitchAuthNavigation(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      TWITCH_AUTH_ORIGINS.has(url.origin) &&
      url.protocol === "https:" &&
      url.port === "" &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

function isTwitchVerificationUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const queryEntries = [...url.searchParams.entries()];
    const deviceCode = url.searchParams.get("device-code");
    return (
      url.origin === TWITCH_ACTIVATION_ORIGIN &&
      url.protocol === "https:" &&
      url.port === "" &&
      url.username === "" &&
      url.password === "" &&
      url.pathname === "/activate" &&
      url.hash === "" &&
      queryEntries.length === 2 &&
      url.searchParams.getAll("public").length === 1 &&
      url.searchParams.get("public") === "true" &&
      url.searchParams.getAll("device-code").length === 1 &&
      typeof deviceCode === "string" &&
      deviceCode.length > 0 &&
      deviceCode.length <= 128
    );
  } catch {
    return false;
  }
}

export interface TwitchDeviceAuthWindowHandle {
  closed: Promise<void>;
  close: () => void;
}

class TwitchDeviceAuthWindowManager {
  private activeWindow: BrowserWindow | null = null;

  async open(verificationUri: string): Promise<TwitchDeviceAuthWindowHandle> {
    if (!isTwitchVerificationUrl(verificationUri)) {
      throw new Error("Invalid Twitch verification URL");
    }

    this.close();

    const window = new BrowserWindow({
      width: 500,
      height: 750,
      minWidth: 400,
      minHeight: 600,
      center: true,
      show: false,
      title: "Connect Twitch",
      autoHideMenuBar: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        devTools: false,
        partition: "persist:streamfusion-twitch-auth",
      },
    });
    this.activeWindow = window;

    let resolveClosed: () => void = () => undefined;
    let closeReported = false;
    const closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    const reportClosed = (): void => {
      if (this.activeWindow === window) {
        this.activeWindow = null;
      }
      if (!closeReported) {
        closeReported = true;
        resolveClosed();
      }
    };
    window.on("closed", reportClosed);
    window.once("ready-to-show", () => {
      if (!window.isDestroyed()) window.show();
    });

    const restrictNavigation = (event: Event, targetUrl: string): void => {
      if (!isAllowedTwitchAuthNavigation(targetUrl)) {
        event.preventDefault();
      }
    };
    window.webContents.on("will-navigate", restrictNavigation);
    window.webContents.on("will-redirect", restrictNavigation);
    window.webContents.on("will-attach-webview", (event) => event.preventDefault());
    window.webContents.on(
      "did-fail-load",
      (_event, _errorCode, _errorDescription, _validatedUrl, isMainFrame = true) => {
        if (isMainFrame && !window.isDestroyed()) window.close();
      }
    );
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.session.setPermissionCheckHandler(() => false);
    window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
      callback(false)
    );

    try {
      await window.loadURL(verificationUri);
    } catch {
      if (!window.isDestroyed()) window.close();
      throw new Error("Unable to open Twitch authorization window");
    }

    return {
      closed,
      close: () => {
        if (!window.isDestroyed()) window.close();
      },
    };
  }

  close(): void {
    const window = this.activeWindow;
    if (window && !window.isDestroyed()) window.close();
  }
}

export const twitchDeviceAuthWindow = new TwitchDeviceAuthWindowManager();
