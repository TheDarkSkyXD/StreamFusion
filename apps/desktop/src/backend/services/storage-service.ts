/**
 * Storage Service
 *
 * Provides secure, persistent storage for authentication tokens,
 * user preferences using electron-store, and local follows using SQLite.
 *
 * Uses Electron's safeStorage API to encrypt sensitive data like tokens.
 */

import { safeStorage } from "electron";
import Store from "electron-store";

import { logger } from "@/lib/cross-logger";
import {
  type AuthToken,
  type BufferPreferences,
  type CaptionPreferences,
  DEFAULT_CAPTION_PREFERENCES,
  DEFAULT_NOTIFICATION_PREFERENCES,
  DEFAULT_USER_PREFERENCES,
  DEFAULT_WINDOW_BOUNDS,
  type EncryptedToken,
  type FollowSource,
  type KickUser,
  type LocalFollow,
  type NotificationPreferences,
  type Platform,
  type StorageSchema,
  type TwitchUser,
  type UserPreferences,
} from "../../shared/auth-types";
import type { DownloadQueueSnapshot } from "../../shared/download-types";
import type { StreamRecordingJournalV2 } from "../../shared/stream-recording-types";

import {
  dbService,
  type PendingFollowAction,
  type PendingFollowWrite,
  type PendingFollowWriteStatus,
} from "./database-service";

// ========== Default Values ==========

const KICK_ACCOUNT_FOLLOWS_VERIFIED_KEY = "kick-account-follows-verified-v3";

function kickFollowVerificationIdentity(user: KickUser | null): string | null {
  if (!user) return null;
  return `${user.id}:${(user.slug || user.username).toLowerCase()}`;
}

const LEGACY_LATENCY_FIRST_BUFFER_PREFERENCES: BufferPreferences = {
  lowLatencyMode: true,
  liveSyncDurationCount: 2,
  maxBufferLengthSec: 15,
  maxMaxBufferLengthSec: 30,
};

function isLegacyLatencyFirstBufferPreferences(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const buffer = value as Partial<BufferPreferences>;
  return (
    buffer.lowLatencyMode === LEGACY_LATENCY_FIRST_BUFFER_PREFERENCES.lowLatencyMode &&
    buffer.liveSyncDurationCount ===
      LEGACY_LATENCY_FIRST_BUFFER_PREFERENCES.liveSyncDurationCount &&
    buffer.maxBufferLengthSec === LEGACY_LATENCY_FIRST_BUFFER_PREFERENCES.maxBufferLengthSec &&
    buffer.maxMaxBufferLengthSec === LEGACY_LATENCY_FIRST_BUFFER_PREFERENCES.maxMaxBufferLengthSec
  );
}

function normalizeCaptionPreferences(value: unknown): CaptionPreferences {
  const stored = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const preferredLanguage = stored.preferredLanguage;
  const localModelId = stored.localModelId;
  const textSizePercent = stored.textSizePercent;
  const backgroundOpacityPercent = stored.backgroundOpacityPercent;

  return {
    enabled:
      typeof stored.enabled === "boolean" ? stored.enabled : DEFAULT_CAPTION_PREFERENCES.enabled,
    source:
      stored.source === "platform" || stored.source === "local"
        ? stored.source
        : DEFAULT_CAPTION_PREFERENCES.source,
    preferredLanguage:
      preferredLanguage === null ||
      (typeof preferredLanguage === "string" &&
        /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(preferredLanguage))
        ? preferredLanguage
        : DEFAULT_CAPTION_PREFERENCES.preferredLanguage,
    localModelId:
      localModelId === null ||
      (typeof localModelId === "string" && /^[a-z0-9][a-z0-9._-]*$/i.test(localModelId))
        ? localModelId
        : DEFAULT_CAPTION_PREFERENCES.localModelId,
    textSizePercent:
      typeof textSizePercent === "number" &&
      Number.isFinite(textSizePercent) &&
      textSizePercent >= 75 &&
      textSizePercent <= 200
        ? textSizePercent
        : DEFAULT_CAPTION_PREFERENCES.textSizePercent,
    backgroundOpacityPercent:
      typeof backgroundOpacityPercent === "number" &&
      Number.isFinite(backgroundOpacityPercent) &&
      backgroundOpacityPercent >= 0 &&
      backgroundOpacityPercent <= 100
        ? backgroundOpacityPercent
        : DEFAULT_CAPTION_PREFERENCES.backgroundOpacityPercent,
  };
}

function isAuthToken(value: unknown): value is AuthToken {
  if (typeof value !== "object" || value === null) return false;
  return (
    "accessToken" in value &&
    typeof value.accessToken === "string" &&
    (!("refreshToken" in value) || typeof value.refreshToken === "string") &&
    (!("expiresAt" in value) || typeof value.expiresAt === "number") &&
    (!("scope" in value) ||
      (Array.isArray(value.scope) && value.scope.every((scope) => typeof scope === "string"))) &&
    (!("authFlow" in value) || value.authFlow === "device-code")
  );
}

function hydratePreferences(stored: Partial<UserPreferences>): UserPreferences {
  const notificationPreferences: NotificationPreferences = {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    ...(stored.notifications ?? {}),
    perChannelNotifications: {
      ...DEFAULT_NOTIFICATION_PREFERENCES.perChannelNotifications,
      ...(stored.notifications?.perChannelNotifications ?? {}),
    },
  };
  const hydrated = {
    ...DEFAULT_USER_PREFERENCES,
    ...stored,
    notifications: notificationPreferences,
    chatDisplay: {
      ...DEFAULT_USER_PREFERENCES.chatDisplay,
      ...(stored.chatDisplay ?? {}),
    },
    captions: normalizeCaptionPreferences(stored.captions),
  };
  if (isLegacyLatencyFirstBufferPreferences(hydrated.buffer)) {
    return { ...hydrated, buffer: DEFAULT_USER_PREFERENCES.buffer };
  }
  return hydrated;
}

const defaults: StorageSchema = {
  authTokens: {},
  appTokens: {},
  twitchUser: null,
  kickUser: null,
  localFollows: [],
  downloadQueue: { jobs: [] },
  streamRecordingJournal: { version: 2, state: "empty", session: null },
  preferences: DEFAULT_USER_PREFERENCES,
  lastActiveTab: "home",
  windowBounds: DEFAULT_WINDOW_BOUNDS,
};

// ========== Storage Service Class ==========

class StorageService {
  private store: Store<StorageSchema> | null = null;
  private isEncryptionAvailable = false;
  // In-memory cache of decrypted auth tokens. Avoids a safeStorage.decryptString()
  // call (DPAPI on Windows) on every API call. Lifetime = process lifetime,
  // invalidated by saveToken / clearToken / clearAllTokens.
  private tokenCache = new Map<Platform, AuthToken>();

  initialize() {
    if (this.store) return; // Already initialized

    this.store = new Store<StorageSchema>({
      // projectName must be passed explicitly even in electron-store@11. Conf
      // (the underlying lib) errors out when it can't derive a project name
      // from app.getName(), and during electron-vite dev startup the app
      // name isn't always populated before the module-level Store
      // instantiations fire (see update-service top-level call). The
      // commit-65b7a80 cleanup that dropped this field caused a hard crash
      // at "Please specify the projectName option" during dev rebuild.
      projectName: "streamfusion",
      name: "streamfusion-storage",
      defaults,
    } as ConstructorParameters<typeof Store<StorageSchema>>[0]);

    // Check if safeStorage encryption is available
    this.isEncryptionAvailable = safeStorage.isEncryptionAvailable();
    logger.debug("Service:Storage", "Storage service initialized", {
      encryptionAvailable: this.isEncryptionAvailable,
    });
  }

  private get storeInstance(): Store<StorageSchema> {
    if (!this.store) {
      throw new Error("Storage not initialized. Call initialize() first.");
    }
    return this.store;
  }

  // ========== Token Management (Electron Store) ==========

  /**
   * Encrypt a token string using Electron's safeStorage
   */
  private encryptToken(token: string): EncryptedToken {
    if (!this.isEncryptionAvailable) {
      // Fallback: Store as base64 (less secure, but works in dev)
      logger.warn("Service:Storage", "safeStorage not available, using base64 fallback");
      return { encrypted: Buffer.from(token).toString("base64"), encoding: "base64" };
    }

    const encrypted = safeStorage.encryptString(token);
    return { encrypted: encrypted.toString("base64"), encoding: "safeStorage" };
  }

  /**
   * Decrypt an encrypted token
   */
  private decryptToken(encryptedToken: EncryptedToken): {
    tokenString: string;
    encoding: "safeStorage" | "base64";
  } {
    const buffer = Buffer.from(encryptedToken.encrypted, "base64");

    if (encryptedToken.encoding === "safeStorage") {
      if (!this.isEncryptionAvailable) {
        throw new Error("safeStorage is unavailable for an encrypted token");
      }
      return { tokenString: safeStorage.decryptString(buffer), encoding: "safeStorage" };
    }

    if (encryptedToken.encoding === "base64") {
      return { tokenString: buffer.toString("utf8"), encoding: "base64" };
    }

    if (encryptedToken.encoding !== undefined) {
      throw new Error("Unsupported token encoding");
    }

    // Legacy records were not marked. Prefer safeStorage when available, then
    // defensively fall back to the old base64 representation.
    if (this.isEncryptionAvailable) {
      try {
        return { tokenString: safeStorage.decryptString(buffer), encoding: "safeStorage" };
      } catch {
        return { tokenString: buffer.toString("utf8"), encoding: "base64" };
      }
    }

    return { tokenString: buffer.toString("utf8"), encoding: "base64" };
  }

  /**
   * Save an auth token for a platform
   */
  saveToken(platform: Platform, token: AuthToken): void {
    const tokenString = JSON.stringify(token);
    const encrypted = this.encryptToken(tokenString);

    const tokens = this.storeInstance.get("authTokens") || {};
    tokens[platform] = encrypted;
    this.storeInstance.set("authTokens", tokens);
    this.tokenCache.set(platform, token);

    logger.debug("Service:Storage", "Token saved", { platform });
  }

  /**
   * Get an auth token for a platform
   */
  getToken(platform: Platform): AuthToken | null {
    const cached = this.tokenCache.get(platform);
    if (cached) return cached;

    const tokens = this.storeInstance.get("authTokens") || {};
    const encrypted = tokens[platform];

    if (!encrypted) {
      return null;
    }

    try {
      const decrypted = this.decryptToken(encrypted);
      const parsed: unknown = JSON.parse(decrypted.tokenString);
      if (!isAuthToken(parsed)) {
        throw new Error("Stored auth token is invalid");
      }
      const token = parsed;
      if (decrypted.encoding === "base64" && this.isEncryptionAvailable) {
        this.saveToken(platform, token);
      } else {
        this.tokenCache.set(platform, token);
      }
      return token;
    } catch (error) {
      logger.error("Service:Storage", "Failed to decrypt token", {
        platform,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      return null;
    }
  }

  saveTwitchFollowWriteToken(token: AuthToken): void {
    const encrypted = this.encryptToken(JSON.stringify(token));
    this.storeInstance.set("twitchFollowWriteToken", encrypted);
    logger.debug("Service:Storage", "Twitch follow-write token saved");
  }

  getTwitchFollowWriteToken(): AuthToken | null {
    const encrypted = this.storeInstance.get("twitchFollowWriteToken");
    if (!encrypted) return null;

    try {
      const decrypted = this.decryptToken(encrypted);
      const parsed: unknown = JSON.parse(decrypted.tokenString);
      if (!isAuthToken(parsed)) return null;
      if (decrypted.encoding === "base64" && this.isEncryptionAvailable) {
        this.storeInstance.set("twitchFollowWriteToken", this.encryptToken(JSON.stringify(parsed)));
      }
      return parsed;
    } catch (error) {
      logger.error("Service:Storage", "Failed to decrypt Twitch follow-write token", {
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      return null;
    }
  }

  clearTwitchFollowWriteToken(): void {
    this.storeInstance.delete("twitchFollowWriteToken");
    logger.debug("Service:Storage", "Twitch follow-write token cleared");
  }

  saveKickWebBearer(bearer: string): void {
    if (!/^Bearer \d+\|[A-Za-z0-9]+$/.test(bearer)) {
      throw new Error("Invalid Kick web bearer");
    }
    this.storeInstance.set("kickWebBearer", this.encryptToken(bearer));
    logger.debug("Service:Storage", "Kick web bearer saved");
  }

  getKickWebBearer(): string | null {
    const encrypted = this.storeInstance.get("kickWebBearer");
    if (!encrypted) return null;

    try {
      const decrypted = this.decryptToken(encrypted);
      if (!/^Bearer \d+\|[A-Za-z0-9]+$/.test(decrypted.tokenString)) {
        throw new Error("Stored Kick web bearer is invalid");
      }
      if (decrypted.encoding === "base64" && this.isEncryptionAvailable) {
        this.storeInstance.set("kickWebBearer", this.encryptToken(decrypted.tokenString));
      }
      return decrypted.tokenString;
    } catch (error) {
      logger.error("Service:Storage", "Failed to decrypt Kick web bearer", {
        error: error instanceof Error ? { name: error.name } : "unknown",
      });
      return null;
    }
  }

  clearKickWebBearer(): void {
    this.storeInstance.delete("kickWebBearer");
    logger.debug("Service:Storage", "Kick web bearer cleared");
  }

  /**
   * Check if a token exists for a platform
   */
  hasToken(platform: Platform): boolean {
    const tokens = this.storeInstance.get("authTokens") || {};
    return !!tokens[platform];
  }

  /**
   * Check if a stored token can be decrypted and validated in this process.
   */
  hasUsableToken(platform: Platform): boolean {
    return this.getToken(platform) !== null;
  }

  /**
   * Check if a token is expired
   */
  isTokenExpired(platform: Platform): boolean {
    const token = this.getToken(platform);
    // If there's no token, consider it expired
    if (!token) {
      return true;
    }
    // If there's no expiresAt, assume the token is still valid
    if (!token.expiresAt) {
      return false;
    }
    // Consider expired if less than 5 minutes remaining
    return Date.now() > token.expiresAt - 5 * 60 * 1000;
  }

  /**
   * Clear token for a platform
   */
  clearToken(platform: Platform): void {
    const tokens = this.storeInstance.get("authTokens") || {};
    delete tokens[platform];
    this.storeInstance.set("authTokens", tokens);
    this.tokenCache.delete(platform);
    logger.debug("Service:Storage", "Token cleared", { platform });
  }

  /**
   * Clear all tokens
   */
  clearAllTokens(): void {
    this.storeInstance.set("authTokens", {});
    this.storeInstance.set("appTokens", {});
    this.storeInstance.delete("twitchFollowWriteToken");
    this.storeInstance.delete("kickWebBearer");
    this.tokenCache.clear();
    logger.debug("Service:Storage", "All tokens cleared");
  }

  // ========== App Token Management (Electron Store) ==========

  /**
   * Save an app token for a platform
   */
  saveAppToken(platform: Platform, token: AuthToken): void {
    const tokenString = JSON.stringify(token);
    const encrypted = this.encryptToken(tokenString);

    const tokens = this.storeInstance.get("appTokens") || {};
    tokens[platform] = encrypted;
    this.storeInstance.set("appTokens", tokens);

    logger.debug("Service:Storage", "App token saved", { platform });
  }

  /**
   * Get an app token for a platform
   */
  getAppToken(platform: Platform): AuthToken | null {
    const tokens = this.storeInstance.get("appTokens") || {};
    const encrypted = tokens[platform];

    if (!encrypted) {
      return null;
    }

    try {
      const decrypted = this.decryptToken(encrypted);
      const parsed: unknown = JSON.parse(decrypted.tokenString);
      if (!isAuthToken(parsed)) {
        throw new Error("Stored app token is invalid");
      }
      if (decrypted.encoding === "base64" && this.isEncryptionAvailable) {
        tokens[platform] = this.encryptToken(JSON.stringify(parsed));
        this.storeInstance.set("appTokens", tokens);
      }
      return parsed;
    } catch (error) {
      logger.error("Service:Storage", "Failed to decrypt app token", {
        platform,
        error:
          error instanceof Error
            ? { name: error.name, message: error.message, stack: error.stack }
            : String(error),
      });
      return null;
    }
  }

  /**
   * Check if an app token is expired
   */
  isAppTokenExpired(platform: Platform): boolean {
    const token = this.getAppToken(platform);
    // If there's no token, consider it expired
    if (!token) {
      return true;
    }
    // If there's no expiresAt, assume the token is still valid
    if (!token.expiresAt) {
      return false;
    }
    // Consider expired if less than 5 minutes remaining
    return Date.now() > token.expiresAt - 5 * 60 * 1000;
  }

  // ========== User Management (Electron Store) ==========

  /**
   * Save Twitch user data
   */
  saveTwitchUser(user: TwitchUser): void {
    this.storeInstance.set("twitchUser", user);
  }

  /**
   * Get Twitch user data
   */
  getTwitchUser(): TwitchUser | null {
    return this.storeInstance.get("twitchUser") || null;
  }

  /**
   * Clear Twitch user data
   */
  clearTwitchUser(): void {
    this.storeInstance.set("twitchUser", null);
  }

  /**
   * Save Kick user data
   */
  saveKickUser(user: KickUser): void {
    this.storeInstance.set("kickUser", user);
  }

  /**
   * Get Kick user data
   */
  getKickUser(): KickUser | null {
    return this.storeInstance.get("kickUser") || null;
  }

  /**
   * Clear Kick user data
   */
  clearKickUser(): void {
    this.storeInstance.set("kickUser", null);
  }

  // ========== Local Follows Management (SQLite) ==========

  /**
   * Get all local follows (both guest and account)
   */
  getLocalFollows(): LocalFollow[] {
    return dbService.getAllFollows(); // No store usage here
  }

  /**
   * Get local follows for a specific platform (all sources)
   */
  getLocalFollowsByPlatform(platform: Platform): LocalFollow[] {
    return dbService.getFollowsByPlatform(platform);
  }

  /**
   * Get the "active" follows for a platform — what the UI should surface.
   *
   * Semantics (post-2026-05-29 source-collapse):
   *   - No token (signed out / session expired) → return rows with
   *     `source = 'guest'` ONLY. Platform-tagged rows stay in the DB but are
   *     intentionally hidden until the user signs back in.
   *   - Token present -> return rows with `source = platform`. Platform-source
   *     rows are confirmed account follows from sync.
   *   - Token present but no platform-tagged rows -> return [] so guest/local
   *     follows do not appear as account follows.
   *
   * The token check is the source of truth for "is the user signed in?",
   * not DB presence — a session that died silently still leaves rows in the
   * DB but `hasToken` returns false, so we correctly hide them.
   */
  getActiveFollowsByPlatform(platform: Platform): LocalFollow[] {
    if (!this.hasToken(platform)) {
      return dbService.getFollowsByPlatformAndSource(platform, "guest");
    }
    if (platform === "kick" && !this.areKickAccountFollowsVerified()) {
      return [];
    }
    const platformFollows = dbService.getFollowsByPlatformAndSource(platform, platform);
    return platformFollows;
  }

  /**
   * Get only guest-source follows for a platform. Used by the
   * "no live token" branch in FOLLOWS_GET_ALL so a session that
   * died silently doesn't keep returning the now-revoked account's
   * synced follows.
   */
  getGuestFollowsByPlatform(platform: Platform): LocalFollow[] {
    return dbService.getFollowsByPlatformAndSource(platform, "guest");
  }

  invalidateKickAccountFollows(): void {
    dbService.set(KICK_ACCOUNT_FOLLOWS_VERIFIED_KEY, null);
  }

  areKickAccountFollowsVerified(): boolean {
    const identity = kickFollowVerificationIdentity(this.getKickUser());
    return (
      identity !== null &&
      dbService.get(KICK_ACCOUNT_FOLLOWS_VERIFIED_KEY, (value) =>
        typeof value === "string" ? value : null
      ) === identity
    );
  }

  /**
   * Add a local follow (guest source by default)
   */
  addLocalFollow(
    follow: Omit<LocalFollow, "id" | "followedAt">,
    source: FollowSource = "guest"
  ): LocalFollow {
    const newFollow = dbService.addFollow(follow, source);
    logger.debug("Service:Storage", "Added follow", {
      source,
      displayName: follow.displayName,
    });
    return newFollow;
  }

  /**
   * Remove a local follow
   */
  removeLocalFollow(id: string): boolean {
    const success = dbService.removeFollow(id);
    if (success) {
      logger.debug("Service:Storage", "Removed local follow", { id });
    }
    return success;
  }

  /**
   * Update a local follow
   */
  updateLocalFollow(id: string, updates: Partial<LocalFollow>): LocalFollow | null {
    const current = this.getLocalFollows().find((f) => f.id === id);
    if (!current) return null;

    const updated = { ...current, ...updates };
    return dbService.addFollow(updated, current.source ?? "guest");
  }

  /**
   * Check if following a channel (any source)
   */
  isFollowing(platform: Platform, channelId: string): boolean {
    return dbService.isFollowing(platform, channelId);
  }

  /**
   * Import follows (merge with existing)
   */
  importLocalFollows(follows: LocalFollow[]): number {
    let count = 0;
    for (const f of follows) {
      if (!this.isFollowing(f.platform, f.channelId)) {
        this.addLocalFollow(f);
        count++;
      }
    }
    logger.debug("Service:Storage", "Imported new follows", { count });
    return count;
  }

  /**
   * Clear platform-tagged follow rows for a platform. Dead since the
   * 2026-05-29 source-collapse — logout now relies on `hasToken`-based
   * hiding rather than DB deletion. Kept for explicit "wipe my synced
   * follows" affordances (none today). SQL updated to target the new
   * platform-named source value rather than the obsolete 'account'.
   */
  clearAccountFollows(platform: Platform): void {
    dbService.clearFollowsByPlatformAndSource(platform, platform);
    logger.debug("Service:Storage", "Platform follows cleared", { platform });
  }

  /**
   * Apply the platform's authoritative follow list. See
   * `database-service.ts#upsertSyncedFollows` for the full semantics.
   *
   * Returns the same counts the IPC payload needs:
   *   - `accountCount`: total platform-source rows after the sync
   *   - `pendingCount`: rows remaining in pending_follow_writes (drives U8 banner)
   *   - `addedCount`: new rows the sync introduced (drives the renderer's
   *     decision to refetch — metadata-only refreshes report 0)
   *   - `removedCount`: stale platform-source rows pruned because they were
   *     absent from the authoritative fetched list; 0 when pruning is disabled
   */
  upsertSyncedFollows(
    platform: Platform,
    follows: Array<Omit<LocalFollow, "id" | "followedAt">>,
    options?: { pruneAbsent?: boolean }
  ): { accountCount: number; pendingCount: number; addedCount: number; removedCount: number } {
    const result = dbService.upsertSyncedFollows(platform, follows, options);
    if (platform === "kick") {
      dbService.set(
        KICK_ACCOUNT_FOLLOWS_VERIFIED_KEY,
        kickFollowVerificationIdentity(this.getKickUser())
      );
    }
    logger.debug("Service:Storage", "Synced follows", {
      platform,
      accountCount: result.accountCount,
      addedCount: result.addedCount,
      pendingCount: result.pendingCount,
    });
    return result;
  }

  /**
   * Clear local follows for a specific platform (all sources)
   */
  clearLocalFollowsByPlatform(platform: Platform): void {
    dbService.clearFollowsByPlatform(platform);
    logger.debug("Service:Storage", "Local follows cleared for platform", { platform });
  }

  /**
   * Clear all local follows
   */
  clearLocalFollows(): void {
    dbService.clearFollows();
    logger.debug("Service:Storage", "All local follows cleared");
  }

  // ========== Pending Follow Writes (Push-Sync Reconciliation) ==========

  /**
   * Record that a follow/unfollow push to the platform has been attempted
   * but not yet confirmed. Reconciliation (background sync) reads this set
   * to distinguish pending pushes from completed external state changes.
   *
   * The caller is responsible for sanitizing `lastError` of any token-shaped
   * substrings before passing — this layer stores what it's given.
   */
  addPendingFollowWrite(input: {
    platform: Platform;
    channelId: string;
    slug: string;
    action: PendingFollowAction;
    now?: Date;
    lastError?: string | null;
  }): void {
    dbService.addPendingFollowWrite(input);
  }

  updatePendingFollowWriteState(input: {
    platform: Platform;
    channelId: string;
    slug: string;
    action: PendingFollowAction;
    status: PendingFollowWriteStatus;
    attemptedAt?: Date;
    nextAttemptAt?: Date;
    attemptCount?: number;
    lastError?: string | null;
  }): boolean {
    return dbService.updatePendingFollowWriteState(input);
  }

  /**
   * Remove a pending write by composite key. Matches via dual-id (channel_id
   * OR slug) so legacy rows with a stale user_id are still findable.
   */
  removePendingFollowWrite(input: {
    platform: Platform;
    channelId: string;
    slug: string;
    action: PendingFollowAction;
  }): boolean {
    return dbService.removePendingFollowWrite(input);
  }

  confirmKickUnfollow(input: { channelId: string; slug: string; localFollowId?: string }): boolean {
    return dbService.confirmKickUnfollow(input);
  }

  confirmKickFollow(
    follow: Omit<LocalFollow, "id" | "followedAt"> & { platform: "kick" }
  ): LocalFollow {
    const confirmed = dbService.confirmKickFollow(follow);
    dbService.set(
      KICK_ACCOUNT_FOLLOWS_VERIFIED_KEY,
      kickFollowVerificationIdentity(this.getKickUser())
    );
    return confirmed;
  }

  getAllPendingFollowWrites(): PendingFollowWrite[] {
    return dbService.getAllPendingFollowWrites();
  }

  getPendingFollowWritesByPlatform(platform: Platform): PendingFollowWrite[] {
    return dbService.getPendingFollowWritesByPlatform(platform);
  }

  /**
   * Get all preferences. Merges the stored value with `DEFAULT_USER_PREFERENCES`
   * so any preference field added in a later version (e.g. `predictions` in
   * the viewer-prediction widget release) hydrates with its default for users
   * whose persisted state predates the field. Shallow merge at the top level
   * is sufficient — every preference subkey is its own object with its own
   * defaults that the original creators of those subkeys are responsible for.
   */
  getPreferences(): UserPreferences {
    const stored = this.storeInstance.get("preferences");
    if (!stored) return defaults.preferences;
    return hydratePreferences(stored);
  }

  /**
   * Update preferences (partial update)
   */
  updatePreferences(updates: Partial<UserPreferences>): UserPreferences {
    const current = this.getPreferences();
    const normalizedUpdates = updates.captions
      ? { ...updates, captions: normalizeCaptionPreferences(updates.captions) }
      : updates;
    const updated = { ...current, ...normalizedUpdates };
    this.storeInstance.set("preferences", updated);
    return updated;
  }

  /**
   * Reset preferences to defaults
   */
  resetPreferences(): void {
    this.storeInstance.set("preferences", DEFAULT_USER_PREFERENCES);
  }

  // ========== Window State Management (Electron Store) ==========

  /**
   * Get window bounds
   */
  getWindowBounds(): StorageSchema["windowBounds"] {
    return this.storeInstance.get("windowBounds") || DEFAULT_WINDOW_BOUNDS;
  }

  /**
   * Save window bounds
   */
  saveWindowBounds(bounds: StorageSchema["windowBounds"]): void {
    this.storeInstance.set("windowBounds", bounds);
  }

  // ========== Kick API continuity (Electron Store) ==========

  getKickApiRateLimitState(): StorageSchema["kickApiRateLimit"] {
    return this.storeInstance.get("kickApiRateLimit");
  }

  saveKickApiRateLimitState(state: NonNullable<StorageSchema["kickApiRateLimit"]>): void {
    this.storeInstance.set("kickApiRateLimit", state);
  }

  clearKickApiRateLimitState(): void {
    this.storeInstance.delete("kickApiRateLimit");
  }

  getKickFollowedStreamsCache(): StorageSchema["kickFollowedStreamsCache"] {
    return this.storeInstance.get("kickFollowedStreamsCache");
  }

  saveKickFollowedStreamsCache(
    snapshot: NonNullable<StorageSchema["kickFollowedStreamsCache"]>
  ): void {
    this.storeInstance.set("kickFollowedStreamsCache", snapshot);
  }

  // ========== Downloads Queue (Electron Store) ==========

  getDownloadQueue(): DownloadQueueSnapshot {
    return this.storeInstance.get("downloadQueue") ?? { jobs: [] };
  }

  saveDownloadQueue(snapshot: DownloadQueueSnapshot): void {
    this.storeInstance.set("downloadQueue", snapshot);
  }

  // ========== Stream Recording Recovery Journal (Electron Store) ==========

  getStreamRecordingJournal(): unknown {
    return this.storeInstance.get("streamRecordingJournal");
  }

  saveStreamRecordingJournal(journal: StreamRecordingJournalV2): void {
    this.storeInstance.set("streamRecordingJournal", journal);
  }

  // ========== Generic Storage (Electron Store) ==========

  /**
   * Get a value from storage
   */
  get(key: string): unknown {
    return this.storeInstance.get(key);
  }

  /**
   * Set a value in storage
   */
  set(key: string, value: unknown): void {
    this.storeInstance.set(key, value);
  }

  /**
   * Delete a value from storage
   */
  delete(key: string): void {
    this.storeInstance.delete(key as keyof StorageSchema);
  }

  /**
   * Clear all storage
   */
  clearAll(): void {
    this.storeInstance.clear();
    // Also clear DB
    dbService.clearKeyValue(); // Though we aren't using this part anymore, good to be safe
    dbService.clearFollows();
    logger.debug("Service:Storage", "All storage cleared");
  }

  /**
   * Get storage file path (for debugging)
   */
  getStorePath(): string {
    return this.storeInstance.path;
  }
}

// ========== Export Singleton ==========

export const storageService = new StorageService();
