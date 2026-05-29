import { type BrowserWindow, ipcMain } from "electron";
import type {
  AuthToken,
  KickUser,
  LocalFollow,
  Platform,
  TwitchUser,
} from "../../../shared/auth-types";
import { type AuthStatus, IPC_CHANNELS } from "../../../shared/ipc-channels";
import type { FollowedChannelsResult } from "../../api/platforms/kick/endpoints/follow-endpoints";
import { disposeSendWindow } from "../../api/platforms/kick/kick-send-window";
import {
  authWindowManager,
  deviceCodeFlowService,
  getOAuthConfig,
  kickAuthService,
  oauthCallbackServer,
  tokenExchangeService,
  twitchAuthService,
  validateOAuthConfig,
} from "../../auth";
import { createManagedInterval } from "../../../lib/managed-interval";
import { storageService } from "../../services/storage-service";

/**
 * Kick-side of the post-login follow sync, extracted so the
 * "preserve prior rows when fetch errors out" decision is unit-testable
 * without spinning up the full IPC layer. The closure form inside
 * `registerAuthHandlers` calls this and surfaces the outcome to the
 * AUTH_FOLLOWS_SYNCED event.
 *
 * Contract:
 *   - On `{status:"error"}` from `getFollows`: returns the error WITHOUT
 *     touching storage. Guards against silent data loss when Cloudflare /
 *     Kasada / auth challenges produce a transient failure mid-session.
 *   - On `{status:"ok"}`: atomically reconciles account-source rows via
 *     `replaceAccountFollowsRespectingPending`, honoring push-sync
 *     tombstones in `pending_follow_writes` (U2). Returns both the
 *     imported account count and the remaining pending count for the
 *     reconciliation banner in U8.
 */
export type KickSyncOutcome =
  | { status: "ok"; count: number; pendingCount: number }
  | { status: "error"; reason: string };

export async function syncKickFollowsAfterLogin(
  getFollows: () => Promise<FollowedChannelsResult>,
  storage: Pick<typeof storageService, "replaceAccountFollowsRespectingPending"> = storageService
): Promise<KickSyncOutcome> {
  const result = await getFollows();
  if (result.status === "error") {
    return { status: "error", reason: result.reason };
  }
  const kickFollows = result.channels.map(
    (channel) =>
      ({
        platform: "kick",
        channelId: channel.id,
        channelName: channel.username,
        displayName: channel.displayName,
        profileImage: channel.avatarUrl,
      }) as Omit<LocalFollow, "id" | "followedAt">
  );
  const { accountCount, pendingCount } = storage.replaceAccountFollowsRespectingPending(
    "kick",
    kickFollows
  );
  return { status: "ok", count: accountCount, pendingCount };
}

export function registerAuthHandlers(mainWindow: BrowserWindow): void {
  /**
   * Helper to safely send IPC messages to the renderer.
   * Prevents "Render frame was disposed" errors when the window is closing.
   */
  function safeSend(channel: string, ...args: unknown[]): void {
    try {
      if (
        mainWindow &&
        !mainWindow.isDestroyed() &&
        mainWindow.webContents &&
        !mainWindow.webContents.isDestroyed()
      ) {
        mainWindow.webContents.send(channel, ...args);
      }
    } catch {
      console.warn(`⚠️ Could not send to ${channel}: Window disposed`);
    }
  }

  /**
   * Sync local follows on login OR on periodic refresh: reconcile the
   * platform's account-source rows against the platform's actual followed
   * channels, honoring `pending_follow_writes` tombstones from push-sync.
   * Runs in the background — does not block the login flow.
   */
  async function syncFollowsOnLogin(platform: Platform): Promise<void> {
    try {
      console.debug(`🔄 Syncing ${platform} follows...`);

      let importedCount = 0;
      let pendingCount = 0;
      if (platform === "twitch") {
        const { twitchClient } = await import("../../api/platforms/twitch/twitch-client");
        const allFollowed = await twitchClient.getAllFollowedChannels();

        // Pending-aware atomic reconciliation. Replaces the prior
        // clearAccountFollows + addLocalFollow loop which was both
        // non-atomic (mid-loop crash left a partial list with no recovery)
        // and pending-blind (would silently drop a row the user just
        // clicked Follow on if the platform hadn't registered the push
        // yet). U7 doc-review P1 fix.
        const twitchFollows = allFollowed.map(
          (channel) =>
            ({
              platform: "twitch",
              channelId: channel.id,
              channelName: channel.username,
              displayName: channel.displayName,
              profileImage: channel.avatarUrl,
            }) as Omit<LocalFollow, "id" | "followedAt">
        );
        const result = storageService.replaceAccountFollowsRespectingPending(
          "twitch",
          twitchFollows
        );
        importedCount = result.accountCount;
        pendingCount = result.pendingCount;
        console.debug(`✅ Synced ${importedCount} Twitch follows (pending=${pendingCount})`);
      } else if (platform === "kick") {
        // Call FollowEndpoints directly rather than kickClient.getAllFollowedChannels()
        // so we get the tagged result. A transient Cloudflare 403 / auth failure
        // must NOT trigger clearAccountFollows — that would silently wipe the
        // user's prior synced follows. See A1 in
        // docs/plans/2026-05-21-001-feat-kick-account-follows-import-plan.md.
        const { getAllFollowedChannels } = await import(
          "../../api/platforms/kick/endpoints/follow-endpoints"
        );
        const outcome = await syncKickFollowsAfterLogin(getAllFollowedChannels);
        if (outcome.status === "error") {
          console.warn(
            `⚠️ Kick follow sync skipped (${outcome.reason}); preserving prior account-source rows`
          );
          // Bail out without firing AUTH_FOLLOWS_SYNCED. The renderer's prior
          // state remains correct.
          return;
        }
        importedCount = outcome.count;
        pendingCount = outcome.pendingCount;
        console.debug(`✅ Synced ${importedCount} Kick follows (pending=${pendingCount})`);
      }

      // Tell the renderer the local DB now reflects this platform's account
      // follow list so it can re-hydrate useFollowStore and invalidate the
      // followed-channels / followed-streams React-Query caches. Without this
      // signal the renderer keeps showing pre-login state (empty FollowButton,
      // stale sidebar) until something else happens to trigger a re-read.
      // pendingCount drives U8's per-platform reconciliation banner.
      safeSend(IPC_CHANNELS.AUTH_FOLLOWS_SYNCED, {
        platform,
        count: importedCount,
        pendingCount,
      });
    } catch (error) {
      console.warn(`⚠️ Failed to sync ${platform} follows:`, error);
      // Don't throw — this is non-critical and should not block the login
    }
  }

  // ========== Background follow refresh (per platform) ==========
  // Two refresh triggers per platform:
  //   1. Periodic interval (15 min) — catches follows added while the app
  //      was open in the background OR confirms / clears pending push-sync
  //      rows that landed externally.
  //   2. Window focus — catches the common case of "I followed someone in
  //      my browser/Xbox/mobile, then switched back to StreamFusion."
  //
  // Per-platform cooldown state so Kick focus events don't gate Twitch
  // refreshes and vice versa. Both platforms register unconditionally;
  // the no-token guard lives inside maybeRefreshFollows so the interval
  // ticks harmlessly when the user isn't signed in.
  //
  // The single-flight Promise inside each platform's getAllFollowedChannels
  // collapses concurrent triggers, so over-firing is cheap. We still
  // cooldown the on-focus path to avoid hammering on Alt-Tab.
  const FOLLOWS_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
  const FOCUS_REFRESH_COOLDOWN_MS = 60 * 1000;
  const lastRefreshAt: Map<Platform, number> = new Map([
    ["kick", 0],
    ["twitch", 0],
  ]);

  function maybeRefreshFollows(platform: Platform, trigger: "interval" | "focus"): void {
    if (!storageService.hasToken(platform)) return;
    const now = Date.now();
    if (trigger === "focus") {
      const last = lastRefreshAt.get(platform) ?? 0;
      if (now - last < FOCUS_REFRESH_COOLDOWN_MS) return;
    }
    lastRefreshAt.set(platform, now);
    console.debug(`🔄 ${platform} follow refresh (${trigger})`);
    syncFollowsOnLogin(platform).catch(() => {});
  }

  createManagedInterval(() => maybeRefreshFollows("kick", "interval"), FOLLOWS_REFRESH_INTERVAL_MS);
  createManagedInterval(() => maybeRefreshFollows("twitch", "interval"), FOLLOWS_REFRESH_INTERVAL_MS);
  mainWindow.on("focus", () => {
    maybeRefreshFollows("kick", "focus");
    maybeRefreshFollows("twitch", "focus");
  });

  // ========== Kick Session Expiry (push event) ==========
  // Forward the 'session-expired' event emitted by KickAuthService to the renderer
  // so it can prompt the user to re-authenticate.
  kickAuthService.on("session-expired", () => {
    safeSend(IPC_CHANNELS.AUTH_KICK_SESSION_EXPIRED);
  });

  // ========== Auth - Token Management ==========
  ipcMain.handle(IPC_CHANNELS.AUTH_GET_TOKEN, (_event, { platform }: { platform: Platform }) => {
    return storageService.getToken(platform);
  });

  ipcMain.handle(
    IPC_CHANNELS.AUTH_SAVE_TOKEN,
    (_event, { platform, token }: { platform: Platform; token: AuthToken }) => {
      storageService.saveToken(platform, token);
    }
  );

  ipcMain.handle(IPC_CHANNELS.AUTH_CLEAR_TOKEN, (_event, { platform }: { platform: Platform }) => {
    storageService.clearToken(platform);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_HAS_TOKEN, (_event, { platform }: { platform: Platform }) => {
    return storageService.hasToken(platform);
  });

  ipcMain.handle(
    IPC_CHANNELS.AUTH_IS_TOKEN_EXPIRED,
    (_event, { platform }: { platform: Platform }) => {
      return storageService.isTokenExpired(platform);
    }
  );

  ipcMain.handle(IPC_CHANNELS.AUTH_CLEAR_ALL_TOKENS, () => {
    storageService.clearAllTokens();
  });

  // ========== Auth - User Data ==========
  ipcMain.handle(IPC_CHANNELS.AUTH_GET_TWITCH_USER, () => {
    return storageService.getTwitchUser();
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_SAVE_TWITCH_USER, (_event, { user }: { user: TwitchUser }) => {
    storageService.saveTwitchUser(user);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_CLEAR_TWITCH_USER, () => {
    storageService.clearTwitchUser();
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_GET_KICK_USER, () => {
    return storageService.getKickUser();
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_SAVE_KICK_USER, (_event, { user }: { user: KickUser }) => {
    storageService.saveKickUser(user);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_CLEAR_KICK_USER, () => {
    storageService.clearKickUser();
  });

  // ========== Auth - Status ==========
  ipcMain.handle(IPC_CHANNELS.AUTH_GET_STATUS, (): AuthStatus => {
    const twitchUser = storageService.getTwitchUser();
    const kickUser = storageService.getKickUser();
    const twitchHasToken = storageService.hasToken("twitch");
    const kickHasToken = storageService.hasToken("kick");
    const twitchExpired = storageService.isTokenExpired("twitch");
    const kickExpired = storageService.isTokenExpired("kick");

    return {
      twitch: {
        connected: !!twitchUser && twitchHasToken && !twitchExpired,
        user: twitchUser,
        hasToken: twitchHasToken,
        isExpired: twitchExpired,
      },
      kick: {
        connected: !!kickUser && kickHasToken && !kickExpired,
        user: kickUser,
        hasToken: kickHasToken,
        isExpired: kickExpired,
      },
      isGuest: !twitchUser && !kickUser,
    };
  });

  // ========== Auth - OAuth Flow using Localhost Callback Server ==========

  // Track in-progress OAuth flows to prevent state mismatch from multiple clicks
  const pendingOAuthFlows: Map<Platform, { cancel: () => void }> = new Map();

  /**
   * Handle OAuth flow for a platform using localhost callback server
   */
  async function handleOAuthFlow(platform: Platform): Promise<void> {
    // Validate OAuth config first
    const configErrors = validateOAuthConfig(platform);
    if (configErrors.length > 0) {
      throw new Error(`OAuth not configured: ${configErrors.join(", ")}`);
    }

    // Cancel any existing OAuth flow for this platform to prevent state mismatch
    const existingFlow = pendingOAuthFlows.get(platform);
    if (existingFlow) {
      console.debug(`⚠️ Cancelling previous OAuth flow for ${platform}`);
      existingFlow.cancel();
      pendingOAuthFlows.delete(platform);
    }

    // Stop any existing callback server before starting a new one
    oauthCallbackServer.stop();

    // Open auth window and get session info
    const { pkce, state, redirectUri, port } = authWindowManager.openAuthWindow(platform);

    // Create a cancellation mechanism for this flow
    let isCancelled = false;
    const flowControl = {
      cancel: () => {
        isCancelled = true;
        oauthCallbackServer.stop();
        authWindowManager.closeAuthWindow(platform);
      },
    };
    pendingOAuthFlows.set(platform, flowControl);

    try {
      // Start the localhost callback server and wait for the callback
      const callbackResult = await oauthCallbackServer.waitForCallback(platform, state, { port });

      // Check if this flow was cancelled (a newer flow started)
      if (isCancelled) {
        console.debug(`🛑 OAuth flow for ${platform} was cancelled`);
        return;
      }

      console.debug(`📥 Received OAuth callback for ${platform}`);

      // Exchange the code for a token
      const token = await tokenExchangeService.exchangeCodeForToken({
        platform,
        code: callbackResult.code,
        redirectUri,
        pkce,
      });

      // Save the token
      storageService.saveToken(platform, token);

      console.debug(`✅ Successfully authenticated with ${platform}`);

      // Fetch user info after token is saved
      if (platform === "twitch") {
        // Kick off background refresh chain against the new expiry. Without
        // this the user would be auto-refreshed only after the first idle
        // expiry, leaving a window where Twitch IRC/EventSub get torn down.
        twitchAuthService.scheduleProactiveRefresh();
        try {
          const user = await twitchAuthService.fetchCurrentUser();
          if (user) {
            storageService.saveTwitchUser(user);
          }
        } catch (userError) {
          console.error("Failed to fetch Twitch user info:", userError);
        }
      } else if (platform === "kick") {
        try {
          const user = await kickAuthService.fetchCurrentUser();
          if (user) {
            storageService.saveKickUser(user);
          }
        } catch (userError) {
          console.error("Failed to fetch Kick user info:", userError);
        }
      }

      // Sync local follows with account follows (background, non-blocking)
      syncFollowsOnLogin(platform).catch(() => {});

      // Notify renderer of successful auth
      safeSend(IPC_CHANNELS.AUTH_ON_CALLBACK, {
        platform,
        success: true,
      });
    } catch (error) {
      // Don't report errors for cancelled flows
      if (isCancelled) {
        console.debug(`🛑 Ignoring error from cancelled OAuth flow for ${platform}`);
        return;
      }

      console.error(`❌ OAuth failed for ${platform}:`, error);

      // Notify renderer of failed auth
      safeSend(IPC_CHANNELS.AUTH_ON_CALLBACK, {
        platform,
        success: false,
        error: error instanceof Error ? error.message : "Authentication failed",
      });

      throw error;
    } finally {
      // Clean up: remove from pending flows
      pendingOAuthFlows.delete(platform);
      // Always close the auth window
      authWindowManager.closeAuthWindow(platform);
      // Stop the callback server
      oauthCallbackServer.stop();
    }
  }

  // Handle opening Twitch OAuth
  ipcMain.handle(IPC_CHANNELS.AUTH_OPEN_TWITCH, async () => {
    console.debug("🔐 Opening Twitch login...");
    try {
      await handleOAuthFlow("twitch");
      return { success: true };
    } catch (error) {
      console.error("Twitch OAuth error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Authentication failed",
      };
    }
  });

  // Handle opening Kick OAuth
  ipcMain.handle(IPC_CHANNELS.AUTH_OPEN_KICK, async () => {
    console.debug("🔐 Opening Kick login...");
    try {
      await handleOAuthFlow("kick");
      return { success: true };
    } catch (error) {
      console.error("Kick OAuth error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Authentication failed",
      };
    }
  });

  // ========== Twitch Auth Operations ==========

  // Handle Twitch logout
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT_TWITCH, async () => {
    console.debug("🚪 Logging out from Twitch...");
    try {
      await twitchAuthService.logout();
      // Clear account follows → guest follows become active again
      storageService.clearAccountFollows("twitch");
      safeSend(IPC_CHANNELS.AUTH_ON_CALLBACK, {
        platform: "twitch",
        success: true,
        loggedOut: true,
      });
      return { success: true };
    } catch (error) {
      console.error("❌ Twitch logout failed:", error);
      return { success: false, error: error instanceof Error ? error.message : "Logout failed" };
    }
  });

  // Handle Twitch token refresh
  ipcMain.handle(IPC_CHANNELS.AUTH_REFRESH_TWITCH, async () => {
    console.debug("🔄 Refreshing Twitch token...");
    try {
      const token = await twitchAuthService.refreshToken();
      if (token) {
        return { success: true, token };
      }
      return { success: false, error: "Token refresh failed" };
    } catch (error) {
      console.error("❌ Twitch token refresh failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Token refresh failed",
      };
    }
  });

  // Returns a guaranteed-valid access-token string, refreshing if expired or
  // expiring within 5 minutes. Use this anywhere the renderer needs to attach
  // Authorization: Bearer <token> to a Twitch API call (chat IRC handshake,
  // direct Helix fetches that don't route through TwitchRequestor, etc.).
  ipcMain.handle(IPC_CHANNELS.AUTH_GET_VALID_TWITCH_TOKEN, async () => {
    return await twitchAuthService.getValidAccessToken();
  });

  // Wire the auth-lost signal. Fires when the refresh chain dies permanently —
  // Twitch rejected the refresh token (invalid_grant), or we exhausted the
  // transient-failure budget. The renderer listens via onTwitchAuthLost and
  // flips the auth-store to a "reconnect required" state.
  twitchAuthService.setAuthLostHandler(() => {
    safeSend(IPC_CHANNELS.AUTH_TWITCH_AUTH_LOST);
  });

  // Handle fetching Twitch user info
  ipcMain.handle(IPC_CHANNELS.AUTH_FETCH_TWITCH_USER, async () => {
    console.debug("👤 Fetching Twitch user info...");
    try {
      const user = await twitchAuthService.fetchCurrentUser();
      if (user) {
        return { success: true, user };
      }
      return { success: false, error: "Failed to fetch user info" };
    } catch (error) {
      console.error("❌ Failed to fetch Twitch user:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch user info",
      };
    }
  });

  // ========== Kick Auth Operations ==========

  // Handle Kick logout (generic)
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async (_event, { platform }: { platform: Platform }) => {
    if (platform === "twitch") {
      await twitchAuthService.logout();
      storageService.clearAccountFollows("twitch");
    } else if (platform === "kick") {
      await kickAuthService.logout();
      await disposeSendWindow();
      storageService.clearAccountFollows("kick");
    }

    safeSend(IPC_CHANNELS.AUTH_ON_CALLBACK, {
      platform,
      success: true,
      loggedOut: true,
    });
    return { success: true };
  });

  // Handle Kick logout (specific channel)
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT_KICK, async () => {
    console.debug("🚪 Logging out from Kick...");
    try {
      await kickAuthService.logout();
      await disposeSendWindow();
      // Clear account follows → guest follows become active again
      storageService.clearAccountFollows("kick");
      safeSend(IPC_CHANNELS.AUTH_ON_CALLBACK, {
        platform: "kick",
        success: true,
        loggedOut: true,
      });
      return { success: true };
    } catch (error) {
      console.error("❌ Kick logout failed:", error);
      return { success: false, error: error instanceof Error ? error.message : "Logout failed" };
    }
  });

  // Handle Kick token refresh
  ipcMain.handle(IPC_CHANNELS.AUTH_REFRESH_KICK, async () => {
    console.debug("🔄 Refreshing Kick token...");
    try {
      const token = await kickAuthService.refreshToken();
      if (token) {
        return { success: true, token };
      }
      return { success: false, error: "Token refresh failed" };
    } catch (error) {
      console.error("❌ Kick token refresh failed:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Token refresh failed",
      };
    }
  });

  // Handle Kick user fetch
  ipcMain.handle(IPC_CHANNELS.AUTH_FETCH_KICK_USER, async () => {
    console.debug("👤 Fetching Kick user info...");
    try {
      const user = await kickAuthService.fetchCurrentUser();
      if (user) {
        return { success: true, user };
      }
      return { success: false, error: "Failed to fetch user info" };
    } catch (error) {
      console.error("❌ Failed to fetch Kick user:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch user info",
      };
    }
  });

  // ========== Device Code Flow (Twitch) ==========

  // Start device code flow - returns codes for user to enter
  ipcMain.handle(IPC_CHANNELS.AUTH_DCF_START, async () => {
    console.debug("🔐 Starting Device Code Flow for Twitch...");
    try {
      const config = getOAuthConfig("twitch");

      if (!config.clientId) {
        throw new Error("TWITCH_CLIENT_ID is not set. Please add it to your .env file.");
      }

      const result = await deviceCodeFlowService.requestDeviceCode(config.scopes);

      // Open the verification URL in the default browser
      const { shell } = await import("electron");
      shell.openExternal(result.verificationUri);

      return {
        success: true,
        userCode: result.userCode,
        verificationUri: result.verificationUri,
        deviceCode: result.deviceCode,
        expiresIn: result.expiresIn,
        interval: result.interval,
      };
    } catch (error) {
      console.error("❌ Failed to start device code flow:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to start device code flow",
      };
    }
  });

  // Poll for token after user authorizes
  ipcMain.handle(
    IPC_CHANNELS.AUTH_DCF_POLL,
    async (
      _event,
      {
        deviceCode,
        interval,
        expiresIn,
      }: {
        deviceCode: string;
        interval: number;
        expiresIn: number;
      }
    ) => {
      console.debug("🔄 Polling for Twitch authorization...");
      try {
        const token = await deviceCodeFlowService.pollForToken(
          deviceCode,
          interval,
          expiresIn,
          (status, message) => {
            // Send status updates to renderer
            safeSend(IPC_CHANNELS.AUTH_DCF_STATUS, { status, message });
          }
        );

        // Save the token
        storageService.saveToken("twitch", token);

        // Chain proactive refresh against the new expiry — see the OAuth
        // callback branch above for the rationale.
        twitchAuthService.scheduleProactiveRefresh();

        // Fetch user info
        const user = await twitchAuthService.fetchCurrentUser();
        if (user) {
          storageService.saveTwitchUser(user);
        }

        // Sync local follows with account follows (background, non-blocking)
        syncFollowsOnLogin("twitch").catch(() => {});

        // Notify renderer
        safeSend(IPC_CHANNELS.AUTH_ON_CALLBACK, {
          platform: "twitch",
          success: true,
        });

        return { success: true, user };
      } catch (error) {
        console.error("❌ Device code flow failed:", error);
        return {
          success: false,
          error: error instanceof Error ? error.message : "Authorization failed",
        };
      }
    }
  );

  // Cancel device code flow
  ipcMain.handle(IPC_CHANNELS.AUTH_DCF_CANCEL, () => {
    console.debug("🛑 Cancelling device code flow...");
    deviceCodeFlowService.stopPolling();
    return { success: true };
  });
}
