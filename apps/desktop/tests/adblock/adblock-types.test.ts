/**
 * Tests for Twitch Ad-Block Types
 *
 * Tests the type definitions and helper functions in adblock-types.ts
 *
 * DEFAULT_ADBLOCK_CONFIG pins Twitch's embed-player client ID and the backup
 * player-type list. These look like config but are load-bearing: drift here
 * silently breaks the VAFT ad-block technique even though the change in diff
 * looks benign. Test asserts each field by exact value on purpose.
 */

// Guards: DEFAULT_ADBLOCK_CONFIG pins Twitch's embed-player client ID + backup player types — drift here breaks VAFT (changes look benign in diff but kill ad-blocking).

import { describe, it, expect } from "vitest";
import { DEFAULT_ADBLOCK_CONFIG } from "@/shared/adblock-types";

// Guards: aligned ad recovery stays reload-free by default to avoid a black frame or playback interruption.
describe("adblock-types", () => {
  describe("DEFAULT_ADBLOCK_CONFIG", () => {
    it("should have ad-blocking enabled by default", () => {
      expect(DEFAULT_ADBLOCK_CONFIG.enabled).toBe(true);
    });

    it("should have correct ad signifier", () => {
      expect(DEFAULT_ADBLOCK_CONFIG.adSignifier).toBe("stitched");
    });

    it("should have valid Twitch client ID", () => {
      expect(DEFAULT_ADBLOCK_CONFIG.clientId).toBe("kimne78kx3ncx6brgo4mv6wki5h1ko");
    });

    it("should have backup player types defined", () => {
      expect(DEFAULT_ADBLOCK_CONFIG.backupPlayerTypes).toBeInstanceOf(Array);
      expect(DEFAULT_ADBLOCK_CONFIG.backupPlayerTypes.length).toBeGreaterThan(0);
      expect(DEFAULT_ADBLOCK_CONFIG.backupPlayerTypes).toContain("embed");
      expect(DEFAULT_ADBLOCK_CONFIG.backupPlayerTypes).toContain("popout");
    });

    it("should have fallback player type set", () => {
      expect(DEFAULT_ADBLOCK_CONFIG.fallbackPlayerType).toBe("embed");
    });

    it("should have ad stripping enabled", () => {
      expect(DEFAULT_ADBLOCK_CONFIG.isAdStrippingEnabled).toBe(true);
    });

    it("should keep player reload after ad disabled", () => {
      expect(DEFAULT_ADBLOCK_CONFIG.reloadPlayerAfterAd).toBe(false);
    });

    it("should have reasonable minimal requests time", () => {
      expect(DEFAULT_ADBLOCK_CONFIG.playerReloadMinimalRequestsTime).toBeGreaterThan(0);
      expect(DEFAULT_ADBLOCK_CONFIG.playerReloadMinimalRequestsTime).toBeLessThan(10000);
    });
  });
});
