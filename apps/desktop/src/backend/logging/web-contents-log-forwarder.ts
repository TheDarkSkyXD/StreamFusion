/**
 * Forwards `console.{warn,error}` messages from a `WebContents` into the
 * project logger. Closes gaps where DevTools shows messages from surfaces
 * the main-renderer console intercept can't reach — sub-windows (OAuth,
 * hidden helpers) and out-of-main-frame contexts inside the main window
 * (iframes, workers).
 *
 * Why warn+error and not all levels: info/log/debug from third-party pages
 * (kick.com analytics, ad-tag scripts) would flood the session log with
 * non-actionable noise. Warn and error are what matters for "this looks
 * broken — what happened?" investigations.
 *
 * Electron's `console-message` event reports `level` as a string in
 * modern versions and as a number in older ones. Handle both shapes.
 */

import type { WebContents } from "electron";

import { logger } from "@backend/logging/logger";

type ConsoleLevel = "warn" | "error";

const PUSHER_CLOSED_SOCKET_MESSAGE = "WebSocket is already in CLOSING or CLOSED state.";
const PUSHER_JS_SOURCE = /(?:^|\/)pusher-js(?:\.js)?(?:\?|$)/;

function normalizeLevel(level: unknown): ConsoleLevel | null {
  // String form (Electron >= 28): "verbose" | "info" | "warning" | "error".
  // Some versions emit "warn" instead of "warning" — accept either.
  if (typeof level === "string") {
    const l = level.toLowerCase();
    if (l === "error") return "error";
    if (l === "warn" || l === "warning") return "warn";
    return null;
  }
  // Numeric form (older Electron): 0=verbose, 1=info, 2=warning, 3=error.
  if (typeof level === "number") {
    if (level === 3) return "error";
    if (level === 2) return "warn";
    return null;
  }
  return null;
}

function isHarmlessConsoleNoise(message: string, meta: Record<string, unknown>): boolean {
  return (
    message === PUSHER_CLOSED_SOCKET_MESSAGE &&
    typeof meta.source === "string" &&
    PUSHER_JS_SOURCE.test(meta.source)
  );
}

export interface ForwardOpts {
  /** Full tag string to write under — the logger prepends nothing. */
  tag: string;
}

/**
 * Wire `console-message` on a `WebContents` so warn+error lines from any
 * of its frames land in the session log. Safe to call once per WebContents.
 */
export function forwardWebContentsConsole(webContents: WebContents, opts: ForwardOpts): void {
  webContents.on("console-message", (details: unknown) => {
    // `details` may be the event-object form (Electron >= 35) or the
    // positional-args form (older). Read both shapes defensively.
    const d = details as {
      level?: unknown;
      message?: unknown;
      sourceId?: unknown;
      lineNumber?: unknown;
    };
    const mapped = normalizeLevel(d?.level);
    if (!mapped) return;
    const message = typeof d?.message === "string" ? d.message : String(d?.message ?? "");
    const meta: Record<string, unknown> = {};
    if (typeof d?.sourceId === "string" && d.sourceId.length > 0) meta.source = d.sourceId;
    if (typeof d?.lineNumber === "number") meta.line = d.lineNumber;
    if (isHarmlessConsoleNoise(message, meta)) {
      logger.debug(opts.tag, message, Object.keys(meta).length > 0 ? meta : undefined);
      return;
    }
    logger[mapped](opts.tag, message, Object.keys(meta).length > 0 ? meta : undefined);
  });
}
