/**
 * Host renderer auto-recovery (PRD #51 slice 01, issue #52).
 *
 * Listens for `render-process-gone` on the host BrowserWindow's webContents
 * and reloads one unexpected loss so the user lands back on the same page
 * instead of staring at a blank window. A repeated or integrity-related loss
 * opens a static safe-mode page rather than entering a reload loop. Route /
 * navigation state is preserved by construction because the SPA's route lives
 * in the URL itself; `webContents.reload()` reloads the current URL.
 *
 * In-memory renderer state (open dropdowns, pending form input, transient
 * client-side caches) is lost — preserving that across a renderer crash would
 * require persisting state into main before the crash, which is architectural
 * work outside the slice. See PRD #51 future slices for stream-slot state
 * survival across host reloads (slot WCVs are owned by main).
 *
 * The webContents handle is injected so this module stays unit-testable under
 * plain Node without booting an Electron runtime, mirroring
 * `backend/logging/crash-hooks.ts`.
 */

import type { WebContents } from "electron";

import { isAllowedSenderUrl } from "@/backend/ipc/sender-origin";
import { logger } from "@/backend/logging/logger";

export interface InstallOpts {
  webContents: WebContents;
}

interface RenderProcessGoneDetails {
  reason: string;
  exitCode: number;
}

const AUTO_RELOAD_REASONS = new Set(["oom", "killed", "crashed", "abnormal-exit"]);
const SAFE_MODE_REASONS = new Set(["launch-failed", "integrity-failure"]);
const CRASH_LOOP_WINDOW_MS = 60_000;

function safeModeDocument(reason: string, appUrl: string): string {
  const safeReason = reason.replaceAll(/[^a-z-]/g, "");
  const reloadLink = isAllowedSenderUrl(appUrl)
    ? `<a href="${appUrl.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}">Reload StreamFusion</a>`
    : "<p>Close and reopen StreamFusion to try again.</p>";
  const html = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><title>StreamFusion recovery</title><style>body{margin:0;background:#111318;color:#fff;font:16px system-ui;display:grid;min-height:100vh;place-items:center}.card{max-width:34rem;padding:2rem;border:1px solid #545a66;border-radius:14px;background:#1b1e25;text-align:center}p{color:#b9bec8;line-height:1.5}a{display:inline-block;margin-top:1rem;padding:.7rem 1rem;border-radius:8px;background:#7c5cff;color:#fff;text-decoration:none;font-weight:700}</style><main class="card"><h1>StreamFusion entered safe mode</h1><p>The renderer stopped repeatedly (${safeReason || "unknown"}). Your saved data was not removed.</p>${reloadLink}</main>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

export function installRendererCrashRecovery(opts: InstallOpts): () => void {
  const { webContents } = opts;
  const failures: number[] = [];

  const onGone = (_event: unknown, details: RenderProcessGoneDetails): void => {
    if (details.reason === "clean-exit") return;
    if (webContents.isDestroyed()) return;
    const now = Date.now();
    failures.push(now);
    while (failures[0] !== undefined && failures[0] < now - CRASH_LOOP_WINDOW_MS) {
      failures.shift();
    }

    if (SAFE_MODE_REASONS.has(details.reason) || failures.length > 1) {
      logger.error("CrashRecovery", "host-renderer-safe-mode", {
        reason: details.reason,
        exitCode: details.exitCode,
        failures: failures.length,
      });
      void webContents
        .loadURL(safeModeDocument(details.reason, webContents.getURL()))
        .catch((error: unknown) => {
          logger.error("CrashRecovery", "host-renderer-safe-mode-load-failed", {
            reason: details.reason,
            error: error instanceof Error ? { name: error.name } : undefined,
          });
        });
      return;
    }
    if (!AUTO_RELOAD_REASONS.has(details.reason)) return;
    logger.warn("CrashRecovery", "host-renderer-auto-reload", {
      reason: details.reason,
      exitCode: details.exitCode,
    });
    webContents.reload();
  };

  (webContents as unknown as NodeJS.EventEmitter).on("render-process-gone", onGone);

  return function uninstall(): void {
    (webContents as unknown as NodeJS.EventEmitter).removeListener("render-process-gone", onGone);
  };
}
