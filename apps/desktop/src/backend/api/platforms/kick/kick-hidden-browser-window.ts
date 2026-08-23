import { BrowserWindow, type BrowserWindowConstructorOptions } from "electron";

type HiddenKickBrowserWindowOptions = Omit<BrowserWindowConstructorOptions, "show">;

/**
 * Creates a background Kick page that can never become an independent audio source.
 *
 * Kick channel pages may autoplay media even when the app's visible player is muted.
 * Keeping this invariant at the window boundary protects every hidden API fallback.
 */
export function createHiddenKickBrowserWindow(
  options: HiddenKickBrowserWindowOptions
): BrowserWindow {
  const window = new BrowserWindow({ ...options, show: false });
  window.webContents.setAudioMuted?.(true);
  return window;
}
