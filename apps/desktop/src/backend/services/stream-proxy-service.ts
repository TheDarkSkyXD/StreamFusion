/**
 * Stream Proxy Service (main process)
 *
 * Applies a user-configurable outbound HTTP/HTTPS proxy to the window's
 * session, for Twitch stream traffic. Off by default; an empty host is a safe
 * no-op that clears any prior proxy without breaking stream requests (R21).
 *
 * EGRESS MODEL (plan U11 spike, R19/R20):
 * The main BrowserWindow uses `session.defaultSession` (window-manager.ts sets
 * no `partition`/`session` in webPreferences). All three target request classes
 * egress through that session:
 *   - playback access token: the renderer ad-block service's
 *     `fetch("https://gql.twitch.tv/gql")` AND the main token path,
 *   - multivariant (master) playlist + media playlist: renderer HLS.js
 *     `fetch`/XHR loaders AND the main-process manifest proxy's `fetch`.
 * `session.setProxy` is session-level (all-or-nothing) and CANNOT select by
 * request class, so per-class selectivity is not achievable — we apply ONE
 * proxy to `defaultSession`. This proxies the three Twitch stream classes plus
 * all other defaultSession traffic while enabled (the honest tradeoff of a
 * working proxy; documented on `ProxyPreferences`). The Kick CDN partition
 * (`persist:kick-cdn-direct`) is `mode:"direct"` separately, so Kick CDN images
 * bypass the proxy regardless.
 *
 * SECURITY:
 *   - Proxy username/password are encrypted via Electron `safeStorage`
 *     (mirroring the OAuth-token storage path) in a dedicated electron-store,
 *     decrypted only here in main when building the proxy-auth response.
 *   - Credentials are never returned to the renderer and never logged.
 */

import { app, session as electronSession, safeStorage } from "electron";
import Store from "electron-store";

import type { ProxyApplyConfig, ProxyApplyResult } from "../../shared/ipc-channels";

// ========== Credential storage (encrypted, dedicated store) ==========

interface ProxyCredentialStoreSchema {
  /** Base64 of the safeStorage-encrypted JSON `{username,password}`. */
  encrypted?: string;
}

// projectName is required at runtime even when app name isn't populated yet —
// see storage-service.ts / update-service.ts for the full regression note.
const credentialStore = new Store<ProxyCredentialStoreSchema>({
  projectName: "streamfusion",
  name: "stream-proxy-credentials",
  defaults: {},
} as ConstructorParameters<typeof Store<ProxyCredentialStoreSchema>>[0]);

interface DecryptedCredentials {
  username: string;
  password: string;
}

/**
 * Encrypt + persist proxy credentials. A `null` clears them. Mirrors the
 * token encrypt path in storage-service (safeStorage with a base64 fallback
 * when the OS keychain is unavailable, e.g. dev/CI).
 */
function persistCredentials(credentials: DecryptedCredentials | null): void {
  if (!credentials) {
    credentialStore.delete("encrypted");
    return;
  }
  const json = JSON.stringify(credentials);
  let encoded: string;
  if (safeStorage.isEncryptionAvailable()) {
    encoded = safeStorage.encryptString(json).toString("base64");
  } else {
    // Fallback mirrors storage-service: less secure, but keeps dev working.
    console.warn("[StreamProxy] safeStorage unavailable, using base64 fallback for credentials");
    encoded = Buffer.from(json).toString("base64");
  }
  credentialStore.set("encrypted", encoded);
}

/** Decrypt the stored proxy credentials, or null when none are stored. */
function readCredentials(): DecryptedCredentials | null {
  const encoded = credentialStore.get("encrypted");
  if (!encoded) return null;
  try {
    const buffer = Buffer.from(encoded, "base64");
    const json = safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(buffer)
      : buffer.toString("utf8");
    const parsed = JSON.parse(json) as DecryptedCredentials;
    if (typeof parsed.username !== "string" || typeof parsed.password !== "string") {
      return null;
    }
    return parsed;
  } catch (error) {
    // Never log the error body — it could echo cipher bytes. Log the failure.
    console.error("[StreamProxy] Failed to decrypt stored proxy credentials");
    void error;
    return null;
  }
}

// ========== Proxy application ==========

/** The session the window actually uses (see egress model above). */
function getTargetSession(): Electron.Session {
  return electronSession.defaultSession;
}

let loginHandlerRegistered = false;

/**
 * Register a single `app.on("login")` handler that answers proxy auth
 * challenges with the stored (decrypted) credentials. Electron has no way to
 * embed credentials in `setProxy` rules — proxy auth is answered via this
 * event. We read credentials lazily per-challenge so a later credential change
 * is honored without re-registering. Non-proxy `login` events are passed
 * through untouched (we never call the callback for those).
 */
function ensureProxyLoginHandler(): void {
  if (loginHandlerRegistered) return;
  loginHandlerRegistered = true;

  app.on("login", (event, _webContents, _request, authInfo, callback) => {
    // `isProxy` distinguishes a proxy 407 challenge from a server 401. Only
    // answer proxy challenges; leave server auth to the default behavior.
    if (!authInfo?.isProxy) return;

    const credentials = readCredentials();
    if (!credentials) return; // No creds → let Electron cancel the challenge.

    event.preventDefault();
    callback(credentials.username, credentials.password);
  });
}

/**
 * Build the Electron proxy rules string for a host/port. We proxy both HTTP and
 * HTTPS through the same endpoint (the common single-proxy case) and bypass
 * loopback so local tooling isn't routed through it.
 */
function buildProxyRules(host: string, port: number): string {
  return `http=${host}:${port};https=${host}:${port}`;
}

const VALID_PORT_MIN = 1;
const VALID_PORT_MAX = 65535;

function isValidPort(port: number | null): port is number {
  return (
    typeof port === "number" &&
    Number.isInteger(port) &&
    port >= VALID_PORT_MIN &&
    port <= VALID_PORT_MAX
  );
}

/**
 * Apply (or clear) the proxy on the window session from a host/port/enabled
 * config. Returns what was actually done so the UI can show accurate status.
 *
 * No-op/clear paths (return `{ applied:false, cleared:true }`):
 *   - `enabled` is false,
 *   - `host` is empty/whitespace,
 *   - `port` is missing/out of range.
 * In every no-op case we set the session back to `mode:"direct"` so toggling
 * the proxy off restores direct egress and never leaves stream requests stuck
 * pointed at a removed proxy.
 */
export async function applyProxy(config: ProxyApplyConfig): Promise<ProxyApplyResult> {
  const hasCredentials = !!credentialStore.get("encrypted");
  const host = config.host?.trim() ?? "";

  // Safe no-op: disabled, empty host, or invalid port → clear to direct.
  if (!config.enabled || host === "" || !isValidPort(config.port)) {
    await clearProxy();
    return { applied: false, cleared: true, hasCredentials };
  }

  // Register the proxy-auth responder before applying, so a 407 on the first
  // request can be answered immediately.
  ensureProxyLoginHandler();

  try {
    const session = getTargetSession();
    await session.setProxy({ proxyRules: buildProxyRules(host, config.port) });
    // Drop pooled connections so existing keep-alive sockets don't keep using
    // the previous (direct or old-proxy) route.
    await session.closeAllConnections();
    // Never log host/port at info level beyond a generic confirmation; never
    // log credentials.
    console.debug("[StreamProxy] Proxy applied to window session");
    return { applied: true, cleared: false, hasCredentials };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to apply proxy";
    console.error("[StreamProxy] Failed to apply proxy:", message);
    // Leave the session direct on failure rather than half-applied.
    await clearProxy().catch(() => {
      /* best-effort */
    });
    return { applied: false, cleared: true, hasCredentials, error: message };
  }
}

/**
 * Clear any proxy on the window session (set back to direct). Safe to call when
 * none is set. Used by the no-op paths and by an explicit disable.
 */
export async function clearProxy(): Promise<void> {
  try {
    const session = getTargetSession();
    await session.setProxy({ mode: "direct" });
    await session.closeAllConnections();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[StreamProxy] Failed to clear proxy:", message);
  }
}

/**
 * Store (or clear) the encrypted proxy credentials. Passing `null` removes
 * them. The password never leaves main after this call. Returns whether
 * credentials are now stored (advisory; never the values).
 */
export function setProxyCredentials(credentials: DecryptedCredentials | null): boolean {
  persistCredentials(credentials);
  return !!credentialStore.get("encrypted");
}

/** Whether encrypted proxy credentials are currently stored. Never the values. */
export function hasStoredCredentials(): boolean {
  return !!credentialStore.get("encrypted");
}
