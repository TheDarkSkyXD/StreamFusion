/**
 * StreamFusion - Main Process Entry Point
 *
 * This is the Electron main process that handles window creation,
 * system integration, and IPC communication with the renderer.
 */

// Load environment variables from .env file FIRST (before other imports)
import "dotenv/config";

import { randomUUID } from "node:crypto";
import path from "node:path";

import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  Menu,
  protocol,
  session,
  shell,
} from "electron";
import { configureAppIdentity } from "./backend/app-identity";
import { protocolHandler } from "./backend/auth/protocol-handler";
import { registerIpcHandlers } from "./backend/ipc-handlers";
import { startChromiumLogTailer } from "./backend/logging/chromium-log-tailer";
import { installConsoleIntercept } from "./backend/logging/console-intercept";
import { installCrashHooks } from "./backend/logging/crash-hooks";
import { computeLogPaths, setBugReportsDir, setTelemetryDir } from "./backend/logging/log-paths";
import { getCurrentLogPath, initLogger, logger, shutdownLogger } from "./backend/logging/logger";
import { installNativeStderrIntercept } from "./backend/logging/native-stderr-intercept";
import { installNetworkDevtoolsRecorder } from "./backend/logging/network-devtools-recorder";
import { installNetworkLogRouter } from "./backend/logging/network-log-router";
import {
  getCurrentNetworkPath,
  initNetworkLogger,
  shutdownNetworkLogger,
} from "./backend/logging/network-logger";
import {
  getCurrentNoisePath,
  initNoiseLogger,
  shutdownNoiseLogger,
} from "./backend/logging/noise-logger";
import { startProcessMonitor } from "./backend/logging/process-monitor";
import { redactObject } from "./backend/logging/redactor";
import { pruneLogs } from "./backend/logging/rotation";
import {
  KICK_IMAGE_SCHEME,
  registerKickImageProtocol,
} from "./backend/protocols/kick-image-protocol";
import {
  registerTwitchClipMediaProtocol,
  TWITCH_CLIP_MEDIA_SCHEME_PRIVILEGES,
} from "./backend/protocols/twitch-clip-media-protocol";
import { TWITCH_CLIP_MEDIA_SCHEME } from "./backend/protocols/twitch-clip-media-url";
import {
  registerTwitchImageProtocol,
  TWITCH_IMAGE_SCHEME,
} from "./backend/protocols/twitch-image-protocol";
import { installRendererCrashRecovery } from "./backend/recovery/renderer-crash-recovery";
import { getPlatformCrashBackoffDecision } from "./backend/recovery/platform-crash-backoff-policy";
import { attachCertVerifyDiagToAllSessions } from "./backend/services/cert-verify-diagnostics";
import { dbService } from "./backend/services/database-service";
import { storageService } from "./backend/services/storage-service";
import { markCleanShutdown, markSessionStarted, wasCleanShutdown } from "./backend/shutdown-marker";
import { runLoadedFeatureCleanups } from "./backend/startup/loaded-feature-cleanup";
import { startPrimaryInstance } from "./backend/startup/start-primary-instance";
import { openStartupRecoveryWindow } from "./backend/startup/startup-recovery-window";
import { beginStartupSession } from "./backend/startup/startup-session-policy";
import { windowManager } from "./backend/window-manager";
import { setMainLogSink } from "./lib/cross-logger";
import {
  pruneStaleChromiumDiskCaches,
  resolveChromiumDiskCachePath,
} from "./lib/chromium-cache-path";
import { resolveUserDataPath } from "./lib/user-data-path";
import { IPC_CHANNELS } from "./shared/ipc-channels";

// Enable Chrome DevTools Protocol for Playwright/Electron MCP connectivity (development only)
// In production builds (electron-forge package/make), NODE_ENV is typically "production"
const isProduction = process.env.NODE_ENV === "production" || app.isPackaged;

// Keep Windows taskbar grouping/identity aligned with electron-builder's appId.
// This must run before the first BrowserWindow is created.
configureAppIdentity(app, { platform: process.platform, isPackaged: app.isPackaged });

const defaultUserDataPath = app.getPath("userData");
const userDataPath = resolveUserDataPath({
  argv: process.argv,
  defaultPath: defaultUserDataPath,
  isProduction,
});
app.setPath("userData", userDataPath);

// Chromium's blockfile cache is disposable, unlike the auth, settings, cookie,
// and SQLite state under userData. Give every process its own temp cache so an
// overlapping proof/dev launch or an unclean shutdown cannot corrupt the next
// process's cache. The OS may reclaim these directories at any time.
const chromiumDiskCachePath = resolveChromiumDiskCachePath({
  tempPath: app.getPath("temp"),
  userDataPath,
  processId: process.pid,
  launchId: randomUUID(),
});
app.setPath("cache", chromiumDiskCachePath);
app.commandLine.appendSwitch("disk-cache-dir", chromiumDiskCachePath);

// Opt-in net log capture (STREAMFUSION_NETLOG=1) for diagnosing TLS / cert /
// fetch failures invisible at the JS layer. Must run before app.whenReady().
// Writes to userData/netlog-<timestamp>.json; finalized on clean app quit.
if (process.env.STREAMFUSION_NETLOG) {
  const netlogPath = `${app.getPath("userData")}\\netlog-${Date.now()}.json`;
  app.commandLine.appendSwitch("log-net-log", netlogPath);
  app.commandLine.appendSwitch("net-log-capture-mode", "IncludeSensitive");
  console.log(`📊 [netlog] Capture enabled → ${netlogPath}`);
}

if (!isProduction) {
  // Suppress the (Disabled webSecurity) + (allowRunningInsecureContent) dev
  // warnings the renderer prints on every launch. The posture is intentional
  // (window-manager.ts:132 — needed for cross-origin video stream playback)
  // and tracked separately in the worker-auth/proxy-removal brainstorm; the
  // warnings just bury real signal in the dev console. Production builds
  // suppress them automatically, so gate strictly to dev.
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";

  // Use a separate user data directory for development unless the launch explicitly supplies one.
  console.debug(`📂 Development mode: User data path set to ${userDataPath}`);

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

// Initialize the logging system as early as possible — must run AFTER the
// dev/prod userData override above so log files land in the matching profile
// dir, and BEFORE any service import below executes a console.* call we'd
// want captured.
//
// Log destination depends on the environment (computeLogPaths is pure — see
// log-paths.ts for the rules):
//   - dev:  <repo-root>/logs + /bug-reports — survive `git clean -fd` review
//   - win:  <installDir>/logs + /bug-reports — NSIS perMachine:false is writable
//   - mac/linux prod: app.getPath('logs') — install bundle is read-only
//
// Dev repo-root anchor: `npm start` runs from apps/desktop/, so process.cwd()
// is apps/desktop/, and the repo root is two levels up. We pass it
// unconditionally; computeLogPaths only consumes it in dev.
let logsDir: string;

function initializeBeforeReady(): void {
  const sessionStamp = new Date().toISOString();
  const {
    logsDir: sessionLogsDir,
    bugReportsDir,
    telemetryDir,
  } = computeLogPaths({
    isPackaged: app.isPackaged,
    platform: process.platform,
    exePath: app.getPath("exe"),
    fallbackLogsPath: app.getPath("logs"),
    projectRoot: path.resolve(process.cwd(), "..", ".."),
  });
  logsDir = sessionLogsDir;
  setBugReportsDir(bugReportsDir);
  setTelemetryDir(telemetryDir);

  // Tell Chromium to write its native logs (e.g. `ssl_client_socket_impl`
  // handshake failures, GPU errors) into a file we own. The native-stderr
  // intercept catches Node-side writes, but Chromium's C++ code writes
  // straight to the OS file descriptor and bypasses that path. Routing to
  // a file we can tail closes that gap. Filename mirrors the main session
  // log so on-disk lifecycle matches.
  const chromiumLogPath = path.join(
    logsDir,
    `streamfusion-chromium-${sessionStamp.replace(/[:.]/g, "-")}.log`
  );
  app.commandLine.appendSwitch("enable-logging", "file");
  app.commandLine.appendSwitch("log-file", chromiumLogPath);

  initLogger({ logsDir, sessionStamp });
  initNoiseLogger({ logsDir, sessionStamp });
  initNetworkLogger({ logsDir, sessionStamp });
  installCrashHooks({ app });
  installConsoleIntercept();

  // This runs only for the primary instance. Remove cache directories whose
  // owning process no longer exists, while preserving the current launch and
  // any concurrently running proof profile. The helper refuses roots that
  // overlap persistent userData.
  void pruneStaleChromiumDiskCaches({
    cacheRoot: path.dirname(chromiumDiskCachePath),
    currentCachePath: chromiumDiskCachePath,
    userDataPath,
  }).catch((error) => {
    logger.warn("Main", "Failed to prune stale Chromium disk caches", {
      error: String(error),
    });
  });

  // Wire dual-use modules (those imported by both main and renderer code) to the
  // real backend logger. They import `@/lib/cross-logger` instead of
  // `@/backend/logging/logger` to avoid dragging electron-log into the renderer
  // bundle; this call swaps in the real sink for main-process callers.
  setMainLogSink((level, tag, message, meta) => {
    logger[level](tag, message, meta);
  });

  installNetworkLogRouter();

  // Capture lines written directly to process.stderr / process.stdout by
  // native Chromium / Electron internals. Must come AFTER initLogger /
  // installConsoleIntercept / setMainLogSink so all logging routes are live
  // before native intercept goes hot — and once installed, lives for the
  // process lifetime (no uninstall on quit).
  installNativeStderrIntercept();

  // Tail the Chromium native log into the session log. Picks up the lines
  // that bypass process.stderr (ssl_client_socket_impl, gpu errors, etc.)
  // since they go straight to the OS file descriptor. The flags configured
  // above route those lines to chromiumLogPath; this watcher forwards each
  // append into `logger` under the "Chromium" tag.
  startChromiumLogTailer({ filePath: chromiumLogPath });

  protocolHandler.registerProtocol({ resolveMainWindow: () => windowManager.getMainWindow() });
  logger.info("Main", "Logging initialized", {
    logFile: getCurrentLogPath(),
    networkLogFile: getCurrentNetworkPath(),
    bugReportsDir,
  });
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
  {
    scheme: TWITCH_CLIP_MEDIA_SCHEME,
    privileges: TWITCH_CLIP_MEDIA_SCHEME_PRIVILEGES,
  },
]);

startPrimaryInstance(app, {
  beforeReady: initializeBeforeReady,
  ready: initializeReady,
});

// App lifecycle events
let stopProcessMonitor: (() => void) | null = null;
let devRelayServer: { close(): Promise<void> } | null = null;
let startupRecoveryDiagnosticId: string | null = null;

function showStartupRecoveryOrExit(diagnosticId: string): void {
  try {
    openStartupRecoveryWindow(diagnosticId);
  } catch (recoveryError) {
    logger.error("Main", "Could not open startup recovery window", {
      diagnosticId,
      error: recoveryError instanceof Error ? { name: recoveryError.name } : undefined,
    });
    dialog.showErrorBox(
      "StreamFusion couldn’t start safely",
      `Your saved data was not removed. Restart the app and include diagnostic ID ${diagnosticId} if this repeats.`
    );
    app.exit(1);
  }
}

async function initializeReady(): Promise<void> {
  if (process.env.STREAMFUSION_BROWSER_DEV === "1") {
    const { startConfiguredDevRelay } = await import("./backend/dev-relay/dev-relay-runtime");
    devRelayServer = await startConfiguredDevRelay({
      isPackaged: app.isPackaged,
      environment: process.env,
      rendererUrl: process.env.ELECTRON_RENDERER_URL,
      fetchMedia: (input, init) => fetch(input, init),
    });
  }

  // Custom frameless window uses its own titlebar UI, but we still need a
  // minimal application menu so OS-standard shortcuts (Copy/Paste, Reload,
  // DevTools, Quit) keep working and the Help menu's log-folder/log-path
  // affordances are reachable from the OS menu bar (macOS) / Alt menu (Win).
  const menu = Menu.buildFromTemplate([
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        {
          label: "Open Logs Folder",
          click: () => {
            void shell.openPath(path.dirname(getCurrentLogPath()));
          },
        },
        {
          label: "Copy Log Path",
          click: () => {
            clipboard.writeText(getCurrentLogPath());
          },
        },
        {
          label: "Copy Noise Log Path",
          click: () => {
            try {
              clipboard.writeText(getCurrentNoisePath());
            } catch {
              // Noise logger not initialized — silently skip rather than throw
              // out of a menu click.
            }
          },
        },
        {
          label: "Copy Network Log Path",
          click: () => {
            try {
              clipboard.writeText(getCurrentNetworkPath());
            } catch {
              // Network logger not initialized — silently skip rather than throw.
            }
          },
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  // Fire-and-forget prune of old session logs. Awaiting would gate window
  // creation on disk IO; surfacing failures via logger.warn is sufficient.
  void pruneLogs(logsDir, { prefix: "streamfusion-", keep: 10 }).catch((error) => {
    logger.warn("Main", "Failed to prune main log files", { error: String(error) });
  });
  void pruneLogs(logsDir, { prefix: "streamfusion-noise-", keep: 10 }).catch((error) => {
    logger.warn("Main", "Failed to prune noise log files", { error: String(error) });
  });
  void pruneLogs(logsDir, { prefix: "streamfusion-network-", keep: 10 }).catch((error) => {
    logger.warn("Main", "Failed to prune network log files", { error: String(error) });
  });

  beginStartupSession({ wasCleanShutdown, markSessionStarted, logger });

  // Cert-error diagnostic logger. Custom partitions + the utility/network
  // process never touch session.defaultSession, so the proc has to fan out
  // across every session — see cert-verify-diagnostics.ts for details.
  attachCertVerifyDiagToAllSessions(app, session.defaultSession);

  // Initialize Core Services (Database & Storage)
  // MUST be called after app path configuration and before IPC handlers
  try {
    dbService.initialize();
    storageService.initialize();
  } catch (error) {
    const diagnosticId = randomUUID();
    startupRecoveryDiagnosticId = diagnosticId;
    logger.error("Main", "Durable service initialization failed", {
      diagnosticId,
      error: error instanceof Error ? error.message : String(error),
    });
    showStartupRecoveryOrExit(diagnosticId);
    return;
  }

  // Dump effective user preferences once at boot so bug reports include the
  // user-visible configuration. redactObject scrubs any token-shaped strings
  // that might have leaked into preference values via copy/paste. Cast to the
  // logger's meta shape — preferences is a typed record but its concrete keys
  // are statically known, which is not assignable to Record<string, unknown>.
  try {
    const preferences = storageService.getPreferences();
    const redacted = redactObject(preferences) as unknown as Record<string, unknown>;
    logger.info("Main", "Settings dump", redacted);
  } catch (error) {
    logger.warn("Main", "Could not dump settings", { error: String(error) });
  }

  // Start the resource probe. Stored at module scope so before-quit can stop
  // it before the logger shuts down.
  stopProcessMonitor = startProcessMonitor();

  // Register kick-image:// streaming image protocol (replaces base64 IPC proxy)
  registerKickImageProtocol();

  // Register twitch-image:// streaming image protocol — swallows per-user
  // 403s from static-cdn.jtvnw.net by returning a 1×1 placeholder so they
  // never reach the renderer's network log.
  registerTwitchImageProtocol();

  // Register twitch-clip-media:// so Twitch clip MP4s stay in the custom player
  // while Electron's main process handles the signed CDN media request.
  registerTwitchClipMediaProtocol();

  const mainWindow = windowManager.createMainWindow();
  installRendererCrashRecovery({ webContents: mainWindow.webContents });

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
  });

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
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    if (startupRecoveryDiagnosticId) {
      showStartupRecoveryOrExit(startupRecoveryDiagnosticId);
      return;
    }
    const mainWindow = windowManager.createMainWindow();
    installRendererCrashRecovery({ webContents: mainWindow.webContents });
    registerIpcHandlers(mainWindow);
  }
});

// Hardened before-quit: mark cleanly, signal renderer to fast-teardown and
// close through its trusted window route, then hard-kill if it doesn't finish
// in 3s. Without the timeout, an HLS buffer
// destroy + chat-service teardown on a heap-pressured renderer can wedge the
// quit path for tens of seconds and the user has to force-kill from the OS.
let isQuitting = false;
app.on("before-quit", (event) => {
  if (isQuitting) return;
  isQuitting = true;
  logger.info("App", "Quitting");
  // Stop the resource probe synchronously — any subsequent tick would race
  // the logger shutdown below.
  if (stopProcessMonitor) {
    stopProcessMonitor();
    stopProcessMonitor = null;
  }
  const featureCleanup = runLoadedFeatureCleanups();
  // `use-resume-playback.ts` saves position every 30s and on pause; chat is
  // ephemeral; window state saves synchronously in mainWindow.on('close').
  // Worst-case loss from this path is the last 30s of playback position.
  markCleanShutdown();

  // Flush the loggers before the process exits. electron-log 5.x writes
  // synchronously, so the awaits are short-lived; we still gate `app.exit`
  // on them so the trailing "Debug closed" header makes it to disk.
  const finalize = async (): Promise<void> => {
    await featureCleanup;
    try {
      await devRelayServer?.close();
      devRelayServer = null;
    } catch {
      // Best-effort — a closing development relay must never block app exit.
    }
    try {
      await shutdownLogger();
    } catch {
      // Best-effort — never block exit on logger teardown.
    }
    try {
      await shutdownNoiseLogger();
    } catch {
      // Best-effort.
    }
    try {
      await shutdownNetworkLogger();
    } catch {
      // Best-effort.
    }
  };

  const win = windowManager.getMainWindow();
  if (!win || win.isDestroyed()) {
    void finalize();
    return;
  }

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
    void finalize().finally(() => app.exit(0));
  }, 3000);

  win.once("closed", () => {
    clearTimeout(killTimer);
    void finalize().finally(() => app.exit(0));
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
  installNetworkDevtoolsRecorder(contents);
  contents.setWindowOpenHandler(() => {
    return { action: "deny" };
  });
});

// ============================================================================
// CRASH RECOVERY
// GPU / utility child-process loss is mirrored into PlatformHealth so in-flight
// retry loops bail out fast instead of cascading net::ERR_FAILED. Host
// renderer auto-reload on oom/killed lives in `installRendererCrashRecovery`
// (wired against `mainWindow.webContents` above). Structured logging of every
// `render-process-gone` event is owned by `installCrashHooks` (CrashHooks tag).
// ============================================================================
app.on("child-process-gone", (_event, details) => {
  const decision = getPlatformCrashBackoffDecision(details);
  if (!decision) return;

  void import("./backend/api/unified/platform-health").then((m) => {
    for (const platform of decision.platforms) {
      m.recordPlatformCrash(platform, decision.reason);
    }
  });
});
