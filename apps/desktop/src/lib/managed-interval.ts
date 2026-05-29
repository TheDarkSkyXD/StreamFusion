/**
 * Wrapper around setInterval providing a single sanctioned cancel-safe API for
 * backend (Node/Electron-main) recurring timers. Returns a stable `{ stop }`
 * handle; `stop()` calls clearInterval and is idempotent. There is no
 * `null`-pause shape (unlike the React `useInterval`) because backend services
 * start intervals imperatively at known cadences and stop them on teardown.
 *
 * `options.unref` — when true, calls `.unref()` on the underlying Node timer so
 * it does not prevent graceful process exit. Only meaningful in Node/Electron-main
 * contexts where `NodeJS.Timeout` exposes `.unref()`.
 *
 * NOTE: the internal `setInterval` is the single sanctioned recurring timer —
 * SP4's lint rule allowlists this file and bans raw `setInterval` elsewhere.
 */
export function createManagedInterval(
  callback: () => void,
  ms: number,
  options?: { unref?: boolean },
): { stop: () => void } {
  const id = setInterval(callback, ms);
  if (options?.unref) {
    (id as unknown as { unref?: () => void }).unref?.();
  }
  return { stop: () => clearInterval(id) };
}
