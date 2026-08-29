import { BrowserWindow, type Event } from "electron";

import { logger } from "@backend/logging/logger";

const TWITCH_ACTIVATION_ORIGIN = "https://www.twitch.tv";
const TWITCH_CALLBACK_ORIGIN = "http://localhost:8765";
const TWITCH_CALLBACK_PATH = "/auth/twitch/callback";
const TWITCH_LOADING_PAGE = `data:text/html;charset=utf-8,${encodeURIComponent(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Connect Twitch</title>
    <style>
      html, body { height: 100%; margin: 0; }
      body { display: grid; place-items: center; background: #0e0e10; color: #efeff1; font: 16px system-ui, sans-serif; }
      main { text-align: center; }
      p { color: #adadb8; }
    </style>
  </head>
  <body><main><h1>Connecting to Twitch</h1><p>Opening secure authentication…</p></main></body>
</html>`)}`;
const TWITCH_AUTH_ORIGINS = new Set([
  TWITCH_ACTIVATION_ORIGIN,
  "https://auth.twitch.tv",
  "https://id.twitch.tv",
  // Twitch's "Continue with Google" sign-in stays in this popup before
  // returning to Twitch. Keep this exact rather than allowing arbitrary
  // third-party navigation.
  "https://accounts.google.com",
]);

function browserCompatibleUserAgent(defaultUserAgent: string): string {
  return defaultUserAgent.replace(/\sElectron\/[^\s]+/g, "");
}

function isTwitchCallbackNavigation(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return (
      url.username === "" &&
      url.password === "" &&
      url.origin === TWITCH_CALLBACK_ORIGIN &&
      url.pathname === TWITCH_CALLBACK_PATH &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function isAllowedTwitchAuthNavigation(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.username !== "" || url.password !== "") return false;
    if (TWITCH_AUTH_ORIGINS.has(url.origin)) {
      return url.protocol === "https:" && url.port === "";
    }
    return isTwitchCallbackNavigation(rawUrl);
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
  navigate: (verificationUri: string) => Promise<void>;
}

class TwitchDeviceAuthWindowManager {
  private activeWindow: BrowserWindow | null = null;

  async open(verificationUri?: string): Promise<TwitchDeviceAuthWindowHandle> {
    if (verificationUri && !isTwitchVerificationUrl(verificationUri)) {
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
        let origin = "invalid";
        try {
          origin = new URL(targetUrl).origin;
        } catch {
          // Keep malformed navigation details out of logs.
        }
        logger.warn("Auth:Window", "Blocked Twitch auth navigation", { origin });
        event.preventDefault();
      } else if (isTwitchCallbackNavigation(targetUrl) && !window.isDestroyed()) {
        logger.info("Auth:Window", "Twitch authorization callback reached");
        window.close();
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
      await window.loadURL(TWITCH_LOADING_PAGE);
      if (!window.isDestroyed()) {
        window.show();
        window.focus();
      }
    } catch {
      if (!window.isDestroyed()) window.close();
      throw new Error("Unable to open Twitch authorization window");
    }

    const handle: TwitchDeviceAuthWindowHandle = {
      closed,
      close: () => {
        if (!window.isDestroyed()) window.close();
      },
      navigate: async (targetUri) => {
        if (!isTwitchVerificationUrl(targetUri)) {
          throw new Error("Invalid Twitch verification URL");
        }
        try {
          const userAgent = browserCompatibleUserAgent(window.webContents.session.getUserAgent());
          await window.loadURL(targetUri, { userAgent });
          if (!window.isDestroyed()) {
            window.show();
            window.focus();
          }
        } catch {
          if (!window.isDestroyed()) window.close();
          throw new Error("Unable to open Twitch authorization window");
        }
      },
    };
    if (verificationUri) await handle.navigate(verificationUri);
    return handle;
  }

  close(): void {
    const window = this.activeWindow;
    if (window && !window.isDestroyed()) window.close();
  }
}

export const twitchDeviceAuthWindow = new TwitchDeviceAuthWindowManager();
