import { app, type BrowserWindow, type Session, session } from "electron";

import { installNetworkRequestLogger } from "@backend/logging/network-request-logger";
import { logger } from "@backend/logging/logger";
import { cosmeticInjectionService } from "@backend/services/cosmetic-injection-service";
import { networkAdBlockService } from "@backend/services/network-adblock-service";
import {
  purgeStoredThirdPartyCookies,
  registerThirdPartyCookieStripper,
} from "@backend/services/third-party-cookie-stripper";
import { twitchManifestProxy } from "@backend/services/twitch-manifest-proxy";
import { vaftPatternService } from "@backend/services/vaft-pattern-service";
import { registerLoadedFeatureCleanup } from "./loaded-feature-cleanup";

const networkBlockedSessions = new WeakSet<Session>();
let initialization: Promise<void> | undefined;

function installNetworkRequestBlocker(
  targetSession: Session,
  options: { skipTwitchManifests?: boolean } = {}
): void {
  if (networkBlockedSessions.has(targetSession)) return;
  networkBlockedSessions.add(targetSession);

  targetSession.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
    if (
      options.skipTwitchManifests &&
      details.url.includes("ttvnw.net") &&
      details.url.includes(".m3u8")
    ) {
      callback({});
      return;
    }

    const result = networkAdBlockService.shouldBlock(details.url);
    callback(result.blocked ? { cancel: true } : {});
  });
}

function setupRequestInterceptors(): void {
  twitchManifestProxy.registerInterceptor();

  installNetworkRequestLogger(session.defaultSession);
  installNetworkRequestBlocker(session.defaultSession, { skipTwitchManifests: true });
  app.on("session-created", (createdSession) => {
    installNetworkRequestLogger(createdSession);
    installNetworkRequestBlocker(createdSession);
  });

  session.defaultSession.webRequest.onBeforeSendHeaders(
    {
      urls: [
        "https://files.kick.com/*",
        "https://*.files.kick.com/*",
        "https://images.kick.com/*",
        "https://*.images.kick.com/*",
      ],
    },
    (details, callback) => {
      callback({
        requestHeaders: {
          ...details.requestHeaders,
          Referer: "https://kick.com/",
        },
      });
    }
  );

  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ["*://*.twitch.tv/*", "*://*.ttvnw.net/*"] },
    (details, callback) => {
      const headers = { ...details.responseHeaders };
      const cspKey = Object.keys(headers).find(
        (key) => key.toLowerCase() === "content-security-policy"
      );
      const cspValues = cspKey ? headers[cspKey] : undefined;

      if (cspKey && Array.isArray(cspValues)) {
        headers[cspKey] = cspValues.map((csp) =>
          csp.includes("connect-src") && !csp.includes("data:")
            ? csp.replace("connect-src", "connect-src data: blob:")
            : csp
        );
      }

      callback({ responseHeaders: headers });
    }
  );

  registerThirdPartyCookieStripper(session.defaultSession);
}

async function initializePlaybackRuntime(): Promise<void> {
  cosmeticInjectionService.initialize();
  setupRequestInterceptors();
  registerLoadedFeatureCleanup("vaft-pattern-service", () => vaftPatternService.destroy());

  void purgeStoredThirdPartyCookies(session.defaultSession).catch((error) => {
    logger.warn("PlaybackRuntime", "Failed to purge third-party cookies", {
      error: String(error),
    });
  });

  try {
    await vaftPatternService.initialize();
  } catch (error) {
    logger.warn("PlaybackRuntime", "VAFT pattern initialization failed", {
      error: String(error),
    });
  }
}

export async function ensurePlaybackRuntime(mainWindow: BrowserWindow): Promise<void> {
  initialization ??= initializePlaybackRuntime();
  await initialization;
  await cosmeticInjectionService.injectIntoWindow(mainWindow);
}
