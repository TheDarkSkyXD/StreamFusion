/**
 * Emote Manager
 *
 * Central manager for all emote providers. Handles loading, caching,
 * and lookup of emotes from Twitch, Kick, BTTV, FFZ, and 7TV.
 */

import type { Platform } from "@/shared/auth-types";
import { EventEmitter } from "../../../shared/browser-event-emitter";
import type { Emote, EmoteManagerConfig, EmoteProvider, EmoteProviderService } from "./emote-types";
import { DEFAULT_EMOTE_CONFIG } from "./emote-types";

/** Cache entry for emote data */
interface EmoteCacheEntry {
  emotes: Emote[];
  fetchedAt: number;
  channelId?: string;
}

/** Memory management constants */
const MAX_CACHED_CHANNELS = 5; // LRU limit for channel emotes
const CACHE_CLEANUP_INTERVAL = 5 * 60 * 1000; // Cleanup every 5 minutes

/**
 * Which providers are relevant per platform.
 * - Twitch streams use Twitch first-party plus BTTV/FFZ/7TV third-party overlays.
 * - Kick streams use Kick first-party plus 7TV (the only third-party that supports Kick).
 *
 * Used by both global and channel emote loaders so we don't fire pointless
 * cross-platform fetches (e.g. Kick's no-op global loader on a Twitch stream).
 */
const PLATFORM_PROVIDERS: { [K in Platform]: readonly [K, ...EmoteProvider[]] } = {
  twitch: ["twitch", "bttv", "ffz", "7tv"],
  kick: ["kick", "7tv"],
};

/** Emote manager events */
export interface EmoteManagerEvents {
  emotesFetched: (provider: EmoteProvider, isGlobal: boolean, channelId?: string) => void;
  error: (error: Error, provider: EmoteProvider) => void;
}

class EmoteManager extends EventEmitter {
  private providers: Map<EmoteProvider, EmoteProviderService> = new Map();
  private globalEmotes: Map<EmoteProvider, Emote[]> = new Map();
  private channelEmotes: Map<string, Map<EmoteProvider, Emote[]>> = new Map();
  private emoteCache: Map<string, EmoteCacheEntry> = new Map();
  private config: EmoteManagerConfig;

  /** Track channel access order for LRU eviction */
  private channelAccessOrder: string[] = [];
  /** Cleanup interval timer */
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;
  /**
   * Single-flight dedup for per-provider channel fetches. When two consumers
   * (e.g. two multistream tiles on the same channel) load simultaneously, the
   * second sees the in-flight promise and awaits it instead of firing a
   * parallel provider fetch. Keyed by `channel:${provider}:${channelId}`.
   */
  private channelEmoteInFlight: Map<string, Promise<Emote[]>> = new Map();

  constructor(config: Partial<EmoteManagerConfig> = {}) {
    super();
    this.config = { ...DEFAULT_EMOTE_CONFIG, ...config };

    // Start periodic cleanup if in browser
    if (typeof window !== "undefined") {
      this.startCleanupTimer();
      // Stop the timer on page unload so it doesn't keep running in a
      // detached context after a renderer reload.
      window.addEventListener("beforeunload", () => this.stopCleanupTimer());
    }
  }

  /**
   * Start periodic cache cleanup timer
   */
  private startCleanupTimer(): void {
    if (this.cleanupTimer) return;

    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredCache();
    }, CACHE_CLEANUP_INTERVAL);

    console.debug("[EmoteManager] Started cleanup timer");
  }

  /**
   * Stop the cleanup timer (call on app shutdown)
   */
  stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
      console.debug("[EmoteManager] Stopped cleanup timer");
    }
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupExpiredCache(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, entry] of this.emoteCache) {
      if (now - entry.fetchedAt > this.config.cacheTTL) {
        this.emoteCache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      console.debug(`[EmoteManager] Cleaned ${cleanedCount} expired cache entries`);
    }
  }

  /**
   * Register an emote provider
   */
  registerProvider(provider: EmoteProviderService): void {
    this.providers.set(provider.name, provider);
  }

  /**
   * Load global emotes from registered providers.
   *
   * When `platform` is provided, only loads from providers that serve that
   * platform (see PLATFORM_PROVIDERS). This avoids no-op fetches like Kick's
   * "no global endpoint" loader firing on Twitch streams.
   *
   * When omitted, falls back to loading all enabled providers (legacy behavior).
   */
  async loadGlobalEmotes(platform?: Platform): Promise<void> {
    const allowed = platform ? PLATFORM_PROVIDERS[platform] : null;
    const enabledProviders = Array.from(this.providers.entries())
      .filter(([name]) => this.config.enabledProviders.includes(name))
      .filter(([name]) => !allowed || allowed.includes(name));

    const results = await Promise.allSettled(
      enabledProviders.map(async ([name, provider]) => {
        try {
          const emotes = await provider.fetchGlobalEmotes();
          this.globalEmotes.set(name, emotes);
          this.cacheEmotes(`global:${name}`, emotes);
          this.emit("emotesFetched", name, true);
          return { provider: name, emotes };
        } catch (error) {
          this.emit("error", error as Error, name);
          throw error;
        }
      })
    );

    // Log results
    results.forEach((result, index) => {
      const providerName = enabledProviders[index][0];
      if (result.status === "fulfilled") {
        console.log(
          `[EmoteManager] Loaded ${result.value.emotes.length} global emotes from ${providerName}`
        );
      } else {
        console.error(
          `[EmoteManager] Failed to load global emotes from ${providerName}:`,
          result.reason
        );
      }
    });
  }

  /**
   * Load channel-specific emotes from all registered providers
   * @param channelId - Channel ID (Twitch user ID or Kick chatroom ID)
   * @param channelName - Channel name/slug
   * @param platform - Platform identifier (used to filter third-party providers)
   */
  async loadChannelEmotes(
    channelId: string,
    channelName?: string,
    platform: Platform = "twitch"
  ): Promise<void> {
    // Track channel access for LRU eviction
    this.trackChannelAccess(channelId);

    // Enforce LRU limit before adding new channel
    this.enforceCacheLimits();

    // Initialize channel map if needed
    if (!this.channelEmotes.has(channelId)) {
      this.channelEmotes.set(channelId, new Map());
    }

    const channelMap = this.channelEmotes.get(channelId)!;

    // Filter providers based on platform to avoid unnecessary API calls.
    const enabledProviders = Array.from(this.providers.entries())
      .filter(([name]) => this.config.enabledProviders.includes(name))
      .filter(([name]) => PLATFORM_PROVIDERS[platform].includes(name));

    const results = await Promise.allSettled(
      enabledProviders.map(async ([name, provider]) => {
        try {
          const cacheKey = `channel:${name}:${channelId}`;
          const cached = this.getCachedEmotes(cacheKey);

          if (cached) {
            channelMap.set(name, cached);
            return { provider: name, emotes: cached, fromCache: true };
          }

          // Single-flight: dedupe concurrent fetches for the same cacheKey.
          let pending = this.channelEmoteInFlight.get(cacheKey);
          if (!pending) {
            pending = (async () => {
              const emotes = await provider.fetchChannelEmotes(channelId, channelName, platform);
              this.cacheEmotes(cacheKey, emotes, channelId);
              this.emit("emotesFetched", name, false, channelId);
              return emotes;
            })();
            this.channelEmoteInFlight.set(cacheKey, pending);
            // Always clear in-flight slot — success or failure — so a transient
            // error doesn't poison subsequent attempts.
            pending.finally(() => {
              if (this.channelEmoteInFlight.get(cacheKey) === pending) {
                this.channelEmoteInFlight.delete(cacheKey);
              }
            });
          }

          const emotes = await pending;
          channelMap.set(name, emotes);
          return { provider: name, emotes, fromCache: false };
        } catch (error) {
          // Channel emotes failing is not critical - just log it
          console.warn(
            `[EmoteManager] Failed to load channel emotes from ${name} for ${channelId}:`,
            error
          );
          return { provider: name, emotes: [], fromCache: false };
        }
      })
    );

    // Log results
    results.forEach((result, index) => {
      const providerName = enabledProviders[index][0];
      if (result.status === "fulfilled" && result.value.emotes.length > 0) {
        const cacheStatus = result.value.fromCache ? "(cached)" : "";
        console.log(
          `[EmoteManager] Loaded ${result.value.emotes.length} channel emotes from ${providerName} for ${channelId} ${cacheStatus}`
        );
      }
    });
  }

  /**
   * Track channel access for LRU ordering
   */
  private trackChannelAccess(channelId: string): void {
    // Remove from current position (if exists)
    const index = this.channelAccessOrder.indexOf(channelId);
    if (index > -1) {
      this.channelAccessOrder.splice(index, 1);
    }
    // Add to end (most recently accessed)
    this.channelAccessOrder.push(channelId);
  }

  /**
   * Enforce LRU cache limits - evict oldest channels when over limit
   */
  private enforceCacheLimits(): void {
    while (this.channelAccessOrder.length > MAX_CACHED_CHANNELS) {
      const oldestChannelId = this.channelAccessOrder.shift();
      if (oldestChannelId) {
        console.debug(
          `[EmoteManager] LRU eviction: clearing emotes for channel ${oldestChannelId}`
        );
        this.clearChannelEmotes(oldestChannelId);
      }
    }
  }

  /**
   * Clear channel emotes (when leaving a channel)
   */
  clearChannelEmotes(channelId: string): void {
    this.channelEmotes.delete(channelId);

    // Remove from access order
    const index = this.channelAccessOrder.indexOf(channelId);
    if (index > -1) {
      this.channelAccessOrder.splice(index, 1);
    }

    // Clear cache entries for this channel
    for (const [key] of this.emoteCache) {
      if (key.includes(`:${channelId}`)) {
        this.emoteCache.delete(key);
      }
    }
  }

  /**
   * Get an emote by name (searches global and channel emotes)
   */
  getEmote(name: string, channelId?: string): Emote | undefined {
    // First check channel emotes (higher priority)
    if (channelId) {
      const channelMap = this.channelEmotes.get(channelId);
      if (channelMap) {
        for (const emotes of channelMap.values()) {
          const emote = emotes.find((e) => e.name === name);
          if (emote) return emote;
        }
      }
    }

    // Then check global emotes
    for (const emotes of this.globalEmotes.values()) {
      const emote = emotes.find((e) => e.name === name);
      if (emote) return emote;
    }

    return undefined;
  }

  /**
   * Get all emotes for a channel (global + channel-specific)
   */
  getAllEmotes(channelId?: string): Emote[] {
    const allEmotes: Emote[] = [];

    // Add global emotes
    for (const emotes of this.globalEmotes.values()) {
      allEmotes.push(...emotes);
    }

    // Add channel emotes
    if (channelId) {
      const channelMap = this.channelEmotes.get(channelId);
      if (channelMap) {
        for (const emotes of channelMap.values()) {
          allEmotes.push(...emotes);
        }
      }
    }

    return allEmotes;
  }

  /**
   * Get emotes grouped by provider
   */
  getEmotesByProvider(channelId?: string): Map<EmoteProvider, Emote[]> {
    const result = new Map<EmoteProvider, Emote[]>();

    // Add global emotes per provider
    for (const [provider, emotes] of this.globalEmotes) {
      result.set(provider, [...emotes]);
    }

    // Merge channel emotes per provider
    if (channelId) {
      const channelMap = this.channelEmotes.get(channelId);
      if (channelMap) {
        for (const [provider, emotes] of channelMap) {
          const existing = result.get(provider) || [];
          result.set(provider, [...existing, ...emotes]);
        }
      }
    }

    return result;
  }

  /**
   * Search emotes by partial name match
   */
  searchEmotes(query: string, channelId?: string, limit = 20): Emote[] {
    const lowerQuery = query.toLowerCase();
    const allEmotes = this.getAllEmotes(channelId);

    // Sort by match quality:
    // 1. Exact match
    // 2. Starts with query
    // 3. Contains query
    const scored = allEmotes
      .filter((e) => e.name.toLowerCase().includes(lowerQuery))
      .map((e) => {
        const lowerName = e.name.toLowerCase();
        let score = 0;
        if (lowerName === lowerQuery) score = 100;
        else if (lowerName.startsWith(lowerQuery)) score = 50;
        else score = 10;
        return { emote: e, score };
      })
      .sort((a, b) => b.score - a.score || a.emote.name.localeCompare(b.emote.name));

    return scored.slice(0, limit).map((s) => s.emote);
  }

  /**
   * Parse text and replace emote codes with emote data
   */
  parseEmotes(
    text: string,
    channelId?: string
  ): Array<{ type: "text" | "emote"; content: string | Emote }> {
    const words = text.split(/(\s+)/);
    const result: Array<{ type: "text" | "emote"; content: string | Emote }> = [];

    for (const word of words) {
      const emote = this.getEmote(word.trim(), channelId);
      if (emote) {
        result.push({ type: "emote", content: emote });
      } else {
        result.push({ type: "text", content: word });
      }
    }

    return result;
  }

  /**
   * Get emote URL for a specific size
   */
  getEmoteUrl(emote: Emote, size: "1x" | "2x" | "4x" = "2x"): string {
    switch (size) {
      case "1x":
        return emote.urls.url1x;
      case "2x":
        return emote.urls.url2x;
      case "4x":
        return emote.urls.url4x || emote.urls.url2x;
      default:
        return emote.urls.url2x;
    }
  }

  /**
   * Check if provider is enabled
   */
  isProviderEnabled(provider: EmoteProvider): boolean {
    return this.config.enabledProviders.includes(provider);
  }

  /**
   * Enable/disable a provider
   */
  setProviderEnabled(provider: EmoteProvider, enabled: boolean): void {
    if (enabled && !this.config.enabledProviders.includes(provider)) {
      this.config.enabledProviders.push(provider);
    } else if (!enabled) {
      this.config.enabledProviders = this.config.enabledProviders.filter((p) => p !== provider);
    }
  }

  /**
   * Get stats about loaded emotes
   */
  getStats(): { global: Record<string, number>; channels: Record<string, Record<string, number>> } {
    const stats: {
      global: Record<string, number>;
      channels: Record<string, Record<string, number>>;
    } = {
      global: {},
      channels: {},
    };

    for (const [provider, emotes] of this.globalEmotes) {
      stats.global[provider] = emotes.length;
    }

    for (const [channelId, channelMap] of this.channelEmotes) {
      stats.channels[channelId] = {};
      for (const [provider, emotes] of channelMap) {
        stats.channels[channelId][provider] = emotes.length;
      }
    }

    return stats;
  }

  /**
   * Get estimated memory usage in bytes
   */
  getMemoryUsage(): { totalEmotes: number; channelCount: number; estimatedBytes: number } {
    let totalEmotes = 0;

    // Count global emotes
    for (const emotes of this.globalEmotes.values()) {
      totalEmotes += emotes.length;
    }

    // Count channel emotes
    for (const channelMap of this.channelEmotes.values()) {
      for (const emotes of channelMap.values()) {
        totalEmotes += emotes.length;
      }
    }

    // Rough estimate: ~500 bytes per emote object
    const estimatedBytes = totalEmotes * 500;

    return {
      totalEmotes,
      channelCount: this.channelEmotes.size,
      estimatedBytes,
    };
  }

  /**
   * Clear all cached data (emergency cleanup)
   */
  clearAll(): void {
    this.globalEmotes.clear();
    this.channelEmotes.clear();
    this.emoteCache.clear();
    this.channelAccessOrder = [];
    console.debug("[EmoteManager] Cleared all emote data");
  }

  // ========== Private Methods ==========

  private cacheEmotes(key: string, emotes: Emote[], channelId?: string): void {
    this.emoteCache.set(key, {
      emotes,
      fetchedAt: Date.now(),
      channelId,
    });
  }

  private getCachedEmotes(key: string): Emote[] | null {
    const entry = this.emoteCache.get(key);
    if (!entry) return null;

    // Check if cache is expired
    if (Date.now() - entry.fetchedAt > this.config.cacheTTL) {
      this.emoteCache.delete(key);
      return null;
    }

    return entry.emotes;
  }
}

// Export singleton instance
export const emoteManager = new EmoteManager();

// Also export class for testing
export { EmoteManager };
