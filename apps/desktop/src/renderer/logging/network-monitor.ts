/**
 * network-monitor.ts (renderer)
 *
 * Passive listener on `window.online` / `window.offline` that forwards each
 * transition through the renderer logger. Mirrors Valo's NetworkMonitor —
 * one line at install time spelling out the INITIAL state (so a single line
 * disambiguates a freshly-reloaded session) plus one line per transition.
 *
 * Offline is logged at `warn` because being offline is a degraded state worth
 * surfacing under default-level filters; online transitions are routine.
 */

import { logger } from "@/renderer/logging/logger";

export interface InstallNetworkMonitorOpts {
  /** Tag used for every emitted line. Defaults to `NetworkMonitor`. */
  tag?: string;
}

interface NetworkMonitorState {
  installed: boolean;
  uninstall: (() => void) | null;
}

const state: NetworkMonitorState = {
  installed: false,
  uninstall: null,
};

/**
 * Installs `online` / `offline` listeners on `window` and logs each transition
 * via the renderer logger. Returns an uninstall fn.
 *
 * Also logs the INITIAL state at install time so a single line in the log
 * file makes the current state unambiguous (otherwise users would only see
 * lines on TRANSITIONS, which can be ambiguous after a reload).
 */
export function installNetworkMonitor(opts?: InstallNetworkMonitorOpts): () => void {
  if (state.installed && state.uninstall) {
    return state.uninstall;
  }

  // Test/SSR safety — fall through without throwing if `window` isn't around.
  const w = (globalThis as unknown as { window?: Window }).window;
  if (!w) {
    const noop = (): void => undefined;
    return noop;
  }

  const tag = opts?.tag ?? "NetworkMonitor";

  logger.info(tag, `initial: ${w.navigator.onLine ? "online" : "offline"}`);

  const onOnline = (): void => {
    logger.info(tag, "online");
  };
  const onOffline = (): void => {
    logger.warn(tag, "offline");
  };

  w.addEventListener("online", onOnline);
  w.addEventListener("offline", onOffline);

  const uninstall = (): void => {
    if (!state.installed) return;
    w.removeEventListener("online", onOnline);
    w.removeEventListener("offline", onOffline);
    state.installed = false;
    state.uninstall = null;
  };

  state.installed = true;
  state.uninstall = uninstall;
  return uninstall;
}
