/**
 * Host renderer auto-recovery (PRD #51 slice 01, issue #52).
 *
 * Listens for `render-process-gone` on the host BrowserWindow's webContents
 * and, when the reason is `oom` or `killed`, reloads the host URL so the user
 * lands back on the same page instead of staring at a blank window. Route /
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

import { logger } from "@/backend/logging/logger";

export interface InstallOpts {
  webContents: WebContents;
}

interface RenderProcessGoneDetails {
  reason: string;
  exitCode: number;
}

// `oom` covers the Linux OOM killer; `killed` covers Windows / macOS
// equivalents and generic forced termination. Other reasons (`crashed`,
// `clean-exit`, `abnormal-exit`, `launch-failed`, `integrity-failure`) are
// intentionally not auto-recovered — they are either user-initiated or
// indicate a deeper problem where an automatic reload would just loop.
const RECOVERABLE_REASONS = new Set(["oom", "killed"]);

export function installRendererCrashRecovery(opts: InstallOpts): () => void {
  const { webContents } = opts;

  const onGone = (_event: unknown, details: RenderProcessGoneDetails): void => {
    if (!RECOVERABLE_REASONS.has(details.reason)) return;
    if (webContents.isDestroyed()) return;
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
