/**
 * StreamFusion - Main Process Entry Point
 *
 * This is the Electron main process that handles window creation,
 * system integration, and IPC communication with the renderer.
 */

// Load environment variables from .env file FIRST (before other imports)
import "dotenv/config";

import {
  app,
  BrowserWindow,
  globalShortcut,
  Menu,
  powerMonitor,
  protocol,
  session,
} from "electron";
import { disposeSendWindow } from "./backend/api/platforms/kick/kick-send-window";
import { authWindowManager, protocolHandler, twitchAuthService } from "./backend/auth";
import { registerIpcHandlers } from "./backend/ipc-handlers";
import {
  KICK_IMAGE_SCHEME,
  registerKickImageProtocol,
} from "./backend/protocols/kick-image-protocol";
import {
  registerTwitchImageProtocol,
  TWITCH_IMAGE_SCHEME,
} from "./backend/protocols/twitch-image-protocol";
import { cosmeticInjectionService } from "./backend/services/cosmetic-injection-service";
import { dbService } from "./backend/services/database-service";
import { networkAdBlockService } from "./backend/services/network-adblock-service";
import { storageService } from "./backend/services/storage-service";
import {
  purgeStoredThirdPartyCookies,
  registerThirdPartyCookieStripper,
} from "./backend/services/third-party-cookie-stripper";
import { twitchManifestProxy } from "./backend/services/twitch-manifest-proxy";
import { vaftPatternService } from "./backend/services/vaft-pattern-service";
import { markCleanShutdown, markSessionStarted, wasCleanShutdown } from "./backend/shutdown-marker";
import { windowManager } from "./backend/window-manager";
import { IPC_CHANNELS } from "./shared/ipc-channels";

// Enable Chrome DevTools Protocol for Playwright/Electron MCP connectivity (development only)
// In production builds (electron-forge package/make), NODE_ENV is typically "production"
const isProduction = process.env.NODE_ENV === "production" || app.isPackaged;

if (!isProduction) {
  // Suppress the (Disabled webSecurity) + (allowRunningInsecureContent) dev
  // warnings the renderer prints on every launch. The posture is intentional
  // (window-manager.ts:132 — needed for cross-origin video stream playback)
  // and tracked separately in the worker-auth/proxy-removal brainstorm; the
  // warnings just bury real signal in the dev console. Production builds
  // suppress them automatically, so gate strictly to dev.
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";

  // Use a separate user data directory for development to allow running dev and prod simultaneously
  const userDataPath = app.getPath("userData");
  const devUserDataPath = `${userDataPath} (Dev)`;
  app.setPath("userData", devUserDataPath);
  console.debug(`📂 Development mode: User data path set to ${devUserDataPath}`);

  // NOTE: if productName ever changes again, a migration shim is needed to copy
  // old userData files and rename localStorage keys before services initialize
  // — see git history for the migrateUserData/renameOldFiles pattern removed
  // in the StreamFusion rebrand.

  // Default to 9236 — the port this project is registered under in the
  // debug-electron MCP as `streamfusion-monorepo`, so `npm start` is
  // discoverable out of the box. Skip the override if the CLI already
  // passed `--remote-debugging-port` (e.g. `dev:mcp` forces 9222 for
  // Playwright tooling) — appendSwitch would otherwise clobber it.
  const hasCliPort = process.argv.some((a) => a.startsWith("--remote-debugging-port"));
  if (!hasCliPort) {
    app.commandLine.appendSwitch("remote-debugging-port", "9236");
    console.debug("🔌 CDP remote debugging enabled on port 9236 for debug-electron MCP");
  } else {
    console.debug("🔌 CDP remote debugging using port from CLI args");
  }
} else {
  app.commandLine.appendSwitch("remote-debugging-port", "9005");
  console.debug("🔌 CDP remote debugging enabled on port 9005 for Production");
}

// ============================================================================
// CRASH-RESISTANT RUNTIME FLAGS
// Must be set before app.whenReady() for long-running HLS stream stability.
// These prevent OOM crashes after 2-6 hours of continuous streaming.
// ============================================================================

// Limit V8 heap to 350MB per process - prevents unbounded memory growth
app.commandLine.appendSwitch("max-old-space-size", "350");

// Expose garbage collector for manual GC in renderer processes + enable V8 memory cage
app.commandLine.appendSwitch("js-flags", "--max-old-space-size=350 --expose-gc");

// Linux: Use /tmp instead of shared memory for larger buffers (prevents SIGBUS)
if (process.platform === "linux") {
  app.commandLine.appendSwitch("disable-dev-shm-usage");
}

// V8 Memory Cage: Additional memory isolation for security and leak prevention
app.commandLine.appendSwitch("enable-features", "V8MemoryCage");

// Disable accessibility runtime (saves ~10-20MB if not needed)
app.commandLine.appendSwitch("disable-renderer-accessibility");

// Disable QUIC/HTTP3. Chromium's HTTP/3 transport intermittently fails against
// the emote CDNs (cdn.7tv.app, fronted by Cloudflare) with
// ERR_QUIC_PROTOCOL_ERROR, forcing a slow per-image TCP fallback and spamming
// the console. Emote grids fire dozens of these at once, so the failed-QUIC
// latency is felt directly in the picker/chat. Forcing HTTP/1.1+2 over TCP
// makes emote/thumbnail loads reliable and quiet; HTTP/3 is only ever an
// optimization, never required (servers always negotiate down).
app.commandLine.appendSwitch("disable-quic");

// Register kick-image:// + twitch-image:// as privileged schemes so the renderer
// can use them in <img src> for CDN avatars/thumbnails. Must happen before app.ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: KICK_IMAGE_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
    },
  },
  {
    scheme: TWITCH_IMAGE_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
    },
  },
]);

/**
 * Setup request interceptors for Kick CDN domains that require special headers
 * and network-level ad blocking for Twitch.
 *
 * NOTE: This is a SECONDARY fallback mechanism. The primary approach is the IPC proxy
 * in system-handlers.ts which uses Electron's net.request (more reliable).
 *
 * This interceptor catches any direct image loads that bypass the ProxiedImage component.
 */
function setupRequestInterceptors(): void {
  // Twitch manifest proxy (handles m3u8 interception for ad removal)
  // MUST be registered before the general onBeforeRequest handler
  twitchManifestProxy.registerInterceptor();

  // Network-level ad blocking (onBeforeRequest)
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ["<all_urls>"] },
    (details, callback) => {
      // Skip manifest URLs - handled by twitchManifestProxy
      if (details.url.includes("ttvnw.net") && details.url.includes(".m3u8")) {
        callback({});
        return;
      }

      const result = networkAdBlockService.shouldBlock(details.url);
      if (result.blocked) {
        callback({ cancel: true });
        return;
      }
      callback({});
    }
  );

  // Header modification for Kick CDN (onBeforeSendHeaders)
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
      const modifiedHeaders = { ...details.requestHeaders };
      modifiedHeaders.Referer = "https://kick.com/";
      callback({ requestHeaders: modifiedHeaders });
    }
  );

  // CSP modification for Twitch ad blocking (onHeadersReceived)
  // Adds 'data:' to connect-src to allow blank video segment replacement.
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ["*://*.twitch.tv/*", "*://*.ttvnw.net/*"] },
    (details, callback) => {
      const headers = { ...details.responseHeaders };

      // Find and modify Content-Security-Policy header
      const cspKey = Object.keys(headers).find(
        (key) => key.toLowerCase() === "content-security-policy"
      );

      if (cspKey && headers[cspKey]) {
        const cspValues = headers[cspKey];
        if (Array.isArray(cspValues)) {
          headers[cspKey] = cspValues.map((csp) => {
            // Add 'data:' to connect-src if not already present
            if (csp.includes("connect-src") && !csp.includes("data:")) {
              if (csp.includes("connect-src")) {
                return csp.replace("connect-src", "connect-src data: blob:");
              }
              return csp.replace(/connect-src\s+([^;]+)/, "connect-src $1 data: blob:");
            }
            return csp;
          });
        }
      }

      callback({ responseHeaders: headers });
    }
  );

  // Set-Cookie stripping for third-party CDN hosts. The previous version of
  // this lived inside the *.twitch.tv handler above and missed jtvnw.net,
  // files.kick.com, and emote CDNs — which accumulated 8 cookies and 1800+
  // "Reading cookie in cross-site context" DevTools warnings.
  registerThirdPartyCookieStripper(session.defaultSession);
}

// App lifecycle events
app.on("ready", async () => {
  // Disable the default application menu since we use a custom frameless window
  // This saves memory and avoids unnecessary menu resource allocation
  Menu.setApplicationMenu(null);

  // Check if last shutdown was clean - if not, clear cache to fix potential corruption
  // "Invalid cache (current) size" errors happen when cache metadata is inconsistent
  const cleanShutdown = wasCleanShutdown();

  if (!cleanShutdown) {
    console.debug("🔍 Detected unclean shutdown, clearing cache to prevent corruption...");
    try {
      await session.defaultSession.clearCache();
      console.debug("🧹 Cleared disk cache");
    } catch (e) {
      console.warn("⚠️ Failed to clear cache:", e);
    }
  } else {
    console.debug("✅ Clean shutdown detected, preserving cache");
  }

  // Mark session as started (remove sentinel until clean shutdown)
  markSessionStarted();

  // Wake-aware Twitch refresh. A laptop that slept across the token's
  // expiry can leave the proactive setTimeout running stale and IRC torn
  // down by Twitch before the renderer notices. On every system resume,
  // re-evaluate the refresh schedule against the current expiry.
  powerMonitor.on("resume", () => {
    twitchAuthService.onSystemResume();
  });

  // Initialize Core Services (Database & Storage)
  // MUST be called after app path configuration and before IPC handlers
  dbService.initialize();
  storageService.initialize();

  // Register custom protocol handler for OAuth callbacks (streamfusion://)
  protocolHandler.registerProtocol();

  // Register kick-image:// streaming image protocol (replaces base64 IPC proxy)
  registerKickImageProtocol();

  // Register twitch-image:// streaming image protocol — swallows per-user
  // 403s from static-cdn.jtvnw.net by returning a 1×1 placeholder so they
  // never reach the renderer's network log.
  registerTwitchImageProtocol();

  // Initialize VAFT pattern service (auto-updates ad detection patterns)
  vaftPatternService.initialize().catch((error) => {
    console.warn("[Main] VAFT pattern service initialization error:", error);
  });

  // Initialize ad blocking services
  cosmeticInjectionService.initialize();

  // Setup request interceptors for CDN domains and ad blocking
  setupRequestInterceptors();

  // One-shot purge so the 8 cookies that accumulated before the stripper was
  // wired up (jtvnw, kick CDN, emote CDNs) don't keep getting read on every
  // cross-site request. Runs once per launch; safe to no-op when the jar is
  // already empty. Fire-and-forget so a slow cookie store doesn't gate the
  // window from opening.
  void purgeStoredThirdPartyCookies(session.defaultSession).catch((e) => {
    console.warn("[Main] Failed to purge stored third-party cookies:", e);
  });

  const mainWindow = windowManager.createMainWindow();

  // Tear down every other BrowserWindow when the main window starts to close.
  // Any hidden helper window (Kick send-window, OAuth popup, future scraper)
  // counts toward `window-all-closed`; if even one is alive after the user
  // clicks X, the event never fires, `app.quit()` is never called, and the
  // Electron process (plus all its child processes — GPU, network service,
  // utility) lingers in the background. Destroy hidden windows first so the
  // process can exit, then reset the send-window module's cached refs.
  mainWindow.on("close", () => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win !== mainWindow && !win.isDestroyed()) {
        try {
          win.destroy();
        } catch {
          // Already gone — ignore.
        }
      }
    }
    void disposeSendWindow();
    authWindowManager.closeAllAuthWindows();
  });

  // Inject cosmetics into main window
  cosmeticInjectionService.injectIntoWindow(mainWindow);

  registerIpcHandlers(mainWindow);

  // Global force-quit shortcut: runs in main process, so it works even when
  // the renderer is at 100% CPU and can't dispatch its own X-button click.
  // Documented in README as the user's manual escape hatch.
  globalShortcut.register("CommandOrControl+Shift+Q", () => {
    console.warn("[Main] Force-quit shortcut pressed");
    markCleanShutdown();
    const win = windowManager.getMainWindow();
    if (win && !win.isDestroyed()) win.destroy();
    app.exit(0);
  });

  console.debug("🌩️ StreamFusion main process started");
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    const mainWindow = windowManager.createMainWindow();
    cosmeticInjectionService.injectIntoWindow(mainWindow);
    registerIpcHandlers(mainWindow);
  }
});

// Hardened before-quit: mark cleanly, signal renderer to fast-teardown, then
// hard-kill if it doesn't finish in 3s. Without the timeout, an HLS buffer
// destroy + chat-service teardown on a heap-pressured renderer can wedge the
// quit path for tens of seconds and the user has to force-kill from the OS.
let isQuitting = false;
app.on("before-quit", (event) => {
  if (isQuitting) return;
  isQuitting = true;
  // `use-resume-playback.ts` saves position every 30s and on pause; chat is
  // ephemeral; window state saves synchronously in mainWindow.on('close').
  // Worst-case loss from this path is the last 30s of playback position.
  markCleanShutdown();

  const win = windowManager.getMainWindow();
  if (!win || win.isDestroyed()) return;

  event.preventDefault();
  try {
    win.webContents.send(IPC_CHANNELS.APP_BEFORE_QUIT);
  } catch {
    // Renderer already gone — nothing to signal.
  }

  // timer-allowlist: force-quit deadline (shutdown)
  const killTimer = setTimeout(() => {
    console.warn("[Main] Renderer didn't quit within 3s — force-destroying");
    if (!win.isDestroyed()) win.destroy();
    app.exit(0);
  }, 3000);

  win.once("closed", () => {
    clearTimeout(killTimer);
    app.exit(0);
  });
});

// Release any global shortcuts before the app exits. Required by Electron
// docs even though our process is about to die — keeps the OS shortcut
// table clean if Electron's exit lingers.
app.on("will-quit", () => {
  try {
    globalShortcut.unregisterAll();
  } catch {
    // Best-effort.
  }
});

// Security: Prevent new window creation from renderer
app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(() => {
    return { action: "deny" };
  });
});

// ============================================================================
// CRASH RECOVERY
// Auto-recover from renderer crashes during long streaming sessions.
// Video decoding + HLS buffers can cause renderer OOM after many hours.
// ============================================================================
app.on("child-process-gone", (_event, details) => {
  console.warn(`[Main] Child process gone: type=${details.type}, reason=${details.reason}`);

  if (details.type === "GPU") {
    // GPU process crash - Chromium will auto-restart it.
    // The network service typically follows the GPU down on Windows, so
    // pre-emptively pause Kick retries to avoid hammering the recovering
    // services with a thundering-herd of net::ERR_FAILED retries.
    console.warn("[Main] GPU process crashed - Chromium will auto-restart");
    void import("./backend/api/platforms/kick/kick-network-health").then((m) =>
      m.recordServiceCrash("GPU crash")
    );
  } else if (details.type === "Utility") {
    // Utility process (e.g. network service) - usually auto-restarts.
    // Mark Kick traffic unhealthy so in-flight retry loops bail out fast
    // instead of cascading ERR_FAILED across every followed channel.
    console.warn("[Main] Utility process crashed");
    void import("./backend/api/platforms/kick/kick-network-health").then((m) =>
      m.recordServiceCrash("Utility crash")
    );
  }
  // Note: Renderer crashes are handled by 'render-process-gone' on webContents
  // We log here for telemetry but don't need manual recovery for renderers
  // since the user would need to reload the page anyway
});

// Handle renderer process crashes with more detail
app.on("web-contents-created", (_event, contents) => {
  contents.on("render-process-gone", (_e, details) => {
    console.error(
      `[Main] Renderer crashed: reason=${details.reason}, exitCode=${details.exitCode}`
    );

    // If OOM killed, log for debugging
    if (details.reason === "oom" || details.reason === "killed") {
      console.error(
        "[Main] Renderer was OOM killed - consider reducing buffer sizes or using BrowserView isolation for video"
      );
    }
  });
});
