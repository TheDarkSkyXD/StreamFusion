/**
 * Window Manager
 *
 * Manages the main window.
 * Handles window state persistence, bounds, and lifecycle.
 */

import path from "node:path";

import { app, BrowserWindow, globalShortcut, screen, shell } from "electron";

import { markCleanShutdown } from "./shutdown-marker";

// No longer using Electron Forge globals - electron-vite provides:
//   - process.env.ELECTRON_RENDERER_URL (dev server URL in development)
//   - __dirname points to out/main/ in production

interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface WindowState {
  bounds: WindowBounds;
  isMaximized: boolean;
}

// In-memory storage for window state (will be replaced with electron-store in Phase 1)
let savedWindowState: WindowState | null = null;

function getDefaultBounds(): WindowBounds {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  return {
    x: Math.floor((width - 1400) / 2),
    y: Math.floor((height - 900) / 2),
    width: 1400,
    height: 900,
  };
}

function ensureWindowIsVisible(bounds: WindowBounds): WindowBounds {
  const displays = screen.getAllDisplays();

  // Check if any part of the window is visible on any display
  const isVisible = displays.some((display) => {
    const { x, y, width, height } = display.bounds;
    return (
      bounds.x < x + width &&
      bounds.x + bounds.width > x &&
      bounds.y < y + height &&
      bounds.y + bounds.height > y
    );
  });

  if (!isVisible) {
    return getDefaultBounds();
  }

  return bounds;
}

// 8s is opinionated: short enough that a frozen renderer doesn't keep the
// user staring at a hung X-button click, long enough that a legitimate slow
// operation (DB migration, large emote cache decode) on a slow machine
// shouldn't trip it. Bump if false-positives appear in dev.
const UNRESPONSIVE_FORCE_QUIT_MS = 8000;

class WindowManager {
  private mainWindow: BrowserWindow | null = null;
  private isDev = process.env.NODE_ENV !== "production";
  /** Tracks the auto-quit timer started by the `unresponsive` listener. */
  private unresponsiveTimer: NodeJS.Timeout | null = null;

  /**
   * Register DevTools keyboard shortcuts (development only)
   */
  private registerDevToolsShortcuts(): void {
    if (!this.isDev || !this.mainWindow) return;

    // Register F12 to toggle DevTools
    globalShortcut.register("F12", () => {
      if (this.mainWindow?.webContents) {
        this.mainWindow.webContents.toggleDevTools();
      }
    });

    // Register Ctrl+Shift+I (Windows/Linux) / Cmd+Shift+I (macOS)
    globalShortcut.register("CommandOrControl+Shift+I", () => {
      if (this.mainWindow?.webContents) {
        this.mainWindow.webContents.toggleDevTools();
      }
    });

    console.debug("🔧 DevTools shortcuts registered (F12, Ctrl+Shift+I)");
  }

  /**
   * Unregister DevTools keyboard shortcuts
   */
  private unregisterDevToolsShortcuts(): void {
    if (!this.isDev) return;
    globalShortcut.unregister("F12");
    globalShortcut.unregister("CommandOrControl+Shift+I");
  }

  /**
   * Create the main application window
   */
  createMainWindow(): BrowserWindow {
    const defaultBounds = getDefaultBounds();
    const bounds = savedWindowState?.bounds
      ? ensureWindowIsVisible(savedWindowState.bounds)
      : defaultBounds;

    this.mainWindow = new BrowserWindow({
      ...bounds,
      minWidth: 1024,
      minHeight: 768,
      backgroundColor: "#0f0f0f",
      show: false,
      frame: false, // Custom title bar
      titleBarStyle: "hidden",
      trafficLightPosition: { x: 12, y: 12 }, // macOS traffic lights position
      webPreferences: {
        // electron-vite outputs preload to out/preload/index.js
        preload: path.join(__dirname, "../preload/index.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false, // Disabled to allow preload IPC
        webSecurity: false, // Allow CORS for video streams
        backgroundThrottling: false, // Prevent Chromium from pausing media when window is minimized
      },
    });

    // Restore maximized state
    if (savedWindowState?.isMaximized) {
      this.mainWindow.maximize();
    }

    // Show when ready
    this.mainWindow.once("ready-to-show", () => {
      this.mainWindow?.show();
    });

    // Save window state on close
    this.mainWindow.on("close", () => {
      if (this.mainWindow) {
        savedWindowState = {
          bounds: this.mainWindow.getBounds(),
          isMaximized: this.mainWindow.isMaximized(),
        };
      }
    });

    // Auto-force-close when the renderer stops responding to input. This is
    // the primary fix for the "click X, nothing happens, force-quit from the
    // OS" failure mode: the click never reaches main because the renderer's
    // event loop is wedged at 100% CPU. Electron's `unresponsive` event
    // fires when the renderer hasn't responded to input pings within ~30s,
    // so we layer a shorter 8s timer on top — if it doesn't recover, mark
    // cleanly (preserves cache on next launch) and destroy.
    this.mainWindow.on("unresponsive", () => {
      console.warn(
        `[WindowManager] Renderer unresponsive — starting ${UNRESPONSIVE_FORCE_QUIT_MS}ms force-quit timer`
      );
      if (this.unresponsiveTimer) clearTimeout(this.unresponsiveTimer);
      this.unresponsiveTimer = setTimeout(() => {
        console.warn(
          `[WindowManager] Renderer still unresponsive after ${UNRESPONSIVE_FORCE_QUIT_MS}ms — force-destroying`
        );
        markCleanShutdown();
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
          this.mainWindow.destroy();
        }
        app.exit(0);
      }, UNRESPONSIVE_FORCE_QUIT_MS);
    });

    this.mainWindow.on("responsive", () => {
      if (this.unresponsiveTimer) {
        clearTimeout(this.unresponsiveTimer);
        this.unresponsiveTimer = null;
        console.debug("[WindowManager] Renderer recovered before force-close timer");
      }
    });

    // Handle window closed
    this.mainWindow.on("closed", () => {
      this.unregisterDevToolsShortcuts();
      if (this.unresponsiveTimer) {
        clearTimeout(this.unresponsiveTimer);
        this.unresponsiveTimer = null;
      }
      this.mainWindow = null;
    });

    // Load the app - electron-vite provides ELECTRON_RENDERER_URL in dev
    if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
      this.mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      this.mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
    }

    // Ensure any target="_blank" navigations open in the system browser
    this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: "deny" };
    });

    // Development only: Open DevTools and register shortcuts
    if (this.isDev) {
      this.mainWindow.webContents.openDevTools();
      this.registerDevToolsShortcuts();
    }

    return this.mainWindow;
  }

  /**
   * Get the main window instance
   */
  getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }
}

// Singleton instance
export const windowManager = new WindowManager();
