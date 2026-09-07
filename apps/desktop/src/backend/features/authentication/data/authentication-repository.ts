import { selectActiveFollowCollection } from "@streamfusion/core/follows";
import { safeStorage } from "electron";

import {
  type AuthToken,
  type EncryptedToken,
  type KickUser,
  type LocalFollow,
  type TwitchUser,
} from "@shared/auth-types";
import { logger } from "@shared/utils/cross-logger";
import { type FollowSource } from "@streamfusion/core/follows";
import { Platform } from "@streamfusion/core/platform";

import { dbService } from "@backend/services/database-service";

import { storageService, type StorageService } from "@backend/services/storage-service";
import { followRepository } from "./follow-repository";
import type {
  PendingFollowAction,
  PendingFollowWrite,
  PendingFollowWriteStatus,
} from "@backend/features/authentication/capabilities/follow-persistence";
const KICK_ACCOUNT_FOLLOWS_VERIFIED_KEY = "kick-account-follows-verified-v3";

function kickFollowVerificationIdentity(user: KickUser | null): string | null {
  if (!user) return null;
  return `${user.id}:${(user.slug || user.username).toLowerCase()}`;
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

export class AuthenticationRepository {
  private tokenCache = new Map<Platform, AuthToken>();
  constructor(private readonly driver: StorageService = storageService) {}
  private get storeInstance() {
    return this.driver.getStore();
  }
  private get isEncryptionAvailable(): boolean {
    return this.driver.encryptionAvailable;
  }
  onTwitchCredentialsChanged(listener: () => void): () => void {
    const notify = () => queueMicrotask(listener);
    const stopToken = this.storeInstance.onDidChange("authTokens", notify);
    const stopUser = this.storeInstance.onDidChange("twitchUser", notify);
    return () => {
      stopToken();
      stopUser();
    };
  }

  // ========== Token Management (Electron Store) ==========

  /**
   * Encrypt a token string using Electron's safeStorage
   */
  private encryptToken(token: string): EncryptedToken {
    if (!this.isEncryptionAvailable) {
      throw new Error("Secure credential storage is unavailable. Credentials were not saved.");
    }

    try {
      const encrypted = safeStorage.encryptString(token);
      return { encrypted: encrypted.toString("base64"), encoding: "safeStorage" };
    } catch {
      throw new Error("Secure credential storage failed. Credentials were not saved.");
    }
  }

  private migrateLegacyCredential(persist: () => void): void {
    try {
      persist();
    } catch {
      logger.warn(
        "Service:Storage",
        "Secure credential upgrade failed; existing credential retained"
      );
    }
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
    this.storeInstance.set("authTokens", { ...tokens, [platform]: encrypted });
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
        this.migrateLegacyCredential(() => this.saveToken(platform, token));
      }
      this.tokenCache.set(platform, token);
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
        this.migrateLegacyCredential(() => this.saveTwitchFollowWriteToken(parsed));
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
        this.migrateLegacyCredential(() => this.saveKickWebBearer(decrypted.tokenString));
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
    return followRepository.getAllFollows(); // No store usage here
  }

  /**
   * Get local follows for a specific platform (all sources)
   */
  getLocalFollowsByPlatform(platform: Platform): LocalFollow[] {
    return followRepository.getFollowsByPlatform(platform);
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
    const selection = selectActiveFollowCollection({
      platform,
      authenticated: this.hasToken(platform),
      accountCollectionAvailable: platform !== "kick" || this.areKickAccountFollowsVerified(),
    });
    return selection.kind === "source"
      ? followRepository.getFollowsByPlatformAndSource(platform, selection.source)
      : [];
  }

  /**
   * Get only guest-source follows for a platform. Used by the
   * "no live token" branch in FOLLOWS_GET_ALL so a session that
   * died silently doesn't keep returning the now-revoked account's
   * synced follows.
   */
  getGuestFollowsByPlatform(platform: Platform): LocalFollow[] {
    return followRepository.getFollowsByPlatformAndSource(platform, "guest");
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
    const newFollow = followRepository.addFollow(follow, source);
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
    const success = followRepository.removeFollow(id);
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
    return followRepository.addFollow(updated, current.source ?? "guest");
  }

  /**
   * Check if following a channel (any source)
   */
  isFollowing(platform: Platform, channelId: string): boolean {
    return followRepository.isFollowing(platform, channelId);
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
    followRepository.clearFollowsByPlatformAndSource(platform, platform);
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
    const result = followRepository.upsertSyncedFollows(platform, follows, options);
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
    followRepository.clearFollowsByPlatform(platform);
    logger.debug("Service:Storage", "Local follows cleared for platform", { platform });
  }

  /**
   * Clear all local follows
   */
  clearLocalFollows(): void {
    followRepository.clearFollows();
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
    followRepository.addPendingFollowWrite(input);
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
    return followRepository.updatePendingFollowWriteState(input);
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
    return followRepository.removePendingFollowWrite(input);
  }

  confirmKickUnfollow(input: { channelId: string; slug: string; localFollowId?: string }): boolean {
    return followRepository.confirmKickUnfollow(input);
  }

  confirmKickFollow(
    follow: Omit<LocalFollow, "id" | "followedAt"> & { platform: "kick" }
  ): LocalFollow {
    const confirmed = followRepository.confirmKickFollow(follow);
    dbService.set(
      KICK_ACCOUNT_FOLLOWS_VERIFIED_KEY,
      kickFollowVerificationIdentity(this.getKickUser())
    );
    return confirmed;
  }

  getAllPendingFollowWrites(): PendingFollowWrite[] {
    return followRepository.getAllPendingFollowWrites();
  }

  getPendingFollowWritesByPlatform(platform: Platform): PendingFollowWrite[] {
    return followRepository.getPendingFollowWritesByPlatform(platform);
  }
}

export const authenticationRepository = new AuthenticationRepository();
