/**
 * StreamStorm - Main Process Entry Point
 *
 * This is the Electron main process that handles window creation,
 * system integration, and IPC communication with the renderer.
 */

// Load environment variables from .env file FIRST (before other imports)
import "dotenv/config";

import * as fs from "node:fs";
import * as path from "node:path";
import { app, BrowserWindow, Menu, session } from "electron";

import { protocolHandler } from "./backend/auth";
import { registerIpcHandlers } from "./backend/ipc-handlers";
import { cosmeticInjectionService } from "./backend/services/cosmetic-injection-service";
import { dbService } from "./backend/services/database-service";
import { networkAdBlockService } from "./backend/services/network-adblock-service";
import { storageService } from "./backend/services/storage-service";
import { twitchManifestProxy } from "./backend/services/twitch-manifest-proxy";
import { vaftPatternService } from "./backend/services/vaft-pattern-service";
import { windowManager } from "./backend/window-manager";

// Enable Chrome DevTools Protocol for Playwright/Electron MCP connectivity (development only)
// This allows external tools to connect to the running Electron app at ws://localhost:9222
// In production builds (electron-forge package/make), NODE_ENV is typically "production"
const isProduction = process.env.NODE_ENV === "production" || app.isPackaged;

if (!isProduction) {
  // Use a separate user data directory for development to allow running dev and prod simultaneously
  const userDataPath = app.getPath("userData");
  const devUserDataPath = `${userDataPath} (Dev)`;
  app.setPath("userData", devUserDataPath);
  console.debug(`📂 Development mode: User data path set to ${devUserDataPath}`);

  app.commandLine.appendSwitch("remote-debugging-port", "9222");
  console.debug("🔌 CDP remote debugging enabled on port 9222 for Playwright MCP");
} else {
  app.commandLine.appendSwitch("remote-debugging-port", "9005");
  console.debug("🔌 CDP remote debugging enabled on port 9005 for Production");
}

// Sentinel file to track clean shutdown
// explicit call to getPath to ensure we use the updated path if set above
const CLEAN_SHUTDOWN_FILE = path.join(app.getPath("userData"), ".clean-shutdown");

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

/**
 * Check if the last shutdown was clean (sentinel file exists)
 * If not, the app likely crashed and cache may be corrupted
 */
function wasCleanShutdown(): boolean {
  try {
    return fs.existsSync(CLEAN_SHUTDOWN_FILE);
  } catch {
    return false;
  }
}

/**
 * Mark the current session as running (remove sentinel)
 * Sentinel will be written back on clean shutdown
 */
function markSessionStarted(): void {
  try {
    if (fs.existsSync(CLEAN_SHUTDOWN_FILE)) {
      fs.unlinkSync(CLEAN_SHUTDOWN_FILE);
    }
  } catch (e) {
    console.warn("⚠️ Failed to remove clean shutdown marker:", e);
  }
}

/**
 * Mark the session as cleanly shutdown (write sentinel)
 */
function markCleanShutdown(): void {
  try {
    fs.writeFileSync(CLEAN_SHUTDOWN_FILE, new Date().toISOString());
  } catch (e) {
    console.warn("⚠️ Failed to write clean shutdown marker:", e);
  }
}

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
  // Adds 'data:' to connect-src to allow blank video segment replacement
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
              return csp.replace(/connect-src\s+([^;]+)/, "connect-src $1 data: blob:");
            }
            return csp;
          });
        }
      }

      callback({ responseHeaders: headers });
    }
  );
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

  // Initialize Core Services (Database & Storage) 
  // MUST be called after app path configuration and before IPC handlers
  dbService.initialize();
  storageService.initialize();

  // Register custom protocol handler for OAuth callbacks (streamstorm://)
  protocolHandler.registerProtocol();

  // Initialize VAFT pattern service (auto-updates ad detection patterns)
  vaftPatternService.initialize().catch((error) => {
    console.warn("[Main] VAFT pattern service initialization error:", error);
  });

  // Initialize ad blocking services
  cosmeticInjectionService.initialize();

  // Setup request interceptors for CDN domains and ad blocking
  setupRequestInterceptors();

  const mainWindow = windowManager.createMainWindow();

  // Inject cosmetics into main window
  cosmeticInjectionService.injectIntoWindow(mainWindow);

  registerIpcHandlers(mainWindow);
  console.debug("🌩️ StreamStorm main process started");
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

// Mark clean shutdown before quitting
app.on("before-quit", () => {
  markCleanShutdown();
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
    // GPU process crash - Chromium will auto-restart it
    console.warn("[Main] GPU process crashed - Chromium will auto-restart");
  } else if (details.type === "Utility") {
    // Utility process (e.g. network service) - usually auto-restarts
    console.warn("[Main] Utility process crashed");
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
