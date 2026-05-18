/**
 * Clean-shutdown sentinel marker.
 *
 * Lives in its own module so both `main.ts` (normal `before-quit` path) and
 * `window-manager.ts` (force-kill on `unresponsive`) can call it without
 * forming a circular import. The next launch reads the sentinel via
 * `wasCleanShutdown()` to decide whether to wipe the disk cache.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { app } from "electron";

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
    console.warn("⚠️ Failed to write clean shutdown marker:", e);
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
    console.warn("⚠️ Failed to remove clean shutdown marker:", e);
  }
}
