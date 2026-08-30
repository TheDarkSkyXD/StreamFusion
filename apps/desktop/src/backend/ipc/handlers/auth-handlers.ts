import type { BrowserWindow } from "electron";

import { trustedIpcMain as ipcMain } from "../trusted-ipc-main";
import { z } from "zod";

import { logger, type Logger } from "@backend/logging/logger";
import type { UnifiedChannel } from "@shared/platform-types";
import { createManagedInterval } from "@shared/utils/managed-interval";
import type { AuthToken, LocalFollow, Platform, TwitchUser } from "../../../shared/auth-types";
import {
  type AuthStatus,
  type AuthSyncFollowsResult,
  IPC_CHANNELS,
} from "../../../shared/ipc-channels";
import type { FollowedChannelsResult } from "../../api/platforms/kick/endpoints/follow-endpoints";
import { disposeSendWindow } from "../../api/platforms/kick/kick-send-window";
import {
  authWindowManager,
  deviceCodeFlowService,
  generatePkceChallenge,
  generateState,
  getOAuthConfig,
  kickAuthService,
  oauthCallbackServer,
  tokenExchangeService,
  twitchAuthService,
  validateOAuthConfig,
} from "../../auth";
import {
  runTwitchDeviceCodeLogin,
  type TwitchDeviceCodeLoginDependencies,
} from "../../auth/device-code-flow";
import { twitchDeviceAuthWindow } from "../../auth/twitch-device-auth-window";
import { kickFollowWriteService } from "../../services/kick-follow-write-service";
import { beginKickAccountReconciliation } from "../../services/kick-account-reconciliation-coordinator";
import { liveNotificationService } from "../../services/live-notification-service";
import { storageService } from "../../services/storage-service";
import { isAllowedSender } from "../sender-origin";

const authTokenSchema = z
  .object({
    accessToken: z.string().min(1),
    refreshToken: z.string().min(1).optional(),
    expiresAt: z.number().finite().nonnegative().optional(),
    scope: z.array(z.string().min(1)).optional(),
    authFlow: z.literal("device-code").optional(),
  })
  .strict();

const kickPlatformPayloadSchema = z.object({ platform: z.literal("kick") }).strict();
const platformPayloadSchema = z.object({ platform: z.enum(["twitch", "kick"]) }).strict();
const kickTokenPayloadSchema = z
  .object({ platform: z.literal("kick"), token: authTokenSchema })
  .strict();
const twitchUserSchema = z
  .object({
    id: z.string().min(1),
    login: z.string().min(1),
    displayName: z.string(),
    profileImageUrl: z.string(),
    email: z.string().optional(),
    createdAt: z.string().min(1),
    broadcasterType: z.enum(["partner", "affiliate", ""]),
  })
  .strict();
const kickUserSchema = z
  .object({
    id: z.number().finite().int().nonnegative(),
    username: z.string().min(1),
    slug: z.string().min(1),
    profilePic: z.string(),
    email: z.string().optional(),
    bio: z.string().optional(),
    verified: z.boolean(),
    twitter: z.string().optional(),
    discord: z.string().optional(),
    instagram: z.string().optional(),
    tiktok: z.string().optional(),
    facebook: z.string().optional(),
    youtube: z.string().optional(),
  })
  .strict();
const twitchUserPayloadSchema = z.object({ user: twitchUserSchema }).strict();
const kickUserPayloadSchema = z.object({ user: kickUserSchema }).strict();

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
 *   - On `{status:"ok"}`: upserts kick-source rows via `upsertSyncedFollows`.
 *     Trusted Kick results may prune absent rows; uncertain fallback results
 *     preserve them. Pending-unfollow tombstones in `pending_follow_writes`
 *     still block re-adoption.
 */
export type KickSyncOutcome =
  | {
      status: "ok";
      count: number;
      pendingCount: number;
      addedCount: number;
      removedCount: number;
    }
  | { status: "error"; reason: string };

type KickSyncFailure = Extract<KickSyncOutcome, { status: "error" }>;

export function reportKickFollowSyncFailure(
  outcome: KickSyncFailure,
  authLogger: Pick<Logger, "debug" | "warn"> = logger
): KickSyncFailure {
  const metadata = { reason: outcome.reason };
  if (outcome.reason === "auth-failed") {
    authLogger.debug(
      "IPC:Auth",
      "Kick follow sync skipped; preserving prior account-source rows",
      metadata
    );
  } else {
    authLogger.warn(
      "IPC:Auth",
      "Kick follow sync skipped; preserving prior account-source rows",
      metadata
    );
  }
  return outcome;
}

type FollowSyncOutcome = KickSyncOutcome;

type KickFollowInput = Omit<LocalFollow, "id" | "followedAt">;
type KickFollowVerifier = (
  userId: string,
  username: string,
  channelSlug: string
) => Promise<"followed" | "not-followed" | "unavailable">;
type KickFollowBatchVerifier = (
  userId: string,
  username: string,
  channelSlugs: string[]
) => Promise<Map<string, "followed" | "not-followed" | "unavailable">>;

function kickFollowRowsMatch(candidate: KickFollowInput, prior: LocalFollow): boolean {
  const candidateId = candidate.channelId.trim();
  const priorId = prior.channelId.trim();
  return (
    (candidateId.length > 0 && priorId.length > 0 && candidateId === priorId) ||
    candidate.channelName.trim().toLowerCase() === prior.channelName.trim().toLowerCase()
  );
}

function hasSameKickFollowMembership(fetched: KickFollowInput[], prior: LocalFollow[]): boolean {
  const unmatchedPrior = prior.filter((follow) => follow.source === "kick");
  if (fetched.length !== unmatchedPrior.length) return false;

  for (const candidate of fetched) {
    const matchIndex = unmatchedPrior.findIndex((follow) => kickFollowRowsMatch(candidate, follow));
    if (matchIndex === -1) return false;
    unmatchedPrior.splice(matchIndex, 1);
  }

  return unmatchedPrior.length === 0;
}

export async function reconcileKickMissingFollowRows(
  fetched: KickFollowInput[],
  prior: LocalFollow[],
  viewer: { id: number; username: string },
  verify: KickFollowVerifier,
  verifyBatch?: KickFollowBatchVerifier,
  options: { preserveUnavailablePrior?: boolean } = {}
): Promise<KickFollowInput[]> {
  const MAX_CONCURRENT_RELATIONSHIP_READS = 4;
  const verificationCache = new Map<string, Promise<Awaited<ReturnType<KickFollowVerifier>>>>();
  if (verifyBatch) {
    const channelSlugs = Array.from(
      new Set([
        ...fetched.map((row) => row.channelName.toLowerCase()),
        ...prior.filter((row) => row.source === "kick").map((row) => row.channelName.toLowerCase()),
      ])
    );
    let states = new Map<string, Awaited<ReturnType<KickFollowVerifier>>>();
    try {
      states = await verifyBatch(String(viewer.id), viewer.username, channelSlugs);
    } catch {
      // Batch failure leaves new discoveries untrusted and existing rows preserved.
    }
    for (const slug of channelSlugs) {
      verificationCache.set(slug, Promise.resolve(states.get(slug) ?? "unavailable"));
    }
  }
  const verifyChannel = (channelSlug: string) => {
    const key = channelSlug.toLowerCase();
    const cached = verificationCache.get(key);
    if (cached) return cached;
    const verification = verify(String(viewer.id), viewer.username, channelSlug).catch(
      () => "unavailable" as const
    );
    verificationCache.set(key, verification);
    return verification;
  };
  const verifyBounded = async <T>(
    values: T[],
    operation: (value: T) => Promise<void>
  ): Promise<void> => {
    for (let index = 0; index < values.length; index += MAX_CONCURRENT_RELATIONSHIP_READS) {
      await Promise.all(
        values
          .slice(index, index + MAX_CONCURRENT_RELATIONSHIP_READS)
          .map((value) => operation(value))
      );
    }
  };
  const reconciled: KickFollowInput[] = [];
  await verifyBounded(fetched, async (candidate) => {
    const state = await verifyChannel(candidate.channelName);
    if (state === "followed") {
      reconciled.push(candidate);
      return;
    }
    if (state === "unavailable" && options.preserveUnavailablePrior !== false) {
      const existing = prior.find(
        (row) => row.source === "kick" && kickFollowRowsMatch(candidate, row)
      );
      if (existing) {
        reconciled.push({
          platform: "kick",
          channelId: existing.channelId,
          channelName: existing.channelName,
          displayName: existing.displayName,
          profileImage: existing.profileImage,
          source: "kick",
        });
      }
    }
  });
  const matchesFetched = (row: LocalFollow): boolean =>
    fetched.some((candidate) => kickFollowRowsMatch(candidate, row));

  await verifyBounded(prior, async (row) => {
    if (row.source !== "kick" || matchesFetched(row)) return;
    const state = await verifyChannel(row.channelName);
    if (
      state === "followed" ||
      (state === "unavailable" && options.preserveUnavailablePrior !== false)
    ) {
      reconciled.push({
        platform: "kick",
        channelId: row.channelId,
        channelName: row.channelName,
        displayName: row.displayName,
        profileImage: row.profileImage,
        source: "kick",
      });
    }
  });
  return reconciled;
}

export async function syncKickFollowsAfterLogin(
  getFollows: () => Promise<FollowedChannelsResult>,
  storage: Pick<typeof storageService, "upsertSyncedFollows"> &
    Partial<
      Pick<typeof storageService, "getLocalFollowsByPlatform" | "getKickUser"> &
        Pick<
          typeof storageService,
          "areKickAccountFollowsVerified" | "getPendingFollowWritesByPlatform"
        >
    > = storageService,
  resumePendingWrites?: () => void,
  verifyMissingFollow?: KickFollowVerifier,
  verifyFollowBatch?: KickFollowBatchVerifier
): Promise<KickSyncOutcome> {
  const releaseReconciliation = beginKickAccountReconciliation();
  try {
    const initialViewer = storage.getKickUser?.() ?? null;
    const result = await getFollows();
    if (result.status === "error") {
      return { status: "error", reason: result.reason };
    }
    let kickFollows = result.channels.map(
      (channel) =>
        ({
          platform: "kick",
          channelId: channel.kickUserId ?? channel.id,
          channelName: channel.username,
          displayName: channel.displayName,
          profileImage: channel.avatarUrl,
        }) as Omit<LocalFollow, "id" | "followedAt">
    );
    let pruneAbsent = result.canPruneAbsent;
    if (storage.getPendingFollowWritesByPlatform) {
      const knownSlugs = new Set(kickFollows.map((follow) => follow.channelName.toLowerCase()));
      for (const pending of storage.getPendingFollowWritesByPlatform("kick")) {
        const slug = pending.slug.trim().toLowerCase();
        if (pending.action !== "follow" || !slug || knownSlugs.has(slug)) continue;
        kickFollows.push({
          platform: "kick",
          channelId: pending.channelId,
          channelName: slug,
          displayName: pending.slug,
          profileImage: "",
          source: "kick",
        });
        knownSlugs.add(slug);
      }
    }
    if (
      !pruneAbsent &&
      verifyMissingFollow &&
      storage.getLocalFollowsByPlatform &&
      storage.getKickUser
    ) {
      const viewer = initialViewer;
      if (viewer) {
        const prior = storage.getLocalFollowsByPlatform("kick");
        if (!hasSameKickFollowMembership(kickFollows, prior)) {
          kickFollows = await reconcileKickMissingFollowRows(
            kickFollows,
            prior,
            { id: viewer.id, username: viewer.slug || viewer.username },
            verifyMissingFollow,
            verifyFollowBatch,
            {
              preserveUnavailablePrior: storage.areKickAccountFollowsVerified?.() === true,
            }
          );
          pruneAbsent = true;
        }
      }
    }
    if (storage.getKickUser) {
      const currentViewer = storage.getKickUser();
      if (
        !initialViewer ||
        !currentViewer ||
        initialViewer.id !== currentViewer.id ||
        (initialViewer.slug || initialViewer.username).toLowerCase() !==
          (currentViewer.slug || currentViewer.username).toLowerCase()
      ) {
        return { status: "error", reason: "kick-account-changed" };
      }
    }
    const { accountCount, pendingCount, addedCount, removedCount } = storage.upsertSyncedFollows(
      "kick",
      kickFollows,
      { pruneAbsent }
    );
    resumePendingWrites?.();
    return { status: "ok", count: accountCount, pendingCount, addedCount, removedCount };
  } finally {
    releaseReconciliation();
  }
}

export async function syncTwitchFollowsAfterLogin(
  getFollows: () => Promise<UnifiedChannel[]>,
  storage: Pick<typeof storageService, "upsertSyncedFollows"> = storageService
): Promise<FollowSyncOutcome> {
  let channels: UnifiedChannel[];
  try {
    channels = await getFollows();
  } catch {
    return { status: "error", reason: "twitch-follow-fetch-failed" };
  }
  const twitchFollows = channels.map((channel): Omit<LocalFollow, "id" | "followedAt"> => ({
    platform: "twitch",
    channelId: channel.id,
    channelName: channel.username,
    displayName: channel.displayName,
    profileImage: channel.avatarUrl,
  }));
  const { accountCount, pendingCount, addedCount, removedCount } = storage.upsertSyncedFollows(
    "twitch",
    twitchFollows,
    { pruneAbsent: true }
  );
  return { status: "ok", count: accountCount, pendingCount, addedCount, removedCount };
}

export const KICK_STARTUP_FOLLOW_REFRESH_GRACE_MS = 60 * 1000;
export const FOLLOWS_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

export function shouldDeferKickStartupFollowRefresh(
  platform: Platform,
  trigger: "interval" | "focus",
  now: number,
  startedAt: number,
  graceMs: number = KICK_STARTUP_FOLLOW_REFRESH_GRACE_MS
): boolean {
  return platform === "kick" && trigger === "focus" && now - startedAt < graceMs;
}

interface SyncFollowsOptions {
  allowKickBrowserWindowFallback?: boolean;
  resumeKickPendingWrites?: boolean;
}

function getRoutineFollowSyncOptions(platform: Platform): SyncFollowsOptions {
  return platform === "kick" ? { allowKickBrowserWindowFallback: true } : {};
}

export function persistInitialAuthToken(
  platform: Platform,
  token: AuthToken,
  storage: Pick<typeof storageService, "saveToken"> &
    Partial<Pick<typeof storageService, "invalidateKickAccountFollows">> = storageService
): AuthToken {
  if (platform === "kick") {
    storage.invalidateKickAccountFollows?.();
  }
  storage.saveToken(platform, token);
  return token;
}

interface PerformTwitchDeviceCodeLoginDependencies extends TwitchDeviceCodeLoginDependencies {
  scopes: string[];
  saveToken: (platform: Platform, token: AuthToken) => void;
  scheduleProactiveRefresh: () => void;
  fetchCurrentUser: () => Promise<TwitchUser | null>;
  saveTwitchUser: (user: TwitchUser) => void;
  afterAuthenticated: () => Promise<void>;
  onStatusChange?: (
    status: "pending" | "authorized" | "expired" | "error",
    message?: string
  ) => void;
}

export async function performTwitchDeviceCodeLogin(
  dependencies: PerformTwitchDeviceCodeLoginDependencies
): Promise<TwitchUser | null> {
  const startedAt = Date.now();
  const token = await runTwitchDeviceCodeLogin(
    dependencies.scopes,
    dependencies,
    dependencies.onStatusChange
  );
  dependencies.saveToken("twitch", token);
  logger.info("Auth:Twitch", "Twitch authentication stage", {
    stage: "token-persisted",
    elapsedMs: Date.now() - startedAt,
  });
  dependencies.scheduleProactiveRefresh();

  const user = await dependencies.fetchCurrentUser();
  logger.info("Auth:Twitch", "Twitch authentication stage", {
    stage: "account-fetch-settled",
    identityPresent: user !== null,
    elapsedMs: Date.now() - startedAt,
  });
  if (user) {
    dependencies.saveTwitchUser(user);
  }
  await dependencies.afterAuthenticated();
  logger.info("Auth:Twitch", "Twitch authentication stage", {
    stage: "renderer-notified",
    elapsedMs: Date.now() - startedAt,
  });
  return user;
}

export function registerAuthHandlers(mainWindow: BrowserWindow): void {
  const authHandlersStartedAt = Date.now();
  let twitchLoginInFlight: Promise<{ success: boolean; error?: string }> | null = null;

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
      logger.warn("IPC:Auth", "Could not send: window disposed", { channel });
    }
  }

  /**
   * Sync local follows on login OR on periodic refresh: reconcile the
   * platform's account-source rows against the platform's actual followed
   * channels, honoring `pending_follow_writes` tombstones from push-sync.
   * Runs in the background — does not block the login flow.
   */
  async function syncFollowsOnLogin(
    platform: Platform,
    options: SyncFollowsOptions = {}
  ): Promise<FollowSyncOutcome> {
    try {
      logger.debug("IPC:Auth", "Syncing follows", { platform });

      let importedCount = 0;
      let pendingCount = 0;
      let addedCount = 0;
      let removedCount = 0;
      if (platform === "twitch") {
        const { twitchClient } = await import("../../api/platforms/twitch/twitch-client");
        const outcome = await syncTwitchFollowsAfterLogin(
          () => twitchClient.getAllFollowedChannels(),
          storageService
        );
        if (outcome.status === "error") {
          logger.warn("IPC:Auth", "Twitch follow sync skipped; preserving prior rows", {
            reason: outcome.reason,
          });
          return outcome;
        }
        importedCount = outcome.count;
        pendingCount = outcome.pendingCount;
        addedCount = outcome.addedCount;
        removedCount = outcome.removedCount;
        logger.debug("IPC:Auth", "Synced Twitch follows", {
          importedCount,
          pendingCount,
        });
      } else if (platform === "kick") {
        // Call FollowEndpoints directly rather than kickClient.getAllFollowedChannels()
        // so we get the tagged result. A transient Cloudflare 403 / auth failure
        // must NOT trigger clearAccountFollows — that would silently wipe the
        // user's prior synced follows. See A1 in
        // docs/plans/2026-05-21-001-feat-kick-account-follows-import-plan.md.
        const { getAllFollowedChannels } =
          await import("../../api/platforms/kick/endpoints/follow-endpoints");
        const { getKickAccountFollowState, getKickAccountFollowStates } =
          await import("../../api/platforms/kick/kick-public-profile-reader");
        const outcome = await syncKickFollowsAfterLogin(
          () =>
            getAllFollowedChannels({
              allowBrowserWindowFallback: options.allowKickBrowserWindowFallback === true,
            }),
          storageService,
          options.resumeKickPendingWrites
            ? () => kickFollowWriteService.resumePendingWrites()
            : undefined,
          getKickAccountFollowState,
          getKickAccountFollowStates
        );
        if (outcome.status === "error") {
          // Bail out without firing AUTH_FOLLOWS_SYNCED. The renderer's prior
          // state remains correct.
          return reportKickFollowSyncFailure(outcome);
        }
        importedCount = outcome.count;
        pendingCount = outcome.pendingCount;
        addedCount = outcome.addedCount;
        removedCount = outcome.removedCount;
        logger.debug("IPC:Auth", "Synced Kick follows", {
          importedCount,
          pendingCount,
        });
      }

      // Tell the renderer the local DB now reflects this platform's account
      // follow list so it can re-hydrate useFollowStore and (when there's a
      // net change) refetch the followed-channels query. We always send the
      // event so U8's reconciliation banner can react to pendingCount, but
      // the renderer uses addedCount/removedCount to skip cache invalidation
      // when nothing in the list actually changed — that gate is what stops
      // periodic background syncs from disrupting the sidebar.
      safeSend(IPC_CHANNELS.AUTH_FOLLOWS_SYNCED, {
        platform,
        count: importedCount,
        pendingCount,
        addedCount,
        removedCount,
      });
      return {
        status: "ok",
        count: importedCount,
        pendingCount,
        addedCount,
        removedCount,
      };
    } catch (error) {
      logger.warn("IPC:Auth", "Failed to sync follows", {
        platform,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      // Don't throw — this is non-critical and should not block the login
      return {
        status: "error",
        reason: error instanceof Error ? error.message : "sync-failed",
      };
    }
  }

  function reconcileLiveNotificationsAfterFollowSync(
    syncPromise: Promise<FollowSyncOutcome>
  ): void {
    void syncPromise.finally(() => liveNotificationService.reconcileSilently()).catch(() => {});
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
  // the auth-validity guard lives inside maybeRefreshFollows so the
  // interval ticks harmlessly when the user isn't signed in.
  //
  // The single-flight Promise inside each platform's getAllFollowedChannels
  // collapses concurrent triggers, so over-firing is cheap. We still
  // cooldown the on-focus path to avoid hammering on Alt-Tab.
  const FOCUS_REFRESH_COOLDOWN_MS = 60 * 1000;
  const lastRefreshAt: Map<Platform, number> = new Map([
    ["kick", 0],
    ["twitch", 0],
  ]);

  async function canRefreshFollows(platform: Platform): Promise<boolean> {
    return platform === "kick"
      ? await kickAuthService.ensureValidToken()
      : await twitchAuthService.ensureValidToken();
  }

  function maybeRefreshFollows(platform: Platform, trigger: "interval" | "focus"): void {
    const now = Date.now();
    if (shouldDeferKickStartupFollowRefresh(platform, trigger, now, authHandlersStartedAt)) {
      logger.debug("IPC:Auth", "deferred Kick follow refresh during startup", {
        trigger,
        elapsedMs: now - authHandlersStartedAt,
        graceMs: KICK_STARTUP_FOLLOW_REFRESH_GRACE_MS,
      });
      return;
    }
    if (trigger === "focus") {
      const last = lastRefreshAt.get(platform) ?? 0;
      if (now - last < FOCUS_REFRESH_COOLDOWN_MS) return;
    }
    lastRefreshAt.set(platform, now);
    void (async () => {
      const isAuthenticated = await canRefreshFollows(platform);
      if (!isAuthenticated) {
        logger.debug("IPC:Auth", "follow refresh skipped; platform not authenticated", {
          platform,
          trigger,
        });
        return;
      }
      logger.debug("IPC:Auth", "follow refresh", { platform, trigger });
      await syncFollowsOnLogin(platform, getRoutineFollowSyncOptions(platform));
    })().catch(() => {});
  }

  createManagedInterval(() => maybeRefreshFollows("kick", "interval"), FOLLOWS_REFRESH_INTERVAL_MS);
  createManagedInterval(
    () => maybeRefreshFollows("twitch", "interval"),
    FOLLOWS_REFRESH_INTERVAL_MS
  );
  mainWindow.on("focus", () => {
    maybeRefreshFollows("kick", "focus");
    maybeRefreshFollows("twitch", "focus");
  });

  // ========== Kick OAuth Expiry (push event) ==========
  // OAuth and Kick's website chat session are independent. Notify the renderer
  // without closing a still-valid hidden chat sender.
  kickAuthService.on("session-expired", () => {
    safeSend(IPC_CHANNELS.AUTH_KICK_SESSION_EXPIRED);
    liveNotificationService.reconcileSilently();
  });

  // ========== Auth - Token Management ==========
  ipcMain.handle(IPC_CHANNELS.AUTH_GET_TOKEN, (event, payload: unknown) => {
    if (!isAllowedSender(event)) return null;
    const parsed = kickPlatformPayloadSchema.safeParse(payload);
    if (!parsed.success) return null;
    return storageService.getToken(parsed.data.platform);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_SAVE_TOKEN, (event, payload: unknown) => {
    if (!isAllowedSender(event)) return;
    const parsed = kickTokenPayloadSchema.safeParse(payload);
    if (!parsed.success) return;
    persistInitialAuthToken(parsed.data.platform, parsed.data.token);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_CLEAR_TOKEN, (event, payload: unknown) => {
    if (!isAllowedSender(event)) return;
    const parsed = platformPayloadSchema.safeParse(payload);
    if (!parsed.success) return;
    storageService.clearToken(parsed.data.platform);
    if (parsed.data.platform === "twitch") {
      liveNotificationService.reconcileSilently();
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_HAS_TOKEN, (event, payload: unknown) => {
    if (!isAllowedSender(event)) return false;
    const parsed = platformPayloadSchema.safeParse(payload);
    if (!parsed.success) return false;
    return storageService.hasToken(parsed.data.platform);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_IS_TOKEN_EXPIRED, (event, payload: unknown) => {
    if (!isAllowedSender(event)) return true;
    const parsed = platformPayloadSchema.safeParse(payload);
    if (!parsed.success) return true;
    return storageService.isTokenExpired(parsed.data.platform);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_CLEAR_ALL_TOKENS, (event) => {
    if (!isAllowedSender(event)) return;
    storageService.clearAllTokens();
    liveNotificationService.reconcileSilently();
  });

  // ========== Auth - User Data ==========
  ipcMain.handle(IPC_CHANNELS.AUTH_GET_TWITCH_USER, (event) => {
    if (!isAllowedSender(event)) return null;
    return storageService.getTwitchUser();
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_SAVE_TWITCH_USER, (event, payload: unknown) => {
    if (!isAllowedSender(event)) return;
    const parsed = twitchUserPayloadSchema.safeParse(payload);
    if (!parsed.success) return;
    storageService.saveTwitchUser(parsed.data.user);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_CLEAR_TWITCH_USER, (event) => {
    if (!isAllowedSender(event)) return;
    storageService.clearTwitchUser();
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_GET_KICK_USER, (event) => {
    if (!isAllowedSender(event)) return null;
    return storageService.getKickUser();
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_SAVE_KICK_USER, (event, payload: unknown) => {
    if (!isAllowedSender(event)) return;
    const parsed = kickUserPayloadSchema.safeParse(payload);
    if (!parsed.success) return;
    storageService.saveKickUser(parsed.data.user);
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_CLEAR_KICK_USER, (event) => {
    if (!isAllowedSender(event)) return;
    storageService.clearKickUser();
  });

  // ========== Auth - Status ==========
  ipcMain.handle(IPC_CHANNELS.AUTH_GET_STATUS, (event): AuthStatus => {
    if (!isAllowedSender(event)) {
      return {
        twitch: { connected: false, user: null, hasToken: false, isExpired: true },
        kick: { connected: false, user: null, hasToken: false, isExpired: true },
        isGuest: true,
      };
    }
    const twitchUser = storageService.getTwitchUser();
    const kickUser = storageService.getKickUser();
    const twitchHasToken = storageService.hasUsableToken("twitch");
    const kickHasToken = storageService.hasUsableToken("kick");
    const twitchExpired = !twitchHasToken || storageService.isTokenExpired("twitch");
    const kickExpired = !kickHasToken || storageService.isTokenExpired("kick");

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

  ipcMain.handle(IPC_CHANNELS.AUTH_SYNC_FOLLOWS, async (event, payload: unknown) => {
    if (!isAllowedSender(event)) return { success: false, error: "Request rejected" };
    const parsed = platformPayloadSchema.safeParse(payload);
    if (!parsed.success) return { success: false, error: "Invalid request" };
    const { platform } = parsed.data;
    const isAuthenticated =
      platform === "kick"
        ? await kickAuthService.ensureValidToken()
        : await twitchAuthService.ensureValidToken();
    if (!isAuthenticated) {
      return { success: false, error: "not-authenticated" };
    }

    const result = await syncFollowsOnLogin(platform, getRoutineFollowSyncOptions(platform));
    logger.info("IPC:Auth", "Follow sync completed", {
      platform,
      status: result.status,
      ...(result.status === "ok"
        ? {
            count: result.count,
            pendingCount: result.pendingCount,
            addedCount: result.addedCount,
            removedCount: result.removedCount,
          }
        : { reason: result.reason }),
    });
    if (result.status === "error") {
      return { success: false, error: result.reason } satisfies AuthSyncFollowsResult;
    }

    return {
      success: true,
      count: result.count,
      pendingCount: result.pendingCount,
      addedCount: result.addedCount,
      removedCount: result.removedCount,
    } satisfies AuthSyncFollowsResult;
  });

  // ========== Auth - OAuth Flow using Localhost Callback Server ==========

  // Track in-progress OAuth flows to prevent state mismatch from multiple clicks
  const pendingOAuthFlows: Map<"kick", { cancel: () => void }> = new Map();

  /** Kick keeps the localhost callback + Worker code-exchange flow. */
  async function handleKickOAuthFlow(): Promise<void> {
    const platform = "kick" as const;
    // Validate OAuth config first
    const configErrors = validateOAuthConfig(platform);
    if (configErrors.length > 0) {
      throw new Error(`OAuth not configured: ${configErrors.join(", ")}`);
    }

    // Cancel any existing OAuth flow for this platform to prevent state mismatch
    const existingFlow = pendingOAuthFlows.get(platform);
    if (existingFlow) {
      logger.debug("IPC:Auth", "Cancelling previous OAuth flow", { platform });
      existingFlow.cancel();
      pendingOAuthFlows.delete(platform);
    }

    // Stop any existing callback server before starting a new one
    oauthCallbackServer.stop();

    const pkce = generatePkceChallenge();
    const state = generateState();

    // Bind before opening Kick so the authorization URL always uses the port
    // that this process actually owns. Ten minutes covers both the five-minute
    // kick.com sign-in phase and the subsequent id.kick.com authorization phase.
    const pendingCallback = await oauthCallbackServer.start(platform, state, {
      timeout: 10 * 60 * 1000,
    });
    const { redirectUri } = authWindowManager.openAuthWindow(platform, {
      port: pendingCallback.port,
      pkce,
      state,
    });

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
      const callbackResult = await pendingCallback.callback;

      // Check if this flow was cancelled (a newer flow started)
      if (isCancelled) {
        logger.debug("IPC:Auth", "OAuth flow was cancelled", { platform });
        return;
      }

      logger.debug("IPC:Auth", "Received OAuth callback", { platform });

      // Exchange the code for a token
      const token = await tokenExchangeService.exchangeCodeForToken({
        platform,
        code: callbackResult.code,
        redirectUri,
        pkce,
      });

      // Save the token
      persistInitialAuthToken(platform, token);
      kickAuthService.scheduleProactiveRefresh();

      logger.debug("IPC:Auth", "Successfully authenticated", { platform });

      try {
        const user = await kickAuthService.fetchCurrentUser();
        if (user) {
          storageService.saveKickUser(user);
        }
      } catch (userError) {
        logger.error("IPC:Auth", "Failed to fetch Kick user info", {
          error:
            userError instanceof Error
              ? { name: userError.name, message: userError.message, stack: userError.stack }
              : String(userError),
        });
      }

      // Sync local follows with account follows (background, non-blocking)
      reconcileLiveNotificationsAfterFollowSync(
        syncFollowsOnLogin(platform, {
          allowKickBrowserWindowFallback: true,
          resumeKickPendingWrites: true,
        })
      );

      // Notify renderer of successful auth
      safeSend(IPC_CHANNELS.AUTH_ON_CALLBACK, {
        platform,
        success: true,
      });
    } catch (error) {
      // Don't report errors for cancelled flows
      if (isCancelled) {
        logger.debug("IPC:Auth", "Ignoring error from cancelled OAuth flow", { platform });
        return;
      }

      logger.error("IPC:Auth", "OAuth failed", {
        platform,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });

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

  // The renderer's established login action now completes Twitch's public
  // Device Code Grant end-to-end. Kick continues to use the callback/Worker
  // authorization-code flow below.
  ipcMain.handle(IPC_CHANNELS.AUTH_OPEN_TWITCH, async (event) => {
    if (!isAllowedSender(event)) return { success: false, error: "Request rejected" };
    if (twitchLoginInFlight) return twitchLoginInFlight;

    const login = (async (): Promise<{ success: boolean; error?: string }> => {
      const startedAt = Date.now();
      let lastStatus: string | null = null;
      logger.debug("IPC:Auth", "Opening Twitch login");
      try {
        const config = getOAuthConfig("twitch");
        if (!config.clientId) {
          throw new Error("Twitch public client ID is not configured.");
        }

        await performTwitchDeviceCodeLogin({
          scopes: config.scopes,
          requestDeviceCode: (scopes) => deviceCodeFlowService.requestDeviceCode(scopes),
          openVerificationWindow: () => twitchDeviceAuthWindow.open(),
          pollForToken: (deviceCode, interval, expiresIn, scopes, onStatusChange, signal) =>
            deviceCodeFlowService.pollForToken(
              deviceCode,
              interval,
              expiresIn,
              scopes,
              onStatusChange,
              signal
            ),
          saveToken: (platform, token) => storageService.saveToken(platform, token),
          scheduleProactiveRefresh: () => twitchAuthService.scheduleProactiveRefresh(),
          fetchCurrentUser: () => twitchAuthService.fetchCurrentUser(),
          saveTwitchUser: (user) => storageService.saveTwitchUser(user),
          afterAuthenticated: async () => {
            reconcileLiveNotificationsAfterFollowSync(syncFollowsOnLogin("twitch"));
            safeSend(IPC_CHANNELS.AUTH_ON_CALLBACK, {
              platform: "twitch",
              success: true,
            });
          },
          onStatusChange: (status, message) => {
            if (lastStatus !== status) {
              lastStatus = status;
              logger.info("Auth:DeviceCode", "Twitch device authorization status", {
                status,
                elapsedMs: Date.now() - startedAt,
              });
            }
            safeSend(IPC_CHANNELS.AUTH_DCF_STATUS, { status, message });
          },
        });
        return { success: true };
      } catch (error) {
        logger.error("IPC:Auth", "Twitch OAuth error", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : String(error),
        });
        return {
          success: false,
          error: error instanceof Error ? error.message : "Authentication failed",
        };
      }
    })();
    twitchLoginInFlight = login;
    try {
      return await login;
    } finally {
      if (twitchLoginInFlight === login) twitchLoginInFlight = null;
    }
  });

  // Handle opening Kick OAuth
  ipcMain.handle(IPC_CHANNELS.AUTH_OPEN_KICK, async (event) => {
    if (!isAllowedSender(event)) return { success: false, error: "Request rejected" };
    logger.debug("IPC:Auth", "Opening Kick login");
    try {
      await handleKickOAuthFlow();
      return { success: true };
    } catch (error) {
      logger.error("IPC:Auth", "Kick OAuth error", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Authentication failed",
      };
    }
  });

  // ========== Twitch Auth Operations ==========

  // Handle Twitch logout
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT_TWITCH, async (event) => {
    if (!isAllowedSender(event)) return { success: false, error: "Request rejected" };
    logger.debug("IPC:Auth", "Logging out from Twitch");
    try {
      await twitchAuthService.logout();
      // Twitch-source rows stay in the DB — `getActiveFollowsByPlatform`
      // hides them via the no-token branch and surfaces guest follows
      // instead. They reappear on next sign-in. No DB delete needed.
      safeSend(IPC_CHANNELS.AUTH_ON_CALLBACK, {
        platform: "twitch",
        success: true,
        loggedOut: true,
      });
      liveNotificationService.reconcileSilently();
      return { success: true };
    } catch (error) {
      logger.error("IPC:Auth", "Twitch logout failed", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      return { success: false, error: error instanceof Error ? error.message : "Logout failed" };
    }
  });

  // Handle Twitch token refresh
  ipcMain.handle(IPC_CHANNELS.AUTH_REFRESH_TWITCH, async (event) => {
    if (!isAllowedSender(event)) return { success: false, error: "Request rejected" };
    logger.debug("IPC:Auth", "Refreshing Twitch token");
    try {
      const token = await twitchAuthService.refreshToken();
      if (token) {
        liveNotificationService.reconcileSilently();
        return {
          success: true,
          user: storageService.getTwitchUser(),
          hasToken: storageService.hasToken("twitch"),
          isExpired: storageService.isTokenExpired("twitch"),
        };
      }
      return { success: false, error: "Token refresh failed" };
    } catch (error) {
      logger.error("IPC:Auth", "Twitch token refresh failed", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Token refresh failed",
      };
    }
  });

  // Narrow raw-token exception for renderer-owned Twitch IRC/Hermes sockets.
  // Helix, EventSub, emotes, and account operations must use main-owned IPC.
  ipcMain.handle(IPC_CHANNELS.AUTH_GET_VALID_TWITCH_TOKEN, async (event) => {
    if (!isAllowedSender(event)) return null;
    return await twitchAuthService.getValidAccessToken();
  });

  // Wire the auth-lost signal. Fires when the refresh chain dies permanently —
  // Twitch rejected the refresh token (invalid_grant), or we exhausted the
  // transient-failure budget. The renderer listens via onTwitchAuthLost and
  // flips the auth-store to a "reconnect required" state.
  twitchAuthService.setAuthLostHandler(() => {
    safeSend(IPC_CHANNELS.AUTH_TWITCH_AUTH_LOST);
    liveNotificationService.reconcileSilently();
  });

  // Handle fetching Twitch user info
  ipcMain.handle(IPC_CHANNELS.AUTH_FETCH_TWITCH_USER, async (event) => {
    if (!isAllowedSender(event)) return { success: false, error: "Request rejected" };
    logger.debug("IPC:Auth", "Fetching Twitch user info");
    try {
      const user = await twitchAuthService.fetchCurrentUser();
      if (user) {
        return { success: true, user };
      }
      return { success: false, error: "Failed to fetch user info" };
    } catch (error) {
      logger.error("IPC:Auth", "Failed to fetch Twitch user", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch user info",
      };
    }
  });

  // ========== Kick Auth Operations ==========

  // Handle Kick logout (generic)
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async (event, payload: unknown) => {
    if (!isAllowedSender(event)) return { success: false, error: "Request rejected" };
    const parsed = platformPayloadSchema.safeParse(payload);
    if (!parsed.success) return { success: false, error: "Invalid request" };
    const { platform } = parsed.data;
    if (platform === "twitch") {
      await twitchAuthService.logout();
    } else if (platform === "kick") {
      await kickAuthService.logout();
      await disposeSendWindow();
    }

    // Platform-source rows stay in the DB; the no-token branch in
    // getActiveFollowsByPlatform hides them and shows guest follows instead.
    safeSend(IPC_CHANNELS.AUTH_ON_CALLBACK, {
      platform,
      success: true,
      loggedOut: true,
    });
    liveNotificationService.reconcileSilently();
    return { success: true };
  });

  // Handle Kick logout (specific channel)
  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT_KICK, async (event) => {
    if (!isAllowedSender(event)) return { success: false, error: "Request rejected" };
    logger.debug("IPC:Auth", "Logging out from Kick");
    try {
      await kickAuthService.logout();
      await disposeSendWindow();
      // Kick-source rows persist in the DB; getActiveFollowsByPlatform's
      // no-token branch hides them and surfaces guest follows instead.
      safeSend(IPC_CHANNELS.AUTH_ON_CALLBACK, {
        platform: "kick",
        success: true,
        loggedOut: true,
      });
      liveNotificationService.reconcileSilently();
      return { success: true };
    } catch (error) {
      logger.error("IPC:Auth", "Kick logout failed", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      return { success: false, error: error instanceof Error ? error.message : "Logout failed" };
    }
  });

  // Handle Kick token refresh
  ipcMain.handle(IPC_CHANNELS.AUTH_REFRESH_KICK, async (event) => {
    if (!isAllowedSender(event)) return { success: false, error: "Request rejected" };
    logger.debug("IPC:Auth", "Refreshing Kick token");
    try {
      const token = await kickAuthService.refreshToken();
      if (token) {
        return { success: true, token };
      }
      return { success: false, error: "Token refresh failed" };
    } catch (error) {
      logger.error("IPC:Auth", "Kick token refresh failed", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Token refresh failed",
      };
    }
  });

  // Handle Kick user fetch
  ipcMain.handle(IPC_CHANNELS.AUTH_FETCH_KICK_USER, async (event) => {
    if (!isAllowedSender(event)) return { success: false, error: "Request rejected" };
    logger.debug("IPC:Auth", "Fetching Kick user info");
    try {
      const user = await kickAuthService.fetchCurrentUser();
      if (user) {
        return { success: true, user };
      }
      return { success: false, error: "Failed to fetch user info" };
    } catch (error) {
      logger.error("IPC:Auth", "Failed to fetch Kick user", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to fetch user info",
      };
    }
  });

  // ========== Device Code Flow (Twitch) ==========

  // Start device code flow - returns codes for user to enter
  // Poll for token after user authorizes
}
