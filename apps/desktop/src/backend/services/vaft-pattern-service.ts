/**
 * VAFT Pattern Service
 *
 * Fetches and parses ad-blocking patterns from the TwitchAdSolutions repository.
 * Provides auto-updating functionality to keep ad detection current as Twitch changes.
 *
 * @see https://github.com/pixeltris/TwitchAdSolutions
 */

import {
  type AdPatternUpdate,
  DEFAULT_AD_SIGNIFIERS,
  DEFAULT_DATERANGE_PATTERNS,
  DEFAULT_STORED_PATTERNS,
  type PlayerType,
  type StoredAdPatterns,
} from "@shared/adblock-types";
import Store from "electron-store";

// ========== Constants ==========

const VAFT_SCRIPT_URL =
  "https://raw.githubusercontent.com/pixeltris/TwitchAdSolutions/master/vaft/vaft-ublock-origin.js";
const VAFT_BACKUP_URL =
  "https://raw.githubusercontent.com/pixeltris/TwitchAdSolutions/master/vaft/vaft.user.js";

/** Check for updates every 7 days */
const UPDATE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/** Minimum time between update checks (1 hour) */
const MIN_CHECK_INTERVAL_MS = 60 * 60 * 1000;

// ========== Storage Schema ==========

interface PatternStoreSchema {
  adPatterns: StoredAdPatterns;
}

// ========== Pattern Service ==========

class VaftPatternService {
  private store: Store<PatternStoreSchema> | null = null;
  private updateTimer: ReturnType<typeof setInterval> | null = null;
  private lastCheckTime: number = 0;
  private isInitialized: boolean = false;

  constructor() {
    // Lazy initialization - call initialize() after app setup
  }

  // ========== Initialization ==========

  /**
   * Initialize the pattern service
   * Checks for updates on startup and schedules periodic checks
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.debug("[VaftPatterns] Already initialized");
      return;
    }

    if (!this.store) {
      this.store = new Store<PatternStoreSchema>({
        name: "streamfusion-adblock-patterns",
        defaults: {
          adPatterns: DEFAULT_STORED_PATTERNS,
        },
      });
    }

    console.debug("[VaftPatterns] Initializing pattern service...");

    // Check if we need to update on startup
    const stored = this.getStoredPatterns();
    const lastChecked = new Date(stored.lastChecked).getTime();
    const timeSinceCheck = Date.now() - lastChecked;

    if (timeSinceCheck > UPDATE_INTERVAL_MS) {
      console.debug("[VaftPatterns] Patterns are stale, fetching updates...");
      await this.fetchAndUpdatePatterns();
    } else {
      console.debug(
        `[VaftPatterns] Patterns are fresh (checked ${Math.round(timeSinceCheck / 3600000)}h ago)`
      );
    }

    // Schedule periodic updates
    this.schedulePeriodicUpdates();
    this.isInitialized = true;
  }

  private get storeInstance(): Store<PatternStoreSchema> {
    if (!this.store) {
      throw new Error("VaftPatternService not initialized. Call initialize() first.");
    }
    return this.store;
  }

  /**
   * Schedule periodic pattern updates
   */
  private schedulePeriodicUpdates(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
    }

    // Check daily, but only update if > UPDATE_INTERVAL_MS has passed
    this.updateTimer = setInterval(
      async () => {
        const stored = this.getStoredPatterns();
        if (!stored.autoUpdateEnabled) {
          return;
        }

        const lastChecked = new Date(stored.lastChecked).getTime();
        if (Date.now() - lastChecked > UPDATE_INTERVAL_MS) {
          await this.fetchAndUpdatePatterns();
        }
      },
      24 * 60 * 60 * 1000
    ); // Check once per day
  }

  // ========== Pattern Fetching ==========

  /**
   * Fetch and update patterns from VAFT repository
   */
  async fetchAndUpdatePatterns(): Promise<AdPatternUpdate | null> {
    // Rate limit checks
    if (Date.now() - this.lastCheckTime < MIN_CHECK_INTERVAL_MS) {
      console.debug("[VaftPatterns] Skipping check (rate limited)");
      return this.getCurrentPatterns();
    }

    this.lastCheckTime = Date.now();

    try {
      console.debug("[VaftPatterns] Fetching patterns from VAFT repository...");

      // Try primary URL first, then backup
      let script = await this.fetchScript(VAFT_SCRIPT_URL);
      if (!script) {
        console.debug("[VaftPatterns] Primary URL failed, trying backup...");
        script = await this.fetchScript(VAFT_BACKUP_URL);
      }

      if (!script) {
        console.warn("[VaftPatterns] Failed to fetch VAFT script from all sources");
        return null;
      }

      // Parse the script for patterns
      const patterns = this.parseVaftScript(script);

      if (patterns) {
        // Store the updated patterns
        this.storeInstance.set("adPatterns", {
          patterns,
          lastChecked: new Date().toISOString(),
          autoUpdateEnabled: this.storeInstance.get("adPatterns").autoUpdateEnabled,
        });

        console.debug(`[VaftPatterns] Updated to version ${patterns.version}`);
        console.debug(`[VaftPatterns] DATERANGE patterns: ${patterns.dateRangePatterns.length}`);
        console.debug(
          `[VaftPatterns] Backup player types: ${patterns.backupPlayerTypes.join(", ")}`
        );

        return patterns;
      }
    } catch (error) {
      console.error("[VaftPatterns] Error fetching patterns:", error);
    }

    return null;
  }

  /**
   * Fetch script from URL
   */
  private async fetchScript(url: string): Promise<string | null> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "text/plain",
          "Cache-Control": "no-cache",
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        console.debug(`[VaftPatterns] HTTP ${response.status} from ${url}`);
        return null;
      }

      return await response.text();
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        console.debug(`[VaftPatterns] Timeout fetching ${url}`);
      } else {
        console.debug(`[VaftPatterns] Error fetching ${url}:`, error);
      }
      return null;
    }
  }

  /**
   * Parse VAFT script to extract patterns
   */
  private parseVaftScript(script: string): AdPatternUpdate | null {
    try {
      // Extract version
      const versionMatch = script.match(/ourTwitchAdSolutionsVersion\s*=\s*(\d+)/);
      const version = versionMatch ? parseInt(versionMatch[1], 10) : 0;

      // Extract ad signifier
      const signifierMatch = script.match(/AdSignifier\s*=\s*['"]([^'"]+)['"]/);
      const adSignifiers = signifierMatch
        ? [signifierMatch[1], ...DEFAULT_AD_SIGNIFIERS.filter((s) => s !== signifierMatch[1])]
        : [...DEFAULT_AD_SIGNIFIERS];

      // Extract backup player types
      const playerTypesMatch = script.match(/BackupPlayerTypes\s*=\s*\[([\s\S]*?)\]/);
      let backupPlayerTypes: PlayerType[] = [
        "embed",
        "popout",
        "autoplay",
        "picture-by-picture",
        "thunderdome",
      ];

      if (playerTypesMatch) {
        const typesStr = playerTypesMatch[1];
        const types = typesStr.match(/'([^']+)'/g);
        if (types && types.length > 0) {
          backupPlayerTypes = types
            .map((t) => t.replace(/'/g, "").replace("-CACHED", "") as PlayerType)
            .filter((t, i, arr) => arr.indexOf(t) === i); // Dedupe
        }
      }

      // Extract fallback player type
      const fallbackMatch = script.match(/FallbackPlayerType\s*=\s*['"]([^'"]+)['"]/);
      const fallbackPlayerType = (fallbackMatch?.[1] as PlayerType) || "embed";

      // Extract client ID
      const clientIdMatch = script.match(/ClientID\s*=\s*['"]([^'"]+)['"]/);
      const clientId = clientIdMatch?.[1] || "kimne78kx3ncx6brgo4mv6wki5h1ko";

      // Build comprehensive DATERANGE patterns
      // These are found throughout the script in various detection logic
      const dateRangePatterns = this.extractDateRangePatterns(script);

      return {
        version,
        adSignifiers,
        dateRangePatterns,
        backupPlayerTypes,
        fallbackPlayerType,
        clientId,
        lastUpdated: new Date().toISOString(),
        source: VAFT_SCRIPT_URL,
      };
    } catch (error) {
      console.error("[VaftPatterns] Error parsing VAFT script:", error);
      return null;
    }
  }

  /**
   * Extract DATERANGE patterns from script
   */
  private extractDateRangePatterns(script: string): string[] {
    const patterns = new Set<string>([...DEFAULT_DATERANGE_PATTERNS]);

    // Look for string literals that appear to be ad markers
    const stringMatches = script.matchAll(/['"]([^'"]*(?:ad|stitched|amazon)[^'"]*)['"]/gi);
    for (const match of stringMatches) {
      const pattern = match[1];
      // Filter to only relevant patterns (not URLs, not too long)
      if (
        pattern.length < 50 &&
        !pattern.includes("http") &&
        !pattern.includes("/") &&
        (pattern.includes("ad") || pattern.includes("stitch") || pattern.includes("amazon"))
      ) {
        // Normalize pattern
        const normalized = pattern.toLowerCase().trim();
        if (normalized.length > 2) {
          patterns.add(pattern);
        }
      }
    }

    // Specifically look for includes() checks for ad detection
    const includesMatches = script.matchAll(/\.includes\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
    for (const match of includesMatches) {
      const pattern = match[1];
      if (
        pattern.length < 50 &&
        (pattern.includes("ad") || pattern.includes("stitch") || pattern.includes("MIDROLL"))
      ) {
        patterns.add(pattern);
      }
    }

    return Array.from(patterns);
  }

  // ========== Public API ==========

  /**
   * Get stored patterns
   */
  getStoredPatterns(): StoredAdPatterns {
    return this.storeInstance.get("adPatterns") || DEFAULT_STORED_PATTERNS;
  }

  /**
   * Get current patterns
   */
  getCurrentPatterns(): AdPatternUpdate {
    return this.getStoredPatterns().patterns;
  }

  /**
   * Get DATERANGE patterns for ad detection
   */
  getDateRangePatterns(): string[] {
    return this.getCurrentPatterns().dateRangePatterns;
  }

  /**
   * Get ad signifiers
   */
  getAdSignifiers(): string[] {
    return this.getCurrentPatterns().adSignifiers;
  }

  /**
   * Get backup player types
   */
  getBackupPlayerTypes(): PlayerType[] {
    return this.getCurrentPatterns().backupPlayerTypes;
  }

  /**
   * Get pattern version
   */
  getVersion(): number {
    return this.getCurrentPatterns().version;
  }

  /**
   * Check if a string contains any ad DATERANGE pattern
   */
  hasAdDateRange(text: string): boolean {
    const patterns = this.getDateRangePatterns();
    return patterns.some((pattern) => text.includes(pattern));
  }

  /**
   * Check if text contains any ad signifier
   */
  hasAdSignifier(text: string): boolean {
    const signifiers = this.getAdSignifiers();
    return signifiers.some((signifier) => text.includes(signifier));
  }

  /**
   * Force refresh patterns
   */
  async forceRefresh(): Promise<AdPatternUpdate | null> {
    this.lastCheckTime = 0; // Reset rate limit
    return this.fetchAndUpdatePatterns();
  }

  /**
   * Set auto-update enabled
   */
  setAutoUpdateEnabled(enabled: boolean): void {
    const stored = this.getStoredPatterns();
    this.storeInstance.set("adPatterns", {
      ...stored,
      autoUpdateEnabled: enabled,
    });
  }

  /**
   * Get auto-update status
   */
  isAutoUpdateEnabled(): boolean {
    return this.getStoredPatterns().autoUpdateEnabled;
  }

  /**
   * Get last checked time
   */
  getLastChecked(): string {
    return this.getStoredPatterns().lastChecked;
  }

  /**
   * Get pattern statistics
   */
  getStats(): {
    version: number;
    dateRangePatternCount: number;
    signifierCount: number;
    backupPlayerTypeCount: number;
    lastChecked: string;
    autoUpdateEnabled: boolean;
  } {
    const stored = this.getStoredPatterns();
    const patterns = stored.patterns;
    return {
      version: patterns.version,
      dateRangePatternCount: patterns.dateRangePatterns.length,
      signifierCount: patterns.adSignifiers.length,
      backupPlayerTypeCount: patterns.backupPlayerTypes.length,
      lastChecked: stored.lastChecked,
      autoUpdateEnabled: stored.autoUpdateEnabled,
    };
  }

  /**
   * Cleanup on shutdown
   */
  destroy(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }
}

// ========== Export Singleton ==========

export const vaftPatternService = new VaftPatternService();
