/**
 * Sender-origin validation for security-sensitive IPC handlers.
 *
 * Context: the main BrowserWindow runs with `webSecurity: false` (needed for
 * cross-origin video playback — see window-manager.ts). That invalidates the
 * implicit assumption that the renderer only ever loads the app's own bundle:
 * any content the renderer navigates to / injects could call a privileged IPC
 * channel. See docs/solutions/integration-issues/
 * preload-auth-gettoken-no-sender-origin-check-2026-05-22.md.
 *
 * This helper is the "sender-frame allowlist" mitigation (option 2 in that
 * doc): security-sensitive handlers reject any call whose `event.senderFrame`
 * origin is not the app's own renderer. Allowed origins:
 *
 *   - Production: the app loads `file://.../renderer/index.html`.
 *   - Development: electron-vite serves the renderer from a localhost dev
 *     server (`http://localhost:<port>` / `http://127.0.0.1:<port>`). The port
 *     varies by config, so we allow any loopback http(s) origin in dev rather
 *     than hardcoding it.
 *
 * Anything else (a remote https origin, a data:/blob: URL, an embedded frame
 * navigated to twitch.tv, etc.) is rejected.
 */

/** Minimal shape we read off an Electron IpcMainInvokeEvent. */
export interface SenderFrameLike {
  senderFrame?: { url?: string } | null;
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Return true when `url` is the app's own renderer (file:// bundle in prod, or a
 * loopback dev-server origin in dev). Pure + exported for direct unit testing.
 */
export function isAllowedSenderUrl(url: string | undefined | null): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  // Production renderer bundle.
  if (parsed.protocol === "file:") return true;

  // Development dev server on loopback only.
  if (parsed.protocol === "http:" || parsed.protocol === "https:") {
    return isLoopbackHost(parsed.hostname);
  }

  // Reject data:, blob:, remote https, custom schemes, etc.
  return false;
}

/**
 * Guard for an `ipcMain.handle` callback. Reads `event.senderFrame.url` and
 * returns whether the caller is the app's own renderer. Handlers should reject
 * (return a benign error / no-op) when this is false, and must NOT perform the
 * privileged action.
 */
export function isAllowedSender(event: SenderFrameLike): boolean {
  return isAllowedSenderUrl(event.senderFrame?.url);
}
