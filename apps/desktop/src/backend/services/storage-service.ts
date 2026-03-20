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

import {
  type AuthToken,
  DEFAULT_USER_PREFERENCES,
  DEFAULT_WINDOW_BOUNDS,
  type EncryptedToken,
  type KickUser,
  type LocalFollow,
  type Platform,
  type StorageSchema,
  type TwitchUser,
  type UserPreferences,
} from "../../shared/auth-types";

import { dbService } from "./database-service";

// ========== Default Values ==========

const defaults: StorageSchema = {
  authTokens: {},
  appTokens: {},
  twitchUser: null,
  kickUser: null,
  localFollows: [],
  preferences: DEFAULT_USER_PREFERENCES,
  lastActiveTab: "home",
  windowBounds: DEFAULT_WINDOW_BOUNDS,
};

// ========== Storage Service Class ==========

class StorageService {
  private store: Store<StorageSchema> | null = null;
  private isEncryptionAvailable = false;

  constructor() {
    // Lazy initialization - call initialize() after app setup
  }

  initialize() {
    if (this.store) return; // Already initialized

    this.store = new Store<StorageSchema>({
      name: "streamfusion-storage",
      defaults,
    });

    // Check if safeStorage encryption is available
    this.isEncryptionAvailable = safeStorage.isEncryptionAvailable();
    console.debug(
      `🔐 Storage service initialized. Encryption available: ${this.isEncryptionAvailable}`
    );
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
      console.warn("⚠️ safeStorage not available, using base64 fallback");
      return { encrypted: Buffer.from(token).toString("base64") };
    }

    const encrypted = safeStorage.encryptString(token);
    return { encrypted: encrypted.toString("base64") };
  }

  /**
   * Decrypt an encrypted token
   */
  private decryptToken(encryptedToken: EncryptedToken): string {
    const buffer = Buffer.from(encryptedToken.encrypted, "base64");

    if (!this.isEncryptionAvailable) {
      // Fallback: Decode from base64
      return buffer.toString("utf8");
    }

    return safeStorage.decryptString(buffer);
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

    console.debug(`✅ Token saved for ${platform}`);
  }

  /**
   * Get an auth token for a platform
   */
  getToken(platform: Platform): AuthToken | null {
    const tokens = this.storeInstance.get("authTokens") || {};
    const encrypted = tokens[platform];

    if (!encrypted) {
      return null;
    }

    try {
      const tokenString = this.decryptToken(encrypted);
      return JSON.parse(tokenString) as AuthToken;
    } catch (error) {
      console.error(`Failed to decrypt token for ${platform}:`, error);
      return null;
    }
  }

  /**
   * Check if a token exists for a platform
   */
  hasToken(platform: Platform): boolean {
    const tokens = this.storeInstance.get("authTokens") || {};
    return !!tokens[platform];
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
    console.debug(`🗑️ Token cleared for ${platform}`);
  }

  /**
   * Clear all tokens
   */
  clearAllTokens(): void {
    this.storeInstance.set("authTokens", {});
    this.storeInstance.set("appTokens", {});
    console.debug("🗑️ All tokens cleared");
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

    console.debug(`✅ App Token saved for ${platform}`);
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
      const tokenString = this.decryptToken(encrypted);
      return JSON.parse(tokenString) as AuthToken;
    } catch (error) {
      console.error(`Failed to decrypt app token for ${platform}:`, error);
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
   * Get the "active" follows for a platform.
   * If the user has logged in and account follows exist, return those.
   * Otherwise, return guest follows.
   */
  getActiveFollowsByPlatform(platform: Platform): LocalFollow[] {
    if (dbService.hasAccountFollows(platform)) {
      return dbService.getFollowsByPlatformAndSource(platform, "account");
    }
    return dbService.getFollowsByPlatformAndSource(platform, "guest");
  }

  /**
   * Add a local follow (guest source by default)
   */
  addLocalFollow(
    follow: Omit<LocalFollow, "id" | "followedAt">,
    source: "guest" | "account" = "guest"
  ): LocalFollow {
    const newFollow = dbService.addFollow(follow, source);
    console.debug(`➕ Added ${source} follow: ${follow.displayName}`);
    return newFollow;
  }

  /**
   * Remove a local follow
   */
  removeLocalFollow(id: string): boolean {
    const success = dbService.removeFollow(id);
    if (success) {
      console.debug(`➖ Removed local follow: ${id}`);
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
    return dbService.addFollow(updated);
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
    console.debug(`📥 Imported ${count} new follows`);
    return count;
  }

  /**
   * Clear account follows for a platform (on logout → guest follows become active)
   */
  clearAccountFollows(platform: Platform): void {
    dbService.clearFollowsByPlatformAndSource(platform, "account");
    console.debug(`🗑️ Account follows cleared for ${platform}`);
  }

  /**
   * Clear local follows for a specific platform (all sources)
   */
  clearLocalFollowsByPlatform(platform: Platform): void {
    dbService.clearFollowsByPlatform(platform);
    console.debug(`🗑️ Local follows cleared for ${platform}`);
  }

  /**
   * Clear all local follows
   */
  clearLocalFollows(): void {
    dbService.clearFollows();
    console.debug("🗑️ All local follows cleared");
  }

  /**
   * Get all preferences
   */
  getPreferences(): UserPreferences {
    return this.storeInstance.get("preferences") || defaults.preferences;
  }

  /**
   * Update preferences (partial update)
   */
  updatePreferences(updates: Partial<UserPreferences>): UserPreferences {
    const current = this.getPreferences();
    const updated = { ...current, ...updates };
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

  // ========== Generic Storage (Electron Store) ==========

  /**
   * Get a value from storage
   */
  get<K extends keyof StorageSchema>(key: K): StorageSchema[K] {
    return this.storeInstance.get(key);
  }

  /**
   * Set a value in storage
   */
  set<K extends keyof StorageSchema>(key: K, value: StorageSchema[K]): void {
    this.storeInstance.set(key, value);
  }

  /**
   * Delete a value from storage
   */
  delete<K extends keyof StorageSchema>(key: K): void {
    this.storeInstance.delete(key);
  }

  /**
   * Clear all storage
   */
  clearAll(): void {
    this.storeInstance.clear();
    // Also clear DB
    dbService.clearKeyValue(); // Though we aren't using this part anymore, good to be safe
    dbService.clearFollows();
    console.debug("🗑️ All storage cleared");
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
