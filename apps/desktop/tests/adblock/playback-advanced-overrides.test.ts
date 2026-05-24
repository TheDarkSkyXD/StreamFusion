/**
 * Tests for the advanced stream-token overrides (plan U13).
 *
 * Guards three contracts:
 *  1. The prefs → AdBlockConfig resolver maps each control to its REAL,
 *     behavior-active field, and behavior-neutral defaults produce NO override.
 *  2. Applying a resolved override via `updateAdBlockConfig` lands the mapped
 *     field on the live config (player-type, codec).
 *  3. "Randomize device-id" clears + regenerates the localStorage value.
 *
 * Overrides are scoped to the ad-block path ONLY — the resolver path
 * (twitch-gql-client.ts) keeps its own Client-Id/playerType and is never
 * touched here. That separation is enforced by construction (this module only
 * imports the ad-block service), so there's nothing to assert against it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_ADBLOCK_CONFIG, type PlayerType } from "@/shared/adblock-types";
import { DEFAULT_PLAYBACK_ADVANCED_PREFERENCES } from "@/shared/auth-types";
import { resolvePlaybackAdvancedAdBlockOverrides } from "@/components/player/twitch/playback-advanced-config";

// Mock fetch so importing the service doesn't pull in real network calls.
global.fetch = vi.fn();

import {
  getAdBlockConfig,
  initAdBlockService,
  updateAdBlockConfig,
} from "@/components/player/twitch/twitch-adblock-service";
import {
  ADBLOCK_DEVICE_ID_STORAGE_KEY,
  generateAdBlockDeviceId,
  getAdBlockDeviceId,
  randomizeAdBlockDeviceId,
} from "@/components/player/twitch/twitch-adblock-device-id";

describe("resolvePlaybackAdvancedAdBlockOverrides (U13)", () => {
  it("returns no override for the behavior-neutral defaults", () => {
    // Untouched install: playerType "default" + allowHevc false → {} so applying
    // it unconditionally can't change shipped behavior (R25).
    expect(resolvePlaybackAdvancedAdBlockOverrides(DEFAULT_PLAYBACK_ADVANCED_PREFERENCES)).toEqual(
      {}
    );
    expect(resolvePlaybackAdvancedAdBlockOverrides(undefined)).toEqual({});
  });

  it("maps allowHevc → skipPlayerReloadOnHevc", () => {
    const overrides = resolvePlaybackAdvancedAdBlockOverrides({
      playerType: "default",
      allowHevc: true,
    });
    expect(overrides).toEqual({ skipPlayerReloadOnHevc: true });
  });

  it("maps a player type to fallbackPlayerType + the front of backupPlayerTypes", () => {
    const current: PlayerType[] = ["embed", "popout", "autoplay"];
    const overrides = resolvePlaybackAdvancedAdBlockOverrides(
      { playerType: "autoplay", allowHevc: false },
      current
    );
    expect(overrides.fallbackPlayerType).toBe("autoplay");
    // Chosen type is tried first, the rest preserved (deduped).
    expect(overrides.backupPlayerTypes).toEqual(["autoplay", "embed", "popout"]);
    // Codec untouched when allowHevc is false.
    expect(overrides).not.toHaveProperty("skipPlayerReloadOnHevc");
  });

  it("combines both controls when both are set", () => {
    const overrides = resolvePlaybackAdvancedAdBlockOverrides(
      { playerType: "embed", allowHevc: true },
      ["popout", "embed"]
    );
    expect(overrides).toEqual({
      skipPlayerReloadOnHevc: true,
      fallbackPlayerType: "embed",
      backupPlayerTypes: ["embed", "popout"],
    });
  });

  it("ignores an unrecognized player type (treats it like 'default')", () => {
    const overrides = resolvePlaybackAdvancedAdBlockOverrides(
      // @ts-expect-error — exercising a legacy/garbage persisted value at runtime.
      { playerType: "bogus", allowHevc: false },
      ["embed"]
    );
    expect(overrides).toEqual({});
  });
});

describe("applying overrides via updateAdBlockConfig (U13)", () => {
  beforeEach(() => {
    // Reset the service to a known baseline before each assertion.
    initAdBlockService({ ...DEFAULT_ADBLOCK_CONFIG });
  });

  it("lands the mapped player-type + codec fields on the live config", () => {
    const overrides = resolvePlaybackAdvancedAdBlockOverrides(
      { playerType: "autoplay", allowHevc: true },
      getAdBlockConfig().backupPlayerTypes
    );
    updateAdBlockConfig(overrides);

    const config = getAdBlockConfig();
    expect(config.fallbackPlayerType).toBe("autoplay");
    expect(config.backupPlayerTypes[0]).toBe("autoplay");
    expect(config.skipPlayerReloadOnHevc).toBe(true);
  });

  it("defaults produce a no-op: the live config still matches DEFAULT_ADBLOCK_CONFIG", () => {
    const overrides = resolvePlaybackAdvancedAdBlockOverrides(
      DEFAULT_PLAYBACK_ADVANCED_PREFERENCES,
      getAdBlockConfig().backupPlayerTypes
    );
    // The player only calls updateAdBlockConfig when overrides are non-empty.
    expect(Object.keys(overrides)).toHaveLength(0);

    const config = getAdBlockConfig();
    expect(config.fallbackPlayerType).toBe(DEFAULT_ADBLOCK_CONFIG.fallbackPlayerType);
    expect(config.backupPlayerTypes).toEqual(DEFAULT_ADBLOCK_CONFIG.backupPlayerTypes);
    expect(config.skipPlayerReloadOnHevc).toBe(DEFAULT_ADBLOCK_CONFIG.skipPlayerReloadOnHevc);
  });
});

describe("randomizeAdBlockDeviceId (U13)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("generates a 32-char lowercase-alphanumeric id", () => {
    const id = generateAdBlockDeviceId();
    expect(id).toMatch(/^[a-z0-9]{32}$/);
  });

  it("clears + sets a new persisted value, returning it", () => {
    localStorage.setItem(ADBLOCK_DEVICE_ID_STORAGE_KEY, "old-device-id-value-1234567890ab");

    const next = randomizeAdBlockDeviceId();

    expect(next).not.toBe("old-device-id-value-1234567890ab");
    expect(next).toMatch(/^[a-z0-9]{32}$/);
    // Persisted under the same key the player seeds from on mount.
    expect(localStorage.getItem(ADBLOCK_DEVICE_ID_STORAGE_KEY)).toBe(next);
    expect(getAdBlockDeviceId()).toBe(next);
  });

  it("getAdBlockDeviceId returns null when none is stored", () => {
    expect(getAdBlockDeviceId()).toBeNull();
  });
});
