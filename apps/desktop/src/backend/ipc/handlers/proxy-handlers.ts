/**
 * Stream Proxy IPC Handlers (Xtra port U11)
 *
 * Bridges the renderer's Proxy settings (U12) to the main-process
 * stream-proxy-service. Two write channels + one advisory read:
 *   - PROXY_APPLY: apply/clear the proxy from a host/port/enabled config.
 *   - PROXY_SET_CREDENTIALS: store (or clear) encrypted credentials. The
 *     password is never read back by any channel.
 *   - PROXY_HAS_CREDENTIALS: advisory boolean for the UI placeholder.
 *
 * SECURITY: every handler validates `event.senderFrame.url` (the
 * AUTH_GET_TOKEN no-sender-origin learning — we do NOT add another
 * unauthenticated privileged channel). Credentials are never logged.
 */

import { ipcMain } from "electron";

import { logger } from "@/backend/logging/logger";
import {
  IPC_CHANNELS,
  type ProxyApplyConfig,
  type ProxyApplyResult,
  type ProxyCredentialsInput,
} from "../../../shared/ipc-channels";
import { storageService } from "../../services/storage-service";
import {
  applyProxy,
  hasStoredCredentials,
  setProxyCredentials,
} from "../../services/stream-proxy-service";
import { isAllowedSender } from "../sender-origin";

/** Result returned to a renderer call that fails the sender-origin check. */
const REJECTED_RESULT: ProxyApplyResult = {
  applied: false,
  cleared: false,
  hasCredentials: false,
  error: "Rejected: caller is not the application renderer.",
};

export function registerProxyHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.PROXY_APPLY,
    async (event, { config }: { config: ProxyApplyConfig }): Promise<ProxyApplyResult> => {
      if (!isAllowedSender(event)) {
        logger.warn("IPC:Proxy", "PROXY_APPLY rejected: disallowed sender origin");
        return REJECTED_RESULT;
      }
      return applyProxy(config);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.PROXY_SET_CREDENTIALS,
    (
      event,
      { credentials }: { credentials: ProxyCredentialsInput | null }
    ): { hasCredentials: boolean } => {
      if (!isAllowedSender(event)) {
        logger.warn("IPC:Proxy", "PROXY_SET_CREDENTIALS rejected: disallowed sender origin");
        // Do not mutate stored credentials on a rejected call.
        return { hasCredentials: hasStoredCredentials() };
      }
      const hasCredentials = setProxyCredentials(credentials);
      return { hasCredentials };
    }
  );

  ipcMain.handle(IPC_CHANNELS.PROXY_HAS_CREDENTIALS, (event): { hasCredentials: boolean } => {
    if (!isAllowedSender(event)) {
      return { hasCredentials: false };
    }
    return { hasCredentials: hasStoredCredentials() };
  });
}

/**
 * Apply the persisted proxy preference at app start (R20: "apply on app start
 * if enabled"). Reads the stored `proxy` group; disabled/empty host is a safe
 * no-op (clears to direct). Fire-and-forget — a proxy failure must not block
 * startup, and `applyProxy` already degrades to direct on error.
 */
export function applyPersistedProxyOnStart(): void {
  const proxy = storageService.getPreferences().proxy;
  void applyProxy({ enabled: proxy.enabled, host: proxy.host, port: proxy.port }).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn("IPC:Proxy", "Failed to apply persisted proxy on start", { message });
  });
}
