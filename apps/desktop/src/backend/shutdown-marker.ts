/**
 * Clean-shutdown sentinel marker.
 *
 * Lives in its own module so both `main.ts` (normal `before-quit` path) and
 * `window-manager.ts` (force-kill on `unresponsive`) can call it without
 * forming a circular import. The next launch reads the sentinel for startup
 * diagnostics and removes it when the new session begins. Marker state never
 * authorizes deletion of Chromium cache or other user data.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { app } from "electron";

import { logger } from "@/backend/logging/logger";

let cachedPath: string | null = null;

function getMarkerPath(): string {
  if (cachedPath) return cachedPath;
  // Resolved lazily so it picks up the dev-mode path override from main.ts
  // (which mutates `app.setPath('userData', …)` before any window is created).
  cachedPath = path.join(app.getPath("userData"), ".clean-shutdown");
  return cachedPath;
}

export function markCleanShutdown(): void {
  try {
    fs.writeFileSync(getMarkerPath(), new Date().toISOString());
  } catch (e) {
    logger.warn("Main:Shutdown", "Failed to write clean shutdown marker", {
      error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : String(e),
    });
  }
}

export function wasCleanShutdown(): boolean {
  try {
    return fs.existsSync(getMarkerPath());
  } catch {
    return false;
  }
}

export function markSessionStarted(): void {
  try {
    const marker = getMarkerPath();
    if (fs.existsSync(marker)) {
      fs.unlinkSync(marker);
    }
  } catch (e) {
    logger.warn("Main:Shutdown", "Failed to remove clean shutdown marker", {
      error: e instanceof Error ? { name: e.name, message: e.message, stack: e.stack } : String(e),
    });
  }
}
