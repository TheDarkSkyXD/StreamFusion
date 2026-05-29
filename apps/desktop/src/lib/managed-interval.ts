/**
 * Wrapper around setInterval providing a single sanctioned cancel-safe API for
 * backend (Node/Electron-main) recurring timers. Returns a stable `{ stop }`
 * handle; `stop()` calls clearInterval and is idempotent. There is no
 * `null`-pause shape (unlike the React `useInterval`) because backend services
 * start intervals imperatively at known cadences and stop them on teardown.
 *
 * NOTE: the internal `setInterval` is the single sanctioned recurring timer —
 * SP4's lint rule allowlists this file and bans raw `setInterval` elsewhere.
 */
export function createManagedInterval(
  callback: () => void,
  ms: number,
): { stop: () => void } {
  const id = setInterval(callback, ms);
  return { stop: () => clearInterval(id) };
}
